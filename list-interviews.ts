import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "./src/utils/paths.js";

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

async function main() {
  const folderToken = 'NEuifX6Gnlz1Y9dMr1Hc5xhKnJo';
  
  console.log('=== 面试记录文件夹 ===');
  try {
    const res = await client.drive.file.list({
      params: { folder_token: folderToken }
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch (e: any) {
    console.error('失败:', e.code, e.msg);
  }
}

main();
