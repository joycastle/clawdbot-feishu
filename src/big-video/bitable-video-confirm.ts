/**
 * Bitable Video Confirm — interactive card for cost confirmation.
 *
 * STATELESS design: all data needed for analysis is embedded in the card
 * button's action value. No external state (no files, no in-memory maps).
 * Feishu returns the action value in the card callback, so we just read it.
 *
 * Card updates use updateCardFeishu API directly (not callback return value)
 * for reliable card state transitions.
 */

import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import { sendCardFeishu, updateCardFeishu } from "../send.js";
import { formatFileSize } from "../cost-estimator.js";
import { analyzeVideoFromGcs } from "../video-analyze.js";
import { initGcsConfig } from "./gcs-upload.js";
import { setCredentialsPath } from "../video-analyze.js";

// ─── Card Builders ───────────────────────────────────────────────────────────

function buildConfirmCard(params: {
  fileName: string;
  size: number;
  recordNumber: number | string;
  costDisplay: string;
  durationDisplay: string;
  pricingBasis: string;
  cacheHit: boolean;
  confirmValue: Record<string, unknown>;
  cancelValue: Record<string, unknown>;
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
          `**文件：** ${params.fileName}（#${params.recordNumber}）`,
          `**大小：** ${formatFileSize(params.size)}`,
          `**预估时长：** ~${params.durationDisplay}`,
          `**预估成本：** ${params.costDisplay}`,
          `**计费方式：** ${params.pricingBasis}`,
          params.cacheHit ? `**状态：** 已缓存，无需重新上传` : `**状态：** 已上传到 GCS`,
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
            value: params.confirmValue,
          },
          {
            tag: "button",
            text: { tag: "plain_text", content: "❌ 取消" },
            type: "default",
            value: params.cancelValue,
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
      template: "blue",
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

function buildCompletedCard(durationStr: string, costStr: string): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "🎬 视频分析 — 完成" },
      template: "green",
    },
    elements: [{
      tag: "markdown",
      content: `✅ 分析完成（${durationStr}，${costStr}）`,
    }],
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Send a cost confirmation card for bitable video analysis.
 * All analysis parameters are embedded in the button's action value.
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
  target: string;
  replyToMessageId: string;
  senderOpenId: string;
  log?: (msg: string) => void;
}): Promise<string> {
  const log = params.log ?? console.log;

  const confirmValue = {
    action: "confirm_bitable_video",
    gcsUri: params.gcsUri,
    mimeType: params.mimeType,
    prompt: params.prompt,
    target: params.target,
    replyToMessageId: params.replyToMessageId,
    senderOpenId: params.senderOpenId,
  };

  const cancelValue = {
    action: "cancel_bitable_video",
  };

  const card = buildConfirmCard({
    fileName: params.fileName,
    size: params.size,
    recordNumber: params.recordNumber,
    costDisplay: params.costDisplay,
    durationDisplay: params.durationDisplay,
    pricingBasis: params.pricingBasis,
    cacheHit: params.cacheHit,
    confirmValue,
    cancelValue,
  });

  const result = await sendCardFeishu({
    cfg: params.cfg,
    to: params.target,
    card,
    replyToMessageId: params.replyToMessageId,
  });

  log(`[bitable-video] Confirm card sent (card=${result.messageId})`);
  return result.messageId;
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
 * STATELESS: reads all data from the action value itself.
 *
 * Card updates use updateCardFeishu API directly for reliability.
 * Does NOT rely on callback return value for card updates.
 */
export async function handleBitableVideoCardAction(params: {
  actionData: { action?: { value?: Record<string, unknown> }; operator?: { open_id?: string }; context?: { open_message_id?: string } };
  cfg: ClawdbotConfig;
  log?: (msg: string) => void;
}): Promise<void> {
  const { actionData, cfg } = params;
  const log = params.log ?? console.log;

  const actionValue = actionData.action?.value as Record<string, unknown> | undefined;
  if (!actionValue) return;

  const action = actionValue.action as string;
  const cardMessageId = actionData.context?.open_message_id;

  // ─── Cancel ────────────────────────────────────────────────────────────────
  if (action === "cancel_bitable_video") {
    log(`[bitable-video] Cancelled by user`);
    if (cardMessageId) {
      try {
        await updateCardFeishu({ cfg, messageId: cardMessageId, card: buildCancelledCard() });
        log(`[bitable-video] Card updated to cancelled`);
      } catch (err) {
        log(`[bitable-video] Failed to update card to cancelled: ${err}`);
      }
    }
    return;
  }

  // ─── Confirm ───────────────────────────────────────────────────────────────
  if (action !== "confirm_bitable_video") return;

  const gcsUri = actionValue.gcsUri as string;
  const mimeType = actionValue.mimeType as string || "video/mp4";
  const prompt = actionValue.prompt as string || "请分析这个视频的内容";
  const target = actionValue.target as string;
  const replyToMessageId = actionValue.replyToMessageId as string;
  const senderOpenId = actionValue.senderOpenId as string;

  // Verify sender
  const operatorOpenId = actionData.operator?.open_id || "";
  if (senderOpenId && operatorOpenId !== senderOpenId) {
    log(`[bitable-video] Action from wrong user (expected=${senderOpenId}, got=${operatorOpenId})`);
    return;
  }

  if (!gcsUri) {
    log(`[bitable-video] Missing gcsUri in action value`);
    return;
  }

  log(`[bitable-video] Confirmed, starting analysis of ${gcsUri}`);

  // Update card to "processing" immediately
  if (cardMessageId) {
    try {
      await updateCardFeishu({ cfg, messageId: cardMessageId, card: buildAnalyzingCard() });
      log(`[bitable-video] Card updated to processing`);
    } catch (err) {
      log(`[bitable-video] Failed to update card to processing: ${err}`);
    }
  }

  // Init config for Gemini
  initGcsConfig(cfg);
  const feishuCfg = cfg?.channels?.feishu as Record<string, unknown> | undefined;
  if (feishuCfg?.gcsCredentialsPath) setCredentialsPath(feishuCfg.gcsCredentialsPath as string);

  // Fire-and-forget: analyze in background
  void (async () => {
    try {
      log(`[bitable-video] Starting Gemini analysis: gcsUri=${gcsUri}, mimeType=${mimeType}`);
      const analysis = await analyzeVideoFromGcs(gcsUri, mimeType, {
        prompt,
        log,
      });
      log(`[bitable-video] Analysis complete, sending result card to ${target}`);

      const costStr = analysis.estimatedCostUsd != null
        ? `$${analysis.estimatedCostUsd.toFixed(4)}`
        : "未知";
      const durationStr = `${(analysis.durationMs / 1000).toFixed(1)}s`;
      const tokensStr = analysis.usage
        ? `${analysis.usage.promptTokens} → ${analysis.usage.completionTokens}`
        : "未知";

      // Send result card
      await sendCardFeishu({
        cfg,
        to: target,
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
        replyToMessageId,
      });
      log(`[bitable-video] Result card sent successfully`);

      // Update confirm card to show completion
      if (cardMessageId) {
        try {
          await updateCardFeishu({ cfg, messageId: cardMessageId, card: buildCompletedCard(durationStr, costStr) });
        } catch (err) {
          log(`[bitable-video] Failed to update card to completed: ${err}`);
        }
      }
    } catch (err) {
      log(`[bitable-video] Analysis or card send FAILED: ${String(err)}`);
      if (err instanceof Error) log(`[bitable-video] Stack: ${err.stack}`);
      try {
        await sendCardFeishu({
          cfg,
          to: target,
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
          replyToMessageId,
        });
      } catch { /* ignore */ }
    }
  })();
}
