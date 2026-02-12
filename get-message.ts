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

  // Get the previous message (video message)
  const chatId = 'oc_202fdd49ee3a2d093c90b5ab332dfe34';
  
  console.log('Fetching messages...');
  const resp = await client.im.message.list({
    params: {
      container_id_type: 'chat',
      container_id: chatId,
      page_size: 50,
      sort_type: 'ByCreateTimeDesc'
    }
  });
  
  console.log(JSON.stringify(resp, null, 2));
}

main().catch(console.error);
