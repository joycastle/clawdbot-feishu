/**
 * Bitable Video Confirm — interactive card for cost confirmation.
 *
 * Sends a Feishu interactive card with cost estimate and confirm/cancel buttons.
 * Card action callbacks are handled by monitor.ts → triggers Gemini analysis.
 *
 * State is stored in-memory (pending confirmations map) with 30-min TTL.
 */

import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import { sendCardFeishu, updateCardFeishu } from "../send.js";
import { formatFileSize } from "../cost-estimator.js";
import { analyzeVideoFromGcs } from "../video-analyze.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PendingBitableVideoConfirm {
  id: string;
  gcsUri: string;
  mimeType: string;
  fileName: string;
  size: number;
  recordNumber: number | string;
  prompt: string;
  costDisplay: string;
  estimatedCostUsd: number;
  durationDisplay: string;
  model: string;
  pricingBasis: string;
  /** Card message ID (for updating after confirm/cancel) */
  cardMessageId: string;
  /** Where to send the result */
  target: string;
  /** Reply to this message */
  replyToMessageId: string;
  /** Who initiated the request */
  senderOpenId: string;
  /** Config snapshot */
  cfg: ClawdbotConfig;
  /** Timestamp */
  createdAt: number;
}

// ─── State (file-persisted, shared between CLI and Clawdbot process) ─────────

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const PENDING_DIR = join(process.env.HOME ?? "/tmp", ".clawdbot");
const PENDING_FILE = join(PENDING_DIR, "bitable-video-pending.json");
const PENDING_TTL_MS = 30 * 60 * 1000;

type PendingStore = Record<string, PendingBitableVideoConfirm>;

async function loadPending(): Promise<PendingStore> {
  try {
    if (existsSync(PENDING_FILE)) {
      const raw = await readFile(PENDING_FILE, "utf-8");
      const store = JSON.parse(raw) as PendingStore;
      // Clean expired entries
      const now = Date.now();
      let changed = false;
      for (const [id, entry] of Object.entries(store)) {
        if (now - entry.createdAt > PENDING_TTL_MS) {
          delete store[id];
          changed = true;
        }
      }
      if (changed) await savePending(store);
      return store;
    }
  } catch { /* ignore */ }
  return {};
}

async function savePending(store: PendingStore): Promise<void> {
  try {
    if (!existsSync(PENDING_DIR)) await mkdir(PENDING_DIR, { recursive: true });
    await writeFile(PENDING_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("[bitable-video-confirm] Failed to save pending:", err);
  }
}

async function getPending(id: string): Promise<PendingBitableVideoConfirm | null> {
  const store = await loadPending();
  return store[id] ?? null;
}

async function setPending(entry: PendingBitableVideoConfirm): Promise<void> {
  const store = await loadPending();
  store[entry.id] = entry;
  await savePending(store);
}

async function deletePending(id: string): Promise<void> {
  const store = await loadPending();
  delete store[id];
  await savePending(store);
}

function generateId(): string {
  return `bv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Card Builders ───────────────────────────────────────────────────────────

function buildConfirmCard(entry: {
  fileName: string;
  size: number;
  recordNumber: number | string;
  costDisplay: string;
  durationDisplay: string;
  pricingBasis: string;
  cacheHit: boolean;
  pendingId: string;
}): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "🎬 视频分析 — 费用确认" },
      template: "orange",
    },
    elements: [
      {
        tag: "markdown",
        content: [
          `**文件：** ${entry.fileName}（#${entry.recordNumber}）`,
          `**大小：** ${formatFileSize(entry.size)}`,
          `**预估时长：** ~${entry.durationDisplay}`,
          `**预估成本：** ${entry.costDisplay}`,
          `**计费方式：** ${entry.pricingBasis}`,
          entry.cacheHit ? `**状态：** 已缓存，无需重新上传` : `**状态：** 已上传到 GCS`,
        ].join("\n"),
      },
      { tag: "hr" },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "✅ 确认分析" },
            type: "primary",
            value: { action: "confirm_bitable_video", pendingId: entry.pendingId },
          },
          {
            tag: "button",
            text: { tag: "plain_text", content: "❌ 取消" },
            type: "default",
            value: { action: "cancel_bitable_video", pendingId: entry.pendingId },
          },
        ],
      },
    ],
  };
}

function buildAnalyzingCard(): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "🎬 视频分析 — 处理中" },
      template: "green",
    },
    elements: [{ tag: "markdown", content: "⏳ 正在用 Gemini 分析视频，请稍候..." }],
  };
}

function buildCancelledCard(): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "🎬 视频分析 — 已取消" },
      template: "grey",
    },
    elements: [{ tag: "markdown", content: "已取消分析。" }],
  };
}

function buildExpiredCard(): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "🎬 视频分析 — 已过期" },
      template: "grey",
    },
    elements: [{ tag: "markdown", content: "确认已过期，请重新发送分析请求。" }],
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Send a cost confirmation card for bitable video analysis.
 * Returns the pending ID for tracking.
 */
export async function sendBitableVideoConfirmCard(params: {
  cfg: ClawdbotConfig;
  gcsUri: string;
  mimeType: string;
  fileName: string;
  size: number;
  recordNumber: number | string;
  cacheHit: boolean;
  prompt: string;
  costDisplay: string;
  estimatedCostUsd: number;
  durationDisplay: string;
  model: string;
  pricingBasis: string;
  /** Target: user:open_id or chat:chat_id */
  target: string;
  /** Reply to this message_id */
  replyToMessageId: string;
  /** Sender's open_id (for authorization) */
  senderOpenId: string;
  log?: (msg: string) => void;
}): Promise<string> {
  const pendingId = generateId();
  const log = params.log ?? console.log;

  const card = buildConfirmCard({
    fileName: params.fileName,
    size: params.size,
    recordNumber: params.recordNumber,
    costDisplay: params.costDisplay,
    durationDisplay: params.durationDisplay,
    pricingBasis: params.pricingBasis,
    cacheHit: params.cacheHit,
    pendingId,
  });

  const result = await sendCardFeishu({
    cfg: params.cfg,
    to: params.target,
    card,
    replyToMessageId: params.replyToMessageId,
  });

  const entry: PendingBitableVideoConfirm = {
    id: pendingId,
    gcsUri: params.gcsUri,
    mimeType: params.mimeType,
    fileName: params.fileName,
    size: params.size,
    recordNumber: params.recordNumber,
    prompt: params.prompt,
    costDisplay: params.costDisplay,
    estimatedCostUsd: params.estimatedCostUsd,
    durationDisplay: params.durationDisplay,
    model: params.model,
    pricingBasis: params.pricingBasis,
    cardMessageId: result.messageId,
    target: params.target,
    replyToMessageId: params.replyToMessageId,
    senderOpenId: params.senderOpenId,
    cfg: params.cfg,
    createdAt: Date.now(),
  };

  await setPending(entry);

  log(`[bitable-video] Confirm card sent (pendingId=${pendingId}, card=${result.messageId})`);
  return pendingId;
}

/**
 * Check if a card action is a bitable video confirm/cancel action.
 */
export function isBitableVideoAction(actionValue: Record<string, unknown> | undefined): boolean {
  if (!actionValue) return false;
  const action = actionValue.action;
  return action === "confirm_bitable_video" || action === "cancel_bitable_video";
}

/**
 * Handle a bitable video card action (confirm or cancel).
 * On confirm: updates card → runs Gemini analysis → sends result card.
 * On cancel: updates card to cancelled state.
 *
 * Returns a card response for immediate callback feedback.
 */
export async function handleBitableVideoCardAction(params: {
  actionData: { action?: { value?: Record<string, unknown> }; operator?: { open_id?: string } };
  cfg: ClawdbotConfig;
  log?: (msg: string) => void;
}): Promise<Record<string, unknown> | undefined> {
  const { actionData, cfg } = params;
  const log = params.log ?? console.log;

  const actionValue = actionData.action?.value as Record<string, unknown> | undefined;
  if (!actionValue) return undefined;

  const action = actionValue.action as string;
  const pendingId = actionValue.pendingId as string;

  if (!pendingId) return undefined;

  const entry = await getPending(pendingId);

  if (!entry) {
    log(`[bitable-video] Pending not found: ${pendingId} (expired?)`);
    return buildExpiredCard();
  }

  // Verify sender
  const operatorOpenId = actionData.operator?.open_id || "";
  if (entry.senderOpenId && operatorOpenId !== entry.senderOpenId) {
    log(`[bitable-video] Action from wrong user (expected=${entry.senderOpenId}, got=${operatorOpenId})`);
    return undefined;
  }

  await deletePending(pendingId);

  if (action === "cancel_bitable_video") {
    log(`[bitable-video] Cancelled by user (pendingId=${pendingId})`);
    return buildCancelledCard();
  }

  // ── Confirm: update card → analyze → send result ──
  log(`[bitable-video] Confirmed by user (pendingId=${pendingId}), starting analysis...`);

  // Fire-and-forget: analyze in background
  void (async () => {
    try {
      const analysis = await analyzeVideoFromGcs(entry.gcsUri, entry.mimeType, {
        prompt: entry.prompt,
        log,
      });

      const costStr = analysis.estimatedCostUsd != null
        ? `$${analysis.estimatedCostUsd.toFixed(4)}`
        : "未知";
      const durationStr = `${(analysis.durationMs / 1000).toFixed(1)}s`;
      const tokensStr = analysis.usage
        ? `${analysis.usage.promptTokens} → ${analysis.usage.completionTokens}`
        : "未知";

      // Send result card
      await sendCardFeishu({
        cfg: entry.cfg,
        to: entry.target,
        card: {
          config: { wide_screen_mode: true },
          header: {
            title: { tag: "plain_text", content: "🎬 视频分析完成" },
            template: "green",
          },
          elements: [
            { tag: "markdown", content: analysis.text },
            { tag: "hr" },
            {
              tag: "note",
              elements: [{
                tag: "plain_text",
                content: `模型: ${analysis.model} | 耗时: ${durationStr} | Tokens: ${tokensStr} | 成本: ${costStr}`,
              }],
            },
          ],
        },
        replyToMessageId: entry.replyToMessageId,
      });

      // Update confirm card to show completion
      try {
        await updateCardFeishu({
          cfg: entry.cfg,
          messageId: entry.cardMessageId,
          card: {
            config: { wide_screen_mode: true },
            header: {
              title: { tag: "plain_text", content: "🎬 视频分析 — 完成" },
              template: "green",
            },
            elements: [{
              tag: "markdown",
              content: `✅ 分析完成（${durationStr}，${costStr}）`,
            }],
          },
        });
      } catch (err) {
        log(`[bitable-video] Failed to update card: ${err}`);
      }
    } catch (err) {
      log(`[bitable-video] Analysis failed: ${err}`);
      try {
        await sendCardFeishu({
          cfg: entry.cfg,
          to: entry.target,
          card: {
            config: { wide_screen_mode: true },
            header: {
              title: { tag: "plain_text", content: "🎬 视频分析失败" },
              template: "red",
            },
            elements: [{
              tag: "markdown",
              content: `分析失败：${err instanceof Error ? err.message : String(err)}`,
            }],
          },
          replyToMessageId: entry.replyToMessageId,
        });
      } catch { /* ignore */ }
    }
  })();

  return buildAnalyzingCard();
}
