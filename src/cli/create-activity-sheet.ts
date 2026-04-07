import * as fs from 'fs';
import * as path from 'path';

// 加载配置
const configPath = path.join(process.env.HOME || '', '.openclaw', 'openclaw.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const feishuCfg = config.channels?.feishu;

async function getAccessToken() {
  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: feishuCfg.appId,
      app_secret: feishuCfg.appSecret
    })
  });
  const data = await resp.json() as any;
  return data.tenant_access_token;
}

async function createSpreadsheet(token: string) {
  const resp = await fetch('https://open.feishu.cn/open-apis/sheets/v3/spreadsheets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: '年度活动日历'
    })
  });
  const data = await resp.json() as any;
  if (data.code !== 0) {
    console.error('创建失败:', data.msg);
    return null;
  }
  return data.data?.spreadsheet?.spreadsheet_token;
}

async function getSheetId(token: string, spreadsheetToken: string) {
  const resp = await fetch(`https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await resp.json() as any;
  return data.data?.sheets?.[0]?.sheet_id;
}

async function writeData(token: string, spreadsheetToken: string, sheetId: string) {
  const values = [
    ['月份', '节日', '参加人', '形式'],
    ['1月', '年会', '全员', '节目、抽奖、餐饮、住宿'],
    ['3月', '元宵节', '全员', '下午茶'],
    ['3月', '38节', '部分', '女生专属礼物及茶歇'],
    ['4月', '美术节', '部分', '美术专属礼物及茶歇'],
    ['5月', '儿童节', '全员', '游戏、下午茶、礼物'],
    ['7月', '产品节', '部分', '产品专属礼物及茶歇'],
    ['8月', '市场节', '部分', '市场专属礼物及茶歇'],
    ['9月', '周年庆', '全员', '旅游出行'],
    ['10月', '1024', '部分', '程序专属礼物及茶歇'],
    ['10月', '万圣节', '全员', '游戏、下午茶'],
    ['11月', '感恩节', '全员', '下午茶'],
    ['12月', '圣诞节', '全员', '下午茶、礼物'],
  ];
  
  const resp = await fetch(`https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values_batch_update`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      value_ranges: [{
        range: `${sheetId}!A1:D13`,
        values: values
      }]
    })
  });
  const data = await resp.json() as any;
  if (data.code !== 0) {
    console.error('写入失败:', data.msg);
    return false;
  }
  return true;
}

async function main() {
  const accessToken = await getAccessToken();
  console.log('获取 token 成功');
  
  const spreadsheetToken = await createSpreadsheet(accessToken);
  if (!spreadsheetToken) return;
  console.log('创建表格成功');
  
  const sheetId = await getSheetId(accessToken, spreadsheetToken);
  if (!sheetId) {
    console.error('获取 sheet ID 失败');
    return;
  }
  
  const success = await writeData(accessToken, spreadsheetToken, sheetId);
  if (success) {
    console.log('写入数据成功');
    console.log(`SHEET_URL: https://vvbg9q9i60.feishu.cn/sheets/${spreadsheetToken}`);
  }
}

main();
