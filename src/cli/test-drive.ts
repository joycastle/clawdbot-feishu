import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync, createReadStream } from "fs";
import { getConfigPath } from "../utils/paths.js";

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

// 检查 drive API 是否可用
console.log("Drive API available:", !!client.drive);
if (client.drive) {
  console.log("Drive file methods:", Object.keys(client.drive.file || {}));
  console.log("Drive media methods:", Object.keys(client.drive.media || {}));
}
