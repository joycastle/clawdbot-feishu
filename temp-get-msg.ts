import { getConfigPath } from "./src/utils/paths.js";
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
  const data = await resp.json() as { tenant_access_token?: string; code?: number; msg?: string };
  if (!data.tenant_access_token) {
    throw new Error(`Failed to get token: ${data.msg || data.code}`);
  }
  return data.tenant_access_token;
}

async function main() {
  const msgId = process.argv[2];
  if (!msgId) {
    console.error('Usage: npx tsx script.ts <message_id>');
    process.exit(1);
  }
  
  const creds = getFeishuCredentials();
  const token = await getTenantAccessToken(creds.appId, creds.appSecret);
  
  const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${msgId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await resp.json() as any;
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);
