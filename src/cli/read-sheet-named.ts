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
  // 先获取表格元信息，看看有没有命名范围
  const metaRes = await (client as any).request({
    method: 'GET',
    url: `/open-apis/sheets/v2/spreadsheets/${sheetToken}/metainfo`,
  });
  
  console.log('Sheet meta:', JSON.stringify(metaRes.data, null, 2));
  
  // 尝试读取更大范围看看右侧是否有其他数据
  const range = `${sheetId}!A1:CZ100`;
  const dataRes = await (client as any).request({
    method: 'GET', 
    url: `/open-apis/sheets/v2/spreadsheets/${sheetToken}/values/${range}`,
  });
  
  if (dataRes.code !== 0) {
    console.error('Failed:', dataRes.msg);
    return;
  }
  
  const values = dataRes.data?.valueRange?.values || [];
  console.log(`\n总行数: ${values.length}`);
  
  // 打印表头看看有哪些列
  if (values[5]) {
    console.log('\n=== 表头 (第6行) ===');
    values[5].forEach((c: any, i: number) => {
      const val = typeof c === 'object' ? (c?.text || JSON.stringify(c)) : c;
      if (val) console.log(`  列${i+1} (${String.fromCharCode(65 + i)}): ${val}`);
    });
  }
  
  // 看看第一个数据行有多少列有数据
  if (values[6]) {
    const nonEmpty = values[6].filter((c: any) => c !== null && c !== undefined && c !== '').length;
    console.log(`\n第7行有 ${nonEmpty} 个非空单元格`);
  }
}

main().catch(console.error);
