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

const sheetToken = 'I9assCeeghegmXtXdgdcajPIn0e';
const sheetId = 'a4585c';

async function main() {
  const range = `${sheetId}!A1:X90`;
  
  const dataRes = await (client as any).request({
    method: 'GET', 
    url: `/open-apis/sheets/v2/spreadsheets/${sheetToken}/values/${range}`,
  });
  
  if (dataRes.code !== 0) {
    console.error('Failed:', dataRes.msg);
    return;
  }
  
  const values = dataRes.data?.valueRange?.values || [];
  console.log(`总行数: ${values.length}`);
  
  // 32关=39行, 42关=49行, 60关=67行, 70关=77行 (第7行是0关)
  const targetRows = [38, 39, 40, 48, 49, 50, 66, 67, 68, 76, 77, 78];
  
  for (const rowIdx of targetRows) {
    if (rowIdx > values.length) {
      console.log(`[${rowIdx}] 无数据`);
      continue;
    }
    const row = values[rowIdx - 1];
    if (!row) {
      console.log(`[${rowIdx}] 空行`);
      continue;
    }
    const formatted = row.slice(0, 24).map((c: any) => {
      if (c === null || c === undefined) return '';
      if (typeof c === 'object') {
        if (c.text) return c.text;
        return JSON.stringify(c);
      }
      return String(c);
    });
    console.log(`[${rowIdx}] ${formatted.join(' | ')}`);
  }
}

main().catch(console.error);
