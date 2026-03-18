#!/usr/bin/env npx tsx
import { getConfigPath } from "../utils/paths.js";
/**
 * 飞书消息发送 CLI
 * 
 * 用法:
 *   # 纯文本消息
 *   npx tsx src/cli/send.ts --to user:ou_xxx --message "Hello"
 *   npx tsx src/cli/send.ts --to chat:oc_xxx --message "Hello"
 *   npx tsx src/cli/send.ts --to user:ou_xxx --file ./message.txt
 * 
 *   # Markdown 卡片（自动渲染格式）
 *   npx tsx src/cli/send.ts --to chat:oc_xxx --markdown "**粗体** 和 *斜体*"
 *   npx tsx src/cli/send.ts --to chat:oc_xxx --markdown --file ./content.md --title "标题"
 * 
 *   # 自定义卡片 JSON
 *   npx tsx src/cli/send.ts --to chat:oc_xxx --card ./card.json
 *   npx tsx src/cli/send.ts --to chat:oc_xxx --card '{"elements":[...]}'
 */

import { parseArgs } from 'util';
import { readFileSync, existsSync } from 'fs';
import * as lark from '@larksuiteoapi/node-sdk';

function getFeishuCredentials(): { appId: string; appSecret: string } {
  const configPath = getConfigPath();
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
      markdown: { type: 'boolean' },
      card: { type: 'string' },
      title: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
飞书消息发送 CLI

用法:
  # 纯文本消息
  npx tsx src/cli/send.ts --to user:ou_xxx --message "Hello"
  npx tsx src/cli/send.ts --to chat:oc_xxx --file ./message.txt

  # Markdown 卡片（自动渲染粗体、斜体、代码、表格等）
  npx tsx src/cli/send.ts --to chat:oc_xxx --markdown --message "**粗体** 和 \`代码\`"
  npx tsx src/cli/send.ts --to chat:oc_xxx --markdown --file ./content.md --title "报告标题"

  # 自定义卡片 JSON
  npx tsx src/cli/send.ts --to chat:oc_xxx --card ./card.json
  npx tsx src/cli/send.ts --to chat:oc_xxx --card '{"config":{},"elements":[...]}'

参数:
  --to, -t      接收者（user:open_id 或 chat:chat_id）
  --message, -m 消息内容
  --file, -f    从文件读取消息内容
  --markdown    以 Markdown 卡片形式发送（渲染格式）
  --card        发送自定义卡片（JSON 文件路径或 JSON 字符串）
  --title       卡片标题（仅 --markdown 模式有效）
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

/**
 * 构建 Markdown 卡片
 */
function buildMarkdownCard(content: string, title?: string): Record<string, unknown> {
  const card: Record<string, unknown> = {
    config: {
      wide_screen_mode: true,
    },
    elements: [
      {
        tag: "markdown",
        content: content,
      },
    ],
  };

  if (title) {
    card.header = {
      title: {
        tag: "plain_text",
        content: title,
      },
      template: "blue",
    };
  }

  return card;
}

/**
 * 解析接收者 ID
 */
function parseReceiver(to: string): { receiveIdType: 'open_id' | 'chat_id'; receiveId: string } {
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

  return { receiveIdType, receiveId };
}

/**
 * 发送纯文本消息
 */
async function sendTextMessage(to: string, message: string) {
  const client = getClient();
  const { receiveIdType, receiveId } = parseReceiver(to);

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

/**
 * 发送卡片消息（interactive）
 */
async function sendCardMessage(to: string, card: Record<string, unknown>) {
  const client = getClient();
  const { receiveIdType, receiveId } = parseReceiver(to);

  const response = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    },
  });

  if (response.code !== 0) {
    throw new Error(`Failed to send card: ${response.msg}`);
  }

  return response.data?.message_id;
}

async function main() {
  const args = parseArguments();

  if (!args.to) {
    console.error('❌ 错误: 需要 --to 参数');
    process.exit(1);
  }

  // 获取消息内容
  let content = args.message || '';
  if (args.file) {
    content = readFileSync(args.file, 'utf-8').trim();
  }

  try {
    let messageId: string | undefined;

    if (args.card) {
      // 自定义卡片模式
      let cardJson: Record<string, unknown>;
      
      // 检查是文件路径还是 JSON 字符串
      if (existsSync(args.card)) {
        const cardContent = readFileSync(args.card, 'utf-8');
        cardJson = JSON.parse(cardContent);
      } else {
        // 尝试解析为 JSON
        try {
          cardJson = JSON.parse(args.card);
        } catch {
          console.error('❌ 错误: --card 参数不是有效的 JSON 或文件路径');
          process.exit(1);
        }
      }

      messageId = await sendCardMessage(args.to, cardJson);
      console.log(`✅ 卡片发送成功: ${messageId}`);

    } else if (args.markdown) {
      // Markdown 卡片模式
      if (!content) {
        console.error('❌ 错误: --markdown 模式需要 --message 或 --file 参数');
        process.exit(1);
      }

      const card = buildMarkdownCard(content, args.title);
      messageId = await sendCardMessage(args.to, card);
      console.log(`✅ Markdown 卡片发送成功: ${messageId}`);

    } else {
      // 纯文本模式
      if (!content) {
        console.error('❌ 错误: 需要 --message 或 --file 参数');
        process.exit(1);
      }

      messageId = await sendTextMessage(args.to, content);
      console.log(`✅ 发送成功: ${messageId}`);
    }

  } catch (err) {
    console.error(`❌ 发送失败: ${err}`);
    process.exit(1);
  }
}

main();
