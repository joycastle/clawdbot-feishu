import type { ClawdbotConfig, RuntimeEnv } from "clawdbot/plugin-sdk";
import {
  buildPendingHistoryContextFromMap,
  recordPendingHistoryEntryIfEnabled,
  clearHistoryEntriesIfEnabled,
  DEFAULT_GROUP_HISTORY_LIMIT,
  type HistoryEntry,
} from "clawdbot/plugin-sdk";
import type { FeishuConfig, FeishuMessageContext, FeishuMediaInfo, MentionTarget } from "./types.js";
import { createFeishuClient } from "./client.js";
import { getFeishuRuntime } from "./runtime.js";
import { downloadFeishuDocMediaByUrl, enrichMessageWithDocs } from "./features/doc-parser.js";
import { resolveFeishuGroupConfig, resolveFeishuReplyPolicy, resolveFeishuAllowlistMatch, isFeishuGroupAllowed } from "./policy.js";
import { createFeishuReplyDispatcher } from "./reply-dispatcher.js";
import { getMessageFeishu, getMergeForwardMessages, sendMarkdownCardFeishu, sendMessageFeishu } from "./api/send.js";
import { downloadImageFeishu, downloadMessageResourceFeishu } from "./api/media.js";
import { sendMediaConfirmCard } from "./features/media-confirm.js";
// Video analysis is now handled by the LLM agent via bitable-video-cli.ts
// instead of hard-coded regex interception. See bitable-video-cli.ts.
import fs from "fs";
import {
  disableDevLock,
  enableDevLock,
  getDevLockSnapshot,
  getUsageSnapshot,
  isDevLockEnabled,
  isFeishuAdmin,
  markFeishuUserActive,
  startInFlightJob,
  endInFlightJob,
} from "./features/dev-lock.js";

export type FeishuMessageEvent = {
  sender: {
    sender_id: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type?: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    chat_id: string;
    chat_type: "p2p" | "group";
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id: {
        open_id?: string;
        user_id?: string;
        union_id?: string;
      };
      name: string;
      tenant_key?: string;
    }>;
  };
};

export type FeishuBotAddedEvent = {
  chat_id: string;
  operator_id: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
  };
  external: boolean;
  operator_tenant_key?: string;
};

const SENDER_NAME_TTL_MS = 10 * 60 * 1000;
const senderNameCache = new Map<string, { name: string; expireAt: number }>();

async function resolveFeishuSenderName(params: {
  cfg: ClawdbotConfig;
  senderOpenId: string;
  log: (...args: any[]) => void;
}): Promise<string | undefined> {
  const { cfg, senderOpenId, log } = params;
  if (!senderOpenId) {
    return undefined;
  }
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    return undefined;
  }
  const cached = senderNameCache.get(senderOpenId);
  const now = Date.now();
  if (cached && cached.expireAt > now) {
    return cached.name;
  }
  try {
    const client = createFeishuClient(feishuCfg);
    const res: any = await client.contact.user.get({
      path: { user_id: senderOpenId },
      params: { user_id_type: "open_id" },
    });
    const name: string | undefined =
      res?.data?.user?.name ||
      res?.data?.user?.display_name ||
      res?.data?.user?.nickname ||
      res?.data?.user?.en_name;
    if (name && typeof name === "string") {
      senderNameCache.set(senderOpenId, { name, expireAt: now + SENDER_NAME_TTL_MS });
      return name;
    }
    return undefined;
  } catch (err) {
    log(`feishu: failed to resolve sender name for ${senderOpenId}: ${String(err)}`);
    return undefined;
  }
}

function parseMessageContent(content: string, messageType: string): string {
  try {
    const parsed = JSON.parse(content);
    if (messageType === "text") {
      return parsed.text || "";
    }
    if (messageType === "post") {
      // Extract text content from rich text post
      const { textContent } = parsePostContent(content);
      return textContent;
    }
    return content;
  } catch {
    return content;
  }
}

function checkBotMentioned(event: FeishuMessageEvent, botOpenId?: string): boolean {
  const mentions = event.message.mentions ?? [];
  if (mentions.length === 0) return false;
  if (!botOpenId) return mentions.length > 0;
  return mentions.some((m) => m.id.open_id === botOpenId);
}

function stripBotMention(text: string, mentions?: FeishuMessageEvent["message"]["mentions"]): string {
  if (!mentions || mentions.length === 0) return text;
  let result = text;
  for (const mention of mentions) {
    result = result.replace(new RegExp(`@${mention.name}\\s*`, "g"), "").trim();
    result = result.replace(new RegExp(mention.key, "g"), "").trim();
  }
  return result;
}

function extractMentionTargets(
  event: FeishuMessageEvent,
  botOpenId?: string,
): MentionTarget[] {
  const mentions = event.message.mentions ?? [];
  return mentions
    .filter((m) => {
      if (botOpenId && m.id.open_id === botOpenId) {
        return false;
      }
      return !!m.id.open_id;
    })
    .map((m) => ({
      openId: m.id.open_id!,
      name: m.name,
      key: m.key,
    }));
}

function isMentionForwardRequest(event: FeishuMessageEvent, botOpenId?: string): boolean {
  const mentions = event.message.mentions ?? [];
  if (mentions.length === 0) {
    return false;
  }
  const isDirectMessage = event.message.chat_type === "p2p";
  const hasOtherMention = mentions.some((m) => m.id.open_id !== botOpenId);
  if (isDirectMessage) {
    return hasOtherMention;
  }
  const hasBotMention = mentions.some((m) => m.id.open_id === botOpenId);
  return hasBotMention && hasOtherMention;
}

function extractMessageBody(text: string, allMentionKeys: string[]): string {
  let result = text;
  for (const key of allMentionKeys) {
    result = result.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "");
  }
  return result.replace(/\s+/g, " ").trim();
}

/**
 * Convert message content to human-readable text based on message type.
 * For media messages, return a friendly placeholder instead of raw JSON.
 */
function formatQuotedContent(content: string, contentType: string): string {
  // Text messages: return parsed text
  if (contentType === "text") {
    try {
      const parsed = JSON.parse(content);
      return parsed.text || content;
    } catch {
      return content;
    }
  }

  // Post (rich text): extract text content
  if (contentType === "post") {
    const { textContent } = parsePostContent(content);
    return textContent;
  }

  // Media types: return friendly placeholder
  const mediaLabels: Record<string, string> = {
    image: "[图片]",
    file: "[文件]",
    audio: "[语音]",
    video: "[视频]",
    sticker: "[表情]",
  };

  return mediaLabels[contentType] || `[${contentType}]`;
}

/**
 * Parse media keys from message content based on message type.
 */
function parseMediaKeys(
  content: string,
  messageType: string,
): {
  imageKey?: string;
  fileKey?: string;
  fileName?: string;
} {
  try {
    const parsed = JSON.parse(content);
    switch (messageType) {
      case "image":
        return { imageKey: parsed.image_key };
      case "file":
        return { fileKey: parsed.file_key, fileName: parsed.file_name };
      case "audio":
        return { fileKey: parsed.file_key };
      case "video":
      case "media":
        // Video/media has both file_key (video) and image_key (thumbnail)
        return { fileKey: parsed.file_key, imageKey: parsed.image_key };
      case "sticker":
        return { fileKey: parsed.file_key };
      default:
        return {};
    }
  } catch {
    return {};
  }
}

/**
 * Parse post (rich text) content and extract embedded image keys.
 * Post structure: { title?: string, content: [[{ tag, text?, image_key?, ... }]] }
 */
function parsePostContent(content: string): {
  textContent: string;
  imageKeys: string[];
  mediaKeys: { fileKey: string; imageKey?: string }[];
} {
  try {
    const parsed = JSON.parse(content);
    const title = parsed.title || "";
    const contentBlocks = parsed.content || [];
    let textContent = title ? `${title}\n\n` : "";
    const imageKeys: string[] = [];
    const mediaKeys: { fileKey: string; imageKey?: string }[] = [];

    for (const paragraph of contentBlocks) {
      if (Array.isArray(paragraph)) {
        for (const element of paragraph) {
          if (element.tag === "text") {
            textContent += element.text || "";
          } else if (element.tag === "a") {
            // Link: show text or href
            textContent += element.text || element.href || "";
          } else if (element.tag === "at") {
            // Mention: @username
            textContent += `@${element.user_name || element.user_id || ""}`;
          } else if (element.tag === "img" && element.image_key) {
            // Embedded image
            imageKeys.push(element.image_key);
          } else if (element.tag === "media" && element.file_key) {
            // Embedded video/media
            mediaKeys.push({
              fileKey: element.file_key,
              imageKey: element.image_key, // thumbnail
            });
          }
        }
        textContent += "\n";
      }
    }

    return {
      textContent: textContent.trim() || "[富文本消息]",
      imageKeys,
      mediaKeys,
    };
  } catch {
    return { textContent: "[富文本消息]", imageKeys: [], mediaKeys: [] };
  }
}

/**
 * Infer placeholder text based on message type.
 */
function inferPlaceholder(messageType: string): string {
  switch (messageType) {
    case "image":
      return "<media:image>";
    case "file":
      return "<media:document>";
    case "audio":
      return "<media:audio>";
    case "video":
    case "media":
      return "<media:video>";
    case "sticker":
      return "<media:sticker>";
    default:
      return "<media:document>";
  }
}

/**
 * Resolve media from a Feishu message, downloading and saving to disk.
 * Similar to Discord's resolveMediaList().
 */
async function resolveFeishuMediaList(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  messageType: string;
  content: string;
  maxBytes: number;
  log?: (msg: string) => void;
}): Promise<FeishuMediaInfo[]> {
  const { cfg, messageId, messageType, content, maxBytes, log } = params;

  // Only process media message types (including post for embedded images)
  const mediaTypes = ["image", "file", "audio", "video", "media", "sticker", "post"];
  if (!mediaTypes.includes(messageType)) {
    return [];
  }

  const out: FeishuMediaInfo[] = [];
  const core = getFeishuRuntime();

  // Handle post (rich text) messages with embedded images
  if (messageType === "post") {
    const { imageKeys, mediaKeys } = parsePostContent(content);
    const hasMedia = imageKeys.length > 0 || mediaKeys.length > 0;
    if (!hasMedia) {
      return [];
    }

    if (imageKeys.length > 0) {
      log?.(`feishu: post message contains ${imageKeys.length} embedded image(s)`);
    }
    if (mediaKeys.length > 0) {
      log?.(`feishu: post message contains ${mediaKeys.length} embedded video/media`);
    }

    for (const imageKey of imageKeys) {
      try {
        // Embedded images in post use messageResource API with image_key as file_key
        const result = await downloadMessageResourceFeishu({
          cfg,
          messageId,
          fileKey: imageKey,
          type: "image",
        });

        let contentType = result.contentType;
        if (!contentType) {
          contentType = await core.media.detectMime({ buffer: result.buffer });
        }

        const saved = await core.channel.media.saveMediaBuffer(
          result.buffer,
          contentType,
          "inbound",
          maxBytes,
        );

        out.push({
          path: saved.path,
          contentType: saved.contentType,
          placeholder: "<media:image>",
        });

        log?.(`feishu: downloaded embedded image ${imageKey}, saved to ${saved.path}`);
      } catch (err) {
        log?.(`feishu: failed to download embedded image ${imageKey}: ${String(err)}`);
      }
    }

    // Download embedded videos from post
    for (const media of mediaKeys) {
      try {
        const result = await downloadMessageResourceFeishu({
          cfg,
          messageId,
          fileKey: media.fileKey,
          type: "file", // videos use file type for download
        });

        let contentType = result.contentType;
        if (!contentType) {
          contentType = await core.media.detectMime({ buffer: result.buffer });
        }
        // Default to video/mp4 if detection fails
        if (!contentType || contentType === "application/octet-stream") {
          contentType = "video/mp4";
        }

        const saved = await core.channel.media.saveMediaBuffer(
          result.buffer,
          contentType,
          "inbound",
          maxBytes,
        );

        out.push({
          path: saved.path,
          contentType: saved.contentType,
          placeholder: "<media:video>",
        });

        log?.(`feishu: downloaded embedded video ${media.fileKey}, saved to ${saved.path}`);
      } catch (err) {
        const errStr = String(err);
        const errAny = err as any;
        const respStatus = errAny?.response?.status;
        // Try to extract Feishu error code from response body (may be Buffer/string/object)
        let respCode = errAny?.code;
        try {
          const respData = errAny?.response?.data;
          if (respData) {
            const bodyStr = Buffer.isBuffer(respData) ? respData.toString("utf-8") : typeof respData === "string" ? respData : JSON.stringify(respData);
            const codeMatch = bodyStr.match(/"code"\s*:\s*(\d+)/);
            if (codeMatch) respCode = codeMatch[1];
            log?.(`feishu: embedded video download error: status=${respStatus}, code=${respCode}, body=${bodyStr.slice(0, 200)}`);
          } else {
            log?.(`feishu: embedded video download error: status=${respStatus}, code=${respCode}, err=${errStr.slice(0, 300)}`);
          }
        } catch { log?.(`feishu: embedded video download error: status=${respStatus}, err=${errStr.slice(0, 300)}`); }
        // Detect oversized files: Feishu returns 400 with code 234037 for files exceeding ~100MB (post-compression).
        // For video downloads, any 400 is almost certainly a size limit issue.
        const isOversized =
          errStr.includes("234037") ||
          errStr.includes("file size exceeds") ||
          errStr.includes("Media exceeds") ||
          errStr.includes("Downloaded file size exceeds limit") ||
          String(respCode) === "234037" ||
          respStatus === 400; // video download 400 = size limit
        if (isOversized) {
          log?.(`feishu: embedded video ${media.fileKey} exceeds Feishu API download limit (code=${respCode}), skipping`);
          // Mark as oversized so we can inform the user
          out.push({
            path: "",
            contentType: "video/oversized",
            placeholder: "<media:video:oversized>",
          });
        } else {
          log?.(`feishu: failed to download embedded video ${media.fileKey}: ${errStr}`);
        }
      }
    }

    return out;
  }

  // Handle other media types
  const mediaKeys = parseMediaKeys(content, messageType);
  if (!mediaKeys.imageKey && !mediaKeys.fileKey) {
    return [];
  }

  try {
    let buffer: Buffer;
    let contentType: string | undefined;
    let fileName: string | undefined;

    // For message media, always use messageResource API
    // The image.get API is only for images uploaded via im/v1/images, not for message attachments
    // For video/media, prefer file_key (actual video) over image_key (thumbnail)
    const fileKey = mediaKeys.fileKey || mediaKeys.imageKey;
    if (!fileKey) {
      return [];
    }

    const resourceType = messageType === "image" ? "image" : "file";
    const result = await downloadMessageResourceFeishu({
      cfg,
      messageId,
      fileKey,
      type: resourceType,
    });
    buffer = result.buffer;
    contentType = result.contentType;
    fileName = result.fileName || mediaKeys.fileName;

    // Detect mime type if not provided
    if (!contentType) {
      contentType = await core.media.detectMime({ buffer });
    }
    // For video/media messages, default to video/mp4 if detection fails
    if ((messageType === "video" || messageType === "media") &&
        (!contentType || contentType === "application/octet-stream")) {
      contentType = "video/mp4";
    }

    // Save to disk using core's saveMediaBuffer
    const saved = await core.channel.media.saveMediaBuffer(
      buffer,
      contentType,
      "inbound",
      maxBytes,
      fileName,
    );

    out.push({
      path: saved.path,
      contentType: saved.contentType,
      placeholder: inferPlaceholder(messageType),
    });

    log?.(`feishu: downloaded ${messageType} media, saved to ${saved.path}`);
  } catch (err) {
    const errStr = String(err);
    const errAny = err as any;
    const respStatus = errAny?.response?.status;
    let respCode = errAny?.code;
    try {
      const respData = errAny?.response?.data;
      if (respData) {
        const bodyStr = Buffer.isBuffer(respData) ? respData.toString("utf-8") : typeof respData === "string" ? respData : JSON.stringify(respData);
        const codeMatch = bodyStr.match(/"code"\s*:\s*(\d+)/);
        if (codeMatch) respCode = codeMatch[1];
        log?.(`feishu: ${messageType} media download error: status=${respStatus}, code=${respCode}, body=${bodyStr.slice(0, 200)}`);
      } else {
        log?.(`feishu: ${messageType} media download error: status=${respStatus}, code=${respCode}, err=${errStr.slice(0, 300)}`);
      }
    } catch { log?.(`feishu: ${messageType} media download error: status=${respStatus}, err=${errStr.slice(0, 300)}`); }
    const isVideoType = messageType === "video" || messageType === "media" || messageType === "audio";
    const isOversized =
      errStr.includes("234037") ||
      errStr.includes("file size exceeds") ||
      errStr.includes("Media exceeds") ||
      errStr.includes("Downloaded file size exceeds limit") ||
      String(respCode) === "234037" ||
      (isVideoType && respStatus === 400); // video download 400 = size limit

    if (isOversized && (messageType === "video" || messageType === "media" || messageType === "audio")) {
      log?.(`feishu: ${messageType} media exceeds Feishu API download limit (~100MB), marking as oversized`);
      out.push({
        path: "",
        contentType: `${messageType}/oversized`,
        placeholder: `<media:${messageType}:oversized>`,
      });
    } else {
      log?.(`feishu: failed to download ${messageType} media: ${errStr}`);
    }
  }

  return out;
}

/**
 * Build media payload for inbound context.
 * Similar to Discord's buildDiscordMediaPayload().
 */
function buildFeishuMediaPayload(
  mediaList: FeishuMediaInfo[],
): {
  MediaPath?: string;
  MediaType?: string;
  MediaUrl?: string;
  MediaPaths?: string[];
  MediaUrls?: string[];
  MediaTypes?: string[];
} {
  const first = mediaList[0];
  const mediaPaths = mediaList.map((media) => media.path);
  const mediaTypes = mediaList.map((media) => media.contentType).filter(Boolean) as string[];
  return {
    MediaPath: first?.path,
    MediaType: first?.contentType,
    MediaUrl: first?.path,
    MediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaUrls: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
  };
}

export function parseFeishuMessageEvent(
  event: FeishuMessageEvent,
  botOpenId?: string,
): FeishuMessageContext {
  const rawContent = parseMessageContent(event.message.content, event.message.message_type);
  const mentionedBot = checkBotMentioned(event, botOpenId);
  const content = stripBotMention(rawContent, event.message.mentions);

  const ctx: FeishuMessageContext = {
    chatId: event.message.chat_id,
    messageId: event.message.message_id,
    senderId: event.sender.sender_id.user_id || event.sender.sender_id.open_id || "",
    senderOpenId: event.sender.sender_id.open_id || "",
    chatType: event.message.chat_type,
    mentionedBot,
    rootId: event.message.root_id || undefined,
    parentId: event.message.parent_id || undefined,
    content,
    contentType: event.message.message_type,
  };

  if (isMentionForwardRequest(event, botOpenId)) {
    const mentionTargets = extractMentionTargets(event, botOpenId);
    if (mentionTargets.length > 0) {
      ctx.mentionTargets = mentionTargets;
      const allMentionKeys = (event.message.mentions ?? []).map((m) => m.key);
      ctx.mentionMessageBody = extractMessageBody(content, allMentionKeys);
    }
  }

  return ctx;
}

function parseDurationToken(token?: string): number | null | undefined {
  const raw = (token ?? "").trim();
  if (!raw) return undefined;
  const lowered = raw.toLowerCase();
  if (["0", "none", "null", "forever", "permanent", "永久", "长期"].includes(lowered)) return null;

  const m = /^(\d+)(ms|s|m|h|d)?$/.exec(lowered);
  if (!m) return undefined;

  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unit = m[2] ?? "m";
  if (unit === "ms") return n;
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  if (unit === "d") return n * 24 * 60 * 60 * 1000;
  return undefined;
}

function formatRemainingMs(ms: number | null): string {
  if (ms == null) return "永久";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function buildUsageText(cfg: ClawdbotConfig): string {
  const usageNoAdmin = getUsageSnapshot({ excludeAdmins: true });
  const usageAll = getUsageSnapshot({ excludeAdmins: false });
  return [
    `当前使用者（不含管理员，最近10分钟活跃）：${usageNoAdmin.activeUsers}`,
    `生成中用户（不含管理员）：${usageNoAdmin.inFlightUsers}`,
    `生成中任务（不含管理员）：${usageNoAdmin.inFlightJobs}`,
    "",
    `含管理员：活跃 ${usageAll.activeUsers}｜生成中用户 ${usageAll.inFlightUsers}｜生成中任务 ${usageAll.inFlightJobs}`,
  ].join("\n");
}

// Helper directory path (relative to workspace)
const HELPER_DIR = "/home/ubuntu/clawd/helper";

// Topic name to file mapping (supports aliases)
const HELPER_TOPICS: Record<string, string> = {
  // 功能总览
  "features": "features.md",
  "1": "features.md",
  // 原生指令
  "clawdbot": "clawdbot.md",
  "commands": "clawdbot.md",
  "2": "clawdbot.md",
  // 常见问题
  "faq": "faq.md",
  "3": "faq.md",
  // 状态指令
  "state": "state.md",
  "4": "state.md",
  // 记忆系统
  "memory": "memory.md",
  "5": "memory.md",
  // RAG 知识检索
  "rag": "rag.md",
  "6": "rag.md",
  // 分析能力
  "analyze": "analyze.md",
  "7": "analyze.md",
  // 代码分析
  "code-analysis": "code-analysis.md",
  "code": "code-analysis.md",
  "8": "code-analysis.md",
  // 飞书基础
  "feishu-basic": "feishu-basic.md",
  "feishu": "feishu-basic.md",
  "9": "feishu-basic.md",
  // 飞书项目
  "feishu-project": "feishu-project.md",
  "project": "feishu-project.md",
  "10": "feishu-project.md",
  // 飞书任务
  "feishu-task": "feishu-task.md",
  "task": "feishu-task.md",
  "11": "feishu-task.md",
  // 多维表格
  "feishu-bitable": "feishu-bitable.md",
  "bitable": "feishu-bitable.md",
  "12": "feishu-bitable.md",
  // 电子表格
  "feishu-sheets": "feishu-sheets.md",
  "sheets": "feishu-sheets.md",
  "13": "feishu-sheets.md",
};

function tryHandleHelperCommand(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith("/helper")) return null;

  const arg = trimmed.slice("/helper".length).trim().toLowerCase();

  try {
    if (!arg) {
      // Return index
      const indexPath = `${HELPER_DIR}/index.md`;
      if (fs.existsSync(indexPath)) {
        return fs.readFileSync(indexPath, "utf-8");
      }
      return "Helper 索引文件不存在";
    }

    // Look up topic
    const fileName = HELPER_TOPICS[arg];
    if (!fileName) {
      return `未知主题: ${arg}\n\n输入 /helper 查看可用主题`;
    }

    const filePath = `${HELPER_DIR}/${fileName}`;
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }
    return `主题文件不存在: ${fileName}`;
  } catch (err) {
    return `读取帮助文件失败: ${String(err)}`;
  }
}

function tryHandleAdminCommand(params: { cfg: ClawdbotConfig; senderId: string; text: string }): string | null {
  const text = params.text.trim();
  if (!text) return null;

  // 使用状态查询已移除硬编码匹配，改由 agent 通过 dev-lock-cli.ts usage 调用

  if (!/^开发锁(\s|$)/.test(text)) return null;

  const rest = text.replace(/^开发锁/, "").trim();
  if (!rest || /^(状态|\?|help|帮助)$/i.test(rest)) {
    const snap = getDevLockSnapshot();
    const usage = buildUsageText(params.cfg);
    if (!snap.enabled) {
      return [`开发锁：关闭`, "", usage].join("\n");
    }
    return [
      `开发锁：开启`,
      snap.remainingMs != null ? `剩余：${formatRemainingMs(snap.remainingMs)}` : `剩余：永久`,
      snap.reason ? `原因：${snap.reason}` : undefined,
      "",
      usage,
    ].filter(Boolean).join("\n");
  }

  const parts = rest.split(/\s+/g).filter(Boolean);
  const op = (parts[0] ?? "").toLowerCase();

  if (["关", "关闭", "off", "false", "0"].includes(op)) {
    disableDevLock();
    const snap = getDevLockSnapshot();
    return snap.enabled ? "开发锁关闭失败" : "开发锁已关闭";
  }

  if (["开", "开启", "on", "true", "1"].includes(op)) {
    const ttlToken = parts[1];
    const ttlMsParsed = parseDurationToken(ttlToken);
    const ttlMs = ttlMsParsed === undefined ? 2 * 60 * 60 * 1000 : ttlMsParsed;
    const reason = parts.length >= 3 ? parts.slice(2).join(" ") : null;
    enableDevLock({ enabledBy: params.senderId, ttlMs, reason });
    const snap = getDevLockSnapshot();
    if (!snap.enabled) return "开发锁开启失败";
    return [
      `开发锁已开启`,
      snap.remainingMs != null ? `剩余：${formatRemainingMs(snap.remainingMs)}` : `剩余：永久`,
      snap.reason ? `原因：${snap.reason}` : undefined,
    ].filter(Boolean).join("\n");
  }

  return null;
}

export async function handleFeishuMessage(params: {
  cfg: ClawdbotConfig;
  event: FeishuMessageEvent;
  botOpenId?: string;
  runtime?: RuntimeEnv;
  chatHistories?: Map<string, HistoryEntry[]>;
  /** Skip media cost confirmation (set when resuming after user confirms) */
  skipMediaConfirm?: boolean;
  /** Pre-resolved media list (passed from confirmation flow to avoid re-downloading) */
  preResolvedMediaList?: FeishuMediaInfo[];
  /** Internal flag to skip abort-before-process logic (used for synthetic stop messages) */
  _isAbortMessage?: boolean;
}): Promise<void> {
  const { cfg, event, botOpenId, runtime, chatHistories, skipMediaConfirm, preResolvedMediaList, _isAbortMessage } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  let ctx = parseFeishuMessageEvent(event, botOpenId);
  const isGroup = ctx.chatType === "group";
  
  // "New message aborts current run" behavior:
  // Before processing any user message, inject a /stop to abort any ongoing run.
  // This makes the conversation feel more responsive - user can always interrupt.
  // Skip if this is already an abort message to avoid infinite loop.
  if (!_isAbortMessage && ctx.contentType === "text") {
    const abortEvent: FeishuMessageEvent = {
      sender: event.sender,
      message: {
        ...event.message,
        message_id: `abort_${event.message.message_id}`,
        content: JSON.stringify({ text: "/stop" }),
      },
    };
    
    // Fire-and-forget: send abort signal before processing the actual message
    // Don't await - let it run in parallel
    void handleFeishuMessage({
      ...params,
      event: abortEvent,
      _isAbortMessage: true,
    }).catch(() => {
      // Ignore abort errors
    });
    
    // Small delay to let abort propagate
    await new Promise(resolve => setTimeout(resolve, 100));
    log(`feishu: sent abort signal before processing new message`);
  }

  log(`feishu: received message from ${ctx.senderOpenId} in ${ctx.chatId} (${ctx.chatType})`);

  if (ctx.senderOpenId) {
    const senderName = await resolveFeishuSenderName({
      cfg,
      senderOpenId: ctx.senderOpenId,
      log,
    });
    if (senderName) {
      ctx = { ...ctx, senderName };
    }
  }

  // Handle merge_forward messages: fetch sub-messages and combine their content
  // Store media items for later download (after mediaList is initialized)
  let pendingMergeForwardMedia: Awaited<ReturnType<typeof getMergeForwardMessages>>["mediaItems"] | undefined;
  
  if (ctx.contentType === "merge_forward") {
    log(`feishu: detected merge_forward message, fetching sub-messages`);
    try {
      const mergeResult = await getMergeForwardMessages({
        cfg,
        messageId: ctx.messageId,
      });
      
      if (mergeResult && mergeResult.subMessages.length > 0) {
        // Format sub-messages into readable text
        const formattedMessages = mergeResult.subMessages.map((msg, idx) => {
          const senderLabel = msg.senderOpenId || msg.senderId || "Unknown";
          return `[${idx + 1}] ${senderLabel}: ${msg.content}`;
        });
        
        const combinedContent = `[合并转发消息，包含 ${mergeResult.subMessages.length} 条消息]\n\n${formattedMessages.join("\n\n")}`;
        
        ctx = { ...ctx, content: combinedContent };
        log(`feishu: extracted ${mergeResult.subMessages.length} sub-messages from merge_forward`);
        
        // Save media items for download later
        if (mergeResult.mediaItems.length > 0) {
          pendingMergeForwardMedia = mergeResult.mediaItems;
          log(`feishu: found ${mergeResult.mediaItems.length} media items in merge_forward`);
        }
      } else {
        ctx = { ...ctx, content: "[合并转发消息，无法获取内容]" };
        log(`feishu: merge_forward message had no sub-messages`);
      }
    } catch (err) {
      log(`feishu: failed to fetch merge_forward sub-messages: ${String(err)}`);
      ctx = { ...ctx, content: "[合并转发消息，获取内容失败]" };
    }
  }

  const historyLimit = Math.max(
    0,
    feishuCfg?.historyLimit ?? cfg.messages?.groupChat?.historyLimit ?? DEFAULT_GROUP_HISTORY_LIMIT,
  );

  const senderIdForAuth = ctx.senderOpenId || ctx.senderId;
  const senderIsAdmin = senderIdForAuth ? isFeishuAdmin({ cfg, senderId: senderIdForAuth }) : false;
  if (ctx.senderOpenId) {
    markFeishuUserActive({ userId: ctx.senderOpenId, isAdmin: senderIsAdmin });
  }

  if (isGroup) {
    const groupPolicy = feishuCfg?.groupPolicy ?? "open";
    const groupAllowFrom = feishuCfg?.groupAllowFrom ?? [];
    const groupConfig = resolveFeishuGroupConfig({ cfg: feishuCfg, groupId: ctx.chatId });

    const senderAllowFrom = groupConfig?.allowFrom ?? groupAllowFrom;
    const allowed = isFeishuGroupAllowed({
      groupPolicy,
      allowFrom: senderAllowFrom,
      senderId: ctx.senderOpenId,
      senderName: ctx.senderName,
    });

    if (!allowed) {
      log(`feishu: sender ${ctx.senderOpenId} not in group allowlist`);
      return;
    }

    const { requireMention } = resolveFeishuReplyPolicy({
      isDirectMessage: false,
      globalConfig: feishuCfg,
      groupConfig,
    });

    // Allow video/media/merge_forward messages through without @mention — users can't @mention in these message types
    const isMediaMessage = ["video", "media", "audio", "image", "file", "merge_forward"].includes(ctx.contentType);
    if (requireMention && !ctx.mentionedBot && !isMediaMessage) {
      if (senderIsAdmin && ctx.contentType === "text") {
        const reply = tryHandleAdminCommand({ cfg, senderId: senderIdForAuth, text: ctx.content });
        if (reply) {
          await sendMessageFeishu({ cfg, to: `chat:${ctx.chatId}`, text: reply, replyToMessageId: ctx.messageId });
          return;
        }
      }
      log(`feishu: message in group ${ctx.chatId} did not mention bot, recording to history`);
      if (chatHistories) {
        // Thread-aware history key: messages in a topic get their own history
        const contextIsolationEnabled = feishuCfg?.contextIsolation !== false;
        const earlyHistoryKey = contextIsolationEnabled && ctx.rootId
          ? `${ctx.chatId}:thread:${ctx.rootId}`
          : ctx.chatId;
        recordPendingHistoryEntryIfEnabled({
          historyMap: chatHistories,
          historyKey: earlyHistoryKey,
          limit: historyLimit,
          entry: {
            sender: ctx.senderOpenId,
            body: ctx.content,
            timestamp: Date.now(),
            messageId: ctx.messageId,
          },
        });
      }
      return;
    }
  } else {
    const dmPolicy = feishuCfg?.dmPolicy ?? "pairing";
    const allowFrom = feishuCfg?.allowFrom ?? [];

    if (dmPolicy === "allowlist") {
      const match = resolveFeishuAllowlistMatch({
        allowFrom,
        senderId: ctx.senderOpenId,
      });
      if (!match.allowed) {
        log(`feishu: sender ${ctx.senderOpenId} not in DM allowlist`);
        return;
      }
    }
  }

  const target = isGroup ? `chat:${ctx.chatId}` : `user:${ctx.senderOpenId}`;

  if (senderIsAdmin && ctx.contentType === "text") {
    const reply = tryHandleAdminCommand({ cfg, senderId: senderIdForAuth, text: ctx.content });
    if (reply) {
      await sendMessageFeishu({ cfg, to: target, text: reply, replyToMessageId: ctx.messageId });
      return;
    }
  }

  // /helper command - available to all users (no LLM call)
  if (ctx.contentType === "text") {
    const helperReply = tryHandleHelperCommand(ctx.content);
    if (helperReply) {
      await sendMessageFeishu({ cfg, to: target, text: helperReply, replyToMessageId: ctx.messageId });
      return;
    }
  }

  if (!senderIsAdmin && !skipMediaConfirm && isDevLockEnabled()) {
    if (!isGroup && !ctx.senderOpenId) return;
    await sendMessageFeishu({
      cfg,
      to: target,
      text: "后端更新中，请稍后重试",
      replyToMessageId: ctx.messageId,
    });
    return;
  }

  const inFlightKey = `feishu:dispatch:${ctx.messageId}`;
  startInFlightJob({ key: inFlightKey, senderId: ctx.senderOpenId || "unknown", isAdmin: senderIsAdmin });

  try {
    const core = getFeishuRuntime();

    const feishuTo = isGroup ? `chat:${ctx.chatId}` : `user:${ctx.senderOpenId}`;

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "feishu",
      peer: {
        kind: isGroup ? "group" : "dm",
        id: isGroup ? ctx.chatId : ctx.senderOpenId,
      },
    });

    // --- Context isolation: per-user, per-group, per-topic ---
    // When enabled (default), each user DM and each group topic gets its own session.
    const contextIsolation = feishuCfg?.contextIsolation !== false; // default: true
    let isolatedSessionKey = route.sessionKey;

    if (contextIsolation) {
      // Force per-user session for DMs (bypass dmScope="main" which collapses all DMs)
      if (!isGroup) {
        isolatedSessionKey = `agent:${route.agentId}:feishu:dm:${ctx.senderOpenId.toLowerCase()}`;
      }
      // Thread/topic isolation: messages with root_id go to a thread-specific session
      if (ctx.rootId) {
        isolatedSessionKey = `${isolatedSessionKey}:thread:${ctx.rootId.toLowerCase()}`;
      }
    }

    log(`feishu: context isolation=${contextIsolation}, sessionKey=${isolatedSessionKey}${ctx.rootId ? ` (topic=${ctx.rootId})` : ""}`);

    // Build From label with topic context
    let feishuFrom = isGroup ? `feishu:group:${ctx.chatId}` : `feishu:${ctx.senderOpenId}`;
    if (isGroup && ctx.rootId && contextIsolation) {
      feishuFrom = `feishu:group:${ctx.chatId}:topic:${ctx.rootId}`;
    }

    const preview = ctx.content.replace(/\s+/g, " ").slice(0, 160);
    let inboundLabel = isGroup
      ? `Feishu message in group ${ctx.chatId}`
      : `Feishu DM from ${ctx.senderOpenId}`;
    if (isGroup && ctx.rootId && contextIsolation) {
      inboundLabel = `Feishu message in group ${ctx.chatId} (topic ${ctx.rootId})`;
    }

    core.system.enqueueSystemEvent(`${inboundLabel}: ${preview}`, {
      sessionKey: isolatedSessionKey,
      contextKey: `feishu:message:${ctx.chatId}:${ctx.messageId}`,
    });

    // Resolve media from message (use pre-resolved list if resuming from cost confirmation)
    const mediaMaxBytes = (feishuCfg?.mediaMaxMb ?? 30) * 1024 * 1024; // 30MB default
    const mediaList = (skipMediaConfirm && preResolvedMediaList)
      ? preResolvedMediaList
      : await resolveFeishuMediaList({
          cfg,
          messageId: ctx.messageId,
          messageType: event.message.message_type,
          content: event.message.content,
          maxBytes: mediaMaxBytes,
          log,
        });
    log(`feishu: resolveFeishuMediaList returned ${mediaList.length} items for type=${event.message.message_type}`);

    // Download media from merge_forward message if any
    if (pendingMergeForwardMedia && pendingMergeForwardMedia.length > 0) {
      log(`feishu: downloading ${pendingMergeForwardMedia.length} media items from merge_forward`);
      for (const mediaItem of pendingMergeForwardMedia) {
        try {
          const result = await downloadMessageResourceFeishu({
            cfg,
            messageId: mediaItem.messageId,
            fileKey: mediaItem.imageKey || mediaItem.fileKey || "",
            type: mediaItem.imageKey ? "image" : "file",
          });

          let contentType = result.contentType;
          if (!contentType) {
            contentType = await core.media.detectMime({ buffer: result.buffer });
          }
          if (!contentType || contentType === "application/octet-stream") {
            // Default based on media type
            if (mediaItem.mediaType === "image") contentType = "image/png";
            else if (mediaItem.mediaType === "video") contentType = "video/mp4";
            else if (mediaItem.mediaType === "audio") contentType = "audio/mp3";
          }

          const saved = await core.channel.media.saveMediaBuffer(
            result.buffer,
            contentType,
            "inbound",
            mediaMaxBytes,
            mediaItem.fileName,
          );

          mediaList.push({
            path: saved.path,
            contentType: saved.contentType,
            placeholder: `<media:${mediaItem.mediaType}>`,
          });

          log(`feishu: downloaded merge_forward media (${mediaItem.mediaType}), saved to ${saved.path}`);
        } catch (err) {
          log(`feishu: failed to download merge_forward media: ${String(err)}`);
        }
      }
    }

    // Fetch quoted/replied message content if parentId exists
    // (moved before media cost confirmation so quoted audio/video is also intercepted)
    let quotedContent: string | undefined;
    if (ctx.parentId && !skipMediaConfirm) {
      try {
        const quotedMsg = await getMessageFeishu({ cfg, messageId: ctx.parentId });
        if (quotedMsg) {
          // Special handling for merge_forward: fetch sub-messages and download media
          if (quotedMsg.contentType === "merge_forward") {
            log(`feishu: quoted message is merge_forward, fetching sub-messages`);
            try {
              const mergeResult = await getMergeForwardMessages({
                cfg,
                messageId: ctx.parentId,
              });
              if (mergeResult && mergeResult.subMessages.length > 0) {
                const formattedMessages = mergeResult.subMessages.map((msg, idx) => {
                  const senderLabel = msg.senderOpenId || msg.senderId || "Unknown";
                  return `[${idx + 1}] ${senderLabel}: ${msg.content}`;
                });
                quotedContent = `[合并转发消息，包含 ${mergeResult.subMessages.length} 条消息]\n${formattedMessages.join("\n")}`;
                log(`feishu: extracted ${mergeResult.subMessages.length} sub-messages from quoted merge_forward`);
                
                // Download media from quoted merge_forward
                if (mergeResult.mediaItems.length > 0) {
                  log(`feishu: downloading ${mergeResult.mediaItems.length} media items from quoted merge_forward`);
                  for (const mediaItem of mergeResult.mediaItems) {
                    try {
                      const result = await downloadMessageResourceFeishu({
                        cfg,
                        messageId: mediaItem.messageId,
                        fileKey: mediaItem.imageKey || mediaItem.fileKey || "",
                        type: mediaItem.imageKey ? "image" : "file",
                      });

                      let contentType = result.contentType;
                      if (!contentType) {
                        contentType = await core.media.detectMime({ buffer: result.buffer });
                      }
                      if (!contentType || contentType === "application/octet-stream") {
                        if (mediaItem.mediaType === "image") contentType = "image/png";
                        else if (mediaItem.mediaType === "video") contentType = "video/mp4";
                        else if (mediaItem.mediaType === "audio") contentType = "audio/mp3";
                      }

                      const saved = await core.channel.media.saveMediaBuffer(
                        result.buffer,
                        contentType,
                        "inbound",
                        mediaMaxBytes,
                        mediaItem.fileName,
                      );

                      mediaList.push({
                        path: saved.path,
                        contentType: saved.contentType,
                        placeholder: `<media:${mediaItem.mediaType}>`,
                      });

                      log(`feishu: downloaded quoted merge_forward media (${mediaItem.mediaType}), saved to ${saved.path}`);
                    } catch (err) {
                      log(`feishu: failed to download quoted merge_forward media: ${String(err)}`);
                    }
                  }
                }
              } else {
                quotedContent = "[合并转发消息]";
              }
            } catch (mergeErr) {
              log(`feishu: failed to fetch merge_forward sub-messages: ${String(mergeErr)}`);
              quotedContent = "[合并转发消息]";
            }
          } else {
            quotedContent = formatQuotedContent(quotedMsg.content, quotedMsg.contentType);
          }
          log(`feishu: fetched quoted message (type=${quotedMsg.contentType}): ${quotedContent?.slice(0, 100)}`);

          // Also download media from quoted message if it contains media
          const quotedMediaTypes = ["image", "file", "audio", "video", "sticker", "post"];
          if (quotedMediaTypes.includes(quotedMsg.contentType)) {
            try {
              const quotedMedia = await resolveFeishuMediaList({
                cfg,
                messageId: ctx.parentId,
                messageType: quotedMsg.contentType,
                content: quotedMsg.content,
                maxBytes: mediaMaxBytes,
                log,
              });
              if (quotedMedia.length > 0) {
                mediaList.push(...quotedMedia);
                log(`feishu: downloaded ${quotedMedia.length} media from quoted message`);
              }
            } catch (mediaErr) {
              log(`feishu: failed to download media from quoted message (type=${quotedMsg.contentType}, id=${ctx.parentId}): ${String(mediaErr)}`);
            }
          }
        }
      } catch (err) {
        log(`feishu: failed to fetch quoted message: ${String(err)}`);
      }
    } else if (ctx.parentId && skipMediaConfirm) {
      // When resuming from cost confirmation, still fetch quoted content for context
      try {
        const quotedMsg = await getMessageFeishu({ cfg, messageId: ctx.parentId });
        if (quotedMsg) {
          // Special handling for merge_forward: fetch sub-messages and download media
          if (quotedMsg.contentType === "merge_forward") {
            try {
              const mergeResult = await getMergeForwardMessages({
                cfg,
                messageId: ctx.parentId,
              });
              if (mergeResult && mergeResult.subMessages.length > 0) {
                const formattedMessages = mergeResult.subMessages.map((msg, idx) => {
                  const senderLabel = msg.senderOpenId || msg.senderId || "Unknown";
                  return `[${idx + 1}] ${senderLabel}: ${msg.content}`;
                });
                quotedContent = `[合并转发消息，包含 ${mergeResult.subMessages.length} 条消息]\n${formattedMessages.join("\n")}`;
                
                // Download media from quoted merge_forward (when resuming from cost confirmation)
                if (mergeResult.mediaItems.length > 0) {
                  for (const mediaItem of mergeResult.mediaItems) {
                    try {
                      const result = await downloadMessageResourceFeishu({
                        cfg,
                        messageId: mediaItem.messageId,
                        fileKey: mediaItem.imageKey || mediaItem.fileKey || "",
                        type: mediaItem.imageKey ? "image" : "file",
                      });

                      let contentType = result.contentType;
                      if (!contentType) {
                        contentType = await core.media.detectMime({ buffer: result.buffer });
                      }
                      if (!contentType || contentType === "application/octet-stream") {
                        if (mediaItem.mediaType === "image") contentType = "image/png";
                        else if (mediaItem.mediaType === "video") contentType = "video/mp4";
                        else if (mediaItem.mediaType === "audio") contentType = "audio/mp3";
                      }

                      const saved = await core.channel.media.saveMediaBuffer(
                        result.buffer,
                        contentType,
                        "inbound",
                        mediaMaxBytes,
                        mediaItem.fileName,
                      );

                      mediaList.push({
                        path: saved.path,
                        contentType: saved.contentType,
                        placeholder: `<media:${mediaItem.mediaType}>`,
                      });
                    } catch {
                      // Ignore media download errors in resume flow
                    }
                  }
                }
              } else {
                quotedContent = "[合并转发消息]";
              }
            } catch {
              quotedContent = "[合并转发消息]";
            }
          } else {
            quotedContent = formatQuotedContent(quotedMsg.content, quotedMsg.contentType);
          }
          log(`feishu: fetched quoted message (type=${quotedMsg.contentType}): ${quotedContent?.slice(0, 100)}`);
        }
      } catch (err) {
        log(`feishu: failed to fetch quoted message: ${String(err)}`);
      }
    }

    // --- Media cost confirmation interception ---
    // When confirmMediaCost is enabled, intercept audio/video messages (including
    // quoted audio/video) to show a cost estimate card before processing.
    if (
      !skipMediaConfirm &&
      feishuCfg?.confirmMediaCost &&
      mediaList.length > 0
    ) {
      // Determine if there are any audio/video media items that need confirmation
      const hasAudioVideo = mediaList.some(
        (m) => m.contentType?.startsWith("audio/") || m.contentType?.startsWith("video/")
      ) || event.message.message_type === "audio" || event.message.message_type === "video" || event.message.message_type === "media";

      if (hasAudioVideo) {
        // Check if there are oversized videos that couldn't be downloaded
        const hasOversized = mediaList.some((m) => m.contentType?.endsWith("/oversized"));
        if (hasOversized) {
          // Notify user about oversized video limitation
          const chatId = event.message.chat_id;
          const senderOpenId = event.sender?.sender_id?.open_id || "";
          const target = event.message.chat_type === "p2p" ? `user:${senderOpenId}` : `chat:${chatId}`;
          const { sendCardFeishu } = await import("./api/send.js");
          await sendCardFeishu({
            cfg,
            to: target,
            card: {
              config: { wide_screen_mode: true },
              header: {
                title: { tag: "plain_text", content: "🎬 视频文件过大" },
                template: "orange",
              },
              elements: [
                {
                  tag: "markdown",
                  content: [
                    "检测到视频文件，但**超出飞书 API 下载限制（约 20MB）**，无法直接处理。",
                    "",
                    "**请将视频上传到[多维表格](https://joycastle.feishu.cn/base/OW7lbIpSlaf4nEsiDKLcqiYGn7c)**，然后告诉我你想分析哪个视频（最新的 / 编号几的）。",
                    "",
                    "其他方案：",
                    "• 压缩视频到 20MB 以内后重新发送",
                    "• 发送较短的视频片段",
                  ].join("\n"),
                },
              ],
            },
            replyToMessageId: event.message.message_id,
          });
          log(`feishu: notified user about oversized video (file exceeds ~20MB API limit)`);
          // Remove oversized markers from mediaList and continue if there are other valid media
          const validMedia = mediaList.filter((m) => !m.contentType?.endsWith("/oversized"));
          mediaList.length = 0;
          mediaList.push(...validMedia);
          if (mediaList.length === 0) {
            return; // No processable media left
          }
        }

        let totalFileSize = 0;
        for (const media of mediaList) {
          try {
            const stat = fs.statSync(media.path);
            totalFileSize += stat.size;
          } catch {
            // Ignore stat errors — file may have been cleaned up
          }
        }

        if (totalFileSize > 0) {
          // Determine media type for display
          const detectedMediaType: "audio" | "video" =
            event.message.message_type === "video" ||
            event.message.message_type === "media" ||
            mediaList.some((m) => m.contentType?.startsWith("video/"))
              ? "video"
              : "audio";

          // Extract actual duration from message content if available
          let mediaDurationMs: number | undefined;
          try {
            const parsed = JSON.parse(event.message.content);
            if (parsed.duration && typeof parsed.duration === "number") {
              mediaDurationMs = parsed.duration;
            }
          } catch { /* ignore parse errors */ }

          try {
            await sendMediaConfirmCard({
              cfg,
              event,
              mediaType: detectedMediaType,
              fileSizeBytes: totalFileSize,
              mediaList,
              durationMs: mediaDurationMs,
              botOpenId,
              runtime,
              chatHistories,
              log,
            });
            log(`feishu: media cost confirmation card sent, awaiting user response`);
            return; // Stop processing — will resume when user confirms via card action
          } catch (err) {
            // If sending confirmation card fails, fall through to normal processing
            log(`feishu: failed to send media confirmation card (continuing with dispatch): ${String(err)}`);
          }
        }
      }
    }

    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);

    // Enrich message text with Feishu document content (if URLs detected)
    let enrichedContent = ctx.content;
    const docImageUrls: string[] = [];
    const feishuCfgForDoc = cfg.channels?.feishu as FeishuConfig | undefined;
    try {
      if (feishuCfgForDoc) {
        const enriched = await enrichMessageWithDocs(feishuCfgForDoc, ctx.content, log);
        enrichedContent = enriched.text;
        docImageUrls.push(...enriched.docImageUrls);
        // Also enrich quoted content if it contains doc URLs
        if (quotedContent) {
          const enrichedQuoted = await enrichMessageWithDocs(feishuCfgForDoc, quotedContent, log);
          quotedContent = enrichedQuoted.text;
          docImageUrls.push(...enrichedQuoted.docImageUrls);
        }
      }
    } catch (err) {
      log(`feishu: doc enrichment failed (non-fatal): ${String(err)}`);
    }

    if (docImageUrls.length > 0) {
      if (!feishuCfgForDoc) {
        log("feishu: doc image download skipped (Feishu channel config missing)");
      } else {
      const uniqueDocImages = [...new Set(docImageUrls)].slice(0, 8);
      log(`feishu: downloading ${uniqueDocImages.length} doc image(s) from doc enrichment`);
      for (const url of uniqueDocImages) {
        try {
          const result = await downloadFeishuDocMediaByUrl({
            cfg: feishuCfgForDoc,
            url,
            maxBytes: mediaMaxBytes,
          });
          let contentType = result.contentType;
          if (!contentType) {
            contentType = await core.media.detectMime({ buffer: result.buffer });
          }
          if (!contentType || contentType === "application/octet-stream") {
            contentType = "image/png";
          }
          const saved = await core.channel.media.saveMediaBuffer(
            result.buffer,
            contentType,
            "inbound",
            mediaMaxBytes,
          );
          mediaList.push({
            path: saved.path,
            contentType: saved.contentType,
            placeholder: "<media:image>",
          });
        } catch (err) {
          log(`feishu: failed to download doc image ${url}: ${String(err)}`);
        }
      }
      }
    }

    // Build media payload after all media (including doc + quoted media) has been collected
    const mediaPayload = buildFeishuMediaPayload(mediaList);

    // NOTE: Bitable video commands (e.g., "帮我分析最新的视频") are no longer
    // intercepted here via regex. Instead, messages flow through to the LLM agent,
    // which uses natural language understanding to recognize video analysis intent
    // and invokes bitable-video-cli.ts with structured arguments.
    // See: src/big-video/bitable-video-cli.ts

    // Build message body with quoted content if available
    let messageBody = enrichedContent;
    if (quotedContent) {
      messageBody = `[Replying to: "${quotedContent}"]\n\n${enrichedContent}`;
    }
    if (ctx.mentionTargets && ctx.mentionTargets.length > 0) {
      const targetNames = ctx.mentionTargets.map((t) => t.name).join(", ");
      messageBody += `\n\n[System: Your reply will automatically @mention: ${targetNames}. Do not write @xxx yourself.]`;
    }

    const body = core.channel.reply.formatAgentEnvelope({
      channel: "Feishu",
      from: isGroup ? ctx.chatId : ctx.senderOpenId,
      timestamp: new Date(),
      envelope: envelopeOptions,
      body: messageBody,
    });

    let combinedBody = body;
    // Thread-aware history key: messages in a topic get their own history
    const historyKey = isGroup
      ? (contextIsolation && ctx.rootId ? `${ctx.chatId}:thread:${ctx.rootId}` : ctx.chatId)
      : undefined;

    if (isGroup && historyKey && chatHistories) {
      combinedBody = buildPendingHistoryContextFromMap({
        historyMap: chatHistories,
        historyKey,
        limit: historyLimit,
        currentMessage: combinedBody,
        formatEntry: (entry) =>
          core.channel.reply.formatAgentEnvelope({
            channel: "Feishu",
            from: ctx.chatId,
            timestamp: entry.timestamp,
            body: `${entry.sender}: ${entry.body}`,
            envelope: envelopeOptions,
          }),
      });
    }

    const commandBody = ctx.mentionMessageBody ?? ctx.content;
    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: combinedBody,
      RawBody: ctx.content,
      CommandBody: commandBody,
      From: feishuFrom,
      To: feishuTo,
      SessionKey: isolatedSessionKey,
      AccountId: route.accountId,
      ChatType: isGroup ? "group" : "direct",
      GroupSubject: isGroup ? ctx.chatId : undefined,
      SenderName: ctx.senderName ?? ctx.senderOpenId,
      SenderId: ctx.senderOpenId,
      Provider: "feishu" as const,
      Surface: "feishu" as const,
      MessageSid: ctx.messageId,
      Timestamp: Date.now(),
      WasMentioned: ctx.mentionedBot,
      CommandAuthorized: true,
      OriginatingChannel: "feishu" as const,
      OriginatingTo: feishuTo,
      ...mediaPayload,
    });

    const { dispatcher, replyOptions, markDispatchIdle } = createFeishuReplyDispatcher({
      cfg,
      agentId: route.agentId,
      runtime: runtime as RuntimeEnv,
      chatId: ctx.chatId,
      replyToMessageId: ctx.messageId,
      mentionTargets: ctx.mentionTargets,
    });

    log(`feishu: dispatching to agent (session=${isolatedSessionKey})`);

    const { queuedFinal, counts } = await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });

    markDispatchIdle();

    if (isGroup && historyKey && chatHistories) {
      clearHistoryEntriesIfEnabled({
        historyMap: chatHistories,
        historyKey,
        limit: historyLimit,
      });
    }

    log(`feishu: dispatch complete (queuedFinal=${queuedFinal}, replies=${counts.final})`);
  } catch (err) {
    error(`feishu: failed to dispatch message: ${String(err)}`);
  } finally {
    endInFlightJob(inFlightKey);
  }
}
