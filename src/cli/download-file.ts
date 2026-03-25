#!/usr/bin/env npx tsx
/**
 * Download a file from Feishu message
 */
import * as lark from '@larksuiteoapi/node-sdk';
import fs from 'node:fs';
import os from 'node:os';

const args = process.argv.slice(2);
let fileKey: string | undefined;
let messageId: string | undefined;
let outputPath = '/tmp/downloaded_file';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file-key' && args[i + 1]) {
    fileKey = args[i + 1]; i++;
  } else if (args[i] === '--message-id' && args[i + 1]) {
    messageId = args[i + 1]; i++;
  } else if (args[i] === '--output' && args[i + 1]) {
    outputPath = args[i + 1]; i++;
  }
}

if (!fileKey || !messageId) {
  console.error('Usage: npx tsx download-file.ts --file-key <key> --message-id <id> [--output <path>]');
  process.exit(1);
}

const configPath = process.env.CLAWDBOT_CONFIG || `${os.homedir()}/.clawdbot/clawdbot.json`;
if (!fs.existsSync(configPath)) {
  console.error(`Config not found: ${configPath}`);
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const feishuCfg = cfg?.channels?.feishu;

if (!feishuCfg?.appId || !feishuCfg?.appSecret) {
  console.error('Feishu credentials not found in config');
  process.exit(1);
}

const client = new lark.Client({
  appId: feishuCfg.appId,
  appSecret: feishuCfg.appSecret,
});

async function main() {
  console.error(`Downloading file: ${fileKey} from message: ${messageId}`);
  
  const resp = await client.im.messageResource.get({
    path: { message_id: messageId!, file_key: fileKey! },
    params: { type: 'file' }
  });
  
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(JSON.stringify({ success: true, path: outputPath, size: buffer.length }));
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
