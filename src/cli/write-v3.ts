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

const spreadsheetToken = 'Jg3XsjWRmhAwXjtThfScpWKunHg';
const sheetId = '3696d7';

const testData = [
  ['基础功能', 'ABTest分组', '1. 新注册玩家完成注册\n2. 进入游戏', 'A组关闭，B组开启', 'P0'],
];

async function main() {
  // 尝试 v3 写入 API - setStyles
  try {
    const res = await client.request({
      method: 'POST',  
      url: `/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values_prepend`,
      data: {
        valueRange: {
          range: `${sheetId}!A2:E2`,
          values: testData,
        },
      },
    });
    console.log('Prepend result:', JSON.stringify(res, null, 2));
  } catch (e: any) {
    console.log('Prepend error:', JSON.stringify(e.response?.data, null, 2));
  }

  // 尝试 batch update
  try {
    const res = await client.request({
      method: 'POST',
      url: `/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values_batch_update`,
      data: {
        valueRanges: [{
          range: `${sheetId}!A2:E2`,
          values: testData,
        }],
      },
    });
    console.log('Batch update result:', JSON.stringify(res, null, 2));
  } catch (e: any) {
    console.log('Batch update error:', JSON.stringify(e.response?.data, null, 2));
  }
}

main();
