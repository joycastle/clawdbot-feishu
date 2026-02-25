#!/usr/bin/env npx tsx
import * as fs from "fs";
import * as path from "path";

function getConfigPath(): string {
  const home = process.env.HOME!;
  const candidates = [
    path.join(home, ".clawdbot", "clawdbot.json"),
    path.join(home, ".openclaw", "openclaw.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Config not found");
}

function getFeishuCredentials(): { appId: string; appSecret: string } {
  const config = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
  const feishu = config?.channels?.feishu;
  if (!feishu?.appId || !feishu?.appSecret) {
    throw new Error("Feishu credentials not found");
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
    throw new Error(`Failed to get token: ${data.msg}`);
  }
  return data.tenant_access_token;
}

async function downloadFile(token: string, messageId: string, fileKey: string): Promise<Buffer> {
  const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=file`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Download failed: ${resp.status} ${text}`);
  }
  
  return Buffer.from(await resp.arrayBuffer());
}

const files = [
  {
    messageId: "om_x100b56e4d06eeca4b261fc329c1a82b",
    fileKey: "file_v3_01v7_01c8d5d3-ee34-4f9e-a102-ae442dcc57cg",
    fileName: "marketing_weekly_meeting_data.py",
  },
  {
    messageId: "om_x100b56e4d06ec8bcb349fca49fccbfe",
    fileKey: "file_v3_01v7_a20351e2-a759-4caa-a299-b3ec474a0a2g",
    fileName: "market_monitoring.py",
  },
];

async function main() {
  const creds = getFeishuCredentials();
  const token = await getTenantAccessToken(creds.appId, creds.appSecret);
  
  for (const file of files) {
    console.log(`Downloading ${file.fileName}...`);
    const buffer = await downloadFile(token, file.messageId, file.fileKey);
    const outPath = path.join("/home/ubuntu/clawd", file.fileName);
    fs.writeFileSync(outPath, buffer);
    console.log(`Saved to ${outPath} (${buffer.length} bytes)`);
  }
}

main().catch(console.error);
