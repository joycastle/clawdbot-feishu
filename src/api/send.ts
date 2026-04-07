import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import type { FeishuConfig, FeishuSendResult, MentionTarget } from "../types.js";
import { createFeishuClient } from "../client.js";
import { resolveReceiveIdType, normalizeFeishuTarget } from "../targets.js";
import { tryGetFeishuRuntime } from "../runtime.js";

export type FeishuMessageInfo = {
  messageId: string;
  chatId: string;
  senderId?: string;
  senderOpenId?: string;
  content: string;
  contentType: string;
  createTime?: number;
  parentId?: string;  // 父消息 ID（回复链）
  rootId?: string;    // 根消息 ID（话题根）
};

function formatMentionForText(target: MentionTarget): string {
  return `<at user_id="${target.openId}">${target.name}</at>`;
}

function formatMentionForCard(target: MentionTarget): string {
  return `<at id=${target.openId}></at>`;
}

function buildMentionedMessage(targets: MentionTarget[], message: string): string {
  if (targets.length === 0) {
    return message;
  }
  const mentionParts = targets.map((t) => formatMentionForText(t));
  return `${mentionParts.join(" ")} ${message}`;
}

function buildMentionedCardContent(targets: MentionTarget[], message: string): string {
  if (targets.length === 0) {
    return message;
  }
  const mentionParts = targets.map((t) => formatMentionForCard(t));
  return `${mentionParts.join(" ")} ${message}`;
}

/**
 * Get a message by its ID.
 * Useful for fetching quoted/replied message content.
 */
export async function getMessageFeishu(params: {
  cfg: ClawdbotConfig;
  messageId: string;
}): Promise<FeishuMessageInfo | null> {
  const { cfg, messageId } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);

  try {
    const response = (await client.im.message.get({
      path: { message_id: messageId },
    })) as {
      code?: number;
      msg?: string;
      data?: {
        items?: Array<{
          message_id?: string;
          chat_id?: string;
          msg_type?: string;
          body?: { content?: string };
          sender?: {
            id?: string;
            id_type?: string;
            sender_type?: string;
          };
          create_time?: string;
          parent_id?: string;  // 父消息 ID
          root_id?: string;    // 根消息 ID
        }>;
      };
    };

    if (response.code !== 0) {
      return null;
    }

    const item = response.data?.items?.[0];
    if (!item) {
      return null;
    }

    // Parse content based on message type
    let content = item.body?.content ?? "";
    try {
      const parsed = JSON.parse(content);
      if (item.msg_type === "text" && parsed.text) {
        content = parsed.text;
      }
    } catch {
      // Keep raw content if parsing fails
    }

    return {
      messageId: item.message_id ?? messageId,
      chatId: item.chat_id ?? "",
      senderId: item.sender?.id,
      senderOpenId: item.sender?.id_type === "open_id" ? item.sender?.id : undefined,
      content,
      contentType: item.msg_type ?? "text",
      createTime: item.create_time ? parseInt(item.create_time, 10) : undefined,
      parentId: item.parent_id,  // 父消息 ID
      rootId: item.root_id,      // 根消息 ID
    };
  } catch {
    return null;
  }
}

/**
 * 递归获取回复链（从当前消息往上追溯到根消息）
 * @param cfg 配置
 * @param messageId 起始消息 ID
 * @param maxDepth 最大深度，默认 5
 * @returns 回复链数组（从最早到最新排序）
 */
export async function getReplyChain(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  maxDepth?: number;
}): Promise<FeishuMessageInfo[]> {
  const { cfg, messageId, maxDepth = 6 } = params;
  const chain: FeishuMessageInfo[] = [];
  let currentId: string | undefined = messageId;
  
  for (let i = 0; i < maxDepth && currentId; i++) {
    const msg = await getMessageFeishu({ cfg, messageId: currentId });
    if (!msg) break;
    chain.unshift(msg);  // 头部插入，保持时间顺序（最早的在前）
    currentId = msg.parentId;  // 继续往上追溯
  }
  
  return chain;
}

/**
 * 格式化回复链为可读文本
 */
export function formatReplyChain(chain: FeishuMessageInfo[]): string {
  if (chain.length <= 1) return "";
  
  // 只格式化链条中的历史消息（不包括当前消息）
  const history = chain.slice(0, -1);
  if (history.length === 0) return "";
  
  const lines = history.map((msg, idx) => {
    const sender = msg.senderOpenId ? `[${msg.senderOpenId.slice(-8)}]` : "[unknown]";
    const preview = msg.content.replace(/\s+/g, " ").slice(0, 100);
    return `  ${idx + 1}. ${sender}: ${preview}${msg.content.length > 100 ? "..." : ""}`;
  });
  
  return `[Reply chain (${history.length} messages):\n${lines.join("\n")}\n]`;
}

/** Media info extracted from a sub-message */
export type MergeForwardMediaInfo = {
  /** The sub-message ID that contains this media */
  messageId: string;
  /** image_key for images */
  imageKey?: string;
  /** file_key for files/audio/video */
  fileKey?: string;
  /** Media type: image, file, audio, video, sticker */
  mediaType: string;
  /** Optional file name for files */
  fileName?: string;
  /** Duration in milliseconds (for audio/video) */
  durationMs?: number;
};

/**
 * Get all sub-messages from a merge_forward message.
 * merge_forward messages contain multiple forwarded messages as children.
 * 
 * @returns Array of sub-messages with their content, sender info, media keys, and original chat context
 */
export async function getMergeForwardMessages(params: {
  cfg: ClawdbotConfig;
  messageId: string;
}): Promise<{
  subMessages: Array<{
    messageId: string;
    chatId: string;
    senderId?: string;
    senderOpenId?: string;
    content: string;
    contentType: string;
    createTime?: number;
    /** Raw content JSON for media extraction */
    rawContent?: string;
  }>;
  /** All media items found in sub-messages */
  mediaItems: MergeForwardMediaInfo[];
  parentMessageId: string;
} | null> {
  const { cfg, messageId } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);

  try {
    const response = (await client.im.message.get({
      path: { message_id: messageId },
    })) as {
      code?: number;
      msg?: string;
      data?: {
        items?: Array<{
          message_id?: string;
          chat_id?: string;
          msg_type?: string;
          body?: { content?: string };
          sender?: {
            id?: string;
            id_type?: string;
            sender_type?: string;
          };
          create_time?: string;
          upper_message_id?: string;
        }>;
      };
    };

    if (response.code !== 0) {
      return null;
    }

    const items = response.data?.items ?? [];
    if (items.length === 0) {
      return null;
    }

    // First item is the parent merge_forward message
    const parentItem = items[0];
    if (parentItem.msg_type !== "merge_forward") {
      return null;
    }

    const mediaItems: MergeForwardMediaInfo[] = [];

    // Remaining items are sub-messages (they have upper_message_id pointing to parent)
    const subMessages = items
      .filter((item) => item.upper_message_id === messageId)
      .map((item) => {
        const rawContent = item.body?.content ?? "";
        let content = rawContent;
        const msgType = item.msg_type ?? "text";
        const subMsgId = item.message_id ?? "";

        // Parse content based on message type
        try {
          const parsed = JSON.parse(rawContent);
          if (msgType === "text" && parsed.text) {
            content = parsed.text;
          } else if (msgType === "post") {
            // Extract text from rich text post, and collect embedded images
            const title = parsed.title || "";
            const contentBlocks = parsed.content || [];
            let textContent = title ? `${title}\n\n` : "";
            for (const paragraph of contentBlocks) {
              if (Array.isArray(paragraph)) {
                for (const element of paragraph) {
                  if (element.tag === "text") {
                    textContent += element.text || "";
                  } else if (element.tag === "a") {
                    textContent += element.text || element.href || "";
                  } else if (element.tag === "at") {
                    textContent += `@${element.user_name || ""}`;
                  } else if (element.tag === "img" && element.image_key) {
                    textContent += "[图片]";
                    mediaItems.push({
                      messageId: subMsgId,
                      imageKey: element.image_key,
                      mediaType: "image",
                    });
                  } else if (element.tag === "media" && element.file_key) {
                    textContent += "[媒体]";
                    mediaItems.push({
                      messageId: subMsgId,
                      fileKey: element.file_key,
                      imageKey: element.image_key, // thumbnail
                      mediaType: "video",
                    });
                  }
                }
                textContent += "\n";
              }
            }
            content = textContent.trim() || "[富文本消息]";
          } else if (msgType === "image") {
            content = "[图片]";
            if (parsed.image_key) {
              mediaItems.push({
                messageId: subMsgId,
                imageKey: parsed.image_key,
                mediaType: "image",
              });
            }
          } else if (msgType === "file") {
            content = `[文件: ${parsed.file_name || "未知"}]`;
            if (parsed.file_key) {
              mediaItems.push({
                messageId: subMsgId,
                fileKey: parsed.file_key,
                mediaType: "file",
                fileName: parsed.file_name,
              });
            }
          } else if (msgType === "audio") {
            content = "[语音]";
            if (parsed.file_key) {
              mediaItems.push({
                messageId: subMsgId,
                fileKey: parsed.file_key,
                mediaType: "audio",
                durationMs: typeof parsed.duration === "number" ? parsed.duration : undefined,
              });
            }
          } else if (msgType === "video" || msgType === "media") {
            content = "[视频]";
            if (parsed.file_key) {
              mediaItems.push({
                messageId: subMsgId,
                fileKey: parsed.file_key,
                imageKey: parsed.image_key, // thumbnail
                mediaType: "video",
                durationMs: typeof parsed.duration === "number" ? parsed.duration : undefined,
              });
            }
          } else if (msgType === "sticker") {
            content = "[表情]";
            if (parsed.file_key) {
              mediaItems.push({
                messageId: subMsgId,
                fileKey: parsed.file_key,
                mediaType: "sticker",
              });
            }
          } else if (msgType === "interactive") {
            content = "[卡片消息]";
          } else if (msgType === "share_chat") {
            content = "[群名片]";
          } else if (msgType === "share_user") {
            content = "[用户名片]";
          }
        } catch {
          // Keep raw content if parsing fails
          if (msgType !== "text") {
            content = `[${msgType}]`;
          }
        }

        return {
          messageId: subMsgId,
          chatId: item.chat_id ?? "",
          senderId: item.sender?.id,
          senderOpenId: item.sender?.id_type === "open_id" ? item.sender?.id : undefined,
          content,
          contentType: msgType,
          createTime: item.create_time ? parseInt(item.create_time, 10) : undefined,
          rawContent,
        };
      });

    return {
      subMessages,
      mediaItems,
      parentMessageId: messageId,
    };
  } catch {
    return null;
  }
}

export type SendFeishuMessageParams = {
  cfg: ClawdbotConfig;
  to: string;
  text: string;
  replyToMessageId?: string;
  mentions?: MentionTarget[];
};

export async function sendMessageFeishu(params: SendFeishuMessageParams): Promise<FeishuSendResult> {
  const { cfg, to, text, replyToMessageId, mentions } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  const receiveId = normalizeFeishuTarget(to);
  if (!receiveId) {
    throw new Error(`Invalid Feishu target: ${to}`);
  }

  const receiveIdType = resolveReceiveIdType(receiveId);
  const rt = tryGetFeishuRuntime();
  let rawText = text ?? "";
  if (mentions && mentions.length > 0) {
    rawText = buildMentionedMessage(mentions, rawText);
  }
  const messageText = rt
    ? rt.channel.text.convertMarkdownTables(
        rawText,
        rt.channel.text.resolveMarkdownTableMode({ cfg, channel: "feishu" }),
      )
    : rawText;

  const content = JSON.stringify({ text: messageText });

  if (replyToMessageId) {
    const response = await client.im.message.reply({
      path: { message_id: replyToMessageId },
      data: {
        content,
        msg_type: "text",
      },
    });

    if (response.code !== 0) {
      throw new Error(`Feishu reply failed: ${response.msg || `code ${response.code}`}`);
    }

    return {
      messageId: response.data?.message_id ?? "unknown",
      chatId: receiveId,
    };
  }

  const response = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      content,
      msg_type: "text",
    },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu send failed: ${response.msg || `code ${response.code}`}`);
  }

  return {
    messageId: response.data?.message_id ?? "unknown",
    chatId: receiveId,
  };
}

export type SendFeishuCardParams = {
  cfg: ClawdbotConfig;
  to: string;
  card: Record<string, unknown>;
  replyToMessageId?: string;
};

export async function sendCardFeishu(params: SendFeishuCardParams): Promise<FeishuSendResult> {
  const { cfg, to, card, replyToMessageId } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  const receiveId = normalizeFeishuTarget(to);
  if (!receiveId) {
    throw new Error(`Invalid Feishu target: ${to}`);
  }

  const receiveIdType = resolveReceiveIdType(receiveId);
  const content = JSON.stringify(card);

  if (replyToMessageId) {
    const response = await client.im.message.reply({
      path: { message_id: replyToMessageId },
      data: {
        content,
        msg_type: "interactive",
      },
    });

    if (response.code !== 0) {
      throw new Error(`Feishu card reply failed: ${response.msg || `code ${response.code}`}`);
    }

    return {
      messageId: response.data?.message_id ?? "unknown",
      chatId: receiveId,
    };
  }

  const response = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      content,
      msg_type: "interactive",
    },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu card send failed: ${response.msg || `code ${response.code}`}`);
  }

  return {
    messageId: response.data?.message_id ?? "unknown",
    chatId: receiveId,
  };
}

export async function updateCardFeishu(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  card: Record<string, unknown>;
}): Promise<void> {
  const { cfg, messageId, card } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  const content = JSON.stringify(card);

  const response = await client.im.message.patch({
    path: { message_id: messageId },
    data: { content },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu card update failed: ${response.msg || `code ${response.code}`}`);
  }
}

/**
 * Build a Feishu interactive card with markdown content.
 * Cards render markdown properly (code blocks, tables, links, etc.)
 */
export function buildMarkdownCard(text: string): Record<string, unknown> {
  return {
    config: {
      wide_screen_mode: true,
    },
    elements: [
      {
        tag: "markdown",
        content: text,
      },
    ],
  };
}

/**
 * Send a message as a markdown card (interactive message).
 * This renders markdown properly in Feishu (code blocks, tables, bold/italic, etc.)
 */
export async function sendMarkdownCardFeishu(params: {
  cfg: ClawdbotConfig;
  to: string;
  text: string;
  replyToMessageId?: string;
  mentions?: MentionTarget[];
}): Promise<FeishuSendResult> {
  const { cfg, to, text, replyToMessageId, mentions } = params;
  const cardText = mentions && mentions.length > 0 ? buildMentionedCardContent(mentions, text) : text;
  const card = buildMarkdownCard(cardText);
  return sendCardFeishu({ cfg, to, card, replyToMessageId });
}

/**
 * Convert markdown text with code blocks into Feishu post (rich text) content structure.
 * Splits text by ``` code fences and maps them to code_block tags.
 */
export function buildPostContent(text: string, title?: string): Record<string, unknown> {
  const content: Array<Array<Record<string, unknown>>> = [];
  // Split by code fences: ```lang\ncode\n```
  const parts = text.split(/(```[\s\S]*?```)/g);

  for (const part of parts) {
    if (!part) continue;

    const codeMatch = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
    if (codeMatch) {
      // Code block
      const language = codeMatch[1] || "plaintext";
      const code = codeMatch[2].replace(/\n$/, ""); // trim trailing newline
      content.push([{ tag: "code_block", language, text: code }]);
    } else {
      // Regular text — split by newlines into separate paragraphs
      const lines = part.split("\n");
      for (const line of lines) {
        if (line.trim() === "") {
          content.push([{ tag: "text", text: "\n" }]);
        } else {
          // Parse inline links: [text](url)
          const elements: Array<Record<string, unknown>> = [];
          let remaining = line;
          const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
          let match: RegExpExecArray | null;
          let lastIndex = 0;

          while ((match = linkRegex.exec(remaining)) !== null) {
            if (match.index > lastIndex) {
              elements.push({ tag: "text", text: remaining.slice(lastIndex, match.index) });
            }
            elements.push({ tag: "a", text: match[1], href: match[2] });
            lastIndex = match.index + match[0].length;
          }

          if (lastIndex < remaining.length) {
            elements.push({ tag: "text", text: remaining.slice(lastIndex) });
          }

          if (elements.length > 0) {
            content.push(elements);
          }
        }
      }
    }
  }

  return {
    zh_cn: {
      title: title || "",
      content,
    },
  };
}

/**
 * Send a message as Feishu post (rich text) format.
 * Supports code_block tags for proper code rendering.
 */
export async function sendPostFeishu(params: {
  cfg: ClawdbotConfig;
  to: string;
  text: string;
  title?: string;
  replyToMessageId?: string;
  mentions?: MentionTarget[];
}): Promise<FeishuSendResult> {
  const { cfg, to, text, title, replyToMessageId, mentions } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  const receiveId = normalizeFeishuTarget(to);
  if (!receiveId) {
    throw new Error(`Invalid Feishu target: ${to}`);
  }

  const receiveIdType = resolveReceiveIdType(receiveId);
  const rawText = mentions && mentions.length > 0 ? buildMentionedMessage(mentions, text) : text;
  const postContent = buildPostContent(rawText, title);
  const content = JSON.stringify(postContent);

  if (replyToMessageId) {
    const response = await client.im.message.reply({
      path: { message_id: replyToMessageId },
      data: {
        content,
        msg_type: "post",
      },
    });

    if (response.code !== 0) {
      throw new Error(`Feishu post reply failed: ${response.msg || `code ${response.code}`}`);
    }

    return {
      messageId: response.data?.message_id ?? "unknown",
      chatId: receiveId,
    };
  }

  const response = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      content,
      msg_type: "post",
    },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu post send failed: ${response.msg || `code ${response.code}`}`);
  }

  return {
    messageId: response.data?.message_id ?? "unknown",
    chatId: receiveId,
  };
}

/**
 * Edit an existing text message.
 * Note: Feishu only allows editing messages within 24 hours.
 */
export async function editMessageFeishu(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  text: string;
}): Promise<void> {
  const { cfg, messageId, text } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  const rt2 = tryGetFeishuRuntime();
  const messageText = rt2
    ? rt2.channel.text.convertMarkdownTables(
        text ?? "",
        rt2.channel.text.resolveMarkdownTableMode({ cfg, channel: "feishu" }),
      )
    : (text ?? "");
  const content = JSON.stringify({ text: messageText });

  const response = await client.im.message.update({
    path: { message_id: messageId },
    data: {
      msg_type: "text",
      content,
    },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu message edit failed: ${response.msg || `code ${response.code}`}`);
  }
}
