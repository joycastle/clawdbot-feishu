/**
 * Model Router — Explicit model switch detection.
 *
 * Only switches to dev model (Claude Opus) when the user explicitly requests it.
 * Default behavior: all messages use the default model (Gemini).
 *
 * Triggers on explicit requests like:
 * - "切换到claude" / "用claude" / "换opus"
 * - "开发模式" / "开发"（单独发送时）
 * - "switch to claude" / "use opus"
 */

import type { ModelRouterConfig } from "./types.js";

// ─── Explicit Switch Patterns ────────────────────────────────────────────────

/**
 * Patterns that explicitly request switching to the dev model.
 * Only these will trigger a model switch — no general keyword detection.
 */
const SWITCH_TO_DEV_PATTERNS: RegExp[] = [
  // Chinese - explicit switch requests
  /^开发$/,                           // Just "开发" alone
  /^开发模式$/,                        // "开发模式"
  /切换(到|成)?.*?(claude|opus|开发)/i,  // "切换到claude" / "切换opus" / "切换到开发"
  /换(到|成)?.*?(claude|opus|开发模式)/i, // "换到claude" / "换成opus"
  /用.*?(claude|opus)/i,               // "用claude" / "用opus"
  /改(成|用|为).*?(claude|opus)/i,      // "改成claude" / "改用opus"
  /模型.*?(切换|换|改|用).*?(claude|opus)/i, // "模型切换到claude"

  // English - explicit switch requests
  /switch\s+(to\s+)?(claude|opus)/i,
  /use\s+(claude|opus)/i,
  /change\s+(to\s+)?(claude|opus)/i,
];

/**
 * Patterns that explicitly request switching back to default model.
 * These will clear the model override.
 */
const SWITCH_TO_DEFAULT_PATTERNS: RegExp[] = [
  /^聊天$/,                             // Just "聊天" alone
  /^聊天模式$/,                          // "聊天模式"
  /切换(到|成)?.*?(gemini|默认|聊天)/i,   // "切换到gemini" / "切换默认" / "切换聊天"
  /换(到|成)?.*?(gemini|默认|聊天模式)/i,  // "换到gemini" / "换成默认"
  /用.*?gemini/i,                        // "用gemini"
  /退出.*?(开发|claude|opus)/i,           // "退出开发" / "退出claude"
  /关闭.*?(开发|claude|opus)/i,           // "关闭开发模式"

  // English
  /switch\s+(to\s+)?(gemini|default|chat)/i,
  /use\s+(gemini|default)/i,
  /exit\s+(dev|claude|opus)/i,
];

// ─── Intent Detection ────────────────────────────────────────────────────────

export interface ModelRouteResult {
  /** Whether a model switch is recommended */
  shouldSwitch: boolean;
  /** Whether to switch back to default */
  shouldSwitchToDefault: boolean;
  /** The recommended model to switch to (null if no switch needed) */
  targetModel: string | null;
  /** Confidence level of the detection */
  confidence: "high" | "medium" | "low";
  /** Matched keywords/patterns for logging */
  matchedHints: string[];
}

/**
 * Detect whether a message explicitly requests a model switch.
 * Only triggers on clear, intentional switch requests — not general dev keywords.
 */
export function detectDevIntent(
  text: string,
  _customKeywords?: string[],
): { isDevRequest: boolean; isDefaultRequest: boolean; confidence: "high" | "medium" | "low"; matchedHints: string[] } {
  if (!text || text.trim().length === 0) {
    return { isDevRequest: false, isDefaultRequest: false, confidence: "low", matchedHints: [] };
  }

  const trimmed = text.trim();

  // Check switch-to-default patterns first
  for (const pattern of SWITCH_TO_DEFAULT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isDevRequest: false,
        isDefaultRequest: true,
        confidence: "high",
        matchedHints: [`default:${pattern.source.slice(0, 30)}`],
      };
    }
  }

  // Check switch-to-dev patterns
  for (const pattern of SWITCH_TO_DEV_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isDevRequest: true,
        isDefaultRequest: false,
        confidence: "high",
        matchedHints: [`switch:${pattern.source.slice(0, 30)}`],
      };
    }
  }

  return { isDevRequest: false, isDefaultRequest: false, confidence: "low", matchedHints: [] };
}

/**
 * Determine the model to use for a given message.
 */
export function resolveModelForMessage(
  text: string,
  config: ModelRouterConfig,
): ModelRouteResult {
  if (!config.enabled) {
    return {
      shouldSwitch: false,
      shouldSwitchToDefault: false,
      targetModel: null,
      confidence: "low",
      matchedHints: [],
    };
  }

  const { isDevRequest, isDefaultRequest, confidence, matchedHints } = detectDevIntent(
    text,
    config.keywords,
  );

  if (isDefaultRequest) {
    return {
      shouldSwitch: false,
      shouldSwitchToDefault: true,
      targetModel: config.defaultModel,
      confidence,
      matchedHints,
    };
  }

  if (isDevRequest) {
    return {
      shouldSwitch: true,
      shouldSwitchToDefault: false,
      targetModel: config.devModel,
      confidence,
      matchedHints,
    };
  }

  return {
    shouldSwitch: false,
    shouldSwitchToDefault: false,
    targetModel: null,
    confidence,
    matchedHints,
  };
}
