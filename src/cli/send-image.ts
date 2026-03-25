#!/usr/bin/env npx tsx
import { readFileSync } from 'fs';
import * as lark from '@larksuiteoapi/node-sdk';
import { Readable } from 'stream';
import { getConfigPath } from '../utils/paths.js';

const imagePath = process.argv[2];
const chatId = process.argv[3];

if (!imagePath || !chatId) {
  console.error('Usage: npx tsx src/cli/send-image.ts <image-path> <chat-id>');
  process.exit(1);
}

// 读取配置
const configPath = getConfigPath();
const configText = readFileSync(configPath, 'utf-8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const config = JSON.parse(configText);
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

async function main() {
  // 1. 上传图片
  const imageBuffer = readFileSync(imagePath);
  const imageStream = Readable.from(imageBuffer);
  
  const uploadRes = await client.im.image.create({
    data: {
      image_type: 'message',
      image: imageStream as any,
    },
  });
  
  const imageKey = (uploadRes as any).image_key || (uploadRes as any).data?.image_key;
  if (!imageKey) {
    console.error('Failed to upload image:', uploadRes);
    process.exit(1);
  }
  console.log('Image uploaded:', imageKey);
  
  // 2. 发送图片消息
  const sendRes = await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
      msg_type: 'image',
      content: JSON.stringify({ image_key: imageKey }),
    },
  });
  
  if ((sendRes as any).code !== 0) {
    console.error('Failed to send image:', sendRes);
    process.exit(1);
  }
  console.log('Image sent successfully!');
}

main().catch(console.error);
