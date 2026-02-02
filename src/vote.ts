/**
 * Vote — Interactive poll cards for Feishu.
 *
 * Module structure:
 *   vote-store.ts  — file-based persistence + mutex + cleanup
 *   vote-card.ts   — card rendering + name resolution
 *   vote.ts        — public API (create, handle, query)
 *
 * On each vote callback:
 *   1. Load current vote state from file
 *   2. Update vote state
 *   3. Rebuild card and patch via im.message.patch
 *   4. Write updated state back to file
 *   5. Feishu auto-broadcasts the update to all users
 */

import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import type { VoteData } from "./vote-store.js";
import { loadVoteData, saveVoteData, withLock } from "./vote-store.js";
import { buildVoteCard, resolveNames } from "./vote-card.js";
import { sendCardFeishu, updateCardFeishu } from "./send.js";

// ─── Debounce ────────────────────────────────────────────────────────────────

/** Per-poll debounce timers for delayed PATCH calls. */
const patchTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PATCH_DELAY_MS = 40;

// Re-exports for external consumers
export type { VoteData } from "./vote-store.js";
export { cleanupOldPolls } from "./vote-store.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CreatePollParams {
  cfg: ClawdbotConfig;
  to: string;
  question: string;
  options: string[];
  multiSelect?: boolean;
  anonymous?: boolean;
  creatorOpenId?: string;
  replyToMessageId?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 20;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create and send a poll card.
 */
export async function createPoll(params: CreatePollParams): Promise<{
  cardMessageId: string;
  id: string;
}> {
  const {
    cfg,
    to,
    question,
    options,
    multiSelect = true,
    anonymous = false,
    creatorOpenId = "",
    replyToMessageId,
  } = params;

  if (options.length < MIN_OPTIONS) {
    throw new Error(`Poll requires at least ${MIN_OPTIONS} options`);
  }
  if (options.length > MAX_OPTIONS) {
    throw new Error(`Poll supports at most ${MAX_OPTIONS} options`);
  }

  const pollId = `poll_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const voteData: VoteData = {
    pollId,
    question,
    options,
    voters: {},
    multiSelect,
    anonymous,
    closed: false,
    creatorOpenId,
    messageId: "",
    chatId: to,
    createdAt: Date.now(),
  };

  const card = buildVoteCard(voteData);
  const result = await sendCardFeishu({ cfg, to, card, replyToMessageId });

  voteData.messageId = result.messageId;
  await saveVoteData(voteData);

  return {
    cardMessageId: result.messageId,
    id: pollId,
  };
}

/**
 * Handle a vote card action (toggle vote or close poll).
 * Returns a toast response for immediate user feedback, plus schedules
 * a debounced PATCH to update the card after the callback completes.
 */
export async function handleVoteCardAction(params: {
  actionData: {
    operator?: { open_id?: string };
    action?: { value?: Record<string, unknown> };
    context?: { open_message_id?: string; open_chat_id?: string };
  };
  cfg: ClawdbotConfig;
  log?: (msg: string) => void;
}): Promise<Record<string, unknown> | null> {
  const { actionData, cfg, log } = params;

  const actionValue = actionData.action?.value as Record<string, unknown> | undefined;
  if (!actionValue) return null;

  const action = actionValue.action as string;
  const pollId = actionValue.pollId as string;
  const operatorOpenId = actionData.operator?.open_id || "";

  if (!pollId) {
    log?.(`vote: missing pollId`);
    return null;
  }

  // Holds the updated card to return as websocket callback response
  let responseCard: Record<string, unknown> | null = null;

  // Serialize updates per poll
  await withLock(pollId, async () => {
    // 1. Load current state from file
    const voteData = await loadVoteData(pollId);
    if (!voteData) {
      log?.(`vote: poll data not found on disk (pollId=${pollId})`);
      return;
    }

    // Get messageId from stored data or callback context
    const messageId = voteData.messageId || actionData.context?.open_message_id;
    if (!messageId) {
      log?.(`vote: no messageId available (pollId=${pollId})`);
      return;
    }
    // Update messageId if we got it from context
    if (!voteData.messageId && messageId) {
      voteData.messageId = messageId;
    }

    // 2. Process action
    if (action === "vote_close") {
      if (voteData.closed) return;
      // Only the creator can close the poll
      if (voteData.creatorOpenId && operatorOpenId !== voteData.creatorOpenId) {
        log?.(`vote: close denied — not creator (pollId=${pollId}, operator=${operatorOpenId})`);
        return;
      }
      voteData.closed = true;
      log?.(`vote: poll closed (pollId=${pollId})`);
    } else if (action === "vote_toggle") {
      if (voteData.closed) {
        log?.(`vote: attempt on closed poll (pollId=${pollId})`);
        return;
      }

      const optionIndex = actionValue.optionIndex as number;
      if (optionIndex < 0 || optionIndex >= voteData.options.length) return;

      if (voteData.multiSelect) {
        const currentArr = Array.isArray(voteData.voters[operatorOpenId])
          ? (voteData.voters[operatorOpenId] as number[])
          : typeof voteData.voters[operatorOpenId] === "number"
            ? [voteData.voters[operatorOpenId] as number]
            : [];
        const idx = currentArr.indexOf(optionIndex);
        if (idx >= 0) {
          currentArr.splice(idx, 1);
          log?.(`vote: ${operatorOpenId} removed from opt ${optionIndex}`);
        } else {
          currentArr.push(optionIndex);
          log?.(`vote: ${operatorOpenId} added to opt ${optionIndex}`);
        }
        if (currentArr.length === 0) {
          delete voteData.voters[operatorOpenId];
        } else {
          voteData.voters[operatorOpenId] = currentArr;
        }
      } else {
        const currentVote = voteData.voters[operatorOpenId];
        if (typeof currentVote === "number" && currentVote === optionIndex) {
          delete voteData.voters[operatorOpenId];
          log?.(`vote: ${operatorOpenId} removed vote (pollId=${pollId})`);
        } else {
          voteData.voters[operatorOpenId] = optionIndex;
          log?.(`vote: ${operatorOpenId} voted for opt ${optionIndex} (pollId=${pollId})`);
        }
      }
    } else {
      return;
    }

    // 3. Resolve voter names
    const allVoterIds = Object.keys(voteData.voters);
    let namesMap: Map<string, string> | undefined;
    if (!voteData.anonymous && allVoterIds.length > 0) {
      try {
        namesMap = await resolveNames(cfg, allVoterIds);
      } catch (err) {
        log?.(`vote: name resolve failed: ${String(err)}`);
      }
    }

    // 4. Rebuild card
    const updatedCard = buildVoteCard(voteData, namesMap);

    // 5. Save state to file
    await saveVoteData(voteData);

    // 6. Debounced delayed PATCH — cancel any pending PATCH for this poll,
    //    then schedule a new one. This batches rapid consecutive clicks
    //    into a single PATCH with the latest state.
    const prevTimer = patchTimers.get(pollId);
    if (prevTimer) {
      clearTimeout(prevTimer);
      log?.(`vote: debounce — cancelled pending PATCH (pollId=${pollId})`);
    }
    const capturedMessageId = messageId;
    const capturedCard = updatedCard;
    const timer = setTimeout(async () => {
      patchTimers.delete(pollId);
      try {
        await updateCardFeishu({ cfg, messageId: capturedMessageId, card: capturedCard });
        log?.(`vote: debounced PATCH sent (pollId=${pollId})`);
      } catch (err) {
        log?.(`vote: debounced PATCH failed: ${String(err)}`);
      }
    }, PATCH_DELAY_MS);
    patchTimers.set(pollId, timer);
  });

  // Return toast for immediate user feedback (click registered).
  return { toast: { type: "success" as const, content: "已投票" } };
}

/**
 * Check if an action value is a vote action.
 */
export function isVoteAction(actionValue: Record<string, unknown> | undefined): boolean {
  if (!actionValue) return false;
  const action = actionValue.action;
  return action === "vote_toggle" || action === "vote_close";
}

/**
 * Get a poll by ID (from file).
 */
export async function getPoll(pollId: string): Promise<VoteData | undefined> {
  return (await loadVoteData(pollId)) ?? undefined;
}
