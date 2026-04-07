/**
 * feishu_history — 飞书聊天历史工具
 *
 * Actions:
 *   list_by_chat    — 通过 chat_id 获取聊天历史
 *   list_by_message — 通过 message_id 获取所在会话的历史
 */

import { Type, type Static } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { FeishuConfig } from "../types.js";
import { createFeishuClient } from "../client.js";
import { resolveFeishuCredentials } from "../accounts.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

const FeishuHistorySchema = Type.Union([
  Type.Object({
    action: Type.Literal("list_by_chat"),
    chat_id: Type.String({ description: "群/会话 ID" }),
    count: Type.Optional(Type.Integer({ description: "获取消息数量，默认 20，最大 200", minimum: 1, maximum: 200 })),
  }),
  Type.Object({
    action: Type.Literal("list_by_message"),
    message_id: Type.String({ description: "消息 ID，用于定位会话" }),
    count: Type.Optional(Type.Integer({ description: "获取消息数量，默认 20，最大 200", minimum: 1, maximum: 200 })),
  }),
]);

type FeishuHistoryParams = Static<typeof FeishuHistorySchema>;

// ─── Types ────────────────────────────────────────────────────────────────────

type HistoryMessage = {
  message_id: string;
  time: string;
  sender_id: string;
  sender_type: string;
  msg_type: string;
  content: string;
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function parseContent(msgType: string, bodyContent?: string): string {
  if (!bodyContent) return "";
  try {
    const parsed = JSON.parse(bodyContent);
    if (msgType === "text") return parsed.text || "";
    if (msgType === "post") {
      // Rich text post - extract text from structure
      const content = parsed.content || parsed.zh_cn?.content || [];
      return content
        .flat()
        .map((item: any) => item.text || item.content || "")
        .join("");
    }
    return bodyContent;
  } catch {
    return bodyContent;
  }
}

// ─── Tool Registration ────────────────────────────────────────────────────────

export function registerFeishuHistoryTool(api: OpenClawPluginApi) {
  api.registerTool(
    (ctx) => {
      const feishuCfg = ctx.config?.channels?.feishu as FeishuConfig | undefined;
      const creds = resolveFeishuCredentials(feishuCfg);
      if (!creds) return null;

      const client = createFeishuClient(feishuCfg!);

      async function getChatIdFromMessage(messageId: string): Promise<string> {
        const resp = (await client.im.message.get({
          path: { message_id: messageId },
        })) as any;
        if (resp.code !== 0) {
          throw new Error(`Failed to get message: ${resp.msg}`);
        }
        const chatId = resp.data?.items?.[0]?.chat_id;
        if (!chatId) {
          throw new Error("chat_id not found in message");
        }
        return chatId;
      }

      async function getHistoryMessages(chatId: string, count: number): Promise<HistoryMessage[]> {
        const messages: HistoryMessage[] = [];
        let pageToken: string | undefined;

        while (messages.length < count) {
          const resp = (await client.im.message.list({
            params: {
              container_id_type: "chat",
              container_id: chatId,
              page_size: Math.min(count - messages.length, 50),
              sort_type: "ByCreateTimeDesc",
              ...(pageToken ? { page_token: pageToken } : {}),
            },
          })) as any;

          if (resp.code !== 0) {
            throw new Error(`Failed to get history: ${resp.msg}`);
          }

          const items = resp.data?.items || [];
          for (const item of items) {
            messages.push({
              message_id: item.message_id || "",
              time: item.create_time
                ? new Date(Number(item.create_time)).toISOString()
                : "",
              sender_id: item.sender?.id || "",
              sender_type: item.sender?.sender_type || "",
              msg_type: item.msg_type || "",
              content: parseContent(item.msg_type, item.body?.content),
            });
          }

          pageToken = resp.data?.page_token;
          if (!pageToken || items.length === 0) break;
        }

        return messages.slice(0, count);
      }

      return {
        name: "joycastle_feishu_history",
        label: "Feishu History",
        description:
          "获取飞书聊天历史消息。" +
          "Actions: list_by_chat（通过 chat_id 获取）、list_by_message（通过 message_id 定位会话后获取）",
        parameters: FeishuHistorySchema,
        async execute(_id, params: FeishuHistoryParams) {
          try {
            const count = params.count ?? 20;

            switch (params.action) {
              case "list_by_chat": {
                const messages = await getHistoryMessages(params.chat_id, count);
                return json({ chat_id: params.chat_id, count: messages.length, messages });
              }

              case "list_by_message": {
                const chatId = await getChatIdFromMessage(params.message_id);
                const messages = await getHistoryMessages(chatId, count);
                return json({ chat_id: chatId, source_message: params.message_id, count: messages.length, messages });
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
    { name: "joycastle_feishu_history" },
  );
}
