import type { ClawdbotConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import {
  createReplyPrefixContext,
  logTypingFailure,
  type ReplyPayload,
} from "openclaw/plugin-sdk/feishu";
import { createTypingCallbacks } from "openclaw/plugin-sdk/matrix";
import { getFeishuRuntime } from "./runtime.js";
import { createFeishuClient } from "./client.js";
import { resolveFeishuCredentials } from "./accounts.js";
import { sendMessageFeishu, sendMarkdownCardFeishu, sendCardFeishu } from "./api/send.js";
import { containsMarkdownTable, textToTableCard } from "./features/table-card.js";
import type { FeishuConfig, MentionTarget } from "./types.js";
import {
  addTypingIndicator,
  removeTypingIndicator,
  type TypingIndicatorState,
} from "./features/typing.js";
import { FeishuStreamingSession, mergeStreamingText } from "./streaming-card.js";

/**
 * Detect if text contains markdown elements that benefit from card rendering.
 * Used by auto render mode.
 */
function shouldUseCard(text: string): boolean {
  // Code blocks (fenced)
  if (/```[\s\S]*?```/.test(text)) return true;
  // Tables (at least header + separator row with |)
  if (/\|.+\|[\r\n]+\|[-:| ]+\|/.test(text)) return true;
  return false;
}

export type CreateFeishuReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  replyToMessageId?: string;
  mentionTargets?: MentionTarget[];
};

export function createFeishuReplyDispatcher(params: CreateFeishuReplyDispatcherParams) {
  const core = getFeishuRuntime();
  const { cfg, agentId, chatId, replyToMessageId, mentionTargets } = params;

  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  const renderMode = feishuCfg?.renderMode ?? "auto";
  // Streaming is enabled by default unless explicitly disabled or renderMode is "raw"
  const streamingEnabled = feishuCfg?.streaming !== false && renderMode !== "raw";

  const prefixContext = createReplyPrefixContext({
    cfg,
    agentId,
  });

  // Feishu doesn't have a native typing indicator API.
  // We use message reactions as a typing indicator substitute.
  let typingState: TypingIndicatorState | null = null;

  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      if (!replyToMessageId) return;
      typingState = await addTypingIndicator({ cfg, messageId: replyToMessageId });
      params.runtime.log?.(`feishu: added typing indicator reaction`);
    },
    stop: async () => {
      if (!typingState) return;
      await removeTypingIndicator({ cfg, state: typingState });
      typingState = null;
      params.runtime.log?.(`feishu: removed typing indicator reaction`);
    },
    onStartError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "feishu",
        action: "start",
        error: err,
      });
    },
    onStopError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "feishu",
        action: "stop",
        error: err,
      });
    },
  });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit(cfg, "feishu", undefined, {
    fallbackLimit: 4000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "feishu");
  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "feishu",
  });

  // Streaming state
  let streaming: FeishuStreamingSession | null = null;
  let streamText = "";
  let lastPartial = "";
  let partialUpdateQueue: Promise<void> = Promise.resolve();
  let streamingStartPromise: Promise<void> | null = null;
  type StreamTextUpdateMode = "snapshot" | "delta";

  // Track dropped block text for fallback delivery (when streaming not used)
  let droppedBlockText = "";

  // Track sent messages to prevent duplicate sends
  const sentMessageHashes = new Set<string>();
  const hashText = (text: string): string => {
    // Simple hash for deduplication (first 200 chars + length)
    const normalized = text.trim().slice(0, 200);
    return `${normalized.length}:${normalized}`;
  };
  const wasAlreadySent = (text: string): boolean => {
    const hash = hashText(text);
    if (sentMessageHashes.has(hash)) {
      params.runtime.log?.(`feishu: skipping duplicate message (hash=${hash.slice(0, 50)}...)`);
      return true;
    }
    sentMessageHashes.add(hash);
    // Keep set bounded
    if (sentMessageHashes.size > 50) {
      const first = sentMessageHashes.values().next().value;
      if (first) sentMessageHashes.delete(first);
    }
    return false;
  };

  const queueStreamingUpdate = (
    nextText: string,
    options?: {
      dedupeWithLastPartial?: boolean;
      mode?: StreamTextUpdateMode;
    },
  ) => {
    if (!nextText) return;
    if (options?.dedupeWithLastPartial && nextText === lastPartial) return;
    if (options?.dedupeWithLastPartial) lastPartial = nextText;
    const mode = options?.mode ?? "snapshot";
    streamText =
      mode === "delta" ? `${streamText}${nextText}` : mergeStreamingText(streamText, nextText);
    partialUpdateQueue = partialUpdateQueue.then(async () => {
      if (streamingStartPromise) await streamingStartPromise;
      if (streaming?.isActive()) await streaming.update(streamText);
    });
  };

  const startStreaming = () => {
    if (!streamingEnabled || streamingStartPromise || streaming) return;
    streamingStartPromise = (async () => {
      const creds = resolveFeishuCredentials(feishuCfg);
      if (!creds) return;
      streaming = new FeishuStreamingSession(
        createFeishuClient(feishuCfg!),
        creds,
        (msg) => params.runtime.log?.(`feishu: ${msg}`),
      );
      try {
        await streaming.start(chatId, "chat_id", { replyToMessageId });
      } catch (e) {
        params.runtime.error?.(`feishu: streaming start failed: ${String(e)}`);
        streaming = null;
      }
    })();
  };

  const closeStreaming = async () => {
    if (streamingStartPromise) await streamingStartPromise;
    await partialUpdateQueue;
    if (streaming?.isActive()) {
      await streaming.close(streamText || undefined);
    }
    streaming = null;
    streamingStartPromise = null;
    streamText = "";
    lastPartial = "";
  };

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: () => {
        // For explicit card mode, start streaming immediately to show "⏳ Thinking..."
        if (streamingEnabled && renderMode === "card") {
          startStreaming();
        }
        void typingCallbacks.onReplyStart?.();
      },
      deliver: async (payload: ReplyPayload, info: { kind: "tool" | "block" | "final" }) => {
        params.runtime.log?.(`[DEDUP-DEBUG] deliver called: kind=${info?.kind} len=${payload.text?.length ?? 0} text="${payload.text?.slice(0, 80)}..."`);
        const text = payload.text ?? "";
        if (!text.trim()) {
          params.runtime.log?.(`feishu deliver: empty text, skipping`);
          return;
        }

        // Priority 1: Check for markdown tables → use table card (not streamed)
        if (containsMarkdownTable(text)) {
          const tableCard = textToTableCard(text);
          if (tableCard) {
            params.runtime.log?.(`feishu deliver: sending table card to ${chatId}`);
            await sendCardFeishu({
              cfg,
              to: chatId,
              card: tableCard,
              replyToMessageId,
            });
            return;
          }
        }

        const useCard =
          renderMode === "card" || (renderMode === "auto" && shouldUseCard(text));

        // Handle block chunks (intermediate streaming chunks from AI)
        if (info?.kind === "block") {
          if (!(streamingEnabled && useCard)) {
            // Accumulate dropped block text for final fallback (don't lose content!)
            droppedBlockText = mergeStreamingText(droppedBlockText, text);
            params.runtime.log?.(`feishu deliver: accumulated block text for fallback (${droppedBlockText.length} chars)`);
            return;
          }
          startStreaming();
          if (streamingStartPromise) await streamingStartPromise;
          if (streaming?.isActive()) {
            // Accumulate block text into streaming card as delta
            queueStreamingUpdate(text, { mode: "delta" });
            return;
          }
          return;
        }

        // For final delivery with streaming enabled + card mode: ensure streaming is active
        if (info?.kind === "final" && streamingEnabled && useCard) {
          startStreaming();
          if (streamingStartPromise) await streamingStartPromise;
        }

        // If streaming session is active, close it with the final text
        if (streaming?.isActive()) {
          if (info?.kind === "final") {
            streamText = mergeStreamingText(streamText, text);
            await closeStreaming();
          }
          return;
        }

        // Merge any dropped block text with the current text for final delivery
        let deliverText = text;
        if (info?.kind === "final" && droppedBlockText) {
          deliverText = mergeStreamingText(droppedBlockText, text);
          params.runtime.log?.(`feishu deliver: merged dropped block text, final length=${deliverText.length}`);
          droppedBlockText = ""; // Clear after use
        }

        // Fall through to normal (non-streaming) delivery
        // Check for duplicate before sending
        if (wasAlreadySent(deliverText)) {
          params.runtime.log?.(`feishu deliver: skipping duplicate final delivery`);
          droppedBlockText = ""; // Still clear to prevent onIdle resend
          return;
        }

        let isFirstChunk = true;
        // Re-evaluate useCard with the merged text (might contain code blocks now)
        const finalUseCard =
          renderMode === "card" || (renderMode === "auto" && shouldUseCard(deliverText));
        if (finalUseCard) {
          // Card mode: send as interactive card with markdown rendering
          const chunks = core.channel.text.chunkTextWithMode(deliverText, textChunkLimit, chunkMode);
          params.runtime.log?.(`feishu deliver: sending ${chunks.length} card chunks to ${chatId}`);
          for (const chunk of chunks) {
            await sendMarkdownCardFeishu({
              cfg,
              to: chatId,
              text: chunk,
              replyToMessageId,
              mentions: isFirstChunk ? mentionTargets : undefined,
            });
            isFirstChunk = false;
          }
        } else {
          // Raw mode: send as plain text with table conversion
          const converted = core.channel.text.convertMarkdownTables(deliverText, tableMode);
          const chunks = core.channel.text.chunkTextWithMode(converted, textChunkLimit, chunkMode);
          params.runtime.log?.(`feishu deliver: sending ${chunks.length} text chunks to ${chatId}`);
          for (const chunk of chunks) {
            await sendMessageFeishu({
              cfg,
              to: chatId,
              text: chunk,
              replyToMessageId,
              mentions: isFirstChunk ? mentionTargets : undefined,
            });
            isFirstChunk = false;
          }
        }

        // Safety: ensure droppedBlockText is cleared after any successful final delivery
        // to prevent duplicate sends in onIdle
        if (info?.kind === "final") {
          droppedBlockText = "";
        }
      },
      onError: async (err: unknown, info: { kind: "tool" | "block" | "final" }) => {
        params.runtime.error?.(`feishu ${info.kind} reply failed: ${String(err)}`);
        await closeStreaming();
        typingCallbacks.onIdle?.();
      },
      onIdle: async () => {
        await closeStreaming();
        // Safety: flush any remaining dropped block text that wasn't delivered
        // IMPORTANT: Save and clear BEFORE sending to prevent duplicate sends
        // if onIdle is called multiple times (e.g., from markDispatchIdle + dispatcher.onIdle)
        const textToFlush = droppedBlockText;
        droppedBlockText = ""; // Clear immediately to prevent duplicates
        
        // DEBUG: track onIdle calls to diagnose duplicate sends
        params.runtime.log?.(`[DEDUP-DEBUG] onIdle called, textToFlush=${textToFlush.length} chars, sentHashes=${sentMessageHashes.size}`);
        
        if (textToFlush) {
          // Check for duplicate before sending
          if (wasAlreadySent(textToFlush)) {
            params.runtime.log?.(`feishu onIdle: SKIPPED duplicate flush (${textToFlush.length} chars)`);
          } else {
            params.runtime.log?.(`feishu onIdle: flushing ${textToFlush.length} chars of dropped block text`);
            const converted = core.channel.text.convertMarkdownTables(textToFlush, tableMode);
            const chunks = core.channel.text.chunkTextWithMode(converted, textChunkLimit, chunkMode);
            params.runtime.log?.(`feishu onIdle: sending ${chunks.length} chunks to ${chatId}`);
            for (const chunk of chunks) {
              await sendMessageFeishu({
                cfg,
                to: chatId,
                text: chunk,
                replyToMessageId,
              });
            }
            params.runtime.log?.(`feishu onIdle: done sending to ${chatId}`);
          }
        }
        typingCallbacks.onIdle?.();
      },
    });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onModelSelected: prefixContext.onModelSelected,
      onPartialReply: streamingEnabled
        ? (payload: ReplyPayload) => {
            if (!payload.text) return;
            queueStreamingUpdate(payload.text, { dedupeWithLastPartial: true, mode: "snapshot" });
          }
        : undefined,
    },
    markDispatchIdle,
  };
}
