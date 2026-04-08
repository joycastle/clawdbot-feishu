/**
 * virtual-vote — Agent tool for virtual user persona voting.
 *
 * Actions:
 *   help          — Show usage instructions
 *   list_groups   — List available game user groups
 *   vote_text     — Start a text-option vote
 *   vote_image    — Start an image vote (from merge_forward message)
 */

import { Type, type Static } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { FeishuConfig } from "../types.js";
import { resolveFeishuCredentials } from "../accounts.js";
import { sendCardFeishu, getMergeForwardMessages } from "../api/send.js";
import { downloadMessageResourceFeishu } from "../api/media.js";
import {
  loadPersonas,
  listAvailableGames,
  resolveGame,
  type PersonaLoaderConfig,
} from "../features/virtual-vote/persona-loader.js";
import {
  type VirtualVoteLLMConfig,
  type VirtualVoteLLMRuntime,
} from "../features/virtual-vote/llm-client.js";
import { buildProgressCard } from "../features/virtual-vote/result-card.js";
import { runVoteInBackground } from "../features/virtual-vote/vote-runner.js";

// ─── Schema ─────────────────────────────────────────────────────────────────

const GameEnum = Type.Union([
  Type.Literal("BF"),
  Type.Literal("MS"),
  Type.Literal("BV"),
]);

const VirtualVoteSchema = Type.Union([
  Type.Object({
    action: Type.Literal("help"),
  }),
  Type.Object({
    action: Type.Literal("list_groups"),
  }),
  Type.Object({
    action: Type.Literal("vote_text"),
    game: GameEnum,
    topic: Type.String({ description: "投票主题" }),
    options: Type.Array(Type.String(), {
      description: "文字选项列表，至少 2 个",
      minItems: 2,
    }),
    chat_id: Type.String({ description: "当前会话的 chat_id，用于发送结果卡片" }),
  }),
  Type.Object({
    action: Type.Literal("vote_image"),
    game: GameEnum,
    topic: Type.String({ description: "投票主题" }),
    source_message_id: Type.String({
      description: "包含图片的合并转发消息 message_id",
    }),
    chat_id: Type.String({ description: "当前会话的 chat_id，用于发送结果卡片" }),
  }),
]);

type VirtualVoteParams = Static<typeof VirtualVoteSchema>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function buildLoaderConfig(feishuCfg: FeishuConfig): PersonaLoaderConfig {
  const vv = (feishuCfg as any).virtualVote ?? {};
  const workspace = process.env.CLAWDBOT_WORKSPACE || process.env.OPENCLAW_WORKSPACE || "";
  return {
    personaBaseDir: vv.personaBaseDir || (workspace ? `${workspace}/虚拟用户` : "虚拟用户"),
    gameMapping: vv.gameMapping ?? { BV: "BF" },
  };
}

function buildLLMConfig(feishuCfg: FeishuConfig): VirtualVoteLLMConfig {
  const vv = (feishuCfg as any).virtualVote ?? {};
  return {
    model: vv.model ?? "anthropic/claude-opus-4-6",
    temperature: vv.temperature ?? 0.7,
    maxTokens: vv.maxTokens ?? 1024,
    maxConcurrent: vv.maxConcurrent ?? 6,
  };
}

// ─── Image Download ─────────────────────────────────────────────────────────

async function downloadMergeForwardImages(params: {
  cfg: any;
  sourceMessageId: string;
  log?: (msg: string) => void;
}): Promise<Array<{ data: string; mediaType: string }>> {
  const { cfg, sourceMessageId, log } = params;

  const mergeResult = await getMergeForwardMessages({ cfg, messageId: sourceMessageId });
  if (!mergeResult) {
    throw new Error("无法获取合并转发消息内容");
  }

  const imageItems = mergeResult.mediaItems.filter((m) => m.mediaType === "image");
  if (imageItems.length === 0) {
    throw new Error("合并转发消息中没有找到图片");
  }

  log?.(`virtual-vote: found ${imageItems.length} images in merge_forward`);

  const images: Array<{ data: string; mediaType: string }> = [];

  for (const item of imageItems) {
    const fileKey = item.imageKey || item.fileKey || "";
    if (!fileKey) continue;

    try {
      const result = await downloadMessageResourceFeishu({
        cfg,
        messageId: mergeResult.parentMessageId, // Must use parent message ID
        fileKey,
        type: "image",
      });

      const base64 = result.buffer.toString("base64");
      const mediaType = result.contentType || "image/png";
      images.push({ data: base64, mediaType });
      log?.(`virtual-vote: downloaded image ${fileKey}`);
    } catch (err) {
      log?.(`virtual-vote: failed to download image ${fileKey}: ${String(err)}`);
    }
  }

  return images;
}

// ─── Tool Registration ──────────────────────────────────────────────────────

export function registerVirtualVoteTool(api: OpenClawPluginApi) {
  // Capture runtime for model auth — available at registration time
  const pluginRuntime = (api as any).runtime;

  api.registerTool(
    (ctx) => {
      const feishuCfg = ctx.config?.channels?.feishu as FeishuConfig | undefined;
      const creds = resolveFeishuCredentials(feishuCfg);
      if (!creds) return null;

      // Only register if virtualVote config exists
      const vv = (feishuCfg as any)?.virtualVote;
      if (!vv) return null;

      const cfg = ctx.config!;
      const log = (msg: string) => console.log(`[virtual-vote] ${msg}`);

      // Build runtime context for LLM calls (reuses openclaw's provider auth)
      const llmRuntime: VirtualVoteLLMRuntime = {
        config: cfg as any,
        runtime: pluginRuntime,
      };

      return {
        name: "joycastle_virtual_vote",
        label: "虚拟用户投票",
        description:
          "发起虚拟用户投票，让虚拟用户群基于画像人设对方案/设计进行投票评选。\n" +
          "游戏用户群：\n" +
          "- BF (Bingo Frenzy): 休闲游戏用户群(Bingo/Coin/Board品类)，36个画像，覆盖US/GB/DE/FR/JP/KR/AU/CA/IT/ES\n" +
          "- MS (Matching Story): 三消游戏用户群(Match-3品类)，20个画像\n" +
          "- BV (Bingo Voyage): 与BF共享同一套画像\n" +
          "当用户提到Bingo Frenzy/BF/休闲/Bingo/Coin相关 → BF；三消/消除/match/Matching Story → MS；Bingo Voyage/BV → BV。\n" +
          "支持 help 查看使用方法、list_groups 查看可用用户群、vote_text 文字投票、vote_image 图片投票（需要合并转发消息的message_id）。",
        parameters: VirtualVoteSchema,
        async execute(_id: string, params: VirtualVoteParams) {
          try {
            const loaderCfg = buildLoaderConfig(feishuCfg!);

            switch (params.action) {
              // ── Help ──────────────────────────────────────────────────
              case "help": {
                const games = await listAvailableGames(loaderCfg);
                return json({
                  tool: "虚拟用户投票",
                  description: "让虚拟用户群基于画像人设对方案/设计进行投票评选。每个虚拟用户会根据自己的背景、年龄、消费习惯、游戏偏好独立做出选择并给出理由。",
                  games: games.map((g) => ({
                    code: g.game,
                    personas: g.count,
                    available: g.available,
                    note:
                      g.game === "BV"
                        ? `与 ${g.resolvedGame} 共享画像`
                        : undefined,
                  })),
                  actions: {
                    help: "查看本使用说明",
                    list_groups: "查看可用用户群及画像数量",
                    vote_text: "文字选项投票 — 提供选项文字列表，适合功能方案/活动主题评选",
                    vote_image:
                      "图片投票 — 用户先合并转发图片消息，再 @机器人。传入合并转发的 source_message_id，图片按顺序作为选项",
                  },
                  examples: [
                    "用BF用户群对这5张活动设计图投票（配合合并转发图片）",
                    "用MS用户群投票：限时折扣 / 免费试玩 / 社交分享奖励，哪个更吸引用户",
                    "帮我看看BV用户群有哪些人",
                  ],
                });
              }

              // ── List Groups ───────────────────────────────────────────
              case "list_groups": {
                const games = await listAvailableGames(loaderCfg);
                return json({ games });
              }

              // ── Vote Text ─────────────────────────────────────────────
              case "vote_text": {
                const personaIndex = await loadPersonas(loaderCfg, params.game);
                if (!personaIndex || personaIndex.count === 0) {
                  return json({
                    error: `${params.game} 用户群画像未找到或为空`,
                    hint: `画像目录: ${loaderCfg.personaBaseDir}/${resolveGame(params.game, loaderCfg.gameMapping)}`,
                  });
                }

                const llmCfg = buildLLMConfig(feishuCfg!);

                // Send progress card immediately
                const progressCard = buildProgressCard({
                  game: params.game,
                  topic: params.topic,
                  totalPersonas: personaIndex.count,
                  completedCount: 0,
                  status: "running",
                });
                const cardResult = await sendCardFeishu({
                  cfg,
                  to: params.chat_id,
                  card: progressCard,
                });

                // Fire-and-forget background execution
                runVoteInBackground({
                  cfg,
                  llmCfg: { ...llmCfg },
                  llmRuntime,
                  cardMessageId: cardResult.messageId,
                  chatId: params.chat_id,
                  game: params.game,
                  topic: params.topic,
                  options: params.options,
                  personas: personaIndex.personas,
                  log,
                }).catch((err) => log(`background error: ${String(err)}`));

                return json({
                  status: "started",
                  game: params.game,
                  personaCount: personaIndex.count,
                  optionCount: params.options.length,
                  model: llmCfg.model,
                  maxConcurrent: llmCfg.maxConcurrent,
                  message: `虚拟投票已启动，${personaIndex.count} 个用户正在投票，结果将更新到卡片中。`,
                });
              }

              // ── Vote Image ────────────────────────────────────────────
              case "vote_image": {
                const personaIndex = await loadPersonas(loaderCfg, params.game);
                if (!personaIndex || personaIndex.count === 0) {
                  return json({
                    error: `${params.game} 用户群画像未找到或为空`,
                    hint: `画像目录: ${loaderCfg.personaBaseDir}/${resolveGame(params.game, loaderCfg.gameMapping)}`,
                  });
                }

                // Download images from merge_forward message
                const images = await downloadMergeForwardImages({
                  cfg,
                  sourceMessageId: params.source_message_id,
                  log,
                });

                if (images.length < 2) {
                  return json({
                    error: `只获取到 ${images.length} 张图片，至少需要 2 张`,
                  });
                }

                const llmCfg = buildLLMConfig(feishuCfg!);

                // Send progress card
                const progressCard = buildProgressCard({
                  game: params.game,
                  topic: params.topic,
                  totalPersonas: personaIndex.count,
                  completedCount: 0,
                  status: "running",
                });
                const cardResult = await sendCardFeishu({
                  cfg,
                  to: params.chat_id,
                  card: progressCard,
                });

                // Fire-and-forget
                runVoteInBackground({
                  cfg,
                  llmCfg: { ...llmCfg },
                  llmRuntime,
                  cardMessageId: cardResult.messageId,
                  chatId: params.chat_id,
                  game: params.game,
                  topic: params.topic,
                  images,
                  personas: personaIndex.personas,
                  log,
                }).catch((err) => log(`background error: ${String(err)}`));

                return json({
                  status: "started",
                  game: params.game,
                  personaCount: personaIndex.count,
                  imageCount: images.length,
                  model: llmCfg.model,
                  maxConcurrent: llmCfg.maxConcurrent,
                  message: `图片投票已启动，${images.length} 张图片、${personaIndex.count} 个用户正在投票，结果将更新到卡片中。`,
                });
              }

              default:
                return json({ error: `Unknown action: ${(params as any).action}` });
            }
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : String(err) });
          }
        },
      };
    },
    { name: "joycastle_virtual_vote" },
  );
}
