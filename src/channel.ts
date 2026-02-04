import type { ChannelPlugin, ClawdbotConfig } from "clawdbot/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, PAIRING_APPROVED_MESSAGE } from "clawdbot/plugin-sdk";
import type { ResolvedFeishuAccount, FeishuConfig } from "./types.js";
import { resolveFeishuAccount, resolveFeishuCredentials } from "./accounts.js";
import { feishuOutbound } from "./outbound.js";
import { probeFeishu } from "./probe.js";
import { resolveFeishuGroupToolPolicy } from "./policy.js";
import { normalizeFeishuTarget, looksLikeFeishuId, formatFeishuTarget } from "./targets.js";
import { sendMessageFeishu } from "./send.js";
import {
  listFeishuDirectoryPeers,
  listFeishuDirectoryGroups,
  listFeishuDirectoryPeersLive,
  listFeishuDirectoryGroupsLive,
} from "./directory.js";
import { feishuOnboardingAdapter } from "./onboarding.js";
import { clearAllBitableRecords } from "./big-video/bitable-video.js";

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
      "- **Bitable Video Analysis**: When a user wants to analyze a video from the bitable (多维表格), run: `npx tsx /home/ubuntu/.clawdbot/extensions/feishu/src/big-video/bitable-video-cli.ts --target <latest|number> --prompt \"用户的分析需求\" --notify-to \"chat:<chat_id>\" --notify-reply-to \"<message_id>\"`. The CLI outputs JSON to stdout with { text, cacheHit, gcsUri, durationMs, estimatedCostUsd }. Use --target latest for the most recent video, or --target <number> for a specific record number. Recognize user intent naturally — they might say '帮我分析最新的视频', '看看3号视频', '分析一下表格里的视频' etc.",
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

      startDailyBitableRecordClear({
        cfg: ctx.cfg,
        abortSignal: ctx.abortSignal,
        log: ctx.log?.info ? (msg) => ctx.log?.info(msg) : undefined,
      });

      return monitorFeishuProvider({
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },
  },
};

function startDailyBitableRecordClear(params: {
  cfg: ClawdbotConfig;
  abortSignal: AbortSignal;
  log?: (msg: string) => void;
}) {
  const log = params.log ?? console.log;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const scheduleNext = () => {
    clearTimer();
    if (params.abortSignal.aborted) return;

    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    const delayMs = Math.max(0, next.getTime() - now.getTime());

    timer = setTimeout(() => {
      void (async () => {
        if (params.abortSignal.aborted) return;
        if (running) return;
        running = true;
        try {
          const res = await clearAllBitableRecords({ cfg: params.cfg });
          log(`[bitable-clear] cleared records: deleted=${res.deleted}, total=${res.total}, batches=${res.batches}`);
        } catch (err) {
          log(`[bitable-clear] clear failed: ${err}`);
        } finally {
          running = false;
          scheduleNext();
        }
      })();
    }, delayMs);
  };

  params.abortSignal.addEventListener(
    "abort",
    () => {
      clearTimer();
    },
    { once: true },
  );

  scheduleNext();
}
