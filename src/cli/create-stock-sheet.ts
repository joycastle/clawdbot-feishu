import * as Lark from '@larksuiteoapi/node-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { getConfigPath } from "../utils/paths.js";

// 加载配置
const configPath = getConfigPath();
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const feishuCfg = config.channels?.feishu;

const client = new Lark.Client({
  appId: feishuCfg.appId,
  appSecret: feishuCfg.appSecret,
  domain: Lark.Domain.Feishu,
});

async function createSpreadsheet() {
  try {
    // 创建电子表格
    const result = await client.drive.spreadsheet.create({
      data: {
        title: '科技巨头市值7天变化统计 (2026.02.26-03.04)',
        folder_token: '' // 创建在根目录
      }
    });
    
    console.log('创建成功:', JSON.stringify(result, null, 2));
    return result.data?.spreadsheet?.spreadsheet_token;
  } catch (e: any) {
    console.error('创建失败:', e.message || e);
    return null;
  }
}

async function writeData(token: string) {
  // 数据
  const data = [
    ['公司', '股票代码', '02-26市值', '02-27市值', '03-02市值', '03-03市值', '03-04市值', '7天涨跌'],
    ['苹果 (Apple)', 'AAPL', '$4.02T', '$3.89T', '$3.90T', '$3.89T', '$3.87T', '-3.8%'],
    ['谷歌 (Alphabet)', 'GOOGL', '$3.72T', '$3.77T', '$3.71T', '$3.67T', '$3.67T', '-1.4%'],
    ['Facebook (Meta)', 'META', '$1.66T', '$1.64T', '$1.65T', '$1.66T', '$1.69T', '+1.6%'],
    ['英伟达 (NVIDIA)', 'NVDA', '$4.49T', '$4.31T', '$4.43T', '$4.38T', '$4.45T', '-1.0%'],
  ];
  
  try {
    // 获取默认sheet
    const sheetsInfo = await client.sheets.spreadsheetSheet.query({
      path: { spreadsheet_token: token }
    });
    
    const sheetId = sheetsInfo.data?.sheets?.[0]?.sheet_id;
    if (!sheetId) throw new Error('No sheet found');
    
    // 写入数据
    await client.sheets.spreadsheetSheetValues.batchUpdate({
      path: { spreadsheet_token: token },
      data: {
        value_ranges: [{
          range: sheetId + '!A1:H5',
          values: data
        }]
      }
    });
    
    console.log('数据写入成功');
    console.log('SHEET_URL: https://vvbg9q9i60.feishu.cn/sheets/' + token);
  } catch (e: any) {
    console.error('写入失败:', e.message || e);
  }
}

async function main() {
  const token = await createSpreadsheet();
  if (token) {
    await writeData(token);
  }
}

main();
