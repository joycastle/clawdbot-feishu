#!/usr/bin/env npx tsx
/**
 * 获取飞书群成员列表
 * 
 * 用法:
 *   npx tsx feishu-group-members.ts --chat <chat_id>
 */

import * as fs from "fs";
import * as path from "path";

const CONFIG_PATH = path.join(process.env.HOME || "", ".clawdbot/clawdbot.json");

function getFeishuCredentials(): { appId: string; appSecret: string } {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
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

async function getGroupMembers(token: string, chatId: string): Promise<any[]> {
  const members: any[] = [];
  let pageToken = "";
  
  do {
    const url = new URL(`https://open.feishu.cn/open-apis/im/v1/chats/${chatId}/members`);
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json() as any;
    
    if (data.code !== 0) {
      throw new Error(`Failed to get members: ${data.msg || data.code}`);
    }
    
    if (data.data?.items) {
      members.push(...data.data.items);
    }
    pageToken = data.data?.page_token || "";
  } while (pageToken);
  
  return members;
}

async function main() {
  const args = process.argv.slice(2);
  const chatIdx = args.indexOf("--chat");
  
  if (chatIdx === -1 || !args[chatIdx + 1]) {
    console.error("Usage: npx tsx feishu-group-members.ts --chat <chat_id>");
    process.exit(1);
  }
  
  const chatId = args[chatIdx + 1];
  
  try {
    const { appId, appSecret } = getFeishuCredentials();
    const token = await getTenantAccessToken(appId, appSecret);
    const members = await getGroupMembers(token, chatId);
    
    console.log(`\n群成员列表 (共 ${members.length} 人):\n`);
    console.log("| 昵称 | open_id |");
    console.log("|------|---------|");
    
    for (const m of members) {
      const name = m.name || "(未知)";
      const openId = m.member_id || "(未知)";
      console.log(`| ${name} | ${openId} |`);
    }
    
    // 输出 JSON 格式便于记录
    console.log("\n\nJSON 格式:");
    console.log(JSON.stringify(members.map(m => ({
      name: m.name,
      open_id: m.member_id,
    })), null, 2));
    
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
