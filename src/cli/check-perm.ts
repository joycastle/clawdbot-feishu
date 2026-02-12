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

async function main() {
  // 检查表格元信息
  try {
    const res = await client.request({
      method: 'GET',
      url: `/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}`,
    });
    console.log('Sheet meta:', JSON.stringify(res, null, 2));
  } catch (e: any) {
    console.log('Sheet meta error:', JSON.stringify(e.response?.data, null, 2));
  }

  // 检查权限
  try {
    const res = await client.request({
      method: 'POST',
      url: `/open-apis/drive/v1/permissions/${spreadsheetToken}/members/batch_create`,
      params: { type: 'sheet' },
      data: { members: [] }, // 空请求，只是看能不能访问
    });
    console.log('Permission check:', JSON.stringify(res, null, 2));
  } catch (e: any) {
    console.log('Permission error:', JSON.stringify(e.response?.data, null, 2));
  }
}

main();
