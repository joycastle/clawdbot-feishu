import * as lark from '@larksuiteoapi/node-sdk';
import fs from 'node:fs';
import os from 'node:os';

const configPath = process.env.CLAWDBOT_CONFIG || `${os.homedir()}/.openclaw/openclaw.json`;
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const feishuCfg = config.channels?.feishu;

const client = new lark.Client({
  appId: feishuCfg.appId,
  appSecret: feishuCfg.appSecret,
});

const folderToken = 'file_v3_0110b_9ca295a8-a7dc-46bd-86e7-6f36c0e3755g';

async function main() {
  // 用 drive.v1.file.list 列出文件
  const res = await client.drive.v1.file.list({
    params: { folder_token: folderToken },
  });
  console.log(JSON.stringify(res, null, 2));
}

main().catch(console.error);
