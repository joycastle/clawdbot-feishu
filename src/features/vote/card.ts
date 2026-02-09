/**
 * Vote card — builds Feishu interactive card JSON for polls.
 *
 * Responsibilities:
 *   - Voter name resolution (with TTL cache)
 *   - Progress bar rendering
 *   - Card JSON construction for create / update
 */

import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import type { FeishuConfig } from "../../types.js";
import type { VoteData } from "./store.js";
import { createFeishuClient } from "../../client.js";

// ─── Name Cache ──────────────────────────────────────────────────────────────

const nameCache = new Map<string, string>();
const nameCacheTs = new Map<string, number>();
const NAME_TTL = 24 * 60 * 60 * 1000;

async function resolveName(cfg: ClawdbotConfig, openId: string): Promise<string> {
  const cached = nameCache.get(openId);
  const ts = nameCacheTs.get(openId);
  if (cached && ts && Date.now() - ts < NAME_TTL) return cached;

  try {
    const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
    if (!feishuCfg) return openId;
    const client = createFeishuClient(feishuCfg);
    const resp = await client.contact.user.get({
      path: { user_id: openId },
      params: { user_id_type: "open_id" },
    });
    if (resp.code === 0 && resp.data?.user?.name) {
      nameCache.set(openId, resp.data.user.name);
      nameCacheTs.set(openId, Date.now());
      return resp.data.user.name;
    }
  } catch { /* fall through */ }
  return openId;
}

export async function resolveNames(cfg: ClawdbotConfig, ids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  await Promise.all(ids.map(async (id) => {
    result.set(id, await resolveName(cfg, id));
  }));
  return result;
}

// ─── Progress Bar ────────────────────────────────────────────────────────────

function buildProgressBar(count: number, total: number, width = 16): string {
  if (total === 0) return "░".repeat(width);
  const filled = Math.round((count / total) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ─── Card Builder ────────────────────────────────────────────────────────────

export function buildVoteCard(
  data: VoteData,
  namesMap?: Map<string, string>,
): Record<string, unknown> {
  const voteCounts: number[] = new Array(data.options.length).fill(0);
  const votersByOption: string[][] = data.options.map(() => []);

  for (const [openId, vote] of Object.entries(data.voters)) {
    if (data.multiSelect && Array.isArray(vote)) {
      for (const idx of vote) {
        if (idx >= 0 && idx < data.options.length) {
          voteCounts[idx]++;
          votersByOption[idx].push(openId);
        }
      }
    } else if (typeof vote === "number" && vote >= 0 && vote < data.options.length) {
      voteCounts[vote]++;
      votersByOption[vote].push(openId);
    }
  }

  const totalVoters = Object.keys(data.voters).length;
  const elements: Record<string, unknown>[] = [];

  const modeText = data.multiSelect ? "可多选" : "单选";
  const anonText = data.anonymous ? "（匿名）" : "";
  elements.push({
    tag: "markdown",
    content: `📊 ${modeText}${anonText}，点击按钮投票（再次点击取消）`,
  });
  elements.push({ tag: "hr" });

  for (let i = 0; i < data.options.length; i++) {
    const count = voteCounts[i];
    const bar = buildProgressBar(count, totalVoters);
    const pct = totalVoters > 0 ? Math.round((count / totalVoters) * 100) : 0;

    let voterStr = "";
    if (!data.anonymous && count > 0 && namesMap) {
      const names = votersByOption[i].map((id) => namesMap.get(id) ?? id);
      voterStr = `\n👥 ${names.join("、")}`;
    }

    elements.push({
      tag: "markdown",
      content: `**${data.options[i]}**\n${bar}  ${count}票 (${pct}%)${voterStr}`,
    });

    if (!data.closed) {
      elements.push({
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: `投 "${data.options[i]}"` },
            type: count > 0 ? "primary" : "default",
            value: { action: "vote_toggle", pollId: data.pollId, optionIndex: i },
          },
        ],
      });
    }
  }

  elements.push({ tag: "hr" });

  const progressText = data.totalMembers > 0
    ? `已投 ${totalVoters}/${data.totalMembers} 人`
    : `共 ${totalVoters} 人参与投票`;
  elements.push({
    tag: "note",
    elements: [{ tag: "plain_text", content: progressText }],
  });

  if (!data.closed) {
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          text: { tag: "plain_text", content: "🔒 结束投票" },
          type: "danger",
          value: { action: "vote_close", pollId: data.pollId },
        },
      ],
    });
  }

  const title = data.closed
    ? `📊 ${data.question}（已结束）`
    : `📊 ${data.question}`;

  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: "plain_text", content: title },
      template: data.closed ? "grey" : "blue",
    },
    elements,
  };
}
