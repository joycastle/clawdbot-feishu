/**
 * feishu_wiki — 飞书知识库工具
 *
 * Actions:
 *   spaces  — 列出所有知识空间
 *   nodes   — 列出某个知识空间下的节点
 *   get     — 获取单个节点信息（含真实 obj_type 和 obj_token）
 *   resolve — 将 wiki token 解析为实际文档类型和 token
 */

import { Type, type Static } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { FeishuConfig } from "../types.js";
import { createFeishuClient } from "../client.js";
import { resolveFeishuCredentials } from "../accounts.js";
import { getWikiSpaces, getWikiNodes, getWikiNode, resolveWikiNode } from "../services/wiki.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

const FeishuWikiSchema = Type.Union([
  Type.Object({
    action: Type.Literal("spaces"),
  }),
  Type.Object({
    action: Type.Literal("nodes"),
    space_id: Type.String({ description: "知识空间 ID" }),
    parent_node_token: Type.Optional(
      Type.String({ description: "父节点 token，不填则列出根节点" }),
    ),
  }),
  Type.Object({
    action: Type.Literal("get"),
    token: Type.String({ description: "Wiki 节点 token" }),
  }),
  Type.Object({
    action: Type.Literal("resolve"),
    wiki_token: Type.String({
      description: "Wiki 节点 token，将解析为真实文档类型（docx/sheet/bitable 等）和 obj_token",
    }),
  }),
]);

type FeishuWikiParams = Static<typeof FeishuWikiSchema>;

// ─── Helper ───────────────────────────────────────────────────────────────────

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// ─── Tool Registration ────────────────────────────────────────────────────────

export function registerFeishuWikiTool(api: OpenClawPluginApi) {
  api.registerTool(
    (ctx) => {
      const feishuCfg = ctx.config?.channels?.feishu as FeishuConfig | undefined;
      const creds = resolveFeishuCredentials(feishuCfg);
      if (!creds) return null;

      const client = createFeishuClient(feishuCfg!);

      return {
        name: "joycastle_feishu_wiki",
        label: "Feishu Wiki",
        description:
          "飞书知识库（Wiki）操作。" +
          "Actions: spaces（列出所有知识空间）、nodes（列出某空间下的节点）、" +
          "get（获取节点信息含文档类型）、resolve（将 wiki token 解析为真实文档 token）",
        parameters: FeishuWikiSchema,
        async execute(_id, params: FeishuWikiParams) {
          try {
            switch (params.action) {
              case "spaces": {
                const spaces = await getWikiSpaces(client);
                return json({ spaces });
              }
              case "nodes": {
                const nodes = await getWikiNodes(client, params.space_id, params.parent_node_token);
                return json({ nodes });
              }
              case "get": {
                const node = await getWikiNode(feishuCfg!, params.token);
                return json(node);
              }
              case "resolve": {
                const result = await resolveWikiNode(feishuCfg!, params.wiki_token);
                return json(result);
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
    { name: "joycastle_feishu_wiki" },
  );
}
