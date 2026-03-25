import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync, writeFileSync } from "fs";
import { getConfigPath } from "../utils/paths.js";

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

async function main() {
  const response = await client.drive.file.download({
    path: { file_token: "IiIUbrLP3ozuU2xqKYlcFGtfndb" },
  });
  
  // 获取文件内容
  const data = response as any;
  if (data && data.writeFile) {
    await data.writeFile("/tmp/downloaded-v4.docx");
    console.log("下载完成: /tmp/downloaded-v4.docx");
  } else if (Buffer.isBuffer(data)) {
    writeFileSync("/tmp/downloaded-v4.docx", data);
    console.log("下载完成: /tmp/downloaded-v4.docx");
  } else {
    console.log("响应类型:", typeof data, Object.keys(data || {}));
  }
}

main().catch(console.error);
