#!/usr/bin/env npx tsx
import { readFileSync, createReadStream } from 'fs';
import * as lark from '@larksuiteoapi/node-sdk';
import { getConfigPath } from '../utils/paths.js';
import path from 'path';

const filePath = process.argv[2];
const target = process.argv[3]; // user:ou_xxx or chat:oc_xxx

if (!filePath || !target) {
  console.error('Usage: npx tsx src/cli/send-file.ts <file-path> <user:ou_xxx|chat:oc_xxx>');
  process.exit(1);
}

// 读取配置
const configPath = getConfigPath();
const configText = readFileSync(configPath, 'utf-8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const config = JSON.parse(configText);
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

async function main() {
  const fileName = path.basename(filePath);
  
  // 1. 上传文件
  console.log(`Uploading ${fileName}...`);
  const fileStream = createReadStream(filePath);
  
  const uploadRes = await client.im.file.create({
    data: {
      file_type: 'stream',
      file_name: fileName,
      file: fileStream as any,
    },
  });
  
  const fileKey = (uploadRes as any).file_key || (uploadRes as any).data?.file_key;
  if (!fileKey) {
    console.error('Failed to upload file:', uploadRes);
    process.exit(1);
  }
  console.log('File uploaded:', fileKey);
  
  // 2. 解析目标
  const [type, id] = target.split(':');
  const receiveIdType = type === 'user' ? 'open_id' : 'chat_id';
  
  // 3. 发送文件消息
  console.log(`Sending to ${target}...`);
  const sendRes = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: id,
      msg_type: 'file',
      content: JSON.stringify({ file_key: fileKey }),
    },
  });
  
  if ((sendRes as any).code !== 0) {
    console.error('Failed to send file:', sendRes);
    process.exit(1);
  }
  
  console.log('File sent! messageId:', (sendRes as any).data?.message_id);
}

main().catch(console.error);
