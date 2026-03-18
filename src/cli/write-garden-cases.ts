#!/usr/bin/env npx tsx
/**
 * 写入花园玩法补充用例
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import * as fs from 'fs';
import * as path from 'path';

const configPath = path.join(process.env.HOME || '', '.clawdbot', 'clawdbot.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const feishuCfg = config.channels?.feishu;

const client = new Lark.Client({
  appId: feishuCfg.appId,
  appSecret: feishuCfg.appSecret,
  domain: Lark.Domain.Feishu,
});

// wiki token (会自动对应到spreadsheet)
const sheetToken = 'UPgawNje8ibXfKkAQftcQknjnSg';
const sheetId = '5xCJdO'; // 玩法和小游戏工作表

// 补充用例数据
const testCases: string[][] = [
  // 房间规则
  ['房间规则', '震动反馈', '戳洞时检查设备震动', '有震动反馈', ''],
  ['', '', '关闭系统震动后戳洞', '无震动', ''],
  ['', '评价弹版', '完成一局后查看', '弹出评价弹版', '需确认触发条件'],
  ['', '开局说明动画', '首次进入房间开始游戏', '播放bingo说明动画', ''],
  ['', '', '非首次进入房间', '不播放说明动画', ''],
  
  // 玩法FAQ
  ['玩法FAQ', 'FAQ入口', '点击FAQ按钮', '打开FAQ界面', ''],
  ['', 'FAQ内容', '查看FAQ文案', '显示：戳洞发现花种子，使对应花朵升级，待花圃内所有花朵开花获得一个bingo', ''],
  ['', '', '', '显示：花仙子将会用魔法花朵升级', ''],
  ['', '', '', '显示：小兔子将会帮助你戳格子', ''],
  ['', 'FAQ动画', '查看FAQ动画流程', '播放玩法演示动画', ''],
  
  // 花仙子边界
  ['花仙子边界', '加进度数量-1朵', '戳出花仙子，配置权重为只给1朵花', '仅1朵花升1级，花仙子飞1个光束', ''],
  ['', '加进度数量-2朵', '戳出花仙子，配置权重为给2朵花', '2朵花各升1级，花仙子飞2个光束', ''],
  ['', '触发bingo', '某花已4/5进度，花仙子给该花+1', '该花bingo，播放bingo动画', ''],
  ['', '触发bingo+收集物已戳出', '某花4/5，花仙子+1触发bingo，该花收集物已戳出', '花仙子先触发bingo，收集物正常飞过去（不再加进度）', '需求明确提到'],
  ['', '已满花处理', '某花已bingo，花仙子触发', '跳过已bingo的花，只作用未满的花', ''],
  ['', '只剩1种未满', '只剩1种花未满，花仙子权重为2', '只给这1种花加1级进度', '边界情况'],
  ['', '全部已满', '4种花全部已bingo，花仙子触发', '花仙子动画播放但无实际效果', '边界情况'],
  
  // 小兔子边界
  ['小兔子边界', '帮戳1格', '戳出小兔子，配置权重为帮戳1格', '蛋砸到1个格子碎掉', ''],
  ['', '帮戳2格', '戳出小兔子，配置权重为帮戳2格', '蛋砸第1格，反弹砸第2格碎掉', ''],
  ['', '帮戳触发收集物', '小兔子帮戳的格子有收集物', '正常触发收集流程', ''],
  ['', '帮戳触发花仙子', '小兔子帮戳的格子有花仙子', '先播小兔子帮戳动画，再触发花仙子流程', ''],
  
  // 多bingo
  ['多bingo', '同时2个bingo', '一次戳格子使2种花同时集满', '依次播放2个bingo动画', ''],
  ['', '花仙子触发2个bingo', '花仙子给2朵花加进度，2朵都刚好满', '依次播放2个bingo动画', ''],
  ['', '全部4个bingo', '4种花全部收集满', '播放最终完成动画/特效', '需确认是否有特殊表现'],
  
  // 配置验证
  ['配置验证', '收集物埋入数量', '检查每种花收集物埋入数量', '固定5个，不读取配置', '⚠️与现有用例[17][19]矛盾需澄清'],
  ['', 'bingo所需数量', '检查bingo所需收集数量', '固定5个', ''],
];

async function main() {
  // 从51行开始追加（现有数据到50行）
  const startRow = 51;
  const endRow = startRow + testCases.length - 1;
  const range = `${sheetId}!A${startRow}:E${endRow}`;
  
  console.log(`Writing ${testCases.length} test cases to ${range}...`);
  
  const res = await (client as any).request({
    method: 'PUT',
    url: `/open-apis/sheets/v2/spreadsheets/${sheetToken}/values`,
    data: {
      valueRange: {
        range,
        values: testCases,
      },
    },
  });
  
  if (res.code !== 0) {
    console.error('Write failed:', res);
    return;
  }
  
  console.log('✅ Write success!');
  console.log('Result:', JSON.stringify(res.data, null, 2));
}

main().catch(console.error);
