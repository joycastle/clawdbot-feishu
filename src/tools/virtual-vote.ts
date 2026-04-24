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
import { sendCardFeishu, getMergeForwardMessages, getMessageFeishu } from "../api/send.js";
import { downloadMessageResourceFeishu } from "../api/media.js";
import { lookupMedia, hasImageMedia } from "../media-cache.js";
import {
  loadPersonas,
  listAvailableGames,
  resolveGame,
  type PersonaLoaderConfig,
} from "../features/virtual-vote/persona-loader.js";
import { parseTopicOptions } from "../features/virtual-vote/topic-parser.js";
import {
  type VirtualVoteLLMConfig,
  type VirtualVoteLLMRuntime,
} from "../features/virtual-vote/llm-client.js";
import { buildProgressCard, buildEvalProgressCard } from "../features/virtual-vote/result-card.js";
import { runVoteInBackground, runEvalInBackground } from "../features/virtual-vote/vote-runner.js";
import { extractFeishuDocUrls, fetchFeishuDocContent } from "../features/doc-parser.js";
import { getFeishuRuntime } from "../runtime.js";
import { parseMediaKeys, parsePostContent } from "../message-parsers.js";

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
    options: Type.Optional(Type.Array(Type.String(), {
      description: "文字选项列表。如果用户在 topic 中已包含选项（如'A vs B vs C'），可省略此字段，系统会自动提取",
    })),
    chat_id: Type.String({ description: "当前会话的 chat_id，用于发送结果卡片" }),
    source_message_id: Type.Optional(Type.String({
      description: "当前消息的 message_id（MessageSid），用于检测消息是否包含图片",
    })),
  }),
  Type.Object({
    action: Type.Literal("vote_image"),
    game: GameEnum,
    topic: Type.String({ description: "投票主题" }),
    source_message_id: Type.String({
      description: "包含图片的消息 message_id。支持合并转发消息、包含多图的富文本(post)消息、单张图片消息、或引用消息的 message_id",
    }),
    chat_id: Type.String({ description: "当前会话的 chat_id，用于发送结果卡片" }),
  }),
  Type.Object({
    action: Type.Literal("evaluate_doc"),
    game: GameEnum,
    topic: Type.Optional(Type.String({ description: "评估主题（可选，不填则自动使用文档标题）" })),
    doc_url: Type.String({
      description: "飞书文档 URL，支持 wiki/docx/docs 格式，如 https://xxx.feishu.cn/wiki/xxx 或 https://xxx.feishu.cn/docx/xxx",
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

/**
 * Extract the real Feishu chat target from tool ctx or params.
 * Prefers ctx.sessionKey parsing (reliable), falls back to params.chat_id.
 *
 * sessionKey formats:
 *   agent:main:feishu:dm:ou_xxx:thread:om_xxx     → DM, target = ou_xxx
 *   agent:main:feishu:group:oc_xxx:thread:om_xxx   → Group, target = oc_xxx
 *   agent:main:feishu:group:oc_xxx                  → Group, target = oc_xxx
 */
function resolveChatTarget(ctx: { sessionKey?: string }, paramChatId: string, log?: (msg: string) => void): string {
  // Agent-provided chat_id is the most reliable source — it comes from
  // the actual message context (ctx.chatId in bot.ts). Use it directly.
  // Only strip "user:" or "chat:" prefixes via normalizeFeishuTarget-style logic.
  const cleaned = paramChatId.replace(/^(user|chat):/, "").trim();
  if (cleaned && (cleaned.startsWith("oc_") || cleaned.startsWith("ou_"))) {
    log?.(`using agent chat_id: ${cleaned}`);
    return cleaned;
  }

  // Fallback: parse sessionKey
  const sk = ctx.sessionKey ?? "";
  const groupMatch = sk.match(/:group:(oc_[^:]+)/);
  if (groupMatch) {
    log?.(`fallback to sessionKey group: ${groupMatch[1]}`);
    return groupMatch[1];
  }
  const dmMatch = sk.match(/:dm:(ou_[^:]+)/);
  if (dmMatch) {
    log?.(`fallback to sessionKey dm: ${dmMatch[1]}`);
    return dmMatch[1];
  }
  log?.(`could not resolve chat target, using raw: ${paramChatId}`);
  return paramChatId;
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

// Image/post parsing uses shared utilities from message-parsers.ts

/**
 * Resolve a single image by key: try local cache first, fallback to Feishu API.
 */
async function resolveOneImage(params: {
  cfg: any;
  messageId: string;
  imageKey: string;
  log?: (msg: string) => void;
}): Promise<{ data: string; mediaType: string } | null> {
  const { cfg, messageId, imageKey, log } = params;

  // Try local cache (bot.ts already downloaded this, keyed by messageId + imageKey)
  const cached = lookupMedia(messageId, imageKey);
  if (cached) {
    try {
      const { readFile } = await import("fs/promises");
      const buffer = await readFile(cached.localPath);
      log?.(`virtual-vote: cache hit for ${imageKey} → ${cached.localPath}`);
      return { data: buffer.toString("base64"), mediaType: cached.contentType || "image/png" };
    } catch {
      log?.(`virtual-vote: cache file unreadable for ${imageKey}, falling back to API`);
    }
  }

  // Fallback: download from Feishu API
  try {
    const result = await downloadMessageResourceFeishu({
      cfg,
      messageId,
      fileKey: imageKey,
      type: "image",
    });
    log?.(`virtual-vote: API download for ${imageKey}`);
    return { data: result.buffer.toString("base64"), mediaType: result.contentType || "image/png" };
  } catch (err) {
    log?.(`virtual-vote: failed to download image ${imageKey}: ${String(err)}`);
    return null;
  }
}

/**
 * Download images from a message, supporting multiple message types:
 * - merge_forward: extract images from sub-messages
 * - image: single image message
 * - post: rich text with embedded images
 *
 * Also handles quoted/replied messages by resolving the parent message.
 */
async function downloadImagesFromMessage(params: {
  cfg: any;
  messageId: string;
  log?: (msg: string) => void;
}): Promise<Array<{ data: string; mediaType: string }>> {
  const { cfg, messageId, log } = params;

  // Get message info to determine type
  let msgInfo = await getMessageFeishu({ cfg, messageId });
  if (!msgInfo) {
    throw new Error(`无法获取消息 ${messageId}`);
  }

  log?.(`virtual-vote: message type="${msgInfo.contentType}" id=${messageId}`);

  // If the message itself has no images (e.g. text), check if it quotes/replies to
  // a message that contains images, and follow the reference.
  const noImageTypes = new Set(["text"]);
  if (noImageTypes.has(msgInfo.contentType) && msgInfo.parentId) {
    log?.(`virtual-vote: message is "${msgInfo.contentType}" with parentId=${msgInfo.parentId}, following quoted message`);
    const parentMsg = await getMessageFeishu({ cfg, messageId: msgInfo.parentId });
    if (parentMsg) {
      msgInfo = parentMsg;
      log?.(`virtual-vote: resolved to quoted message type="${msgInfo.contentType}" id=${msgInfo.messageId}`);
    }
  }

  const images: Array<{ data: string; mediaType: string }> = [];
  const targetMessageId = msgInfo.messageId;

  switch (msgInfo.contentType) {
    case "merge_forward": {
      const mergeResult = await getMergeForwardMessages({ cfg, messageId: targetMessageId });
      if (!mergeResult) {
        throw new Error("无法获取合并转发消息内容");
      }
      const imageItems = mergeResult.mediaItems.filter((m) => m.mediaType === "image");
      log?.(`virtual-vote: found ${imageItems.length} images in merge_forward`);

      const resolved = await Promise.all(
        imageItems.map((item) => {
          const fileKey = item.imageKey || item.fileKey || "";
          if (!fileKey) return null;
          return resolveOneImage({ cfg, messageId: mergeResult.parentMessageId, imageKey: fileKey, log });
        }),
      );
      for (const img of resolved) {
        if (img) images.push(img);
      }
      break;
    }

    case "image": {
      const { imageKey } = parseMediaKeys(msgInfo.content, "image");
      if (imageKey) {
        const img = await resolveOneImage({ cfg, messageId: targetMessageId, imageKey, log });
        if (img) images.push(img);
      }
      break;
    }

    case "post": {
      const { imageKeys } = parsePostContent(msgInfo.content);
      log?.(`virtual-vote: found ${imageKeys.length} images in post message`);
      for (const key of imageKeys) {
        const img = await resolveOneImage({ cfg, messageId: targetMessageId, imageKey: key, log });
        if (img) images.push(img);
      }
      break;
    }

    default:
      log?.(`virtual-vote: no images found — message type "${msgInfo.contentType}", no parentId to follow`);
  }

  return images;
}

// ─── Tool Registration ──────────────────────────────────────────────────────

export function registerVirtualVoteTool(api: OpenClawPluginApi) {
  api.registerTool(
    (ctx) => {
      const feishuCfg = ctx.config?.channels?.feishu as FeishuConfig | undefined;
      const creds = resolveFeishuCredentials(feishuCfg);
      if (!creds) {
        console.log(`[virtual-vote] tool factory: no feishu credentials, skipping registration`);
        return null;
      }

      // Only register if virtualVote config exists
      const vv = (feishuCfg as any)?.virtualVote;
      if (!vv) {
        console.log(`[virtual-vote] tool factory: no virtualVote config found, skipping registration`);
        return null;
      }

      console.log(`[virtual-vote] tool factory: registering persona_vote (model=${vv.model ?? "default"})`);

      const cfg = ctx.config!;
      const log = (msg: string) => console.log(`[virtual-vote] ${msg}`);

      // Build runtime context for LLM calls (reuses openclaw's provider auth)
      const llmRuntime: VirtualVoteLLMRuntime = {
        config: cfg as any,
        runtime: getFeishuRuntime(),
      };

      return {
        name: "persona_vote",
        label: "虚拟用户投票",
        description:
          "发起虚拟用户投票，让虚拟用户群基于画像人设对方案/设计进行投票评选。\n" +
          "游戏用户群：\n" +
          "- BF (Bingo Frenzy): 休闲游戏用户群(Bingo/Coin/Board品类)，36个画像，覆盖US/GB/DE/FR/JP/KR/AU/CA/IT/ES\n" +
          "- MS (Matching Story): 三消游戏用户群(Match-3品类)，20个画像\n" +
          "- BV (Bingo Voyage): 与BF共享同一套画像\n" +
          "当用户提到Bingo Frenzy/BF/休闲/Bingo/Coin相关 → BF；三消/消除/match/Matching Story → MS；Bingo Voyage/BV → BV。\n" +
          "支持 help/list_groups/vote_text/vote_image/evaluate_doc 五种 action。\n" +
          "evaluate_doc: 当消息中包含飞书文档链接或「--- 飞书文档: xxx ---」格式的文档内容时，使用 evaluate_doc，" +
          "传入 doc_url（飞书文档URL）让虚拟用户评价文档是否吸引。topic 可不填，自动取文档标题。\n" +
          "**重要：当消息中包含图片（或引用了包含图片的消息）时，必须使用 vote_image action 并传入 source_message_id，" +
          "让虚拟用户直接看到原图来投票。绝对不要自己描述图片内容后用 vote_text——虚拟用户必须看到原始图片才能做出准确判断。**\n" +
          "vote_text 仅用于纯文字选项（如功能方案、活动主题等无图片无文档的场景）。\n" +
          "图片投票的 source_message_id 支持：合并转发消息、富文本(post)多图消息、单张图片消息、引用含图消息的 message_id。",
        parameters: VirtualVoteSchema,
        async execute(_id: string, params: VirtualVoteParams) {
          log(`execute called — action=${params.action}, params=${JSON.stringify(params)}`);

          // Resolve real chat target from sessionKey (reliable) instead of agent-provided chat_id
          const chatTarget = "chat_id" in params
            ? resolveChatTarget(ctx, params.chat_id, log)
            : "";
          if ("chat_id" in params) {
            log(`chat target: agent said "${params.chat_id}", resolved to "${chatTarget}"`);
          }
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
                    evaluate_doc:
                      "文档评估 — 传入飞书文档URL，虚拟用户阅读文档内容后判断是否吸引，并给出吸引和不吸引的理由",
                  },
                  examples: [
                    "用BF用户群对这5张活动设计图投票（配合合并转发图片）",
                    "用MS用户群投票：限时折扣 / 免费试玩 / 社交分享奖励，哪个更吸引用户",
                    "帮我看看BV用户群有哪些人",
                    "用BF用户群评估这个飞书文档的活动方案是否吸引：https://xxx.feishu.cn/wiki/xxx",
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
                // Guard: if current message has images in cache, agent must use vote_image
                const hasMsgId = !!params.source_message_id;
                const hasImages = hasMsgId && hasImageMedia(params.source_message_id!);
                log(`vote_text guard: source_message_id=${params.source_message_id ?? "none"}, hasImages=${hasImages}`);
                if (hasImages) {
                  log("vote_text rejected — message has cached images, must use vote_image");
                  return json({
                    error: "当前消息包含图片资源，请改用 vote_image action 并传入 source_message_id，让虚拟用户直接看到原图投票。",
                    hint: "使用 action=vote_image, source_message_id=" + params.source_message_id,
                  });
                }

                const llmCfg = buildLLMConfig(feishuCfg!);

                // Resolve options: use provided options, or parse from topic
                let voteTopic = params.topic;
                let voteOptions = params.options;
                if (!voteOptions || voteOptions.length < 2) {
                  log(`vote_text: options missing or insufficient, parsing from topic`);
                  const parsed = await parseTopicOptions(params.topic, llmCfg, llmRuntime, log);
                  if (parsed.options.length >= 2) {
                    voteTopic = parsed.topic;
                    voteOptions = parsed.options;
                    log(`vote_text: parsed ${voteOptions.length} options from topic`);
                  } else {
                    return json({
                      error: "无法从主题中识别出投票选项（至少需要 2 个），请明确提供 options 参数",
                      hint: "示例：options=[\"选项A\", \"选项B\", \"选项C\"]",
                    });
                  }
                }

                const personaIndex = await loadPersonas(loaderCfg, params.game);

                // Send progress card immediately
                const progressCard = buildProgressCard({
                  game: params.game,
                  topic: voteTopic,
                  totalPersonas: personaIndex.count,
                  completedCount: 0,
                  status: "running",
                });
                log(`sending progress card to chat_id=${params.chat_id}`);
                let cardResult: { messageId: string };
                try {
                  cardResult = await sendCardFeishu({
                    cfg,
                    to: chatTarget,
                    card: progressCard,
                  });
                  log(`progress card sent, messageId=${cardResult.messageId}`);
                } catch (cardErr) {
                  log(`failed to send progress card: ${String(cardErr)}`);
                  return json({ error: `发送进度卡片失败: ${String(cardErr)}`, chat_id: chatTarget });
                }

                // Fire-and-forget background execution
                runVoteInBackground({
                  cfg,
                  llmCfg: { ...llmCfg },
                  llmRuntime,
                  cardMessageId: cardResult.messageId,
                  chatId: chatTarget,
                  game: params.game,
                  topic: voteTopic,
                  options: voteOptions,
                  personas: personaIndex.personas,
                  log,
                }).catch((err) => log(`background error: ${String(err)}`));

                return json({
                  status: "started",
                  game: params.game,
                  personaCount: personaIndex.count,
                  optionCount: voteOptions.length,
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

                // Download images from source message (supports merge_forward, post, image, quoted)
                const images = await downloadImagesFromMessage({
                  cfg,
                  messageId: params.source_message_id,
                  log,
                });

                if (images.length < 1) {
                  return json({
                    error: `只获取到 ${images.length} 张图片，至少需要 1 张`,
                  });
                }

                const llmCfg = buildLLMConfig(feishuCfg!);

                // Try to extract option labels from topic
                let imageTopic = params.topic;
                let imageLabels: string[] | undefined;
                let imageTextOptions: string[] | undefined;
                const parsedImage = await parseTopicOptions(params.topic, llmCfg, llmRuntime, log);
                if (parsedImage.options.length > 0) {
                  imageTopic = parsedImage.topic;
                  if (parsedImage.options.length === images.length) {
                    // Options count matches images → use as image labels
                    imageLabels = parsedImage.options;
                    log(`vote_image: matched ${imageLabels.length} labels to ${images.length} images`);
                  } else {
                    // Options count doesn't match → use as text vote options (e.g. rating scale + images)
                    imageTextOptions = parsedImage.options;
                    log(`vote_image: using ${imageTextOptions.length} extracted options as text vote options alongside ${images.length} images`);
                  }
                }

                // Send progress card
                const progressCard = buildProgressCard({
                  game: params.game,
                  topic: imageTopic,
                  totalPersonas: personaIndex.count,
                  completedCount: 0,
                  status: "running",
                });
                log(`sending progress card to chat_id=${params.chat_id}`);
                let cardResult: { messageId: string };
                try {
                  cardResult = await sendCardFeishu({
                    cfg,
                    to: chatTarget,
                    card: progressCard,
                  });
                  log(`progress card sent, messageId=${cardResult.messageId}`);
                } catch (cardErr) {
                  log(`failed to send progress card: ${String(cardErr)}`);
                  return json({ error: `发送进度卡片失败: ${String(cardErr)}`, chat_id: chatTarget });
                }

                // Fire-and-forget
                runVoteInBackground({
                  cfg,
                  llmCfg: { ...llmCfg },
                  llmRuntime,
                  cardMessageId: cardResult.messageId,
                  chatId: chatTarget,
                  game: params.game,
                  topic: imageTopic,
                  options: imageTextOptions,
                  images,
                  imageLabels,
                  personas: personaIndex.personas,
                  log,
                }).catch((err) => log(`background error: ${String(err)}`));

                return json({
                  status: "started",
                  game: params.game,
                  personaCount: personaIndex.count,
                  imageCount: images.length,
                  optionCount: imageTextOptions?.length,
                  model: llmCfg.model,
                  maxConcurrent: llmCfg.maxConcurrent,
                  message: `图片投票已启动，${images.length} 张图片、${personaIndex.count} 个用户正在投票，结果将更新到卡片中。`,
                });
              }

              // ── Evaluate Doc ────────────────────────────────────────────
              case "evaluate_doc": {
                // Parse Feishu doc URL
                const docUrls = extractFeishuDocUrls(params.doc_url);
                if (docUrls.length === 0) {
                  return json({
                    error: "无法识别飞书文档 URL，请确认链接格式正确（支持 wiki/docx/docs）",
                    hint: "示例：https://xxx.feishu.cn/wiki/xxx 或 https://xxx.feishu.cn/docx/xxx",
                  });
                }

                // Fetch document content
                const docResult = await fetchFeishuDocContent(feishuCfg!, docUrls[0], log);
                if (!docResult) {
                  return json({
                    error: "无法获取飞书文档内容，请确认文档权限和链接有效性",
                  });
                }

                if (!docResult.content || docResult.content === "(文档内容为空)") {
                  return json({
                    error: "飞书文档内容为空",
                    title: docResult.title,
                  });
                }

                const evalTopic = params.topic || docResult.title;
                log?.(`evaluate_doc: fetched doc "${docResult.title}", topic="${evalTopic}", content ${docResult.content.length} chars`);

                const personaIndex = await loadPersonas(loaderCfg, params.game);
                if (!personaIndex || personaIndex.count === 0) {
                  return json({
                    error: `${params.game} 用户群画像未找到或为空`,
                    hint: `画像目录: ${loaderCfg.personaBaseDir}/${resolveGame(params.game, loaderCfg.gameMapping)}`,
                  });
                }

                const llmCfg = buildLLMConfig(feishuCfg!);

                // Send progress card
                const evalProgressCard = buildEvalProgressCard({
                  game: params.game,
                  topic: evalTopic,
                  docTitle: docResult.title,
                  totalPersonas: personaIndex.count,
                  completedCount: 0,
                  status: "running",
                });
                log?.(`sending eval progress card to chat_id=${params.chat_id}`);
                let evalCardResult: { messageId: string };
                try {
                  evalCardResult = await sendCardFeishu({
                    cfg,
                    to: chatTarget,
                    card: evalProgressCard,
                  });
                  log?.(`eval progress card sent, messageId=${evalCardResult.messageId}`);
                } catch (cardErr) {
                  log?.(`failed to send eval progress card: ${String(cardErr)}`);
                  return json({ error: `发送进度卡片失败: ${String(cardErr)}`, chat_id: chatTarget });
                }

                // Fire-and-forget background execution
                runEvalInBackground({
                  cfg,
                  llmCfg: { ...llmCfg },
                  llmRuntime,
                  cardMessageId: evalCardResult.messageId,
                  chatId: chatTarget,
                  game: params.game,
                  topic: evalTopic,
                  docTitle: docResult.title,
                  docContent: docResult.content,
                  personas: personaIndex.personas,
                  log,
                }).catch((err) => log?.(`background eval error: ${String(err)}`));

                return json({
                  status: "started",
                  game: params.game,
                  personaCount: personaIndex.count,
                  docTitle: docResult.title,
                  model: llmCfg.model,
                  maxConcurrent: llmCfg.maxConcurrent,
                  message: `文档评估已启动，${personaIndex.count} 个虚拟用户正在阅读和评估文档「${docResult.title}」，结果将更新到卡片中。`,
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
    { name: "persona_vote" },
  );
}
