import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "../utils/paths.js";

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

// 检查 drive permission API
console.log("Drive permission methods:", Object.keys(client.drive?.permission || {}));
console.log("Drive permission member methods:", Object.keys(client.drive?.permission?.member || {}));
console.log("Drive file methods:", Object.keys(client.drive?.file || {}));
