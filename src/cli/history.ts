#!/usr/bin/env npx tsx
import { getConfigPath } from "../utils/paths.js";
/**
 * 获取飞书会话历史消息 CLI
 * 
 * 用法:
 *   npx tsx history-cli.ts --message <message_id> [--count <n>]
 *   npx tsx history-cli.ts --chat <chat_id> [--count <n>]
 * 
 * 示例:
 *   npx tsx history-cli.ts --message om_xxx --count 10
 *   npx tsx history-cli.ts --chat oc_xxx --count 5
 */

import * as fs from "fs";
import * as path from "path";

// 从配置读取飞书凭据
function getFeishuCredentials(): { appId: string; appSecret: string } {
  const configPath = getConfigPath();
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const feishu = config?.channels?.feishu;
  if (!feishu?.appId || !feishu?.appSecret) {
    throw new Error("Feishu credentials not found in config");
  }
  return { appId: feishu.appId, appSecret: feishu.appSecret };
}

async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await resp.json() as { tenant_access_token?: string; code?: number; msg?: string };
  if (!data.tenant_access_token) {
    throw new Error(`Failed to get token: ${data.msg || data.code}`);
  }
  return data.tenant_access_token;
}

async function getChatIdFromMessage(token: string, messageId: string): Promise<string> {
  const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await resp.json() as any;
  if (data.code !== 0) {
    throw new Error(`Failed to get message: ${data.msg || data.code}`);
  }
  const chatId = data.data?.items?.[0]?.chat_id;
  if (!chatId) {
    throw new Error("chat_id not found in message");
  }
  return chatId;
}

async function getHistoryMessages(
  token: string,
  chatId: string,
  count: number
): Promise<Array<{ messageId: string; time: string; sender: string; type: string; content: string }>> {
  const messages: Array<{ messageId: string; time: string; sender: string; type: string; content: string }> = [];
  let pageToken: string | undefined;
  let fetched = 0;

  // 分页获取，直到拿够 count 条或没有更多数据
  while (fetched < count) {
    const url = new URL("https://open.feishu.cn/open-apis/im/v1/messages");
    url.searchParams.set("container_id_type", "chat");
    url.searchParams.set("container_id", chatId);
    url.searchParams.set("page_size", String(Math.min(count - fetched, 50)));
    url.searchParams.set("sort_type", "ByCreateTimeDesc");
    if (pageToken) {
      url.searchParams.set("page_token", pageToken);
    }

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json() as any;
    if (data.code !== 0) {
      throw new Error(`Failed to get history: ${data.msg || data.code}`);
    }

    const items = data.data?.items || [];
    if (items.length === 0) break;

    fetched += items.length;
    pageToken = data.data?.page_token;

    for (const item of items) {
    const messageId = item.message_id || "";
    const time = new Date(parseInt(item.create_time)).toISOString().replace("T", " ").slice(0, 19);
    const sender = item.sender?.id || "unknown";
    const type = item.msg_type;
    let content = "";

    try {
      if (type === "text") {
        const body = JSON.parse(item.body?.content || "{}");
        content = body.text || "";
      } else if (type === "image") {
        content = "[图片]";
      } else if (type === "file") {
        const body = JSON.parse(item.body?.content || "{}");
        content = `[文件: ${body.file_name || "unknown"}]`;
      } else if (type === "audio") {
        content = "[语音]";
      } else if (type === "video" || type === "media") {
        content = "[视频]";
      } else if (type === "sticker") {
        content = "[表情]";
      } else if (type === "interactive") {
        // 解析卡片内容，提取文本
        try {
          const body = JSON.parse(item.body?.content || "{}");
          const texts: string[] = [];
          
          // 递归提取卡片中的文本
          const extractText = (obj: any) => {
            if (!obj) return;
            if (typeof obj === "string") return;
            if (Array.isArray(obj)) {
              for (const el of obj) extractText(el);
              return;
            }
            if (typeof obj === "object") {
              // 提取 text 字段
              if (obj.tag === "text" && obj.text) {
                texts.push(obj.text);
              } else if (obj.tag === "markdown" && obj.content) {
                texts.push(obj.content);
              } else if (obj.tag === "plain_text" && obj.content) {
                texts.push(obj.content);
              }
              // 递归处理 elements, content, columns 等
              if (obj.elements) extractText(obj.elements);
              if (obj.content) extractText(obj.content);
              if (obj.columns) extractText(obj.columns);
              if (obj.header?.title?.content) texts.push(obj.header.title.content);
            }
          };
          
          extractText(body);
          const cardText = texts.join("").replace(/\n{3,}/g, "\n\n").trim();
          content = cardText ? `[卡片] ${cardText.slice(0, 500)}${cardText.length > 500 ? "..." : ""}` : "[空卡片]";
        } catch {
          content = "[卡片消息]";
        }
      } else if (type === "system") {
        content = "[系统消息]";
      } else if (type === "post") {
        // 富文本
        try {
          const body = JSON.parse(item.body?.content || "{}");
          const texts: string[] = [];
          const processContent = (c: any) => {
            if (Array.isArray(c)) {
              for (const para of c) {
                if (Array.isArray(para)) {
                  for (const el of para) {
                    if (el.tag === "text") texts.push(el.text || "");
                    else if (el.tag === "a") texts.push(el.text || el.href || "");
                    else if (el.tag === "at") texts.push(`@${el.user_name || ""}`);
                  }
                }
              }
            }
          };
          if (body.zh_cn?.content) processContent(body.zh_cn.content);
          else if (body.content) processContent(body.content);
          content = texts.join("").slice(0, 200) || "[富文本]";
        } catch {
          content = "[富文本]";
        }
      } else {
        content = item.body?.content?.slice(0, 100) || `[${type}]`;
      }
    } catch {
      content = item.body?.content?.slice(0, 100) || `[${type}]`;
    }

    // 处理被删除/撤回的消息
    if (item.deleted) {
      content = "[消息已撤回]";
    }

    messages.push({ messageId, time, sender, type, content });
    }

    // 没有下一页了就退出
    if (!pageToken) break;
  }

  // 反转顺序，让旧消息在前
  return messages.reverse();
}

async function main() {
  const args = process.argv.slice(2);
  
  let messageId: string | undefined;
  let chatId: string | undefined;
  let count = 50; // 默认50条，最多50条

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--message" || args[i] === "-m") {
      messageId = args[++i];
    } else if (args[i] === "--chat" || args[i] === "-c") {
      chatId = args[++i];
    } else if (args[i] === "--count" || args[i] === "-n") {
      count = parseInt(args[++i]) || 10;
    }
  }

  if (!messageId && !chatId) {
    console.error("Usage:");
    console.error("  npx tsx history-cli.ts --message <message_id> [--count <n>]");
    console.error("  npx tsx history-cli.ts --chat <chat_id> [--count <n>]");
    process.exit(1);
  }

  const creds = getFeishuCredentials();
  const token = await getTenantAccessToken(creds.appId, creds.appSecret);

  // 如果给的是 message_id，先获取 chat_id
  if (messageId && !chatId) {
    console.error(`Getting chat_id from message: ${messageId}`);
    chatId = await getChatIdFromMessage(token, messageId);
    console.error(`Chat ID: ${chatId}`);
  }

  if (!chatId) {
    console.error("No chat_id available");
    process.exit(1);
  }

  const messages = await getHistoryMessages(token, chatId, count);

  console.log(`\n=== 会话历史 (最近 ${messages.length} 条) ===\n`);
  for (const msg of messages) {
    const senderShort = msg.sender.slice(-8);
    console.log(`[${msg.time}] ${senderShort} [${msg.messageId}]: ${msg.content}`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
