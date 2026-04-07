/**
 * memory_read — 结构化记忆读取工具
 *
 * 支持按 type、session、时间范围读取记忆
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// ─── Schema ──────────────────────────────────────────────────────────────────

const MemoryReadSchema = Type.Object({
  type: Type.Union([
    Type.Literal("session-daily"),
    Type.Literal("session-core"),
    Type.Literal("daily"),
    Type.Literal("core"),
    Type.Literal("all"),
  ], {
    description: "记忆类型，或 'all' 读取所有类型",
  }),
  session: Type.Optional(Type.String({
    description: "Session ID，默认 'current'（当前 session）。也可指定具体 ID 如 'dm-3fd30e7'",
  })),
  days: Type.Optional(Type.Integer({
    description: "最近几天的记忆，默认 1（今天），最大 30",
    minimum: 1,
    maximum: 30,
  })),
  query: Type.Optional(Type.String({
    description: "搜索关键词（简单文本匹配）",
  })),
});

type MemoryReadParams = Static<typeof MemoryReadSchema>;

// ─── Helper ───────────────────────────────────────────────────────────────────

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function parseSessionIdFromKey(sessionKey: string): string {
  const parts = sessionKey.split(":");
  if (parts.length >= 5) {
    const type = parts[3];
    const id = parts[4];
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
  if (paramSession && paramSession !== "current") {
    return paramSession;
  }
  const envSessionKey = process.env.CLAWDBOT_SESSION_KEY;
  if (envSessionKey) {
    return parseSessionIdFromKey(envSessionKey);
  }
  return "main";
}

function getRecentDates(days: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

function readFileIfExists(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }
  } catch {
    // Ignore errors
  }
  return null;
}

function filterByQuery(content: string, query: string): string {
  if (!query) return content;
  const lines = content.split("\n");
  const matched = lines.filter((line) =>
    line.toLowerCase().includes(query.toLowerCase())
  );
  return matched.join("\n");
}

// ─── Tool Registration ────────────────────────────────────────────────────────

export function registerMemoryReadTool(api: OpenClawPluginApi) {
  api.registerTool(
    (ctx) => {
      const workspaceRoot = process.env.CLAWDBOT_WORKSPACE || process.cwd();

      return {
        name: "joycastle_memory_read",
        label: "Memory Read",
        description:
          "读取记忆。支持按类型、session、时间范围读取。\n\n" +
          "Type 说明：\n" +
          "- session-daily: 当前 session 的每日记忆\n" +
          "- session-core: 当前 session 的长期记忆\n" +
          "- daily: 跨 session 的每日摘要\n" +
          "- core: 核心记忆（MEMORY.md）\n" +
          "- all: 读取所有类型",
        parameters: MemoryReadSchema,
        async execute(_id, params: MemoryReadParams) {
          try {
            const sessionId = resolveSessionId(params.session);
            const days = params.days ?? 1;
            const dates = getRecentDates(days);
            const memoryDir = path.join(workspaceRoot, "memory");

            const results: Record<string, string | null> = {};

            const typesToRead = params.type === "all"
              ? ["session-daily", "session-core", "daily", "core"]
              : [params.type];

            for (const type of typesToRead) {
              switch (type) {
                case "session-daily": {
                  for (const date of dates) {
                    const filePath = path.join(memoryDir, "sessions", sessionId, `${date}.md`);
                    const content = readFileIfExists(filePath);
                    if (content) {
                      const key = `session-daily:${date}`;
                      results[key] = params.query ? filterByQuery(content, params.query) : content;
                    }
                  }
                  break;
                }
                case "session-core": {
                  const filePath = path.join(memoryDir, "sessions", sessionId, "MEMORY.md");
                  const content = readFileIfExists(filePath);
                  if (content) {
                    results["session-core"] = params.query ? filterByQuery(content, params.query) : content;
                  }
                  break;
                }
                case "daily": {
                  for (const date of dates) {
                    const filePath = path.join(memoryDir, `${date}.md`);
                    const content = readFileIfExists(filePath);
                    if (content) {
                      const key = `daily:${date}`;
                      results[key] = params.query ? filterByQuery(content, params.query) : content;
                    }
                  }
                  break;
                }
                case "core": {
                  const filePath = path.join(workspaceRoot, "MEMORY.md");
                  const content = readFileIfExists(filePath);
                  if (content) {
                    results["core"] = params.query ? filterByQuery(content, params.query) : content;
                  }
                  break;
                }
              }
            }

            // Clean up empty results
            for (const key of Object.keys(results)) {
              if (!results[key] || results[key]!.trim() === "") {
                delete results[key];
              }
            }

            return json({
              session_id: sessionId,
              days,
              query: params.query || null,
              found: Object.keys(results).length,
              memories: results,
            });
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : String(err) });
          }
        },
      };
    },
    { name: "joycastle_memory_read" },
  );
}
