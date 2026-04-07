import * as Lark from '@larksuiteoapi/node-sdk';
import * as fs from 'fs';
import * as path from 'path';

const configPath = path.join(process.env.HOME || '', '.openclaw', 'openclaw.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const feishuCfg = config.channels?.feishu;
const client = new Lark.Client({
  appId: feishuCfg.appId,
  appSecret: feishuCfg.appSecret,
  domain: Lark.Domain.Feishu,
});

const sheetToken = 'I9assCeeghegmXtXdgdcajPIn0e';
const sheetId = 'a4585c';

async function main() {
  // 读取前面的流失类型数据 (7-87行)
  const range1 = `${sheetId}!A7:X90`;
  const res1 = await (client as any).request({
    method: 'GET', 
    url: `/open-apis/sheets/v2/spreadsheets/${sheetToken}/values/${range1}`,
  });
  
  const values1 = res1.data?.valueRange?.values || [];
  
  // 关键关卡：2,3,4,8,16,32,42,60,70
  const targetLevels = [2, 3, 4, 8, 16, 32, 42, 60, 70];
  
  console.log('=== 关键关卡的四种流失类型分布 ===\n');
  console.log('关卡 | 玩家数 | level_start | level_end | merge_start | merge_end | 主要流失阶段');
  console.log('----|--------|-------------|-----------|-------------|-----------|-------------');
  
  for (const level of targetLevels) {
    const rowIdx = level; // 第7行是0关，第8行是1关，所以 level N 在第 7+N 行，即 values1[N]
    const row = values1[rowIdx];
    if (!row) continue;
    
    const levelName = row[0];
    const playerCount = row[1];
    const levelStart = row[11] || 0;  // L列
    const levelEnd = row[12] || 0;    // M列
    const mergeStart = row[13] || 0;  // N列
    const mergeEnd = row[14] || 0;    // O列
    
    const total = Number(levelStart) + Number(levelEnd) + Number(mergeStart) + Number(mergeEnd);
    const levelTotal = Number(levelStart) + Number(levelEnd);
    const mergeTotal = Number(mergeStart) + Number(mergeEnd);
    
    let mainStage = '';
    if (total > 0) {
      if (mergeTotal > levelTotal) {
        mainStage = `merge(${Math.round(mergeTotal/total*100)}%)`;
      } else {
        mainStage = `level(${Math.round(levelTotal/total*100)}%)`;
      }
    }
    
    console.log(`${levelName} | ${playerCount} | ${levelStart} | ${levelEnd} | ${mergeStart} | ${mergeEnd} | ${mainStage}`);
  }
}

main().catch(console.error);
