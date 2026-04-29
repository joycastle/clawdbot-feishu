/**
 * feishu_message — 飞书消息工具
 *
 * Actions:
 *   send        — 发送文本消息
 *   send_card   — 发送 Markdown 卡片
 *   reply       — 回复消息
 *   edit        — 编辑消息
 *   get         — 获取消息详情
 *   recall      — 撤回消息
 */

import { Type, type Static } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { FeishuConfig } from "../types.js";
import { resolveFeishuCredentials } from "../accounts.js";
import {
  sendMessageFeishu,
  sendCardFeishu,
  editMessageFeishu,
  getMessageFeishu,
} from "../api/send.js";
import { createFeishuClient } from "../client.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

const FeishuMessageSchema = Type.Union([
  Type.Object({
    action: Type.Literal("send"),
    to: Type.String({ description: "目标 ID（chat_id 或 open_id）" }),
    text: Type.String({ description: "消息文本" }),
    reply_to: Type.Optional(Type.String({ description: "回复的消息 ID" })),
  }),
  Type.Object({
    action: Type.Literal("send_card"),
    to: Type.String({ description: "目标 ID（chat_id 或 open_id）" }),
    content: Type.String({ description: "卡片 Markdown 内容" }),
    title: Type.Optional(Type.String({ description: "卡片标题" })),
    reply_to: Type.Optional(Type.String({ description: "回复的消息 ID" })),
  }),
  Type.Object({
    action: Type.Literal("reply"),
    message_id: Type.String({ description: "要回复的消息 ID" }),
    text: Type.String({ description: "回复文本" }),
    in_thread: Type.Optional(Type.Boolean({ description: "是否在话题中回复，默认 false" })),
  }),
  Type.Object({
    action: Type.Literal("edit"),
    message_id: Type.String({ description: "要编辑的消息 ID" }),
    text: Type.String({ description: "新的消息文本" }),
  }),
  Type.Object({
    action: Type.Literal("get"),
    message_id: Type.String({ description: "消息 ID" }),
  }),
  Type.Object({
    action: Type.Literal("recall"),
    message_id: Type.String({ description: "要撤回的消息 ID" }),
  }),
]);

type FeishuMessageParams = Static<typeof FeishuMessageSchema>;

// ─── Helper ───────────────────────────────────────────────────────────────────

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// ─── Tool Registration ────────────────────────────────────────────────────────

export function registerFeishuMessageTool(api: OpenClawPluginApi) {
  api.registerTool(
    (ctx) => {
      const feishuCfg = ctx.config?.channels?.feishu as FeishuConfig | undefined;
      const creds = resolveFeishuCredentials(feishuCfg);
      if (!creds) return null;

      const cfg = ctx.config!;
      const client = createFeishuClient(feishuCfg!);

      return {
        name: "joycastle_feishu_message",
        label: "Feishu Message",
        description:
          "发送、回复、编辑、查询、撤回飞书消息。" +
          "Actions: send（发送文本）、send_card（发送卡片）、reply（回复消息）、edit（编辑消息）、get（获取消息详情）、recall（撤回消息）",
        parameters: FeishuMessageSchema,
        async execute(_id, params: FeishuMessageParams) {
          try {
            switch (params.action) {
              case "send": {
                const result = await sendMessageFeishu({
                  cfg,
                  to: params.to,
                  text: params.text,
                  replyToMessageId: params.reply_to,
                });
                return json({ ok: true, message_id: result.message_id });
              }

              case "send_card": {
                // Build a simple markdown card
                const card = {
                  config: { wide_screen_mode: true },
                  header: params.title
                    ? { title: { tag: "plain_text", content: params.title }, template: "blue" }
                    : undefined,
                  elements: [{ tag: "markdown", content: params.content }],
                };
                const result = await sendCardFeishu({
                  cfg,
                  to: params.to,
                  card,
                  replyToMessageId: params.reply_to,
                });
                return json({ ok: true, message_id: result.message_id });
              }

              case "reply": {
                const result = await sendMessageFeishu({
                  cfg,
                  to: "", // Will be ignored when replyToMessageId is set
                  text: params.text,
                  replyToMessageId: params.message_id,
                  replyInThread: params.in_thread,
                });
                return json({ ok: true, message_id: result.message_id });
              }

              case "edit": {
                await editMessageFeishu({
                  cfg,
                  messageId: params.message_id,
                  text: params.text,
                });
                return json({ ok: true, message_id: params.message_id });
              }

              case "get": {
                const message = await getMessageFeishu({
                  cfg,
                  messageId: params.message_id,
                });
                if (!message) {
                  return json({ error: "Message not found" });
                }
                return json(message);
              }

              case "recall": {
                const resp = (await client.im.message.delete({
                  path: { message_id: params.message_id },
                })) as any;
                if (resp.code !== 0) {
                  return json({ ok: false, error: resp.msg || `code ${resp.code}`, code: resp.code, message_id: params.message_id });
                }
                return json({ ok: true, message_id: params.message_id });
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
    { name: "joycastle_feishu_message" },
  );
}
