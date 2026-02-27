#!/usr/bin/env npx tsx
/**
 * 发送图表图片到飞书群
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { generateWeightChartUrl, generateGoalProgressUrl, generateExerciseChartUrl } from './chart-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载配置
const configPath = path.join(process.env.HOME || '', '.clawdbot', 'clawdbot.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const feishuCfg = config.channels?.feishu;

if (!feishuCfg?.appId || !feishuCfg?.appSecret) {
  console.error('Failed to load Feishu credentials');
  process.exit(1);
}

const client = new Lark.Client({
  appId: feishuCfg.appId,
  appSecret: feishuCfg.appSecret,
  domain: Lark.Domain.Feishu,
});

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  const content = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(content);
}

async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function uploadImage(imageBuffer: Buffer): Promise<string> {
  // SDK expects a Readable stream, not a Buffer
  const imageStream = Readable.from(imageBuffer);
  
  const response = await client.im.image.create({
    data: {
      image_type: 'message',
      image: imageStream as any,
    },
  });
  
  const responseAny = response as any;
  if (responseAny.code !== undefined && responseAny.code !== 0) {
    throw new Error(`Feishu image upload failed: ${responseAny.msg || `code ${responseAny.code}`}`);
  }
  
  const imageKey = responseAny.image_key ?? responseAny.data?.image_key;
  if (!imageKey) {
    throw new Error('Feishu image upload failed: no image_key returned');
  }
  
  return imageKey;
}

async function sendImageToGroup(imageKey: string, groupId: string) {
  const res = await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: groupId,
      msg_type: 'image',
      content: JSON.stringify({ image_key: imageKey }),
    },
  });
  
  if (res.code !== 0) {
    throw new Error(`Failed to send image: ${res.msg}`);
  }
  
  console.log('Image sent successfully');
  return res;
}

async function sendChart(chartType: 'weight' | 'exercise' | 'progress') {
  const data = loadData();
  const groupId = data.groupId;
  
  let chartUrl: string;
  switch (chartType) {
    case 'weight':
      chartUrl = generateWeightChartUrl();
      break;
    case 'exercise':
      chartUrl = generateExerciseChartUrl();
      break;
    case 'progress':
      chartUrl = generateGoalProgressUrl();
      break;
  }
  
  console.log(`Downloading chart from: ${chartUrl.substring(0, 100)}...`);
  const imageBuffer = await downloadImage(chartUrl);
  
  console.log(`Uploading image (${imageBuffer.length} bytes)...`);
  const imageKey = await uploadImage(imageBuffer);
  console.log(`Image key: ${imageKey}`);
  
  console.log('Sending to group...');
  await sendImageToGroup(imageKey, groupId);
}

async function main() {
  const chartType = process.argv[2] as 'weight' | 'exercise' | 'progress' || 'weight';
  await sendChart(chartType);
}

main().catch(console.error);
