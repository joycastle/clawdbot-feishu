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

const sheetToken = process.argv[2] || 'WClxsXjxMhwYVrtIKcMc9VpUnXb';
const sheetId = process.argv[3] || 'hqjeZo';
const range = process.argv[4] || 'A1:Z50';

async function main() {
  const fullRange = `${sheetId}!${range}`;
  
  const dataRes = await (client as any).request({
    method: 'GET', 
    url: `/open-apis/sheets/v2/spreadsheets/${sheetToken}/values/${fullRange}`,
  });
  
  if (dataRes.code !== 0) {
    console.error('Failed:', dataRes.msg);
    return;
  }
  
  const values = dataRes.data?.valueRange?.values || [];
  console.log(`总行数: ${values.length}`);
  
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (!row) continue;
    const formatted = row.map((c: any) => {
      if (c === null || c === undefined) return '';
      if (typeof c === 'object') {
        if (c.text) return c.text;
        return JSON.stringify(c);
      }
      return String(c);
    });
    console.log(`[${i+1}] ${formatted.join(' | ')}`);
  }
}

main().catch(console.error);
