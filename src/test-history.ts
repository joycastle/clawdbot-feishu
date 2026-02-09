#!/usr/bin/env npx tsx
/**
 * 测试获取飞书会话历史消息 API
 * 用法: npx tsx test-history.ts <chat_id>
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

// 从 clawdbot 配置读取飞书凭据
function getFeishuCredentials(): { appId: string; appSecret: string } {
  const configPath = path.join(process.env.HOME || "", ".clawdbot", "config.yaml");
  const config = yaml.parse(fs.readFileSync(configPath, "utf-8"));
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

async function main() {
  const chatId = process.argv[2];
  if (!chatId) {
    console.error("Usage: npx tsx test-history.ts <chat_id>");
    console.error("Example: npx tsx test-history.ts oc_xxx (群聊)");
    process.exit(1);
  }

  const creds = getFeishuCredentials();
  const token = await getTenantAccessToken(creds.appId, creds.appSecret);
  
  // container_id_type: chat (群聊用 chat_id)
  const url = new URL("https://open.feishu.cn/open-apis/im/v1/messages");
  url.searchParams.set("container_id_type", "chat");
  url.searchParams.set("container_id", chatId);
  url.searchParams.set("page_size", "10");
  
  console.log(`Fetching history for: ${chatId}`);
  console.log(`URL: ${url.toString()}\n`);
  
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  
  const result = await resp.json() as any;
  
  console.log("Response code:", result.code);
  console.log("Response msg:", result.msg);
  
  if (result.code === 0 && result.data?.items) {
    console.log(`\nFound ${result.data.items.length} messages:\n`);
    for (const msg of result.data.items) {
      const time = new Date(parseInt(msg.create_time) * 1000).toISOString();
      const senderType = msg.sender?.sender_type;
      const senderId = msg.sender?.id;
      let content = "";
      try {
        const body = JSON.parse(msg.body?.content || "{}");
        content = body.text || JSON.stringify(body).slice(0, 100);
      } catch {
        content = msg.body?.content?.slice(0, 100) || "";
      }
      console.log(`[${time}] ${senderType}:${senderId?.slice(-8)}`);
      console.log(`  Type: ${msg.msg_type}`);
      console.log(`  Content: ${content}`);
      console.log();
    }
  } else {
    console.log("\nFull response:", JSON.stringify(result, null, 2));
  }
}

main();
