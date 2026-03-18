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
  const data = await resp.json() as { tenant_access_token?: string; code?: number; msg?: string };
  if (!data.tenant_access_token) {
    throw new Error(`Failed to get token: ${data.msg || data.code}`);
  }
  return data.tenant_access_token;
}

async function main() {
  const msgId = process.argv[2];
  const fileKey = process.argv[3];
  const outputPath = process.argv[4] || '/tmp/video.mp4';
  
  if (!msgId || !fileKey) {
    console.error('Usage: npx tsx script.ts <message_id> <file_key> [output_path]');
    process.exit(1);
  }
  
  const creds = getFeishuCredentials();
  const token = await getTenantAccessToken(creds.appId, creds.appSecret);
  
  console.log('Downloading video...');
  const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${msgId}/resources/${fileKey}?type=file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Download failed: ${resp.status} ${text}`);
  }
  
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`Saved to ${outputPath} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch(console.error);
