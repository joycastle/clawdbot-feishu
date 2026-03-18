/**
 * 飞书原生工具注册入口
 *
 * 将所有飞书工具注册到 clawdbot SDK，让 AI agent 可以直接调用，
 * 而无需通过 HTTP 服务或 CLI 脚本。
 */

import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { registerFeishuDocTool } from "./feishu-doc.js";
import { registerFeishuWikiTool } from "./feishu-wiki.js";
import { registerFeishuBitableTool } from "./feishu-bitable.js";
import { registerFeishuSheetsTool } from "./feishu-sheets.js";
import { registerFeishuTaskTool } from "./feishu-task.js";

export function registerAllFeishuTools(api: ClawdbotPluginApi) {
  registerFeishuDocTool(api);
  registerFeishuWikiTool(api);
  registerFeishuBitableTool(api);
  registerFeishuSheetsTool(api);
  registerFeishuTaskTool(api);
}
