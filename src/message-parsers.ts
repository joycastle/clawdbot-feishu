/**
 * message-parsers — Shared utilities for parsing Feishu message content.
 *
 * Extracted from bot.ts for reuse across tools and features.
 */

/**
 * Parse media keys from message content based on message type.
 */
export function parseMediaKeys(
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
 * Parse post (rich text) content and extract text, embedded image keys, and media keys.
 * Post structure: { title?: string, content: [[{ tag, text?, image_key?, ... }]] }
 */
export function parsePostContent(content: string): {
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
            textContent += element.text || element.href || "";
          } else if (element.tag === "at") {
            textContent += `@${element.user_name || element.user_id || ""}`;
          } else if (element.tag === "img" && element.image_key) {
            imageKeys.push(element.image_key);
          } else if (element.tag === "media" && element.file_key) {
            mediaKeys.push({
              fileKey: element.file_key,
              imageKey: element.image_key,
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
