/**
 * Media (audio/video) cost confirmation module.
 *
 * When a user sends an audio or video message, this module:
 * 1. Estimates the processing cost
 * 2. Sends an interactive card with cost breakdown and confirm/cancel buttons
 * 3. Handles the card action callback when the user clicks
 * 4. Resumes or cancels media processing accordingly
 *
 * Card action callbacks are received via the `card.action.trigger` event
 * through the WebSocket EventDispatcher.
 */

import type { ClawdbotConfig, HistoryEntry } from "clawdbot/plugin-sdk";
import { estimateMediaCost, formatFileSize, type CostEstimate } from "./cost-estimator.js";
import { sendCardFeishu, updateCardFeishu } from "./send.js";
import type { FeishuMessageEvent } from "./bot.js";
import type { FeishuMediaInfo } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PendingMediaConfirmation {
  /** Unique pending ID */
  id: string;
  /** Original Feishu message event */
  event: FeishuMessageEvent;
  /** Config snapshot at time of interception */
  cfg: ClawdbotConfig;
  /** Media type */
  mediaType: "audio" | "video";
  /** File size in bytes */
  fileSizeBytes: number;
  /** Cost estimate */
  costEstimate: CostEstimate;
  /** Message ID of the confirmation card (for updating) */
  cardMessageId: string;
  /** Chat ID */
  chatId: string;
  /** Sender open ID (for authorization) */
  senderOpenId: string;
  /** Timestamp of creation */
  createdAt: number;
  /** Bot open ID (passed through for resume) */
  botOpenId?: string;
  /** Runtime env (passed through for resume) */
  runtime?: unknown;
  /** Chat histories map (passed through for resume) */
  chatHistories?: Map<string, HistoryEntry[]>;
  /** Pre-resolved media list (already downloaded) */
  mediaList: FeishuMediaInfo[];
}

/** Card action event data from Feishu (card.action.trigger) */
export interface CardActionEvent {
  operator?: {
    tenant_key?: string;
    user_id?: string;
    open_id?: string;
  };
  token?: string;
  action?: {
    value?: Record<string, unknown>;
    tag?: string;
    option?: string;
  };
  host?: string;
  context?: {
    url?: string;
    preview_token?: string;
    open_message_id?: string;
    open_chat_id?: string;
  };
}

// ─── State Management ────────────────────────────────────────────────────────

/** Pending confirmations storage (in-memory, keyed by pendingId) */
const pendingConfirmations = new Map<string, PendingMediaConfirmation>();

/** TTL for pending confirmations (30 minutes) */
const PENDING_TTL_MS = 30 * 60 * 1000;

/** Cleanup timer reference */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/** Start periodic cleanup of expired entries */
function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, entry] of pendingConfirmations) {
      if (now - entry.createdAt > PENDING_TTL_MS) {
        pendingConfirmations.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      // Log cleaned entries if any
    }
    if (pendingConfirmations.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, 5 * 60 * 1000);
}

/** Generate a unique pending ID */
function generatePendingId(): string {
  return `mc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Card Builders ───────────────────────────────────────────────────────────

/**
 * Build the cost confirmation interactive card.
 */
function buildCostConfirmCard(params: {
  mediaType: "audio" | "video";
  fileSizeBytes: number;
  costEstimate: CostEstimate;
  pendingId: string;
}): Record<string, unknown> {
  const { mediaType, fileSizeBytes, costEstimate, pendingId } = params;

  const mediaLabel = mediaType === "audio" ? "🎤 语音消息" : "🎬 视频消息";
  const fileSize = formatFileSize(fileSizeBytes);

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: "plain_text",
        content: `${mediaLabel} — 处理确认`,
      },
      template: "orange",
    },
    elements: [
      {
        tag: "markdown",
        content: [
          `**类型：** ${mediaLabel}`,
          `**文件大小：** ${fileSize}`,
          `**预估时长：** ~${costEstimate.durationDisplay}`,
          `**预估成本：** ${costEstimate.costDisplay}`,
          `**计费方式：** ${costEstimate.pricingBasis}`,
        ].join("\n"),
      },
      {
        tag: "hr",
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: {
              tag: "plain_text",
              content: "✅ 确认处理",
            },
            type: "primary",
            value: {
              action: "confirm_media",
              pendingId,
            },
          },
          {
            tag: "button",
            text: {
              tag: "plain_text",
              content: "❌ 取消",
            },
            type: "default",
            value: {
              action: "cancel_media",
              pendingId,
            },
          },
        ],
      },
    ],
  };
}

/**
 * Build a "processing" card (shown after user confirms).
 */
export function buildProcessingCard(mediaType: "audio" | "video"): Record<string, unknown> {
  const mediaLabel = mediaType === "audio" ? "🎤 语音消息" : "🎬 视频消息";
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `${mediaLabel} — 处理中` },
      template: "green",
    },
    elements: [
      {
        tag: "markdown",
        content: "⏳ 正在处理中，请稍候...",
      },
    ],
  };
}

/**
 * Build a "cancelled" card.
 */
export function buildCancelledCard(mediaType: "audio" | "video"): Record<string, unknown> {
  const mediaLabel = mediaType === "audio" ? "🎤 语音消息" : "🎬 视频消息";
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `${mediaLabel} — 已取消` },
      template: "grey",
    },
    elements: [
      {
        tag: "markdown",
        content: "已取消处理。",
      },
    ],
  };
}

/**
 * Build an "expired" card.
 */
export function buildExpiredCard(): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "确认已过期" },
      template: "grey",
    },
    elements: [
      {
        tag: "markdown",
        content: "此确认已过期，请重新发送消息。",
      },
    ],
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Send a cost confirmation card for a media message.
 * Call this when an audio/video message is detected before processing.
 */
export async function sendMediaConfirmCard(params: {
  cfg: ClawdbotConfig;
  event: FeishuMessageEvent;
  mediaType: "audio" | "video";
  fileSizeBytes: number;
  mediaList: FeishuMediaInfo[];
  modelHint?: string;
  /** Actual duration in milliseconds (from Feishu message metadata) */
  durationMs?: number;
  botOpenId?: string;
  runtime?: unknown;
  chatHistories?: Map<string, HistoryEntry[]>;
  log?: (msg: string) => void;
}): Promise<PendingMediaConfirmation> {
  const {
    cfg,
    event,
    mediaType,
    fileSizeBytes,
    mediaList,
    modelHint,
    durationMs,
    botOpenId,
    runtime,
    chatHistories,
    log,
  } = params;

  const costEstimate = estimateMediaCost({
    fileSizeBytes,
    mediaType,
    modelHint,
    durationMs,
  });

  const pendingId = generatePendingId();
  const chatId = event.message.chat_id;
  const senderOpenId = event.sender.sender_id.open_id || "";

  const card = buildCostConfirmCard({
    mediaType,
    fileSizeBytes,
    costEstimate,
    pendingId,
  });

  // Send card as a reply to the original message
  const target =
    event.message.chat_type === "p2p" ? `user:${senderOpenId}` : `chat:${chatId}`;

  log?.(
    `feishu: sending media cost confirmation card (type=${mediaType}, size=${fileSizeBytes}, cost=${costEstimate.costDisplay}, pendingId=${pendingId})`,
  );

  const result = await sendCardFeishu({
    cfg,
    to: target,
    card,
    replyToMessageId: event.message.message_id,
  });

  const entry: PendingMediaConfirmation = {
    id: pendingId,
    event,
    cfg,
    mediaType,
    fileSizeBytes,
    costEstimate,
    cardMessageId: result.messageId,
    chatId,
    senderOpenId,
    createdAt: Date.now(),
    botOpenId,
    runtime,
    chatHistories: chatHistories as Map<string, HistoryEntry[]>,
    mediaList,
  };

  pendingConfirmations.set(pendingId, entry);
  ensureCleanupTimer();

  log?.(
    `feishu: media confirmation pending (pendingId=${pendingId}, cardMsgId=${result.messageId})`,
  );

  return entry;
}

/**
 * Handle a card action event from Feishu.
 * Called when a `card.action.trigger` event is received.
 *
 * Returns the pending entry if confirmed (caller should resume processing).
 * Returns null if cancelled, expired, or not a media confirmation action.
 */
export async function handleMediaCardAction(params: {
  actionData: CardActionEvent;
  log?: (msg: string) => void;
}): Promise<PendingMediaConfirmation | null> {
  const { actionData, log } = params;

  const actionValue = actionData.action?.value as Record<string, unknown> | undefined;
  // operator.open_id may be empty in some scenarios; fallback to user_id
  const operatorOpenId = actionData.operator?.open_id || actionData.operator?.user_id || "";
  log?.(`feishu: card action operator: open_id=${actionData.operator?.open_id || "(empty)"}, user_id=${actionData.operator?.user_id || "(empty)"}`);

  if (!actionValue) {
    log?.(`feishu: card action has no value payload`);
    return null;
  }

  const action = actionValue.action as string | undefined;
  const pendingId = actionValue.pendingId as string | undefined;

  if (!pendingId || typeof pendingId !== "string") {
    // Not a media confirmation action — ignore silently
    return null;
  }

  if (action !== "confirm_media" && action !== "cancel_media") {
    log?.(`feishu: unknown card action: ${action}`);
    return null;
  }

  const entry = pendingConfirmations.get(pendingId);

  if (!entry) {
    log?.(`feishu: pending confirmation not found (pendingId=${pendingId}, may have expired)`);
    // Try to update the card to show expired state
    const openMessageId = actionData.context?.open_message_id;
    if (openMessageId) {
      // We don't have cfg here easily, so just log it
      log?.(`feishu: card ${openMessageId} refers to expired confirmation`);
    }
    return null;
  }

  // Verify the operator is the original sender
  // Skip auth check if we can't determine operator identity (open_id/user_id both empty)
  if (entry.senderOpenId && operatorOpenId && operatorOpenId !== entry.senderOpenId) {
    log?.(
      `feishu: card action from wrong user (expected=${entry.senderOpenId}, got=${operatorOpenId})`,
    );
    return null;
  }

  // Remove from pending map
  pendingConfirmations.delete(pendingId);

  if (action === "cancel_media") {
    log?.(`feishu: media processing cancelled by user (pendingId=${pendingId})`);
    // Update card via PATCH API (reliable). Callback in monitor.ts returns toast only.
    try {
      await updateCardFeishu({
        cfg: entry.cfg,
        messageId: entry.cardMessageId,
        card: buildCancelledCard(entry.mediaType),
      });
    } catch (err) {
      log?.(`feishu: failed to update cancelled card: ${String(err)}`);
    }
    return null;
  }

  // action === "confirm_media"
  log?.(`feishu: media processing confirmed by user (pendingId=${pendingId})`);
  // Update card via PATCH API (reliable). Callback in monitor.ts returns toast only.
  try {
    await updateCardFeishu({
      cfg: entry.cfg,
      messageId: entry.cardMessageId,
      card: buildProcessingCard(entry.mediaType),
    });
  } catch (err) {
    log?.(`feishu: failed to update processing card: ${String(err)}`);
  }

  return entry;
}

/**
 * Check if a card action value belongs to the media confirmation system.
 */
export function isMediaConfirmAction(actionValue: Record<string, unknown> | undefined): boolean {
  if (!actionValue) return false;
  const action = actionValue.action;
  return action === "confirm_media" || action === "cancel_media";
}

/**
 * Get the number of pending confirmations (for diagnostics).
 */
export function getPendingMediaConfirmCount(): number {
  return pendingConfirmations.size;
}
