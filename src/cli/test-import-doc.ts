import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "../utils/paths.js";

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

// 检查 drive import API
console.log("Drive importTask methods:", Object.keys(client.drive?.importTask || {}));
console.log("Drive exportTask methods:", Object.keys(client.drive?.exportTask || {}));
