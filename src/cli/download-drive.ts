import * as lark from '@larksuiteoapi/node-sdk';
import fs from 'node:fs';
import os from 'node:os';
import axios from 'axios';

const fileToken = process.argv[2];
if (!fileToken) {
  console.error('Usage: npx tsx src/cli/download-drive.ts <file_token>');
  process.exit(1);
}

const configPath = process.env.CLAWDBOT_CONFIG || `${os.homedir()}/.clawdbot/clawdbot.json`;
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const feishuCfg = cfg?.channels?.feishu;

const client = new lark.Client({
  appId: feishuCfg.appId,
  appSecret: feishuCfg.appSecret,
});

async function getTenantAccessToken(): Promise<string> {
  const res = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: feishuCfg.appId,
    app_secret: feishuCfg.appSecret
  });
  return res.data.tenant_access_token;
}

async function main() {
  try {
    console.error('Getting access token...');
    const accessToken = await getTenantAccessToken();
    
    console.error('Downloading file:', fileToken);
    const url = `https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}/download`;
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: 'arraybuffer'
    });
    
    const outputPath = '/tmp/insurance.pdf';
    fs.writeFileSync(outputPath, Buffer.from(res.data));
    console.log('Downloaded to:', outputPath);
  } catch (e: any) {
    console.error('Error:', e.response?.data || e.message || e);
  }
}

main();
