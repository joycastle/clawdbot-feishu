#!/usr/bin/env npx tsx
/**
 * 每周体重统计报告（带图表）
 * 每周一、三、五发送
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { generateWeightChartUrl, generateGoalProgressUrl } from './chart-generator.js';

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

// 加载数据
const DATA_FILE = path.join(__dirname, 'data.json');

interface Member {
  id: string;
  name: string;
  targetWeight?: number;
  joinedAt: string;
}

interface WeightRecord {
  userId: string;
  weight: number;
  date: string;
  timestamp: number;
}

interface Data {
  groupId: string;
  members: Record<string, Member>;
  weightRecords: WeightRecord[];
}

function loadData(): Data {
  const content = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(content);
}

function getToday(): string {
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return beijing.toISOString().split('T')[0];
}

function generateReport(): string {
  const data = loadData();
  const today = getToday();
  
  let report = `⚖️ **体重统计日** (${today})\n\n`;
  
  if (Object.keys(data.members).length === 0) {
    report += '暂无成员，请先注册加入！\n';
    return report;
  }
  
  report += `📊 **各成员最新数据**\n`;
  
  for (const [userId, member] of Object.entries(data.members)) {
    const userRecords = data.weightRecords
      .filter(r => r.userId === userId)
      .sort((a, b) => b.timestamp - a.timestamp);
    
    report += `\n**${member.name}**\n`;
    
    if (userRecords.length === 0) {
      report += `• ⚠️ 暂无体重记录\n`;
    } else {
      const latest = userRecords[0];
      report += `• 最新体重: ${latest.weight}kg (${latest.date})\n`;
      
      if (userRecords.length >= 2) {
        const previous = userRecords[1];
        const change = latest.weight - previous.weight;
        const emoji = change > 0 ? '📈 +' : change < 0 ? '📉 ' : '➡️ ';
        report += `• 上次变化: ${emoji}${change.toFixed(1)}kg\n`;
      }
      
      if (member.targetWeight) {
        const diff = latest.weight - member.targetWeight;
        if (diff > 0) {
          report += `• 距目标: 还差 ${diff.toFixed(1)}kg\n`;
        } else if (diff < 0) {
          report += `• 🎉 已超目标 ${Math.abs(diff).toFixed(1)}kg！\n`;
        } else {
          report += `• 🎯 已达成目标！\n`;
        }
      }
    }
  }
  
  report += `\n💡 **今日提醒**：记得称重并 @我 报告体重哦！\n`;
  report += `格式：@王总 体重 XX.X`;
  
  return report;
}

async function sendToGroup(message: string, imageUrl?: string) {
  const data = loadData();
  const groupId = data.groupId;
  
  // 发送文字消息
  const textRes = await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: groupId,
      msg_type: 'text',
      content: JSON.stringify({ text: message }),
    },
  });
  
  if (textRes.code !== 0) {
    throw new Error(`Failed to send text: ${textRes.msg}`);
  }
  
  // 发送图表（作为图片链接）
  if (imageUrl) {
    const chartMsg = `📈 体重变化趋势图：${imageUrl}`;
    await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: groupId,
        msg_type: 'text',
        content: JSON.stringify({ text: chartMsg }),
      },
    });
  }
  
  console.log('Report sent successfully');
}

async function main() {
  const report = generateReport();
  console.log('Generated report:');
  console.log(report);
  
  const weightChartUrl = generateWeightChartUrl();
  console.log('\nWeight chart URL:', weightChartUrl);
  
  console.log('\nSending to group...');
  await sendToGroup(report, weightChartUrl);
}

main().catch(console.error);
