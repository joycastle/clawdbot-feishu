/**
 * feishu_task — 飞书任务管理工具
 *
 * Actions:
 *   list_tasks       — 列出任务
 *   get_task         — 获取任务详情
 *   create_task      — 创建任务
 *   update_task      — 更新任务
 *   delete_task      — 删除任务
 *   list_tasklists   — 列出任务清单
 *   create_tasklist  — 创建任务清单
 *   create_comment   — 给任务添加评论
 */

import { Type, type Static } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { FeishuConfig } from "../types.js";
import { createFeishuClient } from "../client.js";
import { resolveFeishuCredentials } from "../accounts.js";
import * as Lark from "@larksuiteoapi/node-sdk";

// ─── Schema ──────────────────────────────────────────────────────────────────

const FeishuTaskSchema = Type.Union([
  Type.Object({
    action: Type.Literal("list_tasks"),
    page_size: Type.Optional(Type.Integer({ description: "每页数量，默认 20", minimum: 1, maximum: 100 })),
    page_token: Type.Optional(Type.String({ description: "分页 token" })),
    completed: Type.Optional(Type.Boolean({ description: "是否只返回已完成任务，默认返回全部" })),
    tasklist_guid: Type.Optional(Type.String({ description: "按任务清单过滤" })),
  }),
  Type.Object({
    action: Type.Literal("get_task"),
    task_guid: Type.String({ description: "任务 GUID" }),
  }),
  Type.Object({
    action: Type.Literal("create_task"),
    summary: Type.String({ description: "任务标题" }),
    description: Type.Optional(Type.String({ description: "任务描述（支持 Markdown）" })),
    due_timestamp: Type.Optional(
      Type.String({ description: "截止时间（Unix 毫秒时间戳字符串）" }),
    ),
    tasklist_guid: Type.Optional(Type.String({ description: "所属任务清单 GUID" })),
  }),
  Type.Object({
    action: Type.Literal("update_task"),
    task_guid: Type.String({ description: "任务 GUID" }),
    summary: Type.Optional(Type.String({ description: "新标题" })),
    description: Type.Optional(Type.String({ description: "新描述" })),
    due_timestamp: Type.Optional(Type.String({ description: "新截止时间（Unix 毫秒时间戳字符串）" })),
    completed: Type.Optional(Type.Boolean({ description: "true=完成，false=重新打开" })),
  }),
  Type.Object({
    action: Type.Literal("delete_task"),
    task_guid: Type.String({ description: "任务 GUID" }),
  }),
  Type.Object({
    action: Type.Literal("list_tasklists"),
    page_size: Type.Optional(Type.Integer({ description: "每页数量，默认 20", minimum: 1, maximum: 100 })),
    page_token: Type.Optional(Type.String({ description: "分页 token" })),
  }),
  Type.Object({
    action: Type.Literal("create_tasklist"),
    name: Type.String({ description: "任务清单名称" }),
  }),
  Type.Object({
    action: Type.Literal("create_comment"),
    task_guid: Type.String({ description: "任务 GUID" }),
    content: Type.String({ description: "评论内容" }),
  }),
]);

type FeishuTaskParams = Static<typeof FeishuTaskSchema>;

// ─── Helper ───────────────────────────────────────────────────────────────────

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// ─── Task API Implementations ─────────────────────────────────────────────────

async function listTasks(
  client: Lark.Client,
  opts: { page_size?: number; page_token?: string; completed?: boolean; tasklist_guid?: string },
) {
  if (opts.tasklist_guid) {
    const res = await (client.task as any).v2.tasklist.tasks({
      path: { tasklist_guid: opts.tasklist_guid },
      params: { page_size: opts.page_size ?? 20, page_token: opts.page_token, completed: opts.completed },
    });
    if (res.code !== 0) throw new Error(`list_tasks failed: ${res.msg}`);
    return { items: res.data?.items ?? [], page_token: res.data?.page_token, has_more: res.data?.has_more };
  }

  const res = await (client.task as any).v2.task.list({
    params: { page_size: opts.page_size ?? 20, page_token: opts.page_token, completed: opts.completed },
  });
  if (res.code !== 0) throw new Error(`list_tasks failed: ${res.msg}`);
  return { items: res.data?.items ?? [], page_token: res.data?.page_token, has_more: res.data?.has_more };
}

async function getTask(client: Lark.Client, taskGuid: string) {
  const res = await (client.task as any).v2.task.get({ path: { task_guid: taskGuid } });
  if (res.code !== 0) throw new Error(`get_task failed: ${res.msg}`);
  return res.data?.task;
}

async function createTask(
  client: Lark.Client,
  opts: { summary: string; description?: string; due_timestamp?: string; tasklist_guid?: string },
) {
  const data: Record<string, unknown> = { summary: opts.summary };
  if (opts.description) data["description"] = { content: opts.description };
  if (opts.due_timestamp) data["due"] = { timestamp: opts.due_timestamp };
  if (opts.tasklist_guid) data["tasklists"] = [{ tasklist_guid: opts.tasklist_guid }];

  const res = await (client.task as any).v2.task.create({ data });
  if (res.code !== 0) throw new Error(`create_task failed: ${res.msg}`);
  return res.data?.task;
}

async function updateTask(
  client: Lark.Client,
  taskGuid: string,
  opts: { summary?: string; description?: string; due_timestamp?: string; completed?: boolean },
) {
  const task: Record<string, unknown> = {};
  const updateFields: string[] = [];

  if (opts.summary !== undefined) {
    task["summary"] = opts.summary;
    updateFields.push("summary");
  }
  if (opts.description !== undefined) {
    task["description"] = { content: opts.description };
    updateFields.push("description");
  }
  if (opts.due_timestamp !== undefined) {
    task["due"] = { timestamp: opts.due_timestamp };
    updateFields.push("due");
  }
  if (opts.completed !== undefined) {
    task["completed_at"] = opts.completed ? String(Date.now()) : "0";
    updateFields.push("completed_at");
  }

  const res = await (client.task as any).v2.task.patch({
    path: { task_guid: taskGuid },
    data: { task, update_fields: updateFields },
  });
  if (res.code !== 0) throw new Error(`update_task failed: ${res.msg}`);
  return res.data?.task;
}

async function deleteTask(client: Lark.Client, taskGuid: string) {
  const res = await (client.task as any).v2.task.delete({ path: { task_guid: taskGuid } });
  if (res.code !== 0) throw new Error(`delete_task failed: ${res.msg}`);
  return { deleted: true, task_guid: taskGuid };
}

async function listTasklists(client: Lark.Client, opts: { page_size?: number; page_token?: string }) {
  const res = await (client.task as any).v2.tasklist.list({
    params: { page_size: opts.page_size ?? 20, page_token: opts.page_token },
  });
  if (res.code !== 0) throw new Error(`list_tasklists failed: ${res.msg}`);
  return { items: res.data?.items ?? [], page_token: res.data?.page_token, has_more: res.data?.has_more };
}

async function createTasklist(client: Lark.Client, name: string) {
  const res = await (client.task as any).v2.tasklist.create({ data: { name } });
  if (res.code !== 0) throw new Error(`create_tasklist failed: ${res.msg}`);
  return res.data?.tasklist;
}

async function createComment(client: Lark.Client, taskGuid: string, content: string) {
  const res = await (client.task as any).v2.taskComment.create({
    params: { task_type: "task" },
    data: { content, resource_type: "task", resource_id: taskGuid },
  });
  if (res.code !== 0) throw new Error(`create_comment failed: ${res.msg}`);
  return res.data?.comment;
}

// ─── Tool Registration ────────────────────────────────────────────────────────

export function registerFeishuTaskTool(api: OpenClawPluginApi) {
  api.registerTool(
    (ctx) => {
      const feishuCfg = ctx.config?.channels?.feishu as FeishuConfig | undefined;
      const creds = resolveFeishuCredentials(feishuCfg);
      if (!creds) return null;

      const client = createFeishuClient(feishuCfg!);

      return {
        name: "joycastle_feishu_task",
        label: "Feishu Task",
        description:
          "飞书任务管理（Task v2）。" +
          "Actions: list_tasks（列出任务）、get_task（获取详情）、create_task（创建任务）、" +
          "update_task（更新/完成任务）、delete_task（删除任务）、list_tasklists（列出任务清单）、" +
          "create_tasklist（创建任务清单）、create_comment（添加评论）",
        parameters: FeishuTaskSchema,
        async execute(_id, params: FeishuTaskParams) {
          try {
            switch (params.action) {
              case "list_tasks":
                return json(await listTasks(client, params));
              case "get_task":
                return json(await getTask(client, params.task_guid));
              case "create_task":
                return json(await createTask(client, params));
              case "update_task":
                return json(await updateTask(client, params.task_guid, params));
              case "delete_task":
                return json(await deleteTask(client, params.task_guid));
              case "list_tasklists":
                return json(await listTasklists(client, params));
              case "create_tasklist":
                return json(await createTasklist(client, params.name));
              case "create_comment":
                return json(await createComment(client, params.task_guid, params.content));
              default:
                return json({ error: `Unknown action: ${(params as any).action}` });
            }
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : String(err) });
          }
        },
      };
    },
    { name: "joycastle_feishu_task" },
  );
}
