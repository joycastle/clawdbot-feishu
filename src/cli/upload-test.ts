import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "../utils/paths.js";

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

async function main() {
  const buffer = readFileSync("/tmp/test-table2.docx");
  
  const response = await client.drive.media.uploadAll({
    data: {
      file_name: "表格测试_请验证后删除.docx",
      parent_type: "explorer",
      parent_node: "Ys7Bf8OrMlhGBxdmaCoc6vdTnke",
      size: buffer.length,
      file: buffer,
    },
  });
  
  const fileToken = (response as any).file_token;
  console.log("file_token:", fileToken);
  console.log("链接: https://joycastle.feishu.cn/file/" + fileToken);
}

main();
