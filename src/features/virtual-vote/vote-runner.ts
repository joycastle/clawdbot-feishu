/**
 * vote-runner — Background concurrent voting engine.
 *
 * Orchestrates parallel LLM calls (one per persona), respects concurrency limits
 * via a simple semaphore, and periodically updates a Feishu progress card.
 */

import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import type { Persona } from "./persona-loader.js";
import type { VirtualVoteLLMConfig, VirtualVoteLLMRuntime, LLMMessage, LLMContentPart } from "./llm-client.js";
import type { VoteChoice, VoteResultData } from "./result-card.js";
import { callLLM } from "./llm-client.js";
import { buildProgressCard, buildResultCard } from "./result-card.js";
import { updateCardFeishu } from "../../api/send.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VoteRunnerParams {
  cfg: ClawdbotConfig;
  llmCfg: VirtualVoteLLMConfig;
  llmRuntime: VirtualVoteLLMRuntime;
  cardMessageId: string;
  chatId: string;
  game: string;
  topic: string;
  /** Text options (for vote_text) */
  options?: string[];
  /** Image buffers with mime types (for vote_image), ordered */
  images?: Array<{ data: string; mediaType: string }>;
  personas: Persona[];
  log?: (msg: string) => void;
}

// ─── Semaphore ──────────────────────────────────────────────────────────────

class Semaphore {
  private available: number;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {
    this.available = max;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.available--;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.available++;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ─── Prompt Builder ─────────────────────────────────────────────────────────

function buildVotePrompt(params: {
  topic: string;
  options: string[];
  images?: Array<{ data: string; mediaType: string }>;
}): LLMMessage {
  const { topic, options, images } = params;

  const parts: LLMContentPart[] = [];

  // Add images first if present
  if (images && images.length > 0) {
    parts.push({
      type: "text",
      text: `以下是 ${images.length} 张图片，按顺序对应选项 1 到 ${images.length}：`,
    });
    for (const img of images) {
      parts.push({ type: "image", mediaType: img.mediaType, data: img.data });
    }
  }

  // Build option list text
  const optionList = options.map((opt, i) => `${i + 1}. ${opt}`).join("\n");

  parts.push({
    type: "text",
    text:
      `你正在参与一个投票。\n\n` +
      `**投票主题：** ${topic}\n\n` +
      `**选项：**\n${optionList}\n\n` +
      `请根据你的个人背景、生活经历、审美偏好和游戏习惯，从以上选项中选择一个最吸引你的。\n\n` +
      `请严格按以下 JSON 格式回复，不要输出其他内容：\n` +
      `{"choice": <选项编号1-${options.length}>, "reason": "<一句话说明理由>"}`,
  });

  return { role: "user", content: parts };
}

function buildSystemPrompt(persona: Persona): LLMMessage {
  return {
    role: "system",
    content:
      `你是 ${persona.name}。以下是关于你的详细背景，请完全以这个身份思考和回答问题。\n\n` +
      persona.profile,
  };
}

// ─── Response Parser ────────────────────────────────────────────────────────

function parseVoteResponse(
  text: string,
  optionCount: number,
): { choice: number; reason: string } | null {
  try {
    // Try to extract JSON from response (may have surrounding text)
    const jsonMatch = text.match(/\{[\s\S]*?"choice"[\s\S]*?\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const choice = typeof parsed.choice === "number" ? parsed.choice : parseInt(parsed.choice, 10);
    if (isNaN(choice) || choice < 1 || choice > optionCount) return null;

    return {
      choice: choice - 1, // Convert to 0-based
      reason: String(parsed.reason || "").slice(0, 200),
    };
  } catch {
    return null;
  }
}

// ─── Progress Update ────────────────────────────────────────────────────────

/** Update the progress card at most once every N completed personas. */
const PROGRESS_UPDATE_INTERVAL = 4;

// ─── Main Runner ────────────────────────────────────────────────────────────

export async function runVoteInBackground(params: VoteRunnerParams): Promise<void> {
  const {
    cfg,
    llmCfg,
    cardMessageId,
    chatId,
    game,
    topic,
    options: textOptions,
    images,
    personas,
    log,
  } = params;

  const startTime = Date.now();

  // Determine options list
  const options: string[] =
    textOptions ??
    (images ? images.map((_, i) => `图片 ${i + 1}`) : []);

  if (options.length < 2) {
    log?.("virtual-vote: less than 2 options, aborting");
    await updateCardFeishu({
      cfg,
      messageId: cardMessageId,
      card: buildProgressCard({
        game,
        topic,
        totalPersonas: personas.length,
        completedCount: 0,
        status: "error",
        errorMsg: "选项数量不足（至少需要 2 个）",
      }),
    });
    return;
  }

  const semaphore = new Semaphore(llmCfg.maxConcurrent);
  const results: VoteChoice[] = [];
  let completedCount = 0;
  let lastProgressUpdate = 0;

  const updateProgress = async () => {
    try {
      await updateCardFeishu({
        cfg,
        messageId: cardMessageId,
        card: buildProgressCard({
          game,
          topic,
          totalPersonas: personas.length,
          completedCount,
          status: "running",
        }),
      });
    } catch (err) {
      log?.(`virtual-vote: progress update failed: ${String(err)}`);
    }
  };

  // Run all personas in parallel (bounded by semaphore)
  await Promise.all(
    personas.map(async (persona) => {
      const release = await semaphore.acquire();
      try {
        const systemPrompt = buildSystemPrompt(persona);
        const votePrompt = buildVotePrompt({ topic, options, images });
        const messages: LLMMessage[] = [systemPrompt, votePrompt];

        // Log input for first persona only (to avoid flooding logs with base64)
        if (completedCount === 0) {
          const promptContent = votePrompt.content;
          if (Array.isArray(promptContent)) {
            const parts = promptContent.map((p) => {
              if (p.type === "text") return `[text: ${p.text.slice(0, 200)}...]`;
              return `[image: ${p.mediaType}, base64_len=${p.data.length}]`;
            });
            log?.(`virtual-vote: first persona prompt parts: ${parts.join(", ")}`);
          } else {
            log?.(`virtual-vote: first persona prompt: ${String(promptContent).slice(0, 200)}`);
          }
        }

        const result = await callLLM(llmCfg, params.llmRuntime, messages);
        log?.(`virtual-vote: [${persona.name}] raw response: ${result.text.slice(0, 300)}`);

        const parsed = parseVoteResponse(result.text, options.length);

        if (parsed) {
          log?.(`virtual-vote: [${persona.name}] choice=${parsed.choice + 1}, reason=${parsed.reason}`);
          results.push({
            personaId: persona.id,
            personaName: persona.name,
            personaSummary: persona.summary,
            choice: parsed.choice,
            reason: parsed.reason,
          });
        } else {
          log?.(`virtual-vote: [${persona.name}] PARSE FAILED, raw: ${result.text.slice(0, 300)}`);
        }

        completedCount++;

        // Periodic progress update
        if (completedCount - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
          lastProgressUpdate = completedCount;
          updateProgress().catch(() => {}); // fire-and-forget
        }
      } catch (err) {
        completedCount++;
        log?.(`virtual-vote: LLM call failed for ${persona.name}: ${String(err)}`);
      } finally {
        release();
      }
    }),
  );

  // Build and send final result card
  const durationMs = Date.now() - startTime;
  const resultData: VoteResultData = {
    game,
    topic,
    options,
    choices: results,
    totalPersonas: personas.length,
    durationMs,
    model: llmCfg.model,
  };

  try {
    await updateCardFeishu({
      cfg,
      messageId: cardMessageId,
      card: buildResultCard(resultData),
    });
    log?.(
      `virtual-vote: completed — ${results.length}/${personas.length} voted, ` +
        `took ${Math.round(durationMs / 1000)}s`,
    );
  } catch (err) {
    log?.(`virtual-vote: failed to send result card: ${String(err)}`);
  }
}
