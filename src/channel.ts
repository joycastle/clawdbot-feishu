import type { ChannelPlugin, ClawdbotConfig } from "clawdbot/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, PAIRING_APPROVED_MESSAGE } from "clawdbot/plugin-sdk";
import type { ResolvedFeishuAccount, FeishuConfig } from "./types.js";
import { resolveFeishuAccount, resolveFeishuCredentials } from "./accounts.js";
import { feishuOutbound } from "./outbound.js";
import { probeFeishu } from "./probe.js";
import { resolveFeishuGroupToolPolicy } from "./policy.js";
import { normalizeFeishuTarget, looksLikeFeishuId, formatFeishuTarget } from "./targets.js";
import { sendMessageFeishu } from "./api/send.js";
import {
  listFeishuDirectoryPeers,
  listFeishuDirectoryGroups,
  listFeishuDirectoryPeersLive,
  listFeishuDirectoryGroupsLive,
} from "./directory.js";
import { feishuOnboardingAdapter } from "./onboarding.js";

const meta = {
  id: "feishu",
  label: "Feishu",
  selectionLabel: "Feishu/Lark (飞书)",
  docsPath: "/channels/feishu",
  docsLabel: "feishu",
  blurb: "飞书/Lark enterprise messaging.",
  aliases: ["lark"],
  order: 70,
} as const;

export const feishuPlugin: ChannelPlugin<ResolvedFeishuAccount> = {
  id: "feishu",
  meta: {
    ...meta,
  },
  pairing: {
    idLabel: "feishuUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(feishu|user|open_id):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      await sendMessageFeishu({
        cfg,
        to: id,
        text: PAIRING_APPROVED_MESSAGE,
      });
    },
  },
  capabilities: {
    chatTypes: ["direct", "channel"],
    polls: true,
    threads: true,
    media: true,
    reactions: true,
    edit: true,
    reply: true,
  },
  agentPrompt: {
    messageToolHints: () => [
      "- Feishu targeting: omit `target` to reply to the current conversation (auto-inferred). Explicit targets: `user:open_id` or `chat:chat_id`.",
      "- Feishu supports interactive cards for rich messages.",
      `- **Bitable Video Analysis (ONE COMMAND)**: When a user wants to analyze a video from the bitable (多维表格), run: \`npx tsx /home/ubuntu/.clawdbot/extensions/feishu/src/features/big-video/bitable-video-cli.ts --target <latest|number> --prompt "用户的分析需求" --to "user:<sender_open_id>" --reply-to "<message_id>" --sender "<sender_open_id>"\`. This uploads the video and sends an interactive confirm/cancel card automatically. User clicks confirm → Gemini analysis runs via card callback. No manual confirmation needed from agent. Recognize user intent naturally — '帮我分析最新的视频', '看看3号视频' etc.`,
      `- **飞书项目 API (localhost:18791)**: 当用户询问工作项、缺陷、任务相关内容时，用 curl 调用：`,
      `  - \`curl http://127.0.0.1:18791/types\` - 获取工作项类型（需求/缺陷/任务等）`,
      `  - \`curl http://127.0.0.1:18791/workitems?typeKey=issue\` - 查询缺陷列表`,
      `  - \`curl http://127.0.0.1:18791/workitems?typeKey=story\` - 查询需求列表`,
      `  - \`curl http://127.0.0.1:18791/workitem/123?typeKey=issue\` - 获取单个工作项详情`,
      `  - \`curl -X POST http://127.0.0.1:18791/workitem -H "Content-Type: application/json" -d '{"typeKey":"issue","name":"标题"}'\` - 创建工作项`,
      `  - \`curl -X POST http://127.0.0.1:18791/workitem/123/comment -H "Content-Type: application/json" -d '{"content":"评论内容"}'\` - 添加评论`,
      `  - 用户说"查一下缺陷"、"看看有什么任务"、"帮我建个bug"等，识别意图后调用对应 API`,
      `- **定时提醒/延时任务 (localhost:18797)**: 当用户要求在某个时间提醒、或者几分钟/几小时后执行任务时，用 curl 调用：`,
      `  - \`curl -X POST http://127.0.0.1:18797/add -H "Content-Type: application/json" -d '{"job":{"schedule":"in 5 minutes","text":"提醒内容"}}'\` - 添加延时任务（支持 "in 5 minutes", "at 14:00" 等）`,
      `  - \`curl http://127.0.0.1:18797/list\` - 查看当前所有定时任务`,
      `  - \`curl -X POST http://127.0.0.1:18797/remove -H "Content-Type: application/json" -d '{"id":"job_id"}'\` - 删除任务`,
    ],
  },
  actions: {
    listActions: () => ["poll"],
  },
  groups: {
    resolveToolPolicy: resolveFeishuGroupToolPolicy,
  },
  reload: { configPrefixes: ["channels.feishu"] },
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        appId: { type: "string" },
        appSecret: { type: "string" },
        encryptKey: { type: "string" },
        verificationToken: { type: "string" },
        domain: { type: "string", enum: ["feishu", "lark"] },
        connectionMode: { type: "string", enum: ["websocket", "webhook"] },
        webhookPath: { type: "string" },
        webhookPort: { type: "integer", minimum: 1 },
        dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
        allowFrom: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } },
        adminAllowFrom: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } },
        groupPolicy: { type: "string", enum: ["open", "allowlist", "disabled"] },
        groupAllowFrom: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } },
        requireMention: { type: "boolean" },
        historyLimit: { type: "integer", minimum: 0 },
        dmHistoryLimit: { type: "integer", minimum: 0 },
        textChunkLimit: { type: "integer", minimum: 1 },
        chunkMode: { type: "string", enum: ["length", "newline"] },
        mediaMaxMb: { type: "number", minimum: 0 },
        renderMode: { type: "string", enum: ["auto", "raw", "card"] },
        confirmMediaCost: { type: "boolean" },
        contextIsolation: { type: "boolean" },
      },
    },
  },
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg) => resolveFeishuAccount({ cfg }),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    setAccountEnabled: ({ cfg, enabled }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        feishu: {
          ...cfg.channels?.feishu,
          enabled,
        },
      },
    }),
    deleteAccount: ({ cfg }) => {
      const next = { ...cfg } as ClawdbotConfig;
      const nextChannels = { ...cfg.channels };
      delete (nextChannels as Record<string, unknown>).feishu;
      if (Object.keys(nextChannels).length > 0) {
        next.channels = nextChannels;
      } else {
        delete next.channels;
      }
      return next;
    },
    isConfigured: (_account, cfg) =>
      Boolean(resolveFeishuCredentials(cfg.channels?.feishu as FeishuConfig | undefined)),
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
    }),
    resolveAllowFrom: ({ cfg }) =>
      (cfg.channels?.feishu as FeishuConfig | undefined)?.allowFrom ?? [],
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    collectWarnings: ({ cfg }) => {
      const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
      const defaultGroupPolicy = (cfg.channels as Record<string, { groupPolicy?: string }> | undefined)?.defaults?.groupPolicy;
      const groupPolicy = feishuCfg?.groupPolicy ?? defaultGroupPolicy ?? "allowlist";
      if (groupPolicy !== "open") return [];
      return [
        `- Feishu groups: groupPolicy="open" allows any member to trigger (mention-gated). Set channels.feishu.groupPolicy="allowlist" + channels.feishu.groupAllowFrom to restrict senders.`,
      ];
    },
  },
  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        feishu: {
          ...cfg.channels?.feishu,
          enabled: true,
        },
      },
    }),
  },
  onboarding: feishuOnboardingAdapter,
  messaging: {
    normalizeTarget: normalizeFeishuTarget,
    targetResolver: {
      looksLikeId: looksLikeFeishuId,
      hint: "<chatId|user:openId|chat:chatId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, query, limit }) =>
      listFeishuDirectoryPeers({ cfg, query, limit }),
    listGroups: async ({ cfg, query, limit }) =>
      listFeishuDirectoryGroups({ cfg, query, limit }),
    listPeersLive: async ({ cfg, query, limit }) =>
      listFeishuDirectoryPeersLive({ cfg, query, limit }),
    listGroupsLive: async ({ cfg, query, limit }) =>
      listFeishuDirectoryGroupsLive({ cfg, query, limit }),
  },
  outbound: feishuOutbound,
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
      port: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      port: snapshot.port ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ cfg }) =>
      await probeFeishu(cfg.channels?.feishu as FeishuConfig | undefined),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      port: runtime?.port ?? null,
      probe,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const { monitorFeishuProvider } = await import("./monitor.js");
      const feishuCfg = ctx.cfg.channels?.feishu as FeishuConfig | undefined;
      const port = feishuCfg?.webhookPort ?? null;
      ctx.setStatus({ accountId: ctx.accountId, port });
      ctx.log?.info(`starting feishu provider (mode: ${feishuCfg?.connectionMode ?? "websocket"})`);

      return monitorFeishuProvider({
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },
  },
};
