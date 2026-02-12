#!/usr/bin/env npx tsx
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as lark from '@larksuiteoapi/node-sdk';

function getFeishuCredentials(): { appId: string; appSecret: string } {
  const configPath = join(process.env.HOME || '', '.clawdbot', 'clawdbot.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const feishu = config?.channels?.feishu;
  if (!feishu?.appId || !feishu?.appSecret) {
    throw new Error('Feishu credentials not found in config');
  }
  return { appId: feishu.appId, appSecret: feishu.appSecret };
}

async function main() {
  const creds = getFeishuCredentials();
  const client = new lark.Client({
    appId: creds.appId,
    appSecret: creds.appSecret,
    domain: lark.Domain.Feishu,
  });

  const messageId = 'om_x100b57f347835cacc14df1fbbed92ab';
  const fileKey = 'file_v3_00uq_93eafbe1-7cbb-4ffb-bd3a-1363f357691g';
  
  console.log('Downloading video file...');
  const resp = await client.im.messageResource.get({
    path: { message_id: messageId, file_key: fileKey },
    params: { type: 'file' }
  });
  
  // Use the writeFile method from the response
  await (resp as any).writeFile('/tmp/user_video.mp4');
  console.log('Downloaded to /tmp/user_video.mp4');
  
  // Check file size
  const { statSync } = await import('fs');
  const stats = statSync('/tmp/user_video.mp4');
  console.log('File size:', stats.size);
}

main().catch(console.error);
