/**
 * feishu_contact — 飞书通讯录工具
 *
 * Actions:
 *   get_user         — 获取用户信息
 *   get_chat         — 获取群信息
 *   list_chat_members — 获取群成员列表
 *   search_user      — 搜索用户
 */

import { Type, type Static } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { FeishuConfig } from "../types.js";
import { createFeishuClient } from "../client.js";
import { resolveFeishuCredentials } from "../accounts.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

const FeishuContactSchema = Type.Union([
  Type.Object({
    action: Type.Literal("get_user"),
    user_id: Type.String({ description: "用户 ID（open_id 或 user_id）" }),
    id_type: Type.Optional(Type.String({ description: "ID 类型：open_id（默认）、user_id、union_id" })),
  }),
  Type.Object({
    action: Type.Literal("get_chat"),
    chat_id: Type.String({ description: "群 ID" }),
  }),
  Type.Object({
    action: Type.Literal("list_chat_members"),
    chat_id: Type.String({ description: "群 ID" }),
    page_size: Type.Optional(Type.Integer({ description: "每页数量，默认 100，最大 100", minimum: 1, maximum: 100 })),
    page_token: Type.Optional(Type.String({ description: "分页 token" })),
  }),
]);

type FeishuContactParams = Static<typeof FeishuContactSchema>;

// ─── Helper ───────────────────────────────────────────────────────────────────

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// ─── Tool Registration ────────────────────────────────────────────────────────

export function registerFeishuContactTool(api: OpenClawPluginApi) {
  api.registerTool(
    (ctx) => {
      const feishuCfg = ctx.config?.channels?.feishu as FeishuConfig | undefined;
      const creds = resolveFeishuCredentials(feishuCfg);
      if (!creds) return null;

      const client = createFeishuClient(feishuCfg!);

      return {
        name: "joycastle_feishu_contact",
        label: "Feishu Contact",
        description:
          "获取飞书用户和群信息。" +
          "Actions: get_user（获取用户信息）、get_chat（获取群信息）、list_chat_members（获取群成员）",
        parameters: FeishuContactSchema,
        async execute(_id, params: FeishuContactParams) {
          try {
            switch (params.action) {
              case "get_user": {
                const idType = params.id_type || "open_id";
                const resp = (await client.contact.user.get({
                  path: { user_id: params.user_id },
                  params: { user_id_type: idType as any },
                })) as any;

                if (resp.code !== 0) {
                  return json({ error: resp.msg || `Failed to get user: code ${resp.code}` });
                }

                const user = resp.data?.user;
                return json({
                  open_id: user?.open_id,
                  user_id: user?.user_id,
                  union_id: user?.union_id,
                  name: user?.name,
                  en_name: user?.en_name,
                  nickname: user?.nickname,
                  email: user?.email,
                  mobile: user?.mobile,
                  avatar: user?.avatar?.avatar_origin,
                  department_ids: user?.department_ids,
                  status: user?.status,
                });
              }

              case "get_chat": {
                const resp = (await client.im.chat.get({
                  path: { chat_id: params.chat_id },
                })) as any;

                if (resp.code !== 0) {
                  return json({ error: resp.msg || `Failed to get chat: code ${resp.code}` });
                }

                const chat = resp.data;
                return json({
                  chat_id: chat?.chat_id,
                  name: chat?.name,
                  description: chat?.description,
                  avatar: chat?.avatar,
                  owner_id: chat?.owner_id,
                  owner_id_type: chat?.owner_id_type,
                  chat_mode: chat?.chat_mode,
                  chat_type: chat?.chat_type,
                  user_count: chat?.user_count,
                  bot_count: chat?.bot_count,
                });
              }

              case "list_chat_members": {
                const resp = (await client.im.chatMembers.get({
                  path: { chat_id: params.chat_id },
                  params: {
                    page_size: params.page_size ?? 100,
                    ...(params.page_token ? { page_token: params.page_token } : {}),
                  },
                })) as any;

                if (resp.code !== 0) {
                  return json({ error: resp.msg || `Failed to list members: code ${resp.code}` });
                }

                const members = (resp.data?.items || []).map((m: any) => ({
                  member_id: m.member_id,
                  member_id_type: m.member_id_type,
                  name: m.name,
                  tenant_key: m.tenant_key,
                }));

                return json({
                  chat_id: params.chat_id,
                  members,
                  has_more: resp.data?.has_more,
                  page_token: resp.data?.page_token,
                });
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
    { name: "joycastle_feishu_contact" },
  );
}
