#!/usr/bin/env npx tsx
/**
 * 飞书消息发送 CLI
 * 
 * 用法:
 *   npx tsx src/cli/send.ts --to user:ou_xxx --message "Hello"
 *   npx tsx src/cli/send.ts --to chat:oc_xxx --message "Hello"
 *   npx tsx src/cli/send.ts --to user:ou_xxx --file ./message.txt
 */

import { parseArgs } from 'util';
import { readFileSync } from 'fs';
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

function parseArguments() {
  const { values } = parseArgs({
    options: {
      to: { type: 'string', short: 't' },
      message: { type: 'string', short: 'm' },
      file: { type: 'string', short: 'f' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
飞书消息发送 CLI

用法:
  npx tsx src/cli/send.ts --to user:ou_xxx --message "Hello"
  npx tsx src/cli/send.ts --to chat:oc_xxx --message "Hello"
  npx tsx src/cli/send.ts --to user:ou_xxx --file ./message.txt

参数:
  --to, -t      接收者（user:open_id 或 chat:chat_id）
  --message, -m 消息内容
  --file, -f    从文件读取消息内容
  --help, -h    显示帮助
`);
    process.exit(0);
  }

  return values;
}

function getClient() {
  const { appId, appSecret } = getFeishuCredentials();
  return new lark.Client({ appId, appSecret });
}

async function sendMessage(to: string, message: string) {
  const client = getClient();

  let receiveIdType: 'open_id' | 'chat_id';
  let receiveId: string;

  if (to.startsWith('user:')) {
    receiveIdType = 'open_id';
    receiveId = to.slice(5);
  } else if (to.startsWith('chat:')) {
    receiveIdType = 'chat_id';
    receiveId = to.slice(5);
  } else if (to.startsWith('ou_')) {
    receiveIdType = 'open_id';
    receiveId = to;
  } else if (to.startsWith('oc_')) {
    receiveIdType = 'chat_id';
    receiveId = to;
  } else {
    throw new Error(`Invalid target format: ${to}. Use user:open_id or chat:chat_id`);
  }

  const response = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text: message }),
    },
  });

  if (response.code !== 0) {
    throw new Error(`Failed to send message: ${response.msg}`);
  }

  return response.data?.message_id;
}

async function main() {
  const args = parseArguments();

  if (!args.to) {
    console.error('❌ 错误: 需要 --to 参数');
    process.exit(1);
  }

  let message = args.message || '';
  if (args.file) {
    message = readFileSync(args.file, 'utf-8').trim();
  }

  if (!message) {
    console.error('❌ 错误: 需要 --message 或 --file 参数');
    process.exit(1);
  }

  try {
    const messageId = await sendMessage(args.to, message);
    console.log(`✅ 发送成功: ${messageId}`);
  } catch (err) {
    console.error(`❌ 发送失败: ${err}`);
    process.exit(1);
  }
}

main();
