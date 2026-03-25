import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "./src/utils/paths.js";

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

async function main() {
  const appToken = 'D3j2b92i5aPtowsX4vucV7gtn3d';
  const tableId = 'tblgdSNYgKn3knzx';
  
  try {
    const res = await client.bitable.appTableField.create({
      path: { app_token: appToken, table_id: tableId },
      data: {
        field_name: '核心优势',
        type: 1,
      }
    });
    console.log('创建成功:', res.data?.field?.field_id);
  } catch (e: any) {
    console.error('创建失败:', e.code, e.msg);
  }
}

main();
