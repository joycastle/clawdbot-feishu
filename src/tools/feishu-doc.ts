/**
 * feishu_doc — 飞书文档读取工具
 *
 * Actions:
 *   read       — 通过 doc token 读取文档内容
 *   read_wiki  — 通过 wiki token 读取文档内容（自动解析为 docx token）
 */

import { Type, type Static } from "@sinclair/typebox";
import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import type { FeishuConfig } from "../types.js";
import { createFeishuClient } from "../client.js";
import { resolveFeishuCredentials } from "../accounts.js";
import { readDocx } from "../services/docx.js";
import { resolveWikiNode } from "../services/wiki.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

const FeishuDocSchema = Type.Union([
  Type.Object({
    action: Type.Literal("read"),
    doc_token: Type.String({
      description: "飞书文档 token（obj_token，非 wiki token）。可从文档 URL 中获取：/docx/<doc_token>",
    }),
    include_blocks: Type.Optional(
      Type.Boolean({
        description: "是否同时返回结构化 block 列表，默认 false",
      }),
    ),
  }),
  Type.Object({
    action: Type.Literal("read_wiki"),
    wiki_token: Type.String({
      description: "飞书 Wiki 节点 token。可从 wiki URL 中获取：/wiki/<wiki_token>",
    }),
    include_blocks: Type.Optional(
      Type.Boolean({
        description: "是否同时返回结构化 block 列表，默认 false",
      }),
    ),
  }),
]);

type FeishuDocParams = Static<typeof FeishuDocSchema>;

// ─── Helper ───────────────────────────────────────────────────────────────────

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// ─── Tool Registration ────────────────────────────────────────────────────────

export function registerFeishuDocTool(api: ClawdbotPluginApi) {
  api.registerTool(
    (ctx) => {
      const feishuCfg = ctx.config?.channels?.feishu as FeishuConfig | undefined;
      const creds = resolveFeishuCredentials(feishuCfg);
      if (!creds) return null;

      const client = createFeishuClient(feishuCfg!);

      return {
        name: "feishu_doc",
        label: "Feishu Doc",
        description:
          "读取飞书文档内容。支持直接通过 doc token 读取，或通过 wiki token 自动解析后读取。" +
          "Actions: read（通过 doc_token 读取）、read_wiki（通过 wiki_token 读取）",
        parameters: FeishuDocSchema,
        async execute(_id, params: FeishuDocParams) {
          try {
            switch (params.action) {
              case "read": {
                const result = await readDocx(client, params.doc_token, params.include_blocks ?? false);
                return json(result);
              }
              case "read_wiki": {
                const node = await resolveWikiNode(feishuCfg!, params.wiki_token);
                if (node.objType !== "docx" && node.objType !== "doc") {
                  return json({
                    error: `Wiki 节点类型为 "${node.objType}"，不是文档，请使用对应工具读取`,
                    node,
                  });
                }
                const result = await readDocx(client, node.objToken, params.include_blocks ?? false);
                return json({ ...result, title: node.title, wiki_token: params.wiki_token });
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
    { name: "feishu_doc" },
  );
}
