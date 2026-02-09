import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import type { FeishuConfig, FeishuSendResult } from "../types.js";
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
};

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
};

export async function sendMessageFeishu(params: SendFeishuMessageParams): Promise<FeishuSendResult> {
  const { cfg, to, text, replyToMessageId } = params;
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
  const messageText = rt
    ? rt.channel.text.convertMarkdownTables(
        text ?? "",
        rt.channel.text.resolveMarkdownTableMode({ cfg, channel: "feishu" }),
      )
    : (text ?? "");

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
}): Promise<FeishuSendResult> {
  const { cfg, to, text, replyToMessageId } = params;
  const card = buildMarkdownCard(text);
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
}): Promise<FeishuSendResult> {
  const { cfg, to, text, title, replyToMessageId } = params;
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
  const postContent = buildPostContent(text, title);
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
