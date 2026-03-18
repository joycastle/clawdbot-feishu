#!/usr/bin/env npx tsx
import { getConfigPath } from "./src/utils/paths.js";
import * as fs from "fs";

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
  if (!data.tenant_access_token) {
    throw new Error(`Failed to get token: ${data.msg || data.code}`);
  }
  return data.tenant_access_token;
}

async function main() {
  const messageId = 'om_x100b544f0f2f2480c294afc251b07e7';
  const imageKey = 'img_v3_02vr_2105eb56-fd45-4e40-9632-18480e0a99ag';
  
  const creds = getFeishuCredentials();
  const token = await getTenantAccessToken(creds.appId, creds.appSecret);
  
  // Use messageResource API for message attachments
  const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${imageKey}?type=image`;
  console.log('Fetching:', url);
  
  const imgResp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  const contentType = imgResp.headers.get('content-type');
  console.log('Content-Type:', contentType);
  
  const buffer = Buffer.from(await imgResp.arrayBuffer());
  console.log('Response size:', buffer.length);
  
  // Check if it's an error response
  if (contentType?.includes('application/json') || buffer.length < 1000) {
    console.log('Response:', buffer.toString('utf-8').slice(0, 500));
  } else {
    fs.writeFileSync('/tmp/mk_evidence.jpg', buffer);
    console.log('Saved to /tmp/mk_evidence.jpg');
  }
}

main().catch(e => console.error(e));
