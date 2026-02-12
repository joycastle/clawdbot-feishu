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

// 只写2行测试
const testData = [
  ['基础功能', 'ABTest分组', '1. 新注册玩家完成注册\n2. 进入游戏', 'A组关闭，B组开启', 'P0'],
  ['基础功能', '分组持久性', '1. 已分组玩家登录\n2. 重新登录', '分组保持不变', 'P0'],
];

async function main() {
  // 尝试用原始 request
  try {
    const res = await client.request({
      method: 'PUT',
      url: `/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values`,
      data: {
        valueRange: {
          range: `${sheetId}!A2:E3`,
          values: testData,
        },
      },
    });
    console.log('Result:', JSON.stringify(res, null, 2));
  } catch (e: any) {
    console.log('Error response:', JSON.stringify(e.response?.data, null, 2));
    console.log('Error message:', e.message);
  }
}

main();
