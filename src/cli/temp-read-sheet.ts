#!/usr/bin/env npx tsx
import * as Lark from '@larksuiteoapi/node-sdk';
import * as fs from 'fs';
import * as path from 'path';

// 加载配置
const configPath = path.join(process.env.HOME || '', '.openclaw', 'openclaw.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const feishuCfg = config.channels?.feishu;

if (!feishuCfg?.appId || !feishuCfg?.appSecret) {
  console.error('Failed to load Feishu credentials from channels.feishu');
  process.exit(1);
}

const client = new Lark.Client({
  appId: feishuCfg.appId,
  appSecret: feishuCfg.appSecret,
  domain: Lark.Domain.Feishu,
});

const sheetToken = process.argv[2] || 'IadvsL8nXhs3autyLWkcHVYinye';

async function main() {
  // 获取元信息
  console.log('Fetching spreadsheet info...');
  const metaRes = await (client as any).request({
    method: 'GET',
    url: `/open-apis/sheets/v2/spreadsheets/${sheetToken}/metainfo`,
  });
  
  if (metaRes.code !== 0) {
    console.error('Failed to get meta:', metaRes);
    return;
  }
  
  const meta = metaRes.data;
  console.log('\n=== 表格信息 ===');
  console.log('标题:', meta.properties?.title);
  console.log('工作表数量:', meta.properties?.sheetCount);
  
  // 读取每个 sheet 的数据
  const sheets = meta.sheets || [];
  for (const sheet of sheets) {
    console.log(`\n=== 工作表: ${sheet.title} ===`);
    const sheetId = sheet.sheetId;
    const range = `${sheetId}!A1:Z100`;
    
    const dataRes = await (client as any).request({
      method: 'GET', 
      url: `/open-apis/sheets/v2/spreadsheets/${sheetToken}/values/${range}`,
    });
    
    if (dataRes.code !== 0) {
      console.error('Failed to get data:', dataRes.msg);
      continue;
    }
    
    const values = dataRes.data?.valueRange?.values || [];
    console.log(`行数: ${values.length}`);
    
    // 打印数据
    for (let i = 0; i < Math.min(values.length, 50); i++) {
      const row = values[i];
      console.log(`[${i + 1}] ${row.map((c: any) => {
        if (c === null || c === undefined) return '';
        if (typeof c === 'object') {
          // 处理复杂类型（如链接、公式等）
          if (c.text) return c.text;
          if (c.link) return c.link;
          return JSON.stringify(c);
        }
        return String(c);
      }).join(' | ')}`);
    }
    
    if (values.length > 50) {
      console.log(`... 还有 ${values.length - 50} 行未显示`);
    }
  }
}

main().catch(console.error);
