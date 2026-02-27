#!/usr/bin/env npx tsx
/**
 * 每日运动打卡统计 - 发送到群
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

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

interface ExerciseRecord {
  userId: string;
  type: string;
  duration: number;
  calories?: number;
  date: string;
  timestamp: number;
}

interface Data {
  groupId: string;
  members: Record<string, Member>;
  exerciseRecords: ExerciseRecord[];
}

function loadData(): Data {
  const content = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(content);
}

function getToday(): string {
  // 使用北京时间
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return beijing.toISOString().split('T')[0];
}

function getWeekStart(): string {
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const dayOfWeek = beijing.getDay();
  const diff = beijing.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(beijing.setDate(diff));
  return monday.toISOString().split('T')[0];
}

function generateStats(): string {
  const data = loadData();
  const today = getToday();
  const weekStart = getWeekStart();
  
  const todayRecords = data.exerciseRecords.filter(r => r.date === today);
  const weekRecords = data.exerciseRecords.filter(r => r.date >= weekStart);
  
  const memberCount = Object.keys(data.members).length;
  
  if (memberCount === 0) {
    return '暂无成员，请先注册加入健身打卡！';
  }
  
  const checkedInToday = new Set(todayRecords.map(r => r.userId));
  const notCheckedIn = Object.values(data.members).filter(m => !checkedInToday.has(m.id));
  
  // 统计运动类型分布
  const typeStats: Record<string, number> = {};
  let totalDuration = 0;
  let totalCalories = 0;
  
  for (const record of todayRecords) {
    typeStats[record.type] = (typeStats[record.type] || 0) + 1;
    totalDuration += record.duration;
    if (record.calories) totalCalories += record.calories;
  }
  
  // 本周打卡排行（每人每天只算一次）
  const weeklyDays: Record<string, Set<string>> = {};
  for (const record of weekRecords) {
    if (!weeklyDays[record.userId]) weeklyDays[record.userId] = new Set();
    weeklyDays[record.userId].add(record.date);
  }
  
  const ranking = Object.entries(data.members)
    .map(([id, member]) => ({
      name: member.name,
      days: weeklyDays[id]?.size || 0
    }))
    .sort((a, b) => b.days - a.days);
  
  // 生成报告
  let report = `🏋️ 每日运动打卡统计 (${today})\n\n`;
  
  report += `📊 今日概览\n`;
  report += `• 打卡人数: ${checkedInToday.size}/${memberCount}\n`;
  report += `• 总运动时长: ${totalDuration}分钟\n`;
  if (totalCalories > 0) {
    report += `• 总消耗热量: ${totalCalories}卡路里\n`;
  }
  report += '\n';
  
  if (Object.keys(typeStats).length > 0) {
    report += `🏃 运动类型分布\n`;
    for (const [type, count] of Object.entries(typeStats).sort((a, b) => b[1] - a[1])) {
      report += `• ${type}: ${count}人次\n`;
    }
    report += '\n';
  }
  
  report += `🏆 本周打卡排行\n`;
  const medals = ['🥇', '🥈', '🥉'];
  ranking.slice(0, 10).forEach((r, i) => {
    const medal = i < 3 ? medals[i] : `${i + 1}.`;
    report += `${medal} ${r.name}: ${r.days}天\n`;
  });
  report += '\n';
  
  if (notCheckedIn.length > 0 && notCheckedIn.length <= 10) {
    report += `⚠️ 今日未打卡\n`;
    report += notCheckedIn.map(m => m.name).join('、');
    report += '\n\n';
  } else if (notCheckedIn.length > 10) {
    report += `⚠️ 今日未打卡: ${notCheckedIn.length}人\n\n`;
  }
  
  report += `💪 坚持运动，健康生活！`;
  
  return report;
}

async function sendToGroup(message: string) {
  const data = loadData();
  const groupId = data.groupId;
  
  const res = await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: groupId,
      msg_type: 'text',
      content: JSON.stringify({ text: message }),
    },
  });
  
  if (res.code !== 0) {
    throw new Error(`Failed to send message: ${res.msg}`);
  }
  
  console.log('Message sent successfully');
}

async function main() {
  const stats = generateStats();
  console.log('Generated stats:');
  console.log(stats);
  console.log('\nSending to group...');
  await sendToGroup(stats);
}

main().catch(console.error);
