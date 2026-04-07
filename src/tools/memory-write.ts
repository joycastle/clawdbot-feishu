/**
 * memory_write — 结构化记忆写入工具
 *
 * Type:
 *   session-daily — 当前 session 的今日记忆（具体发生的事）
 *   session-core  — 当前 session 的长期记忆（规则、偏好）
 *   daily         — 跨 session 的今日摘要（通用价值内容）
 *   core          — 全局核心记忆（关键知识、永久规则）
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// ─── Schema ──────────────────────────────────────────────────────────────────

const MemoryWriteSchema = Type.Object({
  type: Type.Union([
    Type.Literal("session-daily"),
    Type.Literal("session-core"),
    Type.Literal("daily"),
    Type.Literal("core"),
  ], {
    description: "记忆类型：session-daily（session今日）、session-core（session长期）、daily（通用今日）、core（核心）",
  }),
  content: Type.String({
    description: "要写入的内容（Markdown 格式）",
  }),
  append: Type.Optional(Type.Boolean({
    description: "是否追加（默认 true），false 则覆盖",
  })),
  session: Type.Optional(Type.String({
    description: "Session ID（如 dm-3fd30e7），仅 session-* 类型需要。不传则从 workspace 环境变量推断",
  })),
});

type MemoryWriteParams = Static<typeof MemoryWriteSchema>;

// ─── Helper ───────────────────────────────────────────────────────────────────

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function getTodayDate(): string {
  return new Date().toISOString().split("T")[0]; // YYYY-MM-DD
}

function parseSessionIdFromKey(sessionKey: string): string {
  // Extract session id from key like "agent:main:feishu:dm:ou_xxx" or "agent:main:feishu:group:oc_xxx"
  const parts = sessionKey.split(":");
  if (parts.length >= 5) {
    const type = parts[3]; // dm or group
    const id = parts[4];
    // Shorten: dm-xxx (last 7 chars) or group-xxx (last 6 chars)
    if (type === "dm" && id.length > 7) {
      return `dm-${id.slice(-7)}`;
    } else if (type === "group" && id.length > 6) {
      return `group-${id.slice(-6)}`;
    }
    return `${type}-${id}`;
  }
  return sessionKey.slice(-10);
}

function resolveSessionId(paramSession: string | undefined): string {
  // 1. Use explicit param if provided
  if (paramSession && paramSession !== "current") {
    return paramSession;
  }

  // 2. Try CLAWDBOT_SESSION_KEY env var (set by gateway during tool execution)
  const envSessionKey = process.env.CLAWDBOT_SESSION_KEY;
  if (envSessionKey) {
    return parseSessionIdFromKey(envSessionKey);
  }

  // 3. Fallback: use "main" as default session
  return "main";
}

function resolveMemoryPath(type: string, sessionId: string, workspaceRoot: string): string {
  const today = getTodayDate();
  const memoryDir = path.join(workspaceRoot, "memory");

  switch (type) {
    case "session-daily":
      return path.join(memoryDir, "sessions", sessionId, `${today}.md`);
    case "session-core":
      return path.join(memoryDir, "sessions", sessionId, "MEMORY.md");
    case "daily":
      return path.join(memoryDir, `${today}.md`);
    case "core":
      return path.join(workspaceRoot, "MEMORY.md");
    default:
      throw new Error(`Unknown memory type: ${type}`);
  }
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Tool Registration ────────────────────────────────────────────────────────

export function registerMemoryWriteTool(api: OpenClawPluginApi) {
  api.registerTool(
    (ctx) => {
      // Get workspace root from config or default
      const workspaceRoot = process.env.CLAWDBOT_WORKSPACE || process.cwd();

      return {
        name: "joycastle_memory_write",
        label: "Memory Write",
        description:
          "结构化写入记忆。根据内容价值判断是否需要记录：\n" +
          "- 闲聊：可能不记\n" +
          "- 做事/任务：要记\n" +
          "- 长期事项：必须记\n\n" +
          "Type 说明：\n" +
          "- session-daily: 当前 session 今日发生的具体事情\n" +
          "- session-core: 当前 session 的长期规则/偏好\n" +
          "- daily: 跨 session 的今日摘要（有通用价值的内容）\n" +
          "- core: 核心记忆（关键知识、永久规则，很少改）",
        parameters: MemoryWriteSchema,
        async execute(_id, params: MemoryWriteParams) {
          try {
            const sessionId = resolveSessionId(params.session);
            const filePath = resolveMemoryPath(params.type, sessionId, workspaceRoot);
            const append = params.append !== false;

            ensureDir(filePath);

            let existingContent = "";
            if (append && fs.existsSync(filePath)) {
              existingContent = fs.readFileSync(filePath, "utf-8");
            }

            // Add timestamp for daily entries
            let contentToWrite = params.content;
            if (params.type === "session-daily" || params.type === "daily") {
              const time = new Date().toISOString().split("T")[1].slice(0, 5); // HH:MM
              if (!contentToWrite.startsWith("##") && !contentToWrite.startsWith("- ")) {
                contentToWrite = `- [${time}] ${contentToWrite}`;
              }
            }

            const finalContent = append
              ? existingContent + (existingContent.endsWith("\n") ? "" : "\n") + contentToWrite + "\n"
              : contentToWrite + "\n";

            fs.writeFileSync(filePath, finalContent, "utf-8");

            return json({
              ok: true,
              type: params.type,
              session_id: sessionId,
              file: filePath.replace(workspaceRoot, "~"),
              append,
              content_length: contentToWrite.length,
            });
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : String(err) });
          }
        },
      };
    },
    { name: "joycastle_memory_write" },
  );
}
