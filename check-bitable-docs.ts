import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "./src/utils/paths.js";

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

async function main() {
  const appToken = 'D3j2b92i5aPtowsX4vucV7gtn3d';
  
  // 1. 查看所有表和仪表盘
  console.log('=== 列出所有表 ===');
  try {
    const tables = await client.bitable.appTable.list({
      path: { app_token: appToken }
    });
    console.log(JSON.stringify(tables.data, null, 2));
  } catch (e: any) {
    console.error('表列表失败:', e.code, e.msg);
  }

  // 2. 查看仪表盘
  console.log('\n=== 列出仪表盘 ===');
  try {
    const dashboards = await client.bitable.appDashboard.list({
      path: { app_token: appToken }
    });
    console.log(JSON.stringify(dashboards.data, null, 2));
  } catch (e: any) {
    console.error('仪表盘失败:', e.code, e.msg);
  }
}

main();
