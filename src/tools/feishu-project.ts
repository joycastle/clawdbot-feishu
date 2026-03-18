/**
 * feishu_project — 飞书项目工具（工作项管理）
 *
 * Actions:
 *   list_types     — 获取工作项类型
 *   list_workitems — 列出工作项（需求、缺陷、任务等）
 *   get_workitem   — 获取工作项详情
 *   create_workitem — 创建工作项
 *   update_workitem — 更新工作项
 *   add_comment    — 添加评论
 */

import { Type, type Static } from "@sinclair/typebox";
import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import type { FeishuConfig } from "../types.js";
import { FeishuProjectClient } from "../features/feishu-project/client.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

const FeishuProjectSchema = Type.Union([
  Type.Object({
    action: Type.Literal("list_types"),
    project_key: Type.Optional(Type.String({ description: "项目 key，默认使用配置中的默认项目" })),
  }),
  Type.Object({
    action: Type.Literal("list_workitems"),
    type_key: Type.String({ description: "工作项类型：story（需求）、issue（缺陷）、task（任务）等" }),
    project_key: Type.Optional(Type.String({ description: "项目 key" })),
    page_size: Type.Optional(Type.Integer({ description: "每页数量，默认 20，最大 200", minimum: 1, maximum: 200 })),
    page_num: Type.Optional(Type.Integer({ description: "页码，从 1 开始", minimum: 1 })),
    created_by: Type.Optional(Type.String({ description: "创建人 user_key" })),
    owner: Type.Optional(Type.String({ description: "负责人 user_key" })),
    status: Type.Optional(Type.String({ description: "状态筛选" })),
  }),
  Type.Object({
    action: Type.Literal("get_workitem"),
    work_item_id: Type.Union([Type.String(), Type.Integer()], { description: "工作项 ID" }),
    type_key: Type.String({ description: "工作项类型" }),
    project_key: Type.Optional(Type.String({ description: "项目 key" })),
  }),
  Type.Object({
    action: Type.Literal("create_workitem"),
    type_key: Type.String({ description: "工作项类型" }),
    name: Type.String({ description: "工作项标题" }),
    project_key: Type.Optional(Type.String({ description: "项目 key" })),
    template_id: Type.Optional(Type.String({ description: "模板 ID" })),
    field_value_pairs: Type.Optional(Type.Array(Type.Object({
      field_key: Type.String(),
      field_value: Type.Unknown(),
    }), { description: "字段值列表" })),
  }),
  Type.Object({
    action: Type.Literal("update_workitem"),
    work_item_id: Type.Union([Type.String(), Type.Integer()], { description: "工作项 ID" }),
    type_key: Type.String({ description: "工作项类型" }),
    project_key: Type.Optional(Type.String({ description: "项目 key" })),
    update_fields: Type.Array(Type.Object({
      field_key: Type.String(),
      field_value: Type.Unknown(),
    }), { description: "要更新的字段列表" }),
  }),
  Type.Object({
    action: Type.Literal("add_comment"),
    work_item_id: Type.Union([Type.String(), Type.Integer()], { description: "工作项 ID" }),
    type_key: Type.String({ description: "工作项类型" }),
    content: Type.String({ description: "评论内容（支持富文本）" }),
    project_key: Type.Optional(Type.String({ description: "项目 key" })),
  }),
]);

type FeishuProjectParams = Static<typeof FeishuProjectSchema>;

// ─── Helper ───────────────────────────────────────────────────────────────────

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// 默认项目 key（BF 项目）
const DEFAULT_PROJECT_KEY = "62b29e862be43458fc1ef6b2";

// ─── Tool Registration ────────────────────────────────────────────────────────

export function registerFeishuProjectTool(api: ClawdbotPluginApi) {
  api.registerTool(
    (ctx) => {
      const feishuCfg = ctx.config?.channels?.feishu as FeishuConfig | undefined;
      
      // 检查飞书项目配置
      const pluginId = feishuCfg?.projectPluginId;
      const pluginSecret = feishuCfg?.projectPluginSecret;
      const userKey = feishuCfg?.projectUserKey;

      if (!pluginId || !pluginSecret || !userKey) {
        // 没有配置飞书项目凭据，不注册此工具
        return null;
      }

      // 创建客户端（复用实例）
      let client: FeishuProjectClient | null = null;
      const getClient = () => {
        if (!client) {
          client = new FeishuProjectClient({ pluginId, pluginSecret, userKey });
        }
        return client;
      };

      return {
        name: "feishu_project",
        label: "Feishu Project",
        description:
          "飞书项目工作项管理（需求、缺陷、任务）。" +
          "Actions: list_types（获取类型）、list_workitems（列出工作项）、get_workitem（获取详情）、" +
          "create_workitem（创建）、update_workitem（更新）、add_comment（添加评论）",
        parameters: FeishuProjectSchema,
        async execute(_id, params: FeishuProjectParams) {
          try {
            const projectClient = getClient();
            const projectKey = (params as any).project_key || DEFAULT_PROJECT_KEY;
            const reqCtx = projectClient.getContext();

            switch (params.action) {
              case "list_types": {
                const types = await projectClient.getWorkItemTypes(projectKey);
                return json({ project_key: projectKey, types });
              }

              case "list_workitems": {
                const searchParams: any = {
                  project_keys: [projectKey],
                  work_item_type_keys: [params.type_key],
                  page_size: params.page_size ?? 20,
                  page_num: params.page_num ?? 1,
                };
                if (params.created_by) searchParams.created_by = [params.created_by];
                if (params.owner) searchParams.owned_by = [params.owner];

                const resp = await projectClient.workitem.searchWorkItems(reqCtx, projectKey, searchParams);
                if (resp.err_code !== 0) {
                  return json({ error: resp.err_msg || `Failed: code ${resp.err_code}` });
                }

                const items = (resp.data?.work_items || []).map((item: any) => ({
                  id: item.id,
                  name: item.name,
                  type_key: item.work_item_type_key,
                  status: item.current_status?.status_name,
                  owner: item.owner_name,
                  created_by: item.created_by_name,
                  created_at: item.created_at,
                  updated_at: item.updated_at,
                }));

                return json({
                  project_key: projectKey,
                  type_key: params.type_key,
                  total: resp.data?.total_count,
                  items,
                });
              }

              case "get_workitem": {
                const resp = await projectClient.workitem.getWorkItem(
                  reqCtx,
                  projectKey,
                  params.type_key,
                  String(params.work_item_id),
                );
                if (resp.err_code !== 0) {
                  return json({ error: resp.err_msg || `Failed: code ${resp.err_code}` });
                }
                return json(resp.data);
              }

              case "create_workitem": {
                const createParams: any = {
                  work_item_type_key: params.type_key,
                  name: params.name,
                };
                if (params.template_id) createParams.template_id = params.template_id;
                if (params.field_value_pairs) createParams.field_value_pairs = params.field_value_pairs;

                const resp = await projectClient.workitem.createWorkItem(reqCtx, projectKey, createParams);
                if (resp.err_code !== 0) {
                  return json({ error: resp.err_msg || `Failed: code ${resp.err_code}` });
                }
                return json({ ok: true, work_item_id: resp.data?.id, data: resp.data });
              }

              case "update_workitem": {
                const resp = await projectClient.workitem.updateWorkItem(
                  reqCtx,
                  projectKey,
                  params.type_key,
                  String(params.work_item_id),
                  { update_fields: params.update_fields },
                );
                if (resp.err_code !== 0) {
                  return json({ error: resp.err_msg || `Failed: code ${resp.err_code}` });
                }
                return json({ ok: true, work_item_id: params.work_item_id });
              }

              case "add_comment": {
                const resp = await projectClient.comment.createComment(
                  reqCtx,
                  projectKey,
                  params.type_key,
                  String(params.work_item_id),
                  { content: params.content },
                );
                if (resp.err_code !== 0) {
                  return json({ error: resp.err_msg || `Failed: code ${resp.err_code}` });
                }
                return json({ ok: true, comment_id: resp.data?.comment_id, data: resp.data });
              }

              default:
                return json({ error: `Unknown action: ${(params as any).action}` });
            }
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : String(err) });
          }
        },
      };
    },
    { name: "feishu_project" },
  );
}
