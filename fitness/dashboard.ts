#!/usr/bin/env npx tsx
/**
 * 健身仪表盘 - 两张图拼接版
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.join(process.env.HOME || '', '.clawdbot', 'clawdbot.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const feishuCfg = config.channels?.feishu;

const client = new Lark.Client({
  appId: feishuCfg.appId,
  appSecret: feishuCfg.appSecret,
  domain: Lark.Domain.Feishu,
});

const DATA_FILE = path.join(__dirname, 'data.json');

interface Member { id: string; name: string; targetWeight?: number; joinedAt: string; }
interface WeightRecord { userId: string; weight: number; date: string; timestamp: number; }
interface ExerciseRecord { userId: string; type: string; duration: number; calories?: number; date: string; timestamp: number; }
interface Data { groupId: string; members: Record<string, Member>; weightRecords: WeightRecord[]; exerciseRecords: ExerciseRecord[]; }

function loadData(): Data {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function getToday(): string {
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return beijing.toISOString().split('T')[0];
}

// 生成体重趋势图配置
function getWeightChartConfig(): any {
  const data = loadData();
  const allDates = [...new Set(data.weightRecords.map(r => r.date))].sort();
  if (allDates.length === 0) allDates.push(getToday());
  
  const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0'];
  const datasets: any[] = [];
  
  // 计算进度
  const progress: string[] = [];
  
  Object.entries(data.members).forEach(([userId, member], index) => {
    const color = colors[index % colors.length];
    const userRecords = data.weightRecords.filter(r => r.userId === userId).sort((a, b) => a.timestamp - b.timestamp);
    
    const weights = allDates.map(date => userRecords.find(r => r.date === date)?.weight ?? null);
    
    datasets.push({
      label: member.name,
      data: weights,
      borderColor: color,
      backgroundColor: color,
      fill: false,
      tension: 0.3,
    });
    
    if (member.targetWeight) {
      datasets.push({
        label: `${member.name}目标`,
        data: allDates.map(() => member.targetWeight),
        borderColor: color,
        borderDash: [5, 5],
        pointRadius: 0,
        fill: false,
      });
      
      if (userRecords.length > 0) {
        const start = userRecords[0].weight;
        const curr = userRecords[userRecords.length - 1].weight;
        const target = member.targetWeight;
        const pct = start > target ? Math.round(((start - curr) / (start - target)) * 100) : 0;
        progress.push(`${member.name}: ${curr}→${target}kg (${Math.max(0, pct)}%)`);
      }
    }
  });
  
  return {
    type: 'line',
    data: { labels: allDates.map(d => d.slice(5)), datasets },
    options: {
      plugins: {
        title: { display: true, text: ['⚖️ 体重趋势', progress.join(' | ') || '暂无数据'], font: { size: 14 } },
        legend: { position: 'bottom', labels: { boxWidth: 12 } },
      },
      scales: { y: { title: { display: true, text: '体重(kg)' } } },
    },
  };
}

// 生成运动打卡图配置（只显示时长）
function getExerciseChartConfig(): any {
  const data = loadData();
  const allDates = [...new Set(data.exerciseRecords.map(r => r.date))].sort();
  if (allDates.length === 0) allDates.push(getToday());
  
  const colors = ['#4BC0C0', '#FF9F40', '#9966FF', '#FF6384'];
  const datasets: any[] = [];
  
  // 每人的运动时长
  Object.entries(data.members).forEach(([userId, member], index) => {
    const color = colors[index % colors.length];
    const durations = allDates.map(date => {
      const dayRecords = data.exerciseRecords.filter(r => r.userId === userId && r.date === date);
      return dayRecords.reduce((sum, r) => sum + r.duration, 0);
    });
    
    datasets.push({
      label: member.name,
      data: durations,
      backgroundColor: color + '80',
      borderColor: color,
      borderWidth: 1,
    });
  });
  
  // 如果没有数据，显示占位
  if (datasets.length === 0 || datasets.every(d => d.data.every((v: number) => v === 0))) {
    datasets.length = 0;
    datasets.push({
      label: '暂无打卡',
      data: [0],
      backgroundColor: '#E0E0E080',
    });
  }
  
  return {
    type: 'bar',
    data: { labels: allDates.map(d => d.slice(5)), datasets },
    options: {
      plugins: {
        title: { display: true, text: '🏃 每日运动时长', font: { size: 14 } },
        legend: { position: 'bottom', labels: { boxWidth: 12 } },
      },
      scales: {
        y: { title: { display: true, text: '时长(分钟)' }, beginAtZero: true },
      },
    },
  };
}

async function downloadChart(chartConfig: any, width: number, height: number): Promise<Buffer> {
  const response = await fetch('https://quickchart.io/chart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chart: chartConfig, width, height, backgroundColor: 'white' }),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return buffer;
  throw new Error(`Chart error: ${buffer.toString().substring(0, 200)}`);
}

async function uploadImage(imageBuffer: Buffer): Promise<string> {
  const response = await client.im.image.create({
    data: { image_type: 'message', image: Readable.from(imageBuffer) as any },
  });
  const key = (response as any).image_key ?? (response as any).data?.image_key;
  if (!key) throw new Error('No image_key');
  return key;
}

async function sendImage(imageKey: string, groupId: string) {
  await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: { receive_id: groupId, msg_type: 'image', content: JSON.stringify({ image_key: imageKey }) },
  });
}

async function main() {
  const data = loadData();
  
  console.log('Generating weight chart...');
  const weightConfig = getWeightChartConfig();
  const weightImg = await downloadChart(weightConfig, 700, 350);
  console.log(`Weight chart: ${weightImg.length} bytes`);
  
  console.log('Generating exercise chart...');
  const exerciseConfig = getExerciseChartConfig();
  const exerciseImg = await downloadChart(exerciseConfig, 700, 300);
  console.log(`Exercise chart: ${exerciseImg.length} bytes`);
  
  // 上传并发送两张图
  console.log('Uploading and sending...');
  const key1 = await uploadImage(weightImg);
  await sendImage(key1, data.groupId);
  
  const key2 = await uploadImage(exerciseImg);
  await sendImage(key2, data.groupId);
  
  console.log('Done!');
}

main().catch(console.error);
