#!/usr/bin/env npx tsx
import * as fs from "fs";
import * as path from "path";
import { createFeishuClient } from "../client.js";
import type { FeishuConfig } from "../types.js";

function loadConfig() {
  const configPath = path.join(process.env.HOME || "", ".clawdbot", "clawdbot.json");
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

async function main() {
  const chatId = process.argv[2] || "oc_58cfa5cc53fda9a5eaffb338c56950a6";
  
  const cfg = loadConfig();
  const feishuCfg = cfg.channels?.feishu as FeishuConfig;
  const client = createFeishuClient(feishuCfg);

  console.log("Querying pinned messages for chat:", chatId);
  
  const response = await client.im.pin.list({
    params: { chat_id: chatId },
  });

  console.log("\n=== Raw API Response ===");
  console.log(JSON.stringify(response, null, 2));
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
