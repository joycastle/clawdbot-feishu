#!/usr/bin/env npx tsx
/**
 * 健身打卡系统 CLI
 * 
 * 命令:
 *   register <userId> <name> [targetWeight]  - 注册成员
 *   weight <userId> <weight>                 - 记录体重
 *   exercise <userId> <type> <duration> [calories] - 记录运动
 *   stats                                    - 生成今日统计
 *   weekly                                   - 生成本周体重统计
 *   members                                  - 列出所有成员
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'data.json');

interface Member {
  id: string;
  name: string;
  targetWeight?: number;
  height?: number;      // 身高 cm
  age?: number;         // 年龄
  gender?: 'male' | 'female';  // 性别
  joinedAt: string;
}

interface WeightRecord {
  userId: string;
  weight: number;
  date: string;
  timestamp: number;
}

interface ExerciseRecord {
  userId: string;
  type: string;
  duration: number; // 分钟
  calories?: number;
  date: string;
  timestamp: number;
}

interface Data {
  groupId: string;
  members: Record<string, Member>;
  weightRecords: WeightRecord[];
  exerciseRecords: ExerciseRecord[];
  settings: {
    weightDays: string[];
    dailyReportTime: string;
    timezone: string;
  };
}

function loadData(): Data {
  const content = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(content);
}

function saveData(data: Data): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

function getWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split('T')[0];
}

// 注册成员
function register(userId: string, name: string, targetWeight?: number): string {
  const data = loadData();
  
  if (data.members[userId]) {
    return `❌ 成员 ${name} 已存在`;
  }
  
  data.members[userId] = {
    id: userId,
    name,
    targetWeight,
    joinedAt: getToday()
  };
  
  saveData(data);
  return `✅ 成员 ${name} 注册成功${targetWeight ? `，目标体重: ${targetWeight}kg` : ''}`;
}

// 记录体重
function recordWeight(userId: string, weight: number): string {
  const data = loadData();
  const member = data.members[userId];
  
  if (!member) {
    return `❌ 成员不存在，请先注册`;
  }
  
  const today = getToday();
  
  // 检查今天是否已记录
  const todayRecord = data.weightRecords.find(
    r => r.userId === userId && r.date === today
  );
  
  if (todayRecord) {
    todayRecord.weight = weight;
    todayRecord.timestamp = Date.now();
  } else {
    data.weightRecords.push({
      userId,
      weight,
      date: today,
      timestamp: Date.now()
    });
  }
  
  saveData(data);
  
  let msg = `✅ ${member.name} 体重记录成功: ${weight}kg`;
  
  if (member.targetWeight) {
    const diff = weight - member.targetWeight;
    if (diff > 0) {
      msg += `\n📊 距目标还差: ${diff.toFixed(1)}kg`;
    } else if (diff < 0) {
      msg += `\n🎉 已超过目标: ${Math.abs(diff).toFixed(1)}kg`;
    } else {
      msg += `\n🎯 达到目标体重！`;
    }
  }
  
  return msg;
}

// 记录运动
function recordExercise(userId: string, type: string, duration: number, calories?: number): string {
  const data = loadData();
  const member = data.members[userId];
  
  if (!member) {
    return `❌ 成员不存在，请先注册`;
  }
  
  data.exerciseRecords.push({
    userId,
    type,
    duration,
    calories,
    date: getToday(),
    timestamp: Date.now()
  });
  
  saveData(data);
  
  let msg = `✅ ${member.name} 运动打卡成功!\n`;
  msg += `🏃 运动类型: ${type}\n`;
  msg += `⏱️ 时长: ${duration}分钟`;
  if (calories) {
    msg += `\n🔥 消耗: ${calories}卡路里`;
  }
  
  return msg;
}

// 生成今日运动统计
function generateDailyStats(): string {
  const data = loadData();
  const today = getToday();
  const weekStart = getWeekStart();
  
  const todayRecords = data.exerciseRecords.filter(r => r.date === today);
  const weekRecords = data.exerciseRecords.filter(r => r.date >= weekStart);
  
  const memberCount = Object.keys(data.members).length;
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
  
  // 本周打卡排行
  const weeklyCount: Record<string, number> = {};
  for (const record of weekRecords) {
    const date = record.date;
    if (!weeklyCount[record.userId]) weeklyCount[record.userId] = 0;
    // 每天只算一次
    const userDayKey = `${record.userId}_${date}`;
    if (!weeklyCount[userDayKey]) {
      weeklyCount[record.userId]++;
      weeklyCount[userDayKey] = 1;
    }
  }
  
  const ranking = Object.entries(data.members)
    .map(([id, member]) => ({
      name: member.name,
      days: weeklyCount[id] || 0
    }))
    .sort((a, b) => b.days - a.days);
  
  // 生成报告
  let report = `🏋️ **每日运动打卡统计** (${today})\n\n`;
  
  report += `📊 **今日概览**\n`;
  report += `• 打卡人数: ${checkedInToday.size}/${memberCount}\n`;
  report += `• 总运动时长: ${totalDuration}分钟\n`;
  if (totalCalories > 0) {
    report += `• 总消耗热量: ${totalCalories}卡路里\n`;
  }
  report += '\n';
  
  if (Object.keys(typeStats).length > 0) {
    report += `🏃 **运动类型分布**\n`;
    for (const [type, count] of Object.entries(typeStats).sort((a, b) => b[1] - a[1])) {
      report += `• ${type}: ${count}人次\n`;
    }
    report += '\n';
  }
  
  report += `🏆 **本周打卡排行**\n`;
  const medals = ['🥇', '🥈', '🥉'];
  ranking.forEach((r, i) => {
    const medal = i < 3 ? medals[i] : `${i + 1}.`;
    report += `${medal} ${r.name}: ${r.days}天\n`;
  });
  report += '\n';
  
  if (notCheckedIn.length > 0) {
    report += `⚠️ **今日未打卡**\n`;
    report += notCheckedIn.map(m => m.name).join('、');
    report += '\n';
  }
  
  report += `\n💪 坚持运动，健康生活！`;
  
  return report;
}

// 生成体重周报
function generateWeeklyWeightStats(): string {
  const data = loadData();
  const weekStart = getWeekStart();
  
  const weekRecords = data.weightRecords.filter(r => r.date >= weekStart);
  
  let report = `⚖️ **本周体重统计** (${weekStart} 至今)\n\n`;
  
  if (weekRecords.length === 0) {
    report += `暂无体重记录\n`;
    return report;
  }
  
  // 按成员分组
  const memberRecords: Record<string, WeightRecord[]> = {};
  for (const record of weekRecords) {
    if (!memberRecords[record.userId]) memberRecords[record.userId] = [];
    memberRecords[record.userId].push(record);
  }
  
  for (const [userId, records] of Object.entries(memberRecords)) {
    const member = data.members[userId];
    if (!member) continue;
    
    const sorted = records.sort((a, b) => a.timestamp - b.timestamp);
    const latest = sorted[sorted.length - 1];
    const first = sorted[0];
    const change = latest.weight - first.weight;
    
    report += `**${member.name}**\n`;
    report += `• 最新体重: ${latest.weight}kg\n`;
    
    if (sorted.length > 1) {
      const changeStr = change > 0 ? `+${change.toFixed(1)}` : change.toFixed(1);
      const emoji = change > 0 ? '📈' : change < 0 ? '📉' : '➡️';
      report += `• 本周变化: ${emoji} ${changeStr}kg\n`;
    }
    
    if (member.targetWeight) {
      const diff = latest.weight - member.targetWeight;
      report += `• 目标体重: ${member.targetWeight}kg`;
      if (diff > 0) {
        report += ` (还差${diff.toFixed(1)}kg)`;
      } else if (diff < 0) {
        report += ` (已超${Math.abs(diff).toFixed(1)}kg 🎉)`;
      } else {
        report += ` (已达成 🎯)`;
      }
      report += '\n';
    }
    report += '\n';
  }
  
  return report;
}

// 计算基础代谢率 (BMR) - Mifflin-St Jeor 公式
function calculateBMR(weight: number, height: number, age: number, gender: 'male' | 'female'): number {
  if (gender === 'male') {
    return Math.round(10 * weight + 6.25 * height - 5 * age + 5);
  } else {
    return Math.round(10 * weight + 6.25 * height - 5 * age - 161);
  }
}

// 更新成员信息（身高、年龄、性别）
function updateMember(userId: string, height: number, age: number, gender: 'male' | 'female'): string {
  const data = loadData();
  const member = data.members[userId];
  
  if (!member) {
    return `❌ 成员不存在`;
  }
  
  member.height = height;
  member.age = age;
  member.gender = gender;
  
  saveData(data);
  
  // 获取最新体重计算BMR
  const userRecords = data.weightRecords
    .filter(r => r.userId === userId)
    .sort((a, b) => b.timestamp - a.timestamp);
  
  let msg = `✅ ${member.name} 信息已更新\n`;
  msg += `📏 身高: ${height}cm\n`;
  msg += `🎂 年龄: ${age}岁\n`;
  msg += `${gender === 'male' ? '👨' : '👩'} 性别: ${gender === 'male' ? '男' : '女'}\n`;
  
  if (userRecords.length > 0) {
    const weight = userRecords[0].weight;
    const bmr = calculateBMR(weight, height, age, gender);
    msg += `\n🔥 基础代谢率: ${bmr} 卡/天`;
  }
  
  return msg;
}

// 列出成员（带基础代谢）
function listMembers(): string {
  const data = loadData();
  const members = Object.values(data.members);
  
  if (members.length === 0) {
    return '暂无成员';
  }
  
  let msg = `👥 **成员列表** (共${members.length}人)\n\n`;
  
  for (const member of members) {
    msg += `**${member.name}**\n`;
    
    // 获取最新体重
    const userRecords = data.weightRecords
      .filter(r => r.userId === member.id)
      .sort((a, b) => b.timestamp - a.timestamp);
    
    if (userRecords.length > 0) {
      msg += `• 体重: ${userRecords[0].weight}kg`;
      if (member.targetWeight) {
        msg += ` → 目标: ${member.targetWeight}kg`;
      }
      msg += '\n';
    }
    
    if (member.height && member.age && member.gender) {
      msg += `• 身高: ${member.height}cm | 年龄: ${member.age}岁\n`;
      if (userRecords.length > 0) {
        const bmr = calculateBMR(userRecords[0].weight, member.height, member.age, member.gender);
        msg += `• 🔥 基础代谢: ${bmr} 卡/天\n`;
      }
    }
    msg += '\n';
  }
  
  return msg;
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'register': {
      const [, userId, name, targetWeight] = args;
      if (!userId || !name) {
        console.error('Usage: register <userId> <name> [targetWeight]');
        process.exit(1);
      }
      console.log(register(userId, name, targetWeight ? parseFloat(targetWeight) : undefined));
      break;
    }
    
    case 'weight': {
      const [, userId, weight] = args;
      if (!userId || !weight) {
        console.error('Usage: weight <userId> <weight>');
        process.exit(1);
      }
      console.log(recordWeight(userId, parseFloat(weight)));
      break;
    }
    
    case 'exercise': {
      const [, userId, type, duration, calories] = args;
      if (!userId || !type || !duration) {
        console.error('Usage: exercise <userId> <type> <duration> [calories]');
        process.exit(1);
      }
      console.log(recordExercise(userId, type, parseInt(duration), calories ? parseInt(calories) : undefined));
      break;
    }
    
    case 'stats':
      console.log(generateDailyStats());
      break;
    
    case 'weekly':
      console.log(generateWeeklyWeightStats());
      break;
    
    case 'members':
      console.log(listMembers());
      break;
    
    case 'update': {
      const [, userId, height, age, gender] = args;
      if (!userId || !height || !age || !gender) {
        console.error('Usage: update <userId> <height> <age> <male|female>');
        process.exit(1);
      }
      const g = gender.toLowerCase() === 'male' || gender === '男' ? 'male' : 'female';
      console.log(updateMember(userId, parseInt(height), parseInt(age), g));
      break;
    }
    
    default:
      console.log(`
健身打卡系统 CLI

命令:
  register <userId> <name> [targetWeight]     - 注册成员
  update <userId> <height> <age> <male|female> - 更新身高/年龄/性别
  weight <userId> <weight>                    - 记录体重
  exercise <userId> <type> <duration> [cal]   - 记录运动
  stats                                       - 生成今日统计
  weekly                                      - 生成本周体重统计
  members                                     - 列出所有成员
      `);
  }
}

main().catch(console.error);
