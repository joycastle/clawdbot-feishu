/**
 * 智能路由器主入口
 * 
 * 使用方式：
 *   import { classifyMessage } from "./smart-router/index.js";
 *   const decision = classifyMessage({ text, messageType, isGroup, mentionedBot });
 *   // 根据 decision.model 设置 session modelOverride
 *   // 根据 decision.thinkingLevel 设置 thinking 级别
 */

export { classifyMessage } from "./classifier.js";
export {
  RouteLevel,
  MessageType,
  type RouteDecision,
  type RouterConfig,
  DEFAULT_ROUTER_CONFIG,
} from "./types.js";
