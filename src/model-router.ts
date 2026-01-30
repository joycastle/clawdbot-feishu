/**
 * Model Router — Intent detection for dynamic model switching.
 *
 * Detects whether a user message is a "dev/tech/code" request
 * and recommends switching to a more capable model (e.g., Claude Opus).
 *
 * Default behavior:
 * - Normal chat → uses default model (e.g., Gemini)
 * - Dev/tech/code request → prompt user to confirm switching to dev model (e.g., Opus)
 */

import type { ModelRouterConfig } from "./types.js";

// ─── Default Keywords ────────────────────────────────────────────────────────

/**
 * Default keywords that indicate a dev/tech/code request.
 * These are checked case-insensitively against the message text.
 */
const DEFAULT_DEV_KEYWORDS: string[] = [
  // Chinese keywords
  "开发", "代码", "编程", "编码", "写代码", "改代码", "看代码",
  "bug", "修复", "修bug", "调试", "debug",
  "功能开发", "新功能", "实现功能", "加功能",
  "接口", "API", "api",
  "数据库", "SQL", "sql", "查询",
  "部署", "deploy", "发布", "上线",
  "重构", "refactor", "优化代码",
  "脚本", "script", "自动化",
  "配置", "config", "环境",
  "git", "提交", "commit", "push", "pull", "merge", "分支", "branch",
  "测试", "test", "单元测试",
  "架构", "设计模式", "技术方案",
  "报错", "错误", "异常", "error", "exception", "crash",
  "日志", "log", "监控",
  "服务器", "server", "nginx", "docker", "k8s",
  "前端", "后端", "frontend", "backend",
  "TypeScript", "typescript", "JavaScript", "javascript",
  "Python", "python", "Java", "java", "C#", "c#",
  "React", "Vue", "Node", "node",
  "npm", "yarn", "pnpm", "pip",
  "算法", "数据结构",
  "正则", "regex",
  "加密", "安全", "认证", "鉴权",
  "webhook", "websocket", "socket",
  "SDK", "sdk", "插件", "plugin", "extension",
  // English keywords
  "implement", "develop", "code", "coding", "programming",
  "function", "method", "class", "module",
  "fix", "patch", "hotfix",
  "build", "compile", "lint",
  "review", "PR", "pull request", "code review",
];

/**
 * Patterns that strongly indicate dev intent (regex).
 * These provide higher confidence detection.
 */
const DEV_PATTERNS: RegExp[] = [
  // Explicit dev requests
  /帮我(写|改|看|修|实现|开发|调试)/,
  /写[一个]*\s*(脚本|代码|函数|接口|功能|模块|组件|页面)/,
  /开发[一个]*\s*(功能|模块|接口|插件|系统|页面|组件)/,
  /实现[一个]*\s*(功能|需求|接口|逻辑|算法)/,
  // Code-related queries
  /怎么(写|实现|调用|配置|部署|解决)/,
  /如何(实现|开发|配置|处理|解析|优化)/,
  // Error/debug patterns
  /(报错|出错|异常|crash|崩溃).*?(怎么|如何|帮)/,
  /看[一下看]*这[个段]*\s*(代码|报错|日志|错误)/,
  // Code blocks in message
  /```[\s\S]*```/,
  // File paths
  /\.(ts|js|py|java|go|rs|cpp|c|h|cs|rb|php|swift|kt)\b/,
  // Tech stack mentions
  /(src|dist|node_modules|package\.json|tsconfig|webpack|vite)\b/,
];

// ─── Intent Detection ────────────────────────────────────────────────────────

export interface ModelRouteResult {
  /** Whether a model switch is recommended */
  shouldSwitch: boolean;
  /** The recommended model to switch to (null if no switch needed) */
  targetModel: string | null;
  /** Confidence level of the detection */
  confidence: "high" | "medium" | "low";
  /** Matched keywords/patterns for logging */
  matchedHints: string[];
}

/**
 * Detect whether a message text indicates a dev/tech/code request.
 */
export function detectDevIntent(
  text: string,
  customKeywords?: string[],
): { isDevRequest: boolean; confidence: "high" | "medium" | "low"; matchedHints: string[] } {
  if (!text || text.trim().length === 0) {
    return { isDevRequest: false, confidence: "low", matchedHints: [] };
  }

  const lowerText = text.toLowerCase();
  const matchedHints: string[] = [];

  // Check regex patterns first (higher confidence)
  for (const pattern of DEV_PATTERNS) {
    if (pattern.test(text)) {
      matchedHints.push(`pattern:${pattern.source.slice(0, 30)}`);
    }
  }

  if (matchedHints.length > 0) {
    return { isDevRequest: true, confidence: "high", matchedHints };
  }

  // Check keywords
  const keywords = customKeywords ?? DEFAULT_DEV_KEYWORDS;
  const matched: string[] = [];

  for (const keyword of keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      matched.push(keyword);
    }
  }

  if (matched.length >= 2) {
    return { isDevRequest: true, confidence: "high", matchedHints: matched };
  }

  if (matched.length === 1) {
    // Single keyword match — medium confidence, might be a casual mention
    return { isDevRequest: true, confidence: "medium", matchedHints: matched };
  }

  return { isDevRequest: false, confidence: "low", matchedHints: [] };
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
      targetModel: null,
      confidence: "low",
      matchedHints: [],
    };
  }

  const { isDevRequest, confidence, matchedHints } = detectDevIntent(
    text,
    config.keywords,
  );

  if (!isDevRequest) {
    return {
      shouldSwitch: false,
      targetModel: null,
      confidence,
      matchedHints,
    };
  }

  return {
    shouldSwitch: true,
    targetModel: config.devModel,
    confidence,
    matchedHints,
  };
}
