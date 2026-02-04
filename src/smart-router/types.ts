/**
 * 智能路由类型定义
 */

/** 路由层级 */
export enum RouteLevel {
  /** 简单问候/闲聊/短回复 → 轻量快速模型 */
  L0_SIMPLE = "L0",
  /** 常规问答/代码/分析 → 默认模型 */
  L1_STANDARD = "L1",
  /** 深度推理/复杂任务 → 重模型 + thinking */
  L2_COMPLEX = "L2",
}

/** 消息类型 */
export enum MessageType {
  TEXT = "text",
  IMAGE = "image",
  VIDEO = "video",
  FILE = "file",
  AUDIO = "audio",
  STICKER = "sticker",
  /** 富文本（飞书 post 类型） */
  RICH_TEXT = "rich_text",
}

/** 路由决策 */
export interface RouteDecision {
  /** 路由层级 */
  level: RouteLevel;
  /** 推荐模型（provider/model 格式） */
  model?: string;
  /** thinking 级别（L2 时设置） */
  thinkingLevel?: "low" | "medium" | "high";
  /** 分类原因（用于日志） */
  reason: string;
  /** 消息类型 */
  messageType: MessageType;
  /** 分类耗时（ms） */
  classifyDurationMs?: number;
}

/** 路由器配置 */
export interface RouterConfig {
  /** 是否启用智能路由 */
  enabled: boolean;
  /** L0 模型 */
  l0Model: string;
  /** L1 模型（默认模型，通常不需要设置 override） */
  l1Model?: string;
  /** L2 模型 */
  l2Model?: string;
  /** L0 判定：消息最大长度（字符数） */
  l0MaxLength: number;
  /** L2 判定：消息最小长度（字符数） */
  l2MinLength: number;
  /** L0 排除关键词（包含这些词时不走 L0） */
  l0ExcludeKeywords: string[];
  /** L2 触发关键词（包含这些词时走 L2） */
  l2TriggerKeywords: string[];
  /** 是否记录路由日志 */
  logDecisions: boolean;
}

/** 默认配置 */
export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  enabled: false,
  l0Model: "google-vertex/gemini-3-flash-preview",
  l2Model: undefined, // 使用默认模型 + thinking
  l0MaxLength: 50,
  l2MinLength: 500,
  l0ExcludeKeywords: [
    "分析", "解释", "为什么", "怎么", "如何", "帮我", "写一个",
    "代码", "bug", "error", "debug", "review",
    "设计", "方案", "架构", "优化",
  ],
  l2TriggerKeywords: [
    "深入分析", "详细解释", "完整方案", "系统设计",
    "重构", "架构设计", "性能优化", "全面评估",
  ],
  logDecisions: true,
};
