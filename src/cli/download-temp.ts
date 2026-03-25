#!/usr/bin/env npx tsx
import { getConfigPath } from "../utils/paths.js";
import * as fs from "fs";

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
  const data = await resp.json() as any;
  if (data.code !== 0) throw new Error(`Failed to get token: ${data.msg}`);
  return data.tenant_access_token;
}

async function downloadFile(messageId: string, fileKey: string, outputPath: string) {
  const { appId, appSecret } = getFeishuCredentials();
  const token = await getTenantAccessToken(appId, appSecret);
  
  const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=file`;
  
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Download failed: ${resp.status} ${text}`);
  }
  
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`Downloaded to ${outputPath}, size: ${buffer.length} bytes`);
  
  // Print content if it's text
  const content = buffer.toString("utf8");
  console.log("\n--- File Content ---\n");
  console.log(content);
}

const messageId = "om_x100b5492fdf888b4b2448eecc358aa3";
const fileKey = "file_v3_00vt_8e3025fa-ee4e-411b-8fa6-34d875b82c3g";
downloadFile(messageId, fileKey, "/tmp/downloaded.txt").catch(console.error);
