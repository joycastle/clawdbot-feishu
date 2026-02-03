import type { ClawdbotConfig, RuntimeEnv } from "clawdbot/plugin-sdk";
import {
  buildPendingHistoryContextFromMap,
  recordPendingHistoryEntryIfEnabled,
  clearHistoryEntriesIfEnabled,
  DEFAULT_GROUP_HISTORY_LIMIT,
  type HistoryEntry,
} from "clawdbot/plugin-sdk";
import type { FeishuConfig, FeishuMessageContext, FeishuMediaInfo } from "./types.js";
import { getFeishuRuntime } from "./runtime.js";
import { enrichMessageWithDocs } from "./doc-parser.js";
import {
  resolveFeishuGroupConfig,
  resolveFeishuReplyPolicy,
  resolveFeishuAllowlistMatch,
  isFeishuGroupAllowed,
} from "./policy.js";
import { createFeishuReplyDispatcher } from "./reply-dispatcher.js";
import { getMessageFeishu } from "./send.js";
import { downloadImageFeishu, downloadMessageResourceFeishu } from "./media.js";
import { sendMediaConfirmCard } from "./media-confirm.js";
import fs from "fs";

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
        // Detect oversized files: Feishu returns 400 with code 234037 for large files.
        // The Axios error may only show "status code 400", so also check response data.
        const isOversized =
          errStr.includes("234037") ||
          errStr.includes("file size exceeds") ||
          errAny?.response?.status === 400 ||
          errStr.includes("status code 400");
        if (isOversized) {
          log?.(`feishu: embedded video ${media.fileKey} likely exceeds download limit (~25MB), skipping`);
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
    const fileKey = mediaKeys.imageKey || mediaKeys.fileKey;
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
    const isOversized =
      errStr.includes("234037") ||
      errStr.includes("file size exceeds") ||
      errAny?.response?.status === 400 ||
      errStr.includes("status code 400");

    if (isOversized && (messageType === "video" || messageType === "media" || messageType === "audio")) {
      log?.(`feishu: ${messageType} media likely exceeds download limit (~25MB), marking as oversized`);
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

  return {
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
}): Promise<void> {
  const { cfg, event, botOpenId, runtime, chatHistories, skipMediaConfirm, preResolvedMediaList } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  const ctx = parseFeishuMessageEvent(event, botOpenId);
  const isGroup = ctx.chatType === "group";

  log(`feishu: received message from ${ctx.senderOpenId} in ${ctx.chatId} (${ctx.chatType})`);

  const historyLimit = Math.max(
    0,
    feishuCfg?.historyLimit ?? cfg.messages?.groupChat?.historyLimit ?? DEFAULT_GROUP_HISTORY_LIMIT,
  );

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

    // Allow video/media messages through without @mention — users can't @mention in media messages
    const isMediaMessage = ["video", "media", "audio", "image", "file"].includes(ctx.contentType);
    if (requireMention && !ctx.mentionedBot && !isMediaMessage) {
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

    // Fetch quoted/replied message content if parentId exists
    // (moved before media cost confirmation so quoted audio/video is also intercepted)
    let quotedContent: string | undefined;
    if (ctx.parentId && !skipMediaConfirm) {
      try {
        const quotedMsg = await getMessageFeishu({ cfg, messageId: ctx.parentId });
        if (quotedMsg) {
          quotedContent = formatQuotedContent(quotedMsg.content, quotedMsg.contentType);
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
          quotedContent = formatQuotedContent(quotedMsg.content, quotedMsg.contentType);
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
          const { sendCardFeishu } = await import("./send.js");
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
                    "检测到视频文件，但**超出飞书 API 下载限制（约 25MB）**，无法处理。",
                    "",
                    "**建议：**",
                    "• 压缩视频后重新发送",
                    "• 发送较短的视频片段",
                    "• 将视频上传到网盘并分享链接",
                  ].join("\n"),
                },
              ],
            },
            replyToMessageId: event.message.message_id,
          });
          log(`feishu: notified user about oversized video (file exceeds ~25MB API limit)`);
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

          try {
            await sendMediaConfirmCard({
              cfg,
              event,
              mediaType: detectedMediaType,
              fileSizeBytes: totalFileSize,
              mediaList,
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

    // Build media payload after all media (including quoted message media) has been collected
    const mediaPayload = buildFeishuMediaPayload(mediaList);

    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);

    // Enrich message text with Feishu document content (if URLs detected)
    let enrichedContent = ctx.content;
    try {
      const feishuCfgForDoc = cfg.channels?.feishu as FeishuConfig | undefined;
      if (feishuCfgForDoc) {
        enrichedContent = await enrichMessageWithDocs(feishuCfgForDoc, ctx.content, log);
        // Also enrich quoted content if it contains doc URLs
        if (quotedContent) {
          quotedContent = await enrichMessageWithDocs(feishuCfgForDoc, quotedContent, log);
        }
      }
    } catch (err) {
      log(`feishu: doc enrichment failed (non-fatal): ${String(err)}`);
    }

    // Build message body with quoted content if available
    let messageBody = enrichedContent;
    if (quotedContent) {
      messageBody = `[Replying to: "${quotedContent}"]\n\n${enrichedContent}`;
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

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: combinedBody,
      RawBody: ctx.content,
      CommandBody: ctx.content,
      From: feishuFrom,
      To: feishuTo,
      SessionKey: isolatedSessionKey,
      AccountId: route.accountId,
      ChatType: isGroup ? "group" : "direct",
      GroupSubject: isGroup ? ctx.chatId : undefined,
      SenderName: ctx.senderOpenId,
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
  }
}
