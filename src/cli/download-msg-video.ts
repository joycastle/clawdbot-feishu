#!/usr/bin/env npx tsx
import { getConfigPath } from "../utils/paths.js";
import * as fs from 'fs';

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
  const data: any = await resp.json();
  if (data.code !== 0) {
    throw new Error(`Failed to get token: ${data.msg}`);
  }
  return data.tenant_access_token;
}

const msgId = process.argv[2];
const outputPath = process.argv[3] || '/tmp/feishu-video.mp4';

if (!msgId) {
  console.error('Usage: npx tsx download-msg-video.ts <message_id> [output_path]');
  process.exit(1);
}

async function main() {
  const { appId, appSecret } = getFeishuCredentials();
  const token = await getTenantAccessToken(appId, appSecret);
  
  console.log(`Getting message ${msgId}...`);
  const msgResp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${msgId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const msgData: any = await msgResp.json();
  
  if (msgData.code !== 0) {
    throw new Error(`Failed to get message: ${msgData.msg}`);
  }
  
  const item = msgData.data?.items?.[0];
  if (!item) {
    throw new Error('Message not found');
  }
  
  console.log('Message type:', item.msg_type);
  const content = JSON.parse(item.body?.content || '{}');
  console.log('Content:', JSON.stringify(content, null, 2));
  
  const fileKey = content.file_key;
  if (!fileKey) {
    throw new Error('No file_key in message');
  }
  
  console.log(`Downloading file ${fileKey}...`);
  const fileResp = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages/${msgId}/resources/${fileKey}?type=file`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  
  if (!fileResp.ok) {
    throw new Error(`Failed to download: ${fileResp.status}`);
  }
  
  const buffer = await fileResp.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(buffer));
  
  const stats = fs.statSync(outputPath);
  console.log(`Saved to ${outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch(e => {
  console.error('Error:', e.message || e);
  process.exit(1);
});
