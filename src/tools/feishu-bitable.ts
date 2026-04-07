/**
 * feishu_bitable — 飞书多维表格工具
 *
 * Actions:
 *   list_tables    — 列出应用下的所有表
 *   list_fields    — 列出表的字段定义
 *   list_records   — 列出记录（支持过滤和排序）
 *   search_records — 高级搜索记录
 *   get_record     — 获取单条记录
 *   create_record  — 创建记录
 *   update_record  — 更新记录
 *   delete_record  — 删除记录
 */

import { Type, type Static } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { FeishuConfig } from "../types.js";
import { createFeishuClient } from "../client.js";
import { resolveFeishuCredentials } from "../accounts.js";
import * as Lark from "@larksuiteoapi/node-sdk";

// ─── Schema ──────────────────────────────────────────────────────────────────

const FeishuBitableSchema = Type.Union([
  Type.Object({
    action: Type.Literal("list_tables"),
    app_token: Type.String({ description: "多维表格 app token" }),
  }),
  Type.Object({
    action: Type.Literal("list_fields"),
    app_token: Type.String({ description: "多维表格 app token" }),
    table_id: Type.String({ description: "数据表 ID" }),
  }),
  Type.Object({
    action: Type.Literal("list_records"),
    app_token: Type.String({ description: "多维表格 app token" }),
    table_id: Type.String({ description: "数据表 ID" }),
    page_size: Type.Optional(Type.Integer({ description: "每页记录数，默认 20，最大 500", minimum: 1, maximum: 500 })),
    page_token: Type.Optional(Type.String({ description: "分页 token，用于翻页" })),
    view_id: Type.Optional(Type.String({ description: "视图 ID，按视图过滤" })),
    filter: Type.Optional(Type.String({ description: "过滤条件（飞书 filter 表达式字符串）" })),
    sort: Type.Optional(Type.String({ description: "排序条件（JSON 字符串数组）" })),
    field_names: Type.Optional(Type.String({ description: "指定返回的字段名（逗号分隔）" })),
  }),
  Type.Object({
    action: Type.Literal("search_records"),
    app_token: Type.String({ description: "多维表格 app token" }),
    table_id: Type.String({ description: "数据表 ID" }),
    filter: Type.Optional(Type.String({ description: "过滤条件（飞书 filter 表达式字符串）" })),
    sort: Type.Optional(Type.String({ description: "排序条件（JSON 字符串数组）" })),
    page_size: Type.Optional(Type.Integer({ description: "每页记录数，默认 20，最大 500", minimum: 1, maximum: 500 })),
    page_token: Type.Optional(Type.String({ description: "分页 token" })),
  }),
  Type.Object({
    action: Type.Literal("get_record"),
    app_token: Type.String({ description: "多维表格 app token" }),
    table_id: Type.String({ description: "数据表 ID" }),
    record_id: Type.String({ description: "记录 ID" }),
  }),
  Type.Object({
    action: Type.Literal("create_record"),
    app_token: Type.String({ description: "多维表格 app token" }),
    table_id: Type.String({ description: "数据表 ID" }),
    fields: Type.Record(Type.String(), Type.Unknown(), { description: "字段名到值的映射" }),
  }),
  Type.Object({
    action: Type.Literal("update_record"),
    app_token: Type.String({ description: "多维表格 app token" }),
    table_id: Type.String({ description: "数据表 ID" }),
    record_id: Type.String({ description: "记录 ID" }),
    fields: Type.Record(Type.String(), Type.Unknown(), { description: "要更新的字段名到值的映射" }),
  }),
  Type.Object({
    action: Type.Literal("delete_record"),
    app_token: Type.String({ description: "多维表格 app token" }),
    table_id: Type.String({ description: "数据表 ID" }),
    record_id: Type.String({ description: "记录 ID" }),
  }),
]);

type FeishuBitableParams = Static<typeof FeishuBitableSchema>;

// ─── Helper ───────────────────────────────────────────────────────────────────

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function tryParseJson<T>(str: string | undefined): T | undefined {
  if (!str) return undefined;
  try {
    return JSON.parse(str) as T;
  } catch {
    return undefined;
  }
}

// ─── Bitable API Implementations ──────────────────────────────────────────────

async function listTables(client: Lark.Client, appToken: string) {
  const res = await client.bitable.appTable.list({
    path: { app_token: appToken },
    params: { page_size: 100 },
  });
  if (res.code !== 0) throw new Error(`list_tables failed: ${res.msg}`);
  return res.data?.items ?? [];
}

async function listFields(client: Lark.Client, appToken: string, tableId: string) {
  const res = await client.bitable.appTableField.list({
    path: { app_token: appToken, table_id: tableId },
    params: { page_size: 100 },
  });
  if (res.code !== 0) throw new Error(`list_fields failed: ${res.msg}`);
  return res.data?.items ?? [];
}

async function listRecords(
  client: Lark.Client,
  appToken: string,
  tableId: string,
  opts: {
    page_size?: number;
    page_token?: string;
    view_id?: string;
    filter?: string;
    sort?: string;
    field_names?: string;
  },
) {
  const res = await client.bitable.appTableRecord.list({
    path: { app_token: appToken, table_id: tableId },
    params: {
      page_size: opts.page_size ?? 20,
      page_token: opts.page_token,
      view_id: opts.view_id,
      filter: opts.filter,
      sort: opts.sort,
      field_names: opts.field_names,
    },
  });
  if (res.code !== 0) throw new Error(`list_records failed: ${res.msg}`);
  return { items: res.data?.items ?? [], page_token: res.data?.page_token, has_more: res.data?.has_more };
}

async function searchRecords(
  client: Lark.Client,
  appToken: string,
  tableId: string,
  opts: {
    filter?: string;
    sort?: string;
    page_size?: number;
    page_token?: string;
  },
) {
  const body: Record<string, unknown> = { page_size: opts.page_size ?? 20 };
  if (opts.filter) body["filter"] = tryParseJson(opts.filter) ?? opts.filter;
  if (opts.sort) body["sort"] = tryParseJson(opts.sort) ?? [];
  if (opts.page_token) body["page_token"] = opts.page_token;

  const res = await client.bitable.appTableRecord.search({
    path: { app_token: appToken, table_id: tableId },
    data: body as any,
  });
  if (res.code !== 0) throw new Error(`search_records failed: ${res.msg}`);
  return { items: res.data?.items ?? [], page_token: res.data?.page_token, has_more: res.data?.has_more };
}

async function getRecord(client: Lark.Client, appToken: string, tableId: string, recordId: string) {
  const res = await client.bitable.appTableRecord.get({
    path: { app_token: appToken, table_id: tableId, record_id: recordId },
  });
  if (res.code !== 0) throw new Error(`get_record failed: ${res.msg}`);
  return res.data?.record;
}

async function createRecord(
  client: Lark.Client,
  appToken: string,
  tableId: string,
  fields: Record<string, unknown>,
) {
  const res = await client.bitable.appTableRecord.create({
    path: { app_token: appToken, table_id: tableId },
    data: { fields } as any,
  });
  if (res.code !== 0) throw new Error(`create_record failed: ${res.msg}`);
  return res.data?.record;
}

async function updateRecord(
  client: Lark.Client,
  appToken: string,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>,
) {
  const res = await client.bitable.appTableRecord.update({
    path: { app_token: appToken, table_id: tableId, record_id: recordId },
    data: { fields } as any,
  });
  if (res.code !== 0) throw new Error(`update_record failed: ${res.msg}`);
  return res.data?.record;
}

async function deleteRecord(
  client: Lark.Client,
  appToken: string,
  tableId: string,
  recordId: string,
) {
  const res = await client.bitable.appTableRecord.delete({
    path: { app_token: appToken, table_id: tableId, record_id: recordId },
  });
  if (res.code !== 0) throw new Error(`delete_record failed: ${res.msg}`);
  return { deleted: true, record_id: recordId };
}

// ─── Tool Registration ────────────────────────────────────────────────────────

export function registerFeishuBitableTool(api: OpenClawPluginApi) {
  api.registerTool(
    (ctx) => {
      const feishuCfg = ctx.config?.channels?.feishu as FeishuConfig | undefined;
      const creds = resolveFeishuCredentials(feishuCfg);
      if (!creds) return null;

      const client = createFeishuClient(feishuCfg!);

      return {
        name: "joycastle_feishu_bitable",
        label: "Feishu Bitable",
        description:
          "飞书多维表格（Bitable）操作，支持读写记录和字段。" +
          "Actions: list_tables（列出表）、list_fields（列出字段）、list_records（列出记录）、" +
          "search_records（搜索记录）、get_record（获取记录）、create_record（创建记录）、" +
          "update_record（更新记录）、delete_record（删除记录）",
        parameters: FeishuBitableSchema,
        async execute(_id, params: FeishuBitableParams) {
          try {
            switch (params.action) {
              case "list_tables":
                return json(await listTables(client, params.app_token));
              case "list_fields":
                return json(await listFields(client, params.app_token, params.table_id));
              case "list_records":
                return json(await listRecords(client, params.app_token, params.table_id, params));
              case "search_records":
                return json(await searchRecords(client, params.app_token, params.table_id, params));
              case "get_record":
                return json(await getRecord(client, params.app_token, params.table_id, params.record_id));
              case "create_record":
                return json(await createRecord(client, params.app_token, params.table_id, params.fields));
              case "update_record":
                return json(
                  await updateRecord(client, params.app_token, params.table_id, params.record_id, params.fields),
                );
              case "delete_record":
                return json(await deleteRecord(client, params.app_token, params.table_id, params.record_id));
              default:
                return json({ error: `Unknown action: ${(params as any).action}` });
            }
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : String(err) });
          }
        },
      };
    },
    { name: "joycastle_feishu_bitable" },
  );
}
