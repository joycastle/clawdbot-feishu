import type { ChannelOutboundAdapter } from "clawdbot/plugin-sdk";
import { getFeishuRuntime } from "./runtime.js";
import { sendMessageFeishu, sendCardFeishu, updateCardFeishu, sendPostFeishu, editMessageFeishu } from "./api/send.js";
import { uploadImageFeishu, uploadFileFeishu, sendImageFeishu, sendFileFeishu, sendMediaFeishu } from "./api/media.js";
import { createPoll } from "./features/vote/index.js";
import { containsMarkdownTable, textToTableCard } from "./features/table-card.js";

/** Check if text contains fenced code blocks */
function hasCodeBlocks(text: string): boolean {
  return /```[\s\S]*?```/.test(text);
}

export const feishuOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getFeishuRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async ({ cfg, to, text }) => {
    // Auto-detect markdown tables → use card for proper table rendering
    if (containsMarkdownTable(text)) {
      const card = textToTableCard(text);
      if (card) {
        const result = await sendCardFeishu({ cfg, to, card });
        return { channel: "feishu", ...result };
      }
    }

    // Auto-detect code blocks → use post (rich text) format for proper code_block rendering
    if (hasCodeBlocks(text)) {
      const result = await sendPostFeishu({ cfg, to, text });
      return { channel: "feishu", ...result };
    }

    const result = await sendMessageFeishu({ cfg, to, text });
    return { channel: "feishu", ...result };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl }) => {
    // Send text first if provided
    if (text?.trim()) {
      await sendMessageFeishu({ cfg, to, text });
    }

    // Upload and send media if URL provided
    if (mediaUrl) {
      try {
        const result = await sendMediaFeishu({ cfg, to, mediaUrl });
        return { channel: "feishu", ...result };
      } catch (err) {
        // Log the error for debugging
        console.error(`[feishu] sendMediaFeishu failed:`, err);
        // Fallback to URL link if upload fails
        const fallbackText = `📎 ${mediaUrl}`;
        const result = await sendMessageFeishu({ cfg, to, text: fallbackText });
        return { channel: "feishu", ...result };
      }
    }

    // No media URL, just return text result
    const result = await sendMessageFeishu({ cfg, to, text: text ?? "" });
    return { channel: "feishu", ...result };
  },
  pollMaxOptions: 20,
  sendPoll: async ({ cfg, to, poll }) => {
    const multiSelect = (poll.maxSelections ?? 1) > 1;
    const pollResult = await createPoll({
      cfg,
      to,
      question: poll.question,
      options: poll.options,
      multiSelect,
    });
    return {
      channel: "feishu",
      messageId: pollResult.cardMessageId,
      pollId: pollResult.id,
    };
  },
};
