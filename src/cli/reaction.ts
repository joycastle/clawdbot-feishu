#!/usr/bin/env npx tsx
import { getConfigPath } from "../utils/paths.js";
/**
 * CLI to add/remove/list reactions on Feishu messages.
 * Usage:
 *   npx tsx src/cli/reaction.ts add --message <message_id> --emoji SMILE
 *   npx tsx src/cli/reaction.ts remove --message <message_id> --reaction <reaction_id>
 *   npx tsx src/cli/reaction.ts list --message <message_id>
 */

import * as fs from "fs";
import * as path from "path";
import { parseArgs } from "node:util";
import { addReactionFeishu, removeReactionFeishu, listReactionsFeishu, FeishuEmoji } from "../api/reactions.js";

function loadConfig() {
  const configPath = getConfigPath();
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

async function main() {
  const args = process.argv.slice(2);
  const action = args[0];

  if (!action || !["add", "remove", "list", "emojis"].includes(action)) {
    console.log(`Usage:
  npx tsx src/cli/reaction.ts add --message <message_id> --emoji <emoji_type>
  npx tsx src/cli/reaction.ts remove --message <message_id> --reaction <reaction_id>
  npx tsx src/cli/reaction.ts list --message <message_id>
  npx tsx src/cli/reaction.ts emojis   # list common emoji types

Common emoji types: ${Object.keys(FeishuEmoji).join(", ")}`);
    process.exit(1);
  }

  if (action === "emojis") {
    console.log("Common Feishu emoji types:");
    for (const [name, value] of Object.entries(FeishuEmoji)) {
      console.log(`  ${name}: ${value}`);
    }
    return;
  }

  const { values } = parseArgs({
    args: args.slice(1),
    options: {
      message: { type: "string", short: "m" },
      emoji: { type: "string", short: "e" },
      reaction: { type: "string", short: "r" },
    },
  });

  const messageId = values.message;
  if (!messageId) {
    console.error("Error: --message is required");
    process.exit(1);
  }

  const cfg = loadConfig();

  switch (action) {
    case "add": {
      const emojiType = values.emoji;
      if (!emojiType) {
        console.error("Error: --emoji is required for add");
        process.exit(1);
      }
      const result = await addReactionFeishu({ cfg, messageId, emojiType });
      console.log(`Added reaction: ${emojiType} (reaction_id: ${result.reactionId})`);
      break;
    }
    case "remove": {
      const reactionId = values.reaction;
      if (!reactionId) {
        console.error("Error: --reaction is required for remove");
        process.exit(1);
      }
      await removeReactionFeishu({ cfg, messageId, reactionId });
      console.log(`Removed reaction: ${reactionId}`);
      break;
    }
    case "list": {
      const reactions = await listReactionsFeishu({ cfg, messageId });
      if (reactions.length === 0) {
        console.log("No reactions found");
      } else {
        console.log("Reactions:");
        for (const r of reactions) {
          console.log(`  ${r.emojiType} by ${r.operatorType}:${r.operatorId} (id: ${r.reactionId})`);
        }
      }
      break;
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
