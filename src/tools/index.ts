/**
 * 飞书原生工具注册入口
 *
 * 将所有飞书工具注册到 clawdbot SDK，让 AI agent 可以直接调用，
 * 而无需通过 HTTP 服务或 CLI 脚本。
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerFeishuDocTool } from "./feishu-doc.js";
import { registerFeishuWikiTool } from "./feishu-wiki.js";
import { registerFeishuBitableTool } from "./feishu-bitable.js";
import { registerFeishuSheetsTool } from "./feishu-sheets.js";
import { registerFeishuTaskTool } from "./feishu-task.js";
import { registerFeishuMessageTool } from "./feishu-message.js";
import { registerFeishuHistoryTool } from "./feishu-history.js";
import { registerFeishuContactTool } from "./feishu-contact.js";
import { registerFeishuProjectTool } from "./feishu-project.js";
import { registerMemoryWriteTool } from "./memory-write.js";
import { registerMemoryReadTool } from "./memory-read.js";
import { registerMemoryGraphTool } from "./memory-graph.js";

export function registerAllFeishuTools(api: OpenClawPluginApi) {
  // Feishu tools
  registerFeishuDocTool(api);
  registerFeishuWikiTool(api);
  registerFeishuBitableTool(api);
  registerFeishuSheetsTool(api);
  registerFeishuTaskTool(api);
  registerFeishuMessageTool(api);
  registerFeishuHistoryTool(api);
  registerFeishuContactTool(api);
  registerFeishuProjectTool(api);
  // Memory tools
  registerMemoryWriteTool(api);
  registerMemoryReadTool(api);
  registerMemoryGraphTool(api);
}
