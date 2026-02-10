#!/usr/bin/env npx tsx
/**
 * CLI to list/create/delete pinned messages in Feishu chats.
 * Usage:
 *   npx tsx src/cli/pin.ts list --chat <chat_id>
 *   npx tsx src/cli/pin.ts add --message <message_id>
 *   npx tsx src/cli/pin.ts remove --message <message_id>
 */

import * as fs from "fs";
import * as path from "path";
import { parseArgs } from "node:util";
import { createFeishuClient } from "../client.js";
import type { FeishuConfig } from "../types.js";

function loadConfig() {
  const configPath = path.join(process.env.HOME || "", ".clawdbot", "clawdbot.json");
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

async function main() {
  const args = process.argv.slice(2);
  const action = args[0];

  if (!action || !["list", "add", "remove"].includes(action)) {
    console.log(`Usage:
  npx tsx src/cli/pin.ts list --chat <chat_id>
  npx tsx src/cli/pin.ts add --message <message_id>
  npx tsx src/cli/pin.ts remove --message <message_id>

Examples:
  npx tsx src/cli/pin.ts list --chat oc_xxx
  npx tsx src/cli/pin.ts add --message om_xxx
  npx tsx src/cli/pin.ts remove --message om_xxx`);
    process.exit(1);
  }

  const { values } = parseArgs({
    args: args.slice(1),
    options: {
      chat: { type: "string", short: "c" },
      message: { type: "string", short: "m" },
    },
  });

  const cfg = loadConfig();
  const feishuCfg = cfg.channels?.feishu as FeishuConfig;
  const client = createFeishuClient(feishuCfg);

  switch (action) {
    case "list": {
      const chatId = values.chat;
      if (!chatId) {
        console.error("Error: --chat is required for list");
        process.exit(1);
      }

      const response = await client.im.pin.list({
        params: { chat_id: chatId },
      }) as {
        code?: number;
        msg?: string;
        data?: {
          items?: Array<{
            message_id?: string;
            chat_id?: string;
            operator_id?: string;
            operator_id_type?: string;
            create_time?: string;
          }>;
          has_more?: boolean;
          page_token?: string;
        };
      };

      if (response.code !== 0) {
        throw new Error(`Failed to list pins: ${response.msg || `code ${response.code}`}`);
      }

      const items = response.data?.items ?? [];
      if (items.length === 0) {
        console.log("No pinned messages found.");
      } else {
        console.log(`Found ${items.length} pinned message(s):\n`);
        for (const item of items) {
          console.log(`Message ID: ${item.message_id}`);
          console.log(`  Pinned by: ${item.operator_id_type}:${item.operator_id}`);
          console.log(`  Pinned at: ${item.create_time}`);
          console.log("");
        }
      }
      break;
    }

    case "add": {
      const messageId = values.message;
      if (!messageId) {
        console.error("Error: --message is required for add");
        process.exit(1);
      }

      const response = await client.im.pin.create({
        data: { message_id: messageId },
      }) as { code?: number; msg?: string };

      if (response.code !== 0) {
        throw new Error(`Failed to pin message: ${response.msg || `code ${response.code}`}`);
      }

      console.log(`✅ Message ${messageId} pinned successfully.`);
      break;
    }

    case "remove": {
      const messageId = values.message;
      if (!messageId) {
        console.error("Error: --message is required for remove");
        process.exit(1);
      }

      const response = await client.im.pin.delete({
        path: { message_id: messageId },
      }) as { code?: number; msg?: string };

      if (response.code !== 0) {
        throw new Error(`Failed to unpin message: ${response.msg || `code ${response.code}`}`);
      }

      console.log(`✅ Message ${messageId} unpinned successfully.`);
      break;
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
