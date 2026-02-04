/**
 * 消息分类器
 * 
 * Phase 1: 基于规则引擎的分类
 * Phase 3: 可扩展 LLM 分类器
 */

import {
  RouteLevel,
  MessageType,
  type RouteDecision,
  type RouterConfig,
  DEFAULT_ROUTER_CONFIG,
} from "./types.js";

/**
 * 对消息进行分类，返回路由决策
 */
export function classifyMessage(params: {
  /** 消息文本内容 */
  text: string;
  /** 消息类型 */
  messageType: MessageType;
  /** 是否在群聊中 */
  isGroup: boolean;
  /** 是否 @ 了机器人 */
  mentionedBot: boolean;
  /** 路由配置 */
  config?: Partial<RouterConfig>;
}): RouteDecision {
  const start = Date.now();
  const cfg = { ...DEFAULT_ROUTER_CONFIG, ...params.config };
  const { text, messageType, isGroup } = params;

  // 非文本消息：按类型决定
  if (messageType === MessageType.VIDEO) {
    return {
      level: RouteLevel.L1_STANDARD,
      messageType,
      reason: "video message → L1 (existing Gemini pipeline)",
      classifyDurationMs: Date.now() - start,
    };
  }

  if (messageType === MessageType.IMAGE) {
    return {
      level: RouteLevel.L1_STANDARD,
      messageType,
      reason: "image message → L1 (needs vision model)",
      classifyDurationMs: Date.now() - start,
    };
  }

  if (messageType === MessageType.AUDIO) {
    return {
      level: RouteLevel.L1_STANDARD,
      messageType,
      reason: "audio message → L1 (needs transcription + response)",
      classifyDurationMs: Date.now() - start,
    };
  }

  if (messageType === MessageType.FILE) {
    return {
      level: RouteLevel.L1_STANDARD,
      messageType,
      reason: "file message → L1 (needs file analysis)",
      classifyDurationMs: Date.now() - start,
    };
  }

  // 文本消息：规则引擎分类
  const trimmed = text.trim();
  const length = trimmed.length;

  // L2 检测：长文本 + 触发关键词
  if (length >= cfg.l2MinLength) {
    return {
      level: RouteLevel.L2_COMPLEX,
      thinkingLevel: "medium",
      messageType,
      reason: `long text (${length} chars, threshold ${cfg.l2MinLength})`,
      classifyDurationMs: Date.now() - start,
    };
  }

  const hasL2Keyword = cfg.l2TriggerKeywords.some((kw) => trimmed.includes(kw));
  if (hasL2Keyword) {
    return {
      level: RouteLevel.L2_COMPLEX,
      thinkingLevel: "medium",
      messageType,
      reason: `L2 trigger keyword detected`,
      classifyDurationMs: Date.now() - start,
    };
  }

  // L0 检测：短文本 + 无复杂关键词
  if (length <= cfg.l0MaxLength) {
    const hasExcludeKeyword = cfg.l0ExcludeKeywords.some((kw) => trimmed.includes(kw));
    if (!hasExcludeKeyword) {
      return {
        level: RouteLevel.L0_SIMPLE,
        model: cfg.l0Model,
        messageType,
        reason: `short text (${length} chars, threshold ${cfg.l0MaxLength}), no complex keywords`,
        classifyDurationMs: Date.now() - start,
      };
    }
  }

  // 默认 L1
  return {
    level: RouteLevel.L1_STANDARD,
    messageType,
    reason: `default → L1 (length=${length})`,
    classifyDurationMs: Date.now() - start,
  };
}
