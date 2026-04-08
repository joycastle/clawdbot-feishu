/**
 * result-card — Feishu card rendering for virtual vote progress and results.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VoteChoice {
  personaId: string;
  personaName: string;
  personaSummary: string;
  /** Chosen option index (0-based) */
  choice: number;
  /** Short reason for the choice */
  reason: string;
}

export interface VoteResultData {
  game: string;
  topic: string;
  options: string[];
  choices: VoteChoice[];
  totalPersonas: number;
  durationMs?: number;
  model?: string;
}

// ─── Progress Card ──────────────────────────────────────────────────────────

export function buildProgressCard(params: {
  game: string;
  topic: string;
  totalPersonas: number;
  completedCount: number;
  status: "running" | "error";
  errorMsg?: string;
}): Record<string, unknown> {
  const { game, topic, totalPersonas, completedCount, status } = params;
  const pct = totalPersonas > 0 ? Math.round((completedCount / totalPersonas) * 100) : 0;
  const barWidth = 20;
  const filled = Math.round((pct / 100) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

  const elements: Record<string, unknown>[] = [];

  if (status === "error") {
    elements.push({
      tag: "markdown",
      content: `❌ **投票出错**\n${params.errorMsg ?? "未知错误"}`,
    });
  } else {
    elements.push({
      tag: "markdown",
      content:
        `🗳️ **虚拟用户投票进行中**\n\n` +
        `**用户群：** ${game}\n` +
        `**主题：** ${topic}\n\n` +
        `${bar}  ${completedCount}/${totalPersonas} (${pct}%)`,
    });
  }

  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: "plain_text", content: `🗳️ 虚拟投票 — ${topic}` },
      template: status === "error" ? "red" : "blue",
    },
    elements,
  };
}

// ─── Result Card ────────────────────────────────────────────────────────────

export function buildResultCard(data: VoteResultData): Record<string, unknown> {
  const { game, topic, options, choices, totalPersonas, durationMs, model } = data;

  // Tally votes per option
  const tally: number[] = new Array(options.length).fill(0);
  for (const c of choices) {
    if (c.choice >= 0 && c.choice < options.length) {
      tally[c.choice]++;
    }
  }

  // Find winner(s)
  const maxVotes = Math.max(...tally);
  const winnerIndices = tally
    .map((count, idx) => (count === maxVotes ? idx : -1))
    .filter((i) => i >= 0);

  const elements: Record<string, unknown>[] = [];

  // Summary section
  elements.push({
    tag: "markdown",
    content:
      `🗳️ **虚拟用户投票结果**\n\n` +
      `**用户群：** ${game} (${totalPersonas}人)\n` +
      `**主题：** ${topic}`,
  });
  elements.push({ tag: "hr" });

  // Option results with bars
  const barWidth = 16;
  for (let i = 0; i < options.length; i++) {
    const count = tally[i];
    const pct = totalPersonas > 0 ? Math.round((count / totalPersonas) * 100) : 0;
    const filled = Math.round((pct / 100) * barWidth);
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
    const isWinner = winnerIndices.includes(i);
    const medal = isWinner ? " 🏆" : "";

    elements.push({
      tag: "markdown",
      content: `**选项${i + 1}. ${options[i]}**${medal}\n${bar}  ${count}票 (${pct}%)`,
    });
  }

  elements.push({ tag: "hr" });

  // Per-persona details (grouped by choice)
  elements.push({
    tag: "markdown",
    content: "**投票详情**",
  });

  for (let i = 0; i < options.length; i++) {
    const voters = choices.filter((c) => c.choice === i);
    if (voters.length === 0) continue;

    const voterLines = voters
      .map((v) => `• **${v.personaName}** (${v.personaSummary})\n  _${v.reason}_`)
      .join("\n");

    elements.push({
      tag: "markdown",
      content: `**选项${i + 1}. ${options[i]}** (${voters.length}票)\n${voterLines}`,
    });
  }

  // Footer
  elements.push({ tag: "hr" });
  const footerParts: string[] = [];
  if (durationMs) footerParts.push(`耗时 ${Math.round(durationMs / 1000)}s`);
  if (model) footerParts.push(`模型 ${model}`);
  footerParts.push(`${choices.length}/${totalPersonas} 人完成投票`);

  elements.push({
    tag: "note",
    elements: [{ tag: "plain_text", content: footerParts.join(" · ") }],
  });

  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: "plain_text", content: `🗳️ 虚拟投票结果 — ${topic}` },
      template: "green",
    },
    elements,
  };
}
