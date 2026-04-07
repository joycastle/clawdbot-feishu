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
  // 读取687-780行的数据 (多读一些确保覆盖)
  const range = `${sheetId}!A687:BM780`;
  const dataRes = await (client as any).request({
    method: 'GET', 
    url: `/open-apis/sheets/v2/spreadsheets/${sheetToken}/values/${range}`,
  });
  
  if (dataRes.code !== 0) {
    console.error('Failed:', dataRes.msg);
    return;
  }
  
  const values = dataRes.data?.valueRange?.values || [];
  console.log(`读取到 ${values.length} 行数据\n`);
  
  // 打印前几行看看结构
  for (let i = 0; i < Math.min(values.length, 95); i++) {
    const row = values[i];
    if (!row) continue;
    
    const formatted = row.slice(0, 65).map((c: any) => {
      if (c === null || c === undefined) return '';
      if (typeof c === 'object') {
        if (c.text) return c.text;
        return JSON.stringify(c);
      }
      return String(c).substring(0, 20);
    });
    
    // 只打印有内容的行
    const hasContent = formatted.some((s: string) => s && s.trim());
    if (hasContent) {
      console.log(`[${687 + i}] ${formatted.join(' | ')}`);
    }
  }
}

main().catch(console.error);
