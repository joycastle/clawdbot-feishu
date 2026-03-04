import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
  type ClawdbotConfig,
  type RuntimeEnv,
  type ReplyPayload,
} from "clawdbot/plugin-sdk";
import { getFeishuRuntime } from "./runtime.js";
import { sendMessageFeishu, sendMarkdownCardFeishu, sendCardFeishu } from "./api/send.js";
import { containsMarkdownTable, textToTableCard } from "./features/table-card.js";
import type { FeishuConfig, MentionTarget } from "./types.js";
import {
  addTypingIndicator,
  removeTypingIndicator,
  type TypingIndicatorState,
} from "./features/typing.js";
import {
  sendStatusCard,
  updateStatusCard,
  deleteStatusCard,
  type StatusCardState,
} from "./features/status-card.js";

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

  const prefixContext = createReplyPrefixContext({
    cfg,
    agentId,
  });

  // Check if status card mode is enabled
  const feishuCfgCheck = cfg.channels?.feishu as FeishuConfig | undefined;
  const useStatusCard = feishuCfgCheck?.statusCard === true;

  // Feishu doesn't have a native typing indicator API.
  // We use message reactions as a typing indicator substitute.
  // Or use status card mode for more control.
  let typingState: TypingIndicatorState | null = null;
  let statusCardState: StatusCardState | null = null;

  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      if (!replyToMessageId) return;
      
      if (useStatusCard) {
        // Status card mode: send a card showing "processing"
        if (statusCardState) {
          // Check if this is the same turn (same trigger message)
          if (statusCardState.triggerMessageId === replyToMessageId) {
            // Same turn - update existing card back to "running" if needed
            params.runtime.log?.(`feishu: status card exists for same turn, updating to running`);
            await updateStatusCard({
              cfg,
              triggerMessageId: statusCardState.triggerMessageId,
              status: "running",
            });
            return;
          } else {
            // New turn (different trigger message) - clear old state
            params.runtime.log?.(`feishu: new turn detected, clearing old status card state`);
            statusCardState = null;
          }
        }
        // Send new status card
        statusCardState = await sendStatusCard({
          cfg,
          chatId,
          triggerMessageId: replyToMessageId,
          replyToMessageId,
        });
        params.runtime.log?.(`feishu: sent status card (running)`);
      } else {
        // Default: use typing indicator reaction
        if (typingState) return; // Already showing typing
        typingState = await addTypingIndicator({ cfg, messageId: replyToMessageId });
        params.runtime.log?.(`feishu: added typing indicator reaction`);
      }
    },
    stop: async () => {
      if (useStatusCard) {
        // Status card mode: update card to "completed"
        if (statusCardState?.triggerMessageId) {
          await updateStatusCard({
            cfg,
            triggerMessageId: statusCardState.triggerMessageId,
            status: "completed",
          });
          // Don't delete the card - keep it as "completed" status
          // Deleting shows "撤回了一条消息" which looks weird
          params.runtime.log?.(`feishu: updated status card (completed)`);
        }
        // Don't clear statusCardState here - keep it for potential continuation within same turn
        // State will be cleared when new turn starts (different replyToMessageId)
      } else {
        // Default: remove typing indicator
        if (!typingState) return;
        await removeTypingIndicator({ cfg, state: typingState });
        typingState = null;
        params.runtime.log?.(`feishu: removed typing indicator reaction`);
      }
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

  const textChunkLimit = core.channel.text.resolveTextChunkLimit({
    cfg,
    channel: "feishu",
    defaultLimit: 4000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "feishu");
  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "feishu",
  });

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: typingCallbacks.onReplyStart,
      deliver: async (payload: ReplyPayload) => {
        params.runtime.log?.(`feishu deliver called: text=${payload.text?.slice(0, 100)}`);
        const text = payload.text ?? "";
        if (!text.trim()) {
          params.runtime.log?.(`feishu deliver: empty text, skipping`);
          return;
        }

        // Check render mode: auto (default), raw, or card
        const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
        const renderMode = feishuCfg?.renderMode ?? "auto";

        // Priority 1: Check for markdown tables → use table card for proper rendering
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

        // Determine if we should use card for this message
        const useCard =
          renderMode === "card" || (renderMode === "auto" && shouldUseCard(text));

        let isFirstChunk = true;
        if (useCard) {
          // Card mode: send as interactive card with markdown rendering
          const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
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
          const converted = core.channel.text.convertMarkdownTables(text, tableMode);
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
      },
      onError: (err, info) => {
        params.runtime.error?.(`feishu ${info.kind} reply failed: ${String(err)}`);
        typingCallbacks.onIdle?.();
      },
      onIdle: typingCallbacks.onIdle,
    });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onModelSelected: prefixContext.onModelSelected,
    },
    markDispatchIdle,
  };
}
