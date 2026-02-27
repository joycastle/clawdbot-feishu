#!/usr/bin/env npx tsx
/**
 * 健身数据图表生成器
 * 使用 QuickChart API 生成图表
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
  duration: number;
  calories?: number;
  date: string;
  timestamp: number;
}

interface Data {
  groupId: string;
  members: Record<string, Member>;
  weightRecords: WeightRecord[];
  exerciseRecords: ExerciseRecord[];
}

function loadData(): Data {
  const content = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(content);
}

// 生成体重趋势图 URL
export function generateWeightChartUrl(): string {
  const data = loadData();
  
  // 按成员分组体重记录
  const memberWeights: Record<string, { dates: string[]; weights: number[] }> = {};
  
  for (const record of data.weightRecords.sort((a, b) => a.timestamp - b.timestamp)) {
    const member = data.members[record.userId];
    if (!member) continue;
    
    if (!memberWeights[member.name]) {
      memberWeights[member.name] = { dates: [], weights: [] };
    }
    
    memberWeights[member.name].dates.push(record.date.slice(5)); // MM-DD
    memberWeights[member.name].weights.push(record.weight);
  }
  
  // 获取所有日期标签
  const allDates = [...new Set(data.weightRecords.map(r => r.date.slice(5)))].sort();
  
  // 构建数据集
  const datasets = Object.entries(memberWeights).map(([name, data], index) => {
    const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'];
    const color = colors[index % colors.length];
    
    return {
      label: name,
      data: data.weights,
      borderColor: color,
      backgroundColor: color + '40',
      fill: false,
      tension: 0.3,
    };
  });
  
  const chartConfig = {
    type: 'line',
    data: {
      labels: allDates.length > 0 ? allDates : ['暂无数据'],
      datasets: datasets.length > 0 ? datasets : [{
        label: '暂无数据',
        data: [0],
        borderColor: '#ccc',
      }],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: '体重变化趋势',
          font: { size: 18 },
        },
        legend: {
          position: 'bottom',
        },
      },
      scales: {
        y: {
          title: {
            display: true,
            text: '体重 (kg)',
          },
        },
        x: {
          title: {
            display: true,
            text: '日期',
          },
        },
      },
    },
  };
  
  const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=600&h=400&bkg=white`;
  return chartUrl;
}

// 生成运动打卡趋势图 URL
export function generateExerciseChartUrl(): string {
  const data = loadData();
  
  // 按日期统计打卡人数
  const dailyCount: Record<string, number> = {};
  const processedUserDays = new Set<string>();
  
  for (const record of data.exerciseRecords) {
    const key = `${record.userId}_${record.date}`;
    if (!processedUserDays.has(key)) {
      processedUserDays.add(key);
      dailyCount[record.date] = (dailyCount[record.date] || 0) + 1;
    }
  }
  
  const sortedDates = Object.keys(dailyCount).sort();
  const counts = sortedDates.map(d => dailyCount[d]);
  
  const chartConfig = {
    type: 'bar',
    data: {
      labels: sortedDates.map(d => d.slice(5)), // MM-DD
      datasets: [{
        label: '打卡人数',
        data: counts.length > 0 ? counts : [0],
        backgroundColor: '#36A2EB',
        borderColor: '#2196F3',
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: '每日运动打卡人数',
          font: { size: 18 },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: '人数',
          },
          ticks: {
            stepSize: 1,
          },
        },
        x: {
          title: {
            display: true,
            text: '日期',
          },
        },
      },
    },
  };
  
  const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=600&h=400&bkg=white`;
  return chartUrl;
}

// 生成个人体重目标进度图
export function generateGoalProgressUrl(): string {
  const data = loadData();
  
  const progressData: { name: string; current: number; target: number; progress: number }[] = [];
  
  for (const [userId, member] of Object.entries(data.members)) {
    if (!member.targetWeight) continue;
    
    // 获取最新体重
    const userRecords = data.weightRecords
      .filter(r => r.userId === userId)
      .sort((a, b) => b.timestamp - a.timestamp);
    
    if (userRecords.length === 0) continue;
    
    const currentWeight = userRecords[0].weight;
    const startWeight = userRecords[userRecords.length - 1].weight;
    const targetWeight = member.targetWeight;
    
    // 计算进度百分比
    const totalToLose = startWeight - targetWeight;
    const alreadyLost = startWeight - currentWeight;
    const progress = totalToLose > 0 ? Math.min(100, Math.max(0, (alreadyLost / totalToLose) * 100)) : 0;
    
    progressData.push({
      name: member.name,
      current: currentWeight,
      target: targetWeight,
      progress: Math.round(progress),
    });
  }
  
  const chartConfig = {
    type: 'bar',
    data: {
      labels: progressData.map(p => p.name),
      datasets: [{
        label: '目标完成度 (%)',
        data: progressData.map(p => p.progress),
        backgroundColor: progressData.map(p => 
          p.progress >= 100 ? '#4CAF50' : 
          p.progress >= 50 ? '#FF9800' : '#FF5722'
        ),
        borderWidth: 1,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: '减重目标完成度',
          font: { size: 18 },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          max: 100,
          title: {
            display: true,
            text: '完成度 (%)',
          },
        },
      },
    },
  };
  
  const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=600&h=300&bkg=white`;
  return chartUrl;
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const chartType = args[0] || 'all';
  
  switch (chartType) {
    case 'weight':
      console.log('体重趋势图:');
      console.log(generateWeightChartUrl());
      break;
    case 'exercise':
      console.log('运动打卡图:');
      console.log(generateExerciseChartUrl());
      break;
    case 'progress':
      console.log('目标进度图:');
      console.log(generateGoalProgressUrl());
      break;
    case 'all':
    default:
      console.log('=== 体重趋势图 ===');
      console.log(generateWeightChartUrl());
      console.log('\n=== 运动打卡图 ===');
      console.log(generateExerciseChartUrl());
      console.log('\n=== 目标进度图 ===');
      console.log(generateGoalProgressUrl());
  }
}

main().catch(console.error);
