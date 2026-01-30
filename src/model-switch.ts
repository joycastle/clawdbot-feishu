/**
 * Model Switch — Confirmation card and session model override.
 *
 * When the model router detects a dev/code request, this module:
 * 1. Sends an interactive card to confirm model switching
 * 2. Handles the card action callback
 * 3. Applies the model override to the session store
 * 4. Resumes message processing with the new model
 *
 * Card action callbacks are received via the `card.action.trigger` event
 * through the WebSocket EventDispatcher.
 */

import type { ClawdbotConfig, HistoryEntry, RuntimeEnv } from "clawdbot/plugin-sdk";
import { sendCardFeishu, updateCardFeishu } from "./send.js";
import { getFeishuRuntime } from "./runtime.js";
import type { FeishuMessageEvent } from "./bot.js";
import type { FeishuConfig, ModelRouterConfig } from "./types.js";
import type { ModelRouteResult } from "./model-router.js";
import fs from "fs";
import path from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PendingModelSwitch {
  /** Unique pending ID */
  id: string;
  /** Original Feishu message event */
  event: FeishuMessageEvent;
  /** Config snapshot */
  cfg: ClawdbotConfig;
  /** Target model to switch to */
  targetModel: string;
  /** Current/default model */
  defaultModel: string;
  /** Session key for this message */
  sessionKey: string;
  /** Card message ID (for updating) */
  cardMessageId: string;
  /** Chat ID */
  chatId: string;
  /** Sender open ID */
  senderOpenId: string;
  /** Detection result */
  routeResult: ModelRouteResult;
  /** Timestamp of creation */
  createdAt: number;
  /** Bot open ID */
  botOpenId?: string;
  /** Runtime */
  runtime?: RuntimeEnv;
  /** Chat histories */
  chatHistories?: Map<string, HistoryEntry[]>;
}

// ─── State Management ────────────────────────────────────────────────────────

const pendingSwitches = new Map<string, PendingModelSwitch>();
const PENDING_TTL_MS = 15 * 60 * 1000; // 15 minutes

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of pendingSwitches) {
      if (now - entry.createdAt > PENDING_TTL_MS) {
        pendingSwitches.delete(id);
      }
    }
    if (pendingSwitches.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, 5 * 60 * 1000);
}

function generatePendingId(): string {
  return `ms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Session Model Override ──────────────────────────────────────────────────

/**
 * Apply a model override to the session store.
 * This directly writes to the session store JSON file.
 */
export async function applyModelOverride(params: {
  cfg: ClawdbotConfig;
  sessionKey: string;
  model: string | null;
  log?: (msg: string) => void;
}): Promise<void> {
  const { cfg, sessionKey, model, log } = params;

  try {
    const core = getFeishuRuntime();
    const storePath = core.channel.session.resolveStorePath(
      (cfg as any).session?.store,
      { agentId: "main" },
    );

    if (!storePath) {
      log?.(`model-switch: could not resolve session store path`);
      return;
    }

    // Read current store
    let store: Record<string, any> = {};
    try {
      const raw = fs.readFileSync(storePath, "utf-8");
      store = JSON.parse(raw);
    } catch {
      // File doesn't exist or invalid JSON — start fresh
    }

    const key = sessionKey.toLowerCase();
    if (!store[key]) {
      store[key] = {};
    }

    if (model) {
      store[key].modelOverride = model;
      log?.(`model-switch: set modelOverride="${model}" for session ${key}`);
    } else {
      delete store[key].modelOverride;
      log?.(`model-switch: cleared modelOverride for session ${key}`);
    }

    // Write back with atomic rename
    const dir = path.dirname(storePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${storePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
    fs.renameSync(tmpPath, storePath);
  } catch (err) {
    log?.(`model-switch: failed to apply model override: ${String(err)}`);
  }
}

// ─── Card Builders ───────────────────────────────────────────────────────────

function buildModelSwitchCard(params: {
  targetModel: string;
  defaultModel: string;
  routeResult: ModelRouteResult;
  pendingId: string;
}): Record<string, unknown> {
  const { targetModel, defaultModel, routeResult, pendingId } = params;

  const hintText = routeResult.matchedHints.length > 0
    ? `检测关键词: ${routeResult.matchedHints.slice(0, 5).join(", ")}`
    : "检测到开发/技术类请求";

  // Extract short model names for display
  const targetShort = targetModel.split("/").pop() || targetModel;
  const defaultShort = defaultModel.split("/").pop() || defaultModel;

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "🔄 模型切换确认" },
      template: "blue",
    },
    elements: [
      {
        tag: "markdown",
        content: [
          `${hintText}`,
          "",
          `当前模型: **${defaultShort}**`,
          `建议切换: **${targetShort}**`,
          "",
          `切换后本次对话将使用 ${targetShort} 处理`,
        ].join("\n"),
      },
      { tag: "hr" },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: `✅ 切换到 ${targetShort}` },
            type: "primary",
            value: { action: "confirm_model_switch", pendingId },
          },
          {
            tag: "button",
            text: { tag: "plain_text", content: `⏭️ 保持 ${defaultShort}` },
            type: "default",
            value: { action: "skip_model_switch", pendingId },
          },
        ],
      },
    ],
  };
}

function buildModelSwitchedCard(targetModel: string): Record<string, unknown> {
  const targetShort = targetModel.split("/").pop() || targetModel;
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `🔄 已切换到 ${targetShort}` },
      template: "green",
    },
    elements: [
      {
        tag: "markdown",
        content: `正在使用 **${targetShort}** 处理你的请求...`,
      },
    ],
  };
}

function buildModelSkippedCard(defaultModel: string): Record<string, unknown> {
  const defaultShort = defaultModel.split("/").pop() || defaultModel;
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `⏭️ 继续使用 ${defaultShort}` },
      template: "grey",
    },
    elements: [
      {
        tag: "markdown",
        content: `继续使用 **${defaultShort}** 处理你的请求`,
      },
    ],
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Send a model switch confirmation card.
 */
export async function sendModelSwitchCard(params: {
  cfg: ClawdbotConfig;
  event: FeishuMessageEvent;
  targetModel: string;
  defaultModel: string;
  sessionKey: string;
  routeResult: ModelRouteResult;
  botOpenId?: string;
  runtime?: RuntimeEnv;
  chatHistories?: Map<string, HistoryEntry[]>;
  log?: (msg: string) => void;
}): Promise<PendingModelSwitch> {
  const {
    cfg, event, targetModel, defaultModel, sessionKey,
    routeResult, botOpenId, runtime, chatHistories, log,
  } = params;

  const pendingId = generatePendingId();
  const chatId = event.message.chat_id;
  const senderOpenId = event.sender.sender_id.open_id || "";

  const card = buildModelSwitchCard({
    targetModel,
    defaultModel,
    routeResult,
    pendingId,
  });

  const target = event.message.chat_type === "p2p"
    ? `user:${senderOpenId}`
    : `chat:${chatId}`;

  log?.(`model-switch: sending confirmation card (target=${targetModel}, pendingId=${pendingId})`);

  const result = await sendCardFeishu({
    cfg,
    to: target,
    card,
    replyToMessageId: event.message.message_id,
  });

  const entry: PendingModelSwitch = {
    id: pendingId,
    event,
    cfg,
    targetModel,
    defaultModel,
    sessionKey,
    cardMessageId: result.messageId,
    chatId,
    senderOpenId,
    routeResult,
    createdAt: Date.now(),
    botOpenId,
    runtime,
    chatHistories,
  };

  pendingSwitches.set(pendingId, entry);
  ensureCleanupTimer();

  return entry;
}

/**
 * Handle a card action event for model switching.
 * Returns the pending entry with applied model info, or null if not applicable.
 */
export async function handleModelSwitchCardAction(params: {
  actionData: { operator?: { open_id?: string }; action?: { value?: Record<string, unknown> }; context?: { open_message_id?: string } };
  log?: (msg: string) => void;
}): Promise<{ entry: PendingModelSwitch; switched: boolean } | null> {
  const { actionData, log } = params;

  const actionValue = actionData.action?.value as Record<string, unknown> | undefined;
  if (!actionValue) return null;

  const action = actionValue.action as string | undefined;
  const pendingId = actionValue.pendingId as string | undefined;

  if (!pendingId || typeof pendingId !== "string") return null;
  if (action !== "confirm_model_switch" && action !== "skip_model_switch") return null;

  const entry = pendingSwitches.get(pendingId);
  if (!entry) {
    log?.(`model-switch: pending not found (pendingId=${pendingId}, may have expired)`);
    return null;
  }

  const operatorOpenId = actionData.operator?.open_id || "";
  if (entry.senderOpenId && operatorOpenId !== entry.senderOpenId) {
    log?.(`model-switch: action from wrong user (expected=${entry.senderOpenId}, got=${operatorOpenId})`);
    return null;
  }

  pendingSwitches.delete(pendingId);

  if (action === "skip_model_switch") {
    log?.(`model-switch: user chose to keep default model (pendingId=${pendingId})`);
    try {
      await updateCardFeishu({
        cfg: entry.cfg,
        messageId: entry.cardMessageId,
        card: buildModelSkippedCard(entry.defaultModel),
      });
    } catch (err) {
      log?.(`model-switch: failed to update skipped card: ${String(err)}`);
    }
    // Still dispatch the message, but with default model
    return { entry, switched: false };
  }

  // action === "confirm_model_switch"
  log?.(`model-switch: user confirmed switch to ${entry.targetModel} (pendingId=${pendingId})`);

  // Apply model override to session
  await applyModelOverride({
    cfg: entry.cfg,
    sessionKey: entry.sessionKey,
    model: entry.targetModel,
    log,
  });

  // Update card to show switched state
  try {
    await updateCardFeishu({
      cfg: entry.cfg,
      messageId: entry.cardMessageId,
      card: buildModelSwitchedCard(entry.targetModel),
    });
  } catch (err) {
    log?.(`model-switch: failed to update switched card: ${String(err)}`);
  }

  return { entry, switched: true };
}

/**
 * Check if a card action value belongs to the model switch system.
 */
export function isModelSwitchAction(actionValue: Record<string, unknown> | undefined): boolean {
  if (!actionValue) return false;
  const action = actionValue.action;
  return action === "confirm_model_switch" || action === "skip_model_switch";
}

/**
 * Resolve the model router config from feishu config, with defaults.
 */
export function resolveModelRouterConfig(feishuCfg: FeishuConfig | undefined): ModelRouterConfig {
  const raw = feishuCfg?.modelRouter;
  if (!raw || !raw.enabled) {
    return {
      enabled: false,
      defaultModel: "",
      devModel: "",
    };
  }

  return {
    enabled: true,
    defaultModel: raw.defaultModel || "",
    devModel: raw.devModel || "",
    keywords: raw.keywords,
    autoConfirm: raw.autoConfirm ?? false,
  };
}
