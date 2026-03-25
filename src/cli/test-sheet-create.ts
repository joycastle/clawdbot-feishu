import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "../utils/paths.js";

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

async function main() {
  console.log("Sheets API methods:", Object.keys(client.sheets?.spreadsheet || {}));
  
  // 尝试创建电子表格
  try {
    const response = await client.sheets.spreadsheet.create({
      data: {
        title: "测试表格_可删除",
        folder_token: "Ys7Bf8OrMlhGBxdmaCoc6vdTnke",
      },
    });
    
    console.log("Response:", JSON.stringify(response, null, 2));
  } catch (error: any) {
    console.error("Error code:", error.response?.data?.code);
    console.error("Error msg:", error.response?.data?.msg);
  }
}

main();
