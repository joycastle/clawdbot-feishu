import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk/feishu";
import { getFeishuRuntime } from "./runtime.js";
import { sendMessageFeishu, sendCardFeishu, updateCardFeishu, sendPostFeishu, editMessageFeishu } from "./api/send.js";
import { uploadImageFeishu, uploadFileFeishu, sendImageFeishu, sendFileFeishu, sendMediaFeishu } from "./api/media.js";
import { createPoll } from "./features/vote/index.js";
import { containsMarkdownTable, textToTableCard } from "./features/table-card.js";

/** Check if text contains fenced code blocks */
function hasCodeBlocks(text: string): boolean {
  return /```[\s\S]*?```/.test(text);
}

/**
 * Remove consecutive duplicate paragraphs from text.
 * Handles LLM "stutter" where the same content is repeated.
 * 
 * Strategy:
 * 1. Split by double newlines (paragraph separator)
 * 2. Remove consecutive duplicates (keep first occurrence)
 * 3. Also detect near-duplicates (>90% similarity) for fuzzy matching
 */
function deduplicateParagraphs(text: string): string {
  if (!text || text.length < 100) return text; // Skip short texts

  // Split into paragraphs (by double newlines or more)
  const paragraphs = text.split(/\n{2,}/);
  if (paragraphs.length < 2) return text;

  const result: string[] = [];
  
  for (let i = 0; i < paragraphs.length; i++) {
    const current = paragraphs[i].trim();
    if (!current) {
      result.push(paragraphs[i]); // Preserve empty paragraphs for spacing
      continue;
    }

    // Check if this paragraph is a duplicate of the previous non-empty one
    let isDuplicate = false;
    for (let j = result.length - 1; j >= 0 && j >= result.length - 3; j--) {
      const prev = result[j].trim();
      if (!prev) continue;
      
      // Exact match
      if (current === prev) {
        isDuplicate = true;
        break;
      }
      
      // Near-duplicate: >90% character overlap (handles minor whitespace/punctuation differences)
      if (current.length > 50 && prev.length > 50) {
        const similarity = stringSimilarity(current, prev);
        if (similarity > 0.9) {
          isDuplicate = true;
          break;
        }
      }
    }

    if (!isDuplicate) {
      result.push(paragraphs[i]);
    }
  }

  // Only return deduplicated text if we actually removed something
  if (result.length < paragraphs.length) {
    const dedupedText = result.join("\n\n");
    console.log(`[feishu-dedup] removed ${paragraphs.length - result.length} duplicate paragraph(s)`);
    return dedupedText;
  }

  return text;
}

/** Simple Jaccard-like similarity: ratio of common chars */
function stringSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().replace(/\s+/g, ""));
  const setB = new Set(b.toLowerCase().replace(/\s+/g, ""));
  let intersection = 0;
  for (const char of setA) {
    if (setB.has(char)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export const feishuOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getFeishuRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async ({ cfg, to, text }) => {
    // Deduplicate consecutive repeated paragraphs (LLM stutter fix)
    const dedupedText = deduplicateParagraphs(text);

    // Auto-detect markdown tables → use card for proper table rendering
    if (containsMarkdownTable(dedupedText)) {
      const card = textToTableCard(dedupedText);
      if (card) {
        const result = await sendCardFeishu({ cfg, to, card });
        return { channel: "feishu", ...result };
      }
    }

    // Auto-detect code blocks → use post (rich text) format for proper code_block rendering
    if (hasCodeBlocks(dedupedText)) {
      const result = await sendPostFeishu({ cfg, to, text: dedupedText });
      return { channel: "feishu", ...result };
    }

    const result = await sendMessageFeishu({ cfg, to, text: dedupedText });
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
