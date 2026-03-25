import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "./src/utils/paths.js";

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

async function main() {
  const folderToken = 'OpPNfw4iFltkapdLbEYcjSQFnHg';
  
  console.log('=== 创建多维表格 ===');
  try {
    const res = await client.bitable.app.create({
      data: {
        name: '测试多维表格_Clawdbot',
        folder_token: folderToken
      }
    });
    console.log('创建成功:', JSON.stringify(res.data, null, 2));
  } catch (e: any) {
    console.error('创建失败:', e.code, e.msg, e.message);
  }
}

main();
