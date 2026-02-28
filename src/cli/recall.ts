#!/usr/bin/env npx tsx
import { readFileSync } from 'fs';
import * as lark from '@larksuiteoapi/node-sdk';
import { getConfigPath } from '../utils/paths.js';

function getFeishuCredentials(): { appId: string; appSecret: string } {
  const configPath = getConfigPath();
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const feishu = config?.channels?.feishu;
  if (!feishu?.appId || !feishu?.appSecret) {
    throw new Error('Feishu credentials not found in config');
  }
  return { appId: feishu.appId, appSecret: feishu.appSecret };
}

async function main() {
  const messageId = process.argv[2];
  if (!messageId) {
    console.error('Usage: npx tsx recall.ts <message_id>');
    process.exit(1);
  }

  const creds = getFeishuCredentials();
  const client = new lark.Client({
    appId: creds.appId,
    appSecret: creds.appSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
  });

  const res = await client.im.message.delete({
    path: { message_id: messageId },
  });

  console.log(JSON.stringify(res, null, 2));
}

main().catch(console.error);
