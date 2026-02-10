import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as Lark from "@larksuiteoapi/node-sdk";
import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "clawdbot/plugin-sdk";
import type { FeishuConfig } from "./types.js";
import { createFeishuWSClient, createEventDispatcher } from "./client.js";
import { resolveFeishuCredentials } from "./accounts.js";
import { handleFeishuMessage, type FeishuMessageEvent, type FeishuBotAddedEvent } from "./bot.js";
import { handleMediaCardAction, isMediaConfirmAction, buildProcessingCard, buildCancelledCard, buildExpiredCard, type CardActionEvent } from "./features/media-confirm.js";
import { handleVoteCardAction, isVoteAction } from "./features/vote/index.js";
import { handleBitableVideoCardAction, isBitableVideoAction } from "./features/big-video/bitable-video-confirm.js";
import { probeFeishu } from "./probe.js";
import { analyzeVideo, resolveVideoProvider } from "./features/video-analyze.js";
import { sendCardFeishu, updateCardFeishu } from "./api/send.js";
import { formatFileSize } from "./features/cost-estimator.js";
import { isDevLockEnabled, isFeishuAdmin, markFeishuUserActive, startInFlightJob, endInFlightJob } from "./features/dev-lock.js";
import { startFeishuProjectApi } from "./services/project-api.js";
import { startFeishuTaskApi } from "./services/task-api.js";
import { startFeishuBitableApi } from "./services/bitable-api.js";
import { startSheetsApi } from "./services/sheets-api.js";

export type MonitorFeishuOpts = {
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
};

let currentWsClient: Lark.WSClient | null = null;
let botOpenId: string | undefined;

async function fetchBotOpenId(cfg: FeishuConfig): Promise<string | undefined> {
  try {
    const result = await probeFeishu(cfg);
    return result.ok ? result.botOpenId : undefined;
  } catch {
    return undefined;
  }
}

export async function monitorFeishuProvider(opts: MonitorFeishuOpts = {}): Promise<void> {
  const cfg = opts.config;
  if (!cfg) {
    throw new Error("Config is required for Feishu monitor");
  }

  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  const creds = resolveFeishuCredentials(feishuCfg);
  if (!creds) {
    throw new Error("Feishu credentials not configured (appId, appSecret required)");
  }

  const log = opts.runtime?.log ?? console.log;
  const error = opts.runtime?.error ?? console.error;

  // 启动飞书项目 HTTP API
  startFeishuProjectApi(feishuCfg, log);

  // 启动飞书任务 HTTP API
  startFeishuTaskApi(feishuCfg, log);

  // 启动飞书多维表格 HTTP API
  startFeishuBitableApi(feishuCfg, log);

  // 启动飞书电子表格 HTTP API
  startSheetsApi(feishuCfg);

  if (feishuCfg) {
    botOpenId = await fetchBotOpenId(feishuCfg);
    log(`feishu: bot open_id resolved: ${botOpenId ?? "unknown"}`);
  }

  const connectionMode = feishuCfg?.connectionMode ?? "websocket";

  if (connectionMode === "websocket") {
    return monitorWebSocket({ cfg, feishuCfg: feishuCfg!, runtime: opts.runtime, abortSignal: opts.abortSignal });
  }

  log("feishu: webhook mode not implemented in monitor, use HTTP server directly");
}

async function monitorWebSocket(params: {
  cfg: ClawdbotConfig;
  feishuCfg: FeishuConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { cfg, feishuCfg, runtime, abortSignal } = params;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  log("feishu: starting WebSocket connection...");

  const wsClient = createFeishuWSClient(feishuCfg);
  currentWsClient = wsClient;

  const chatHistories = new Map<string, HistoryEntry[]>();

  // ─── Message deduplication ─────────────────────────────────────────────────
  // Feishu WebSocket may re-deliver events on reconnect (even hours later).
  // Persist recent message_ids to disk so restarts don't lose dedup state.
  const DEDUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  const DEDUP_FILE = path.join(
    process.env.CLAWDBOT_DATA_DIR || path.join(os.homedir(), ".clawdbot"),
    "feishu-dedup.json",
  );
  const recentMessageIds = new Map<string, number>();

  // Load persisted dedup state on startup
  try {
    const raw = fs.readFileSync(DEDUP_FILE, "utf-8");
    const entries = JSON.parse(raw) as [string, number][];
    const now = Date.now();
    for (const [id, ts] of entries) {
      if (now - ts < DEDUP_TTL_MS) recentMessageIds.set(id, ts);
    }
    log(`feishu: loaded ${recentMessageIds.size} dedup entries from disk`);
  } catch {
    // File doesn't exist or is corrupt — start fresh
  }

  function persistDedup(): void {
    try {
      fs.writeFileSync(DEDUP_FILE, JSON.stringify([...recentMessageIds]), "utf-8");
    } catch {
      // Non-fatal — dedup still works in-memory
    }
  }

  function isDuplicateMessage(messageId: string): boolean {
    const now = Date.now();
    // Purge expired entries
    for (const [id, ts] of recentMessageIds) {
      if (now - ts > DEDUP_TTL_MS) recentMessageIds.delete(id);
    }
    if (recentMessageIds.has(messageId)) return true;
    recentMessageIds.set(messageId, now);
    persistDedup();
    return false;
  }

  const eventDispatcher = createEventDispatcher(feishuCfg);

  eventDispatcher.register({
    "im.message.receive_v1": async (data) => {
      const event = data as unknown as FeishuMessageEvent;
      const messageId = event.message?.message_id;
      if (messageId && isDuplicateMessage(messageId)) {
        log(`feishu: skipping duplicate message (id=${messageId})`);
        return;
      }
      // Fire-and-forget: return immediately so SDK sends ACK to Feishu,
      // avoiding timeout-triggered re-delivery of the same message.
      void (async () => {
        try {
          await handleFeishuMessage({
            cfg,
            event,
            botOpenId,
            runtime,
            chatHistories,
          });
        } catch (err) {
          error(`feishu: error handling message event: ${String(err)}`);
        }
      })();
    },
    "im.message.message_read_v1": async () => {
      // Ignore read receipts
    },
    "im.chat.member.bot.added_v1": async (data) => {
      try {
        const event = data as unknown as FeishuBotAddedEvent;
        log(`feishu: bot added to chat ${event.chat_id}`);
      } catch (err) {
        error(`feishu: error handling bot added event: ${String(err)}`);
      }
    },
    "im.chat.member.bot.deleted_v1": async (data) => {
      try {
        const event = data as unknown as { chat_id: string };
        log(`feishu: bot removed from chat ${event.chat_id}`);
      } catch (err) {
        error(`feishu: error handling bot removed event: ${String(err)}`);
      }
    },
    "card.action.trigger": async (data) => {
      try {
        const actionData = data as unknown as CardActionEvent;
        const actionValue = actionData.action?.value as Record<string, unknown> | undefined;
        log(`feishu: received card action callback`);

        const operatorId = actionData.operator?.open_id || actionData.operator?.user_id || "";
        const operatorIsAdmin = operatorId ? isFeishuAdmin({ cfg, senderId: operatorId }) : false;
        if (operatorId) {
          markFeishuUserActive({ userId: operatorId, isAdmin: operatorIsAdmin });
        }

        const actionName = actionValue?.action as string | undefined;
        if (isDevLockEnabled() && !operatorIsAdmin) {
          const allowDuringLock = actionName === "cancel_media" ||
            actionName === "cancel_bitable_video" ||
            actionName === "cancel_bitable_video_job";
          if (!allowDuringLock) {
            return { toast: { type: "info" as const, content: "后端更新中，请稍后重试" } };
          }
        }

        // Route to the appropriate handler based on action type
        if (isMediaConfirmAction(actionValue)) {
          const action = actionValue?.action as string | undefined;
          const confirmed = await handleMediaCardAction({
            actionData,
            log,
          });

          // Cancel or expired — use delayed PATCH (same pattern as bitable-video-confirm).
          // Callback return card is unreliable via WebSocket; delayed PATCH avoids transaction rollback.
          if (!confirmed) {
            const isCancelAction = action === "cancel_media";
            const cardMessageId = actionData.context?.open_message_id;
            if (isCancelAction) {
              log(`feishu: media cancel — delayed PATCH to cancelled card`);
              if (cardMessageId) {
                const msgId = cardMessageId;
                setTimeout(async () => {
                  try {
                    await updateCardFeishu({ cfg, messageId: msgId, card: buildCancelledCard("video") });
                    log(`feishu: media cancel delayed PATCH succeeded (messageId=${msgId})`);
                  } catch (err) {
                    log(`feishu: media cancel delayed PATCH failed: ${String(err)}`);
                  }
                }, 500);
              }
              return undefined;
            }
            log(`feishu: media expired — delayed PATCH to expired card`);
            if (cardMessageId) {
              const msgId = cardMessageId;
              setTimeout(async () => {
                try {
                  await updateCardFeishu({ cfg, messageId: msgId, card: buildExpiredCard() });
                  log(`feishu: media expired delayed PATCH succeeded (messageId=${msgId})`);
                } catch (err) {
                  log(`feishu: media expired delayed PATCH failed: ${String(err)}`);
                }
              }, 500);
            }
            return undefined;
          }

          if (confirmed) {
            // Check if this is a video that should be auto-analyzed with Gemini
            const hasVideo = confirmed.mediaType === "video" ||
              confirmed.mediaList.some((m) => m.contentType?.startsWith("video/"));

            if (hasVideo) {
              // Fire-and-forget: run video analysis without blocking the event loop
              const confirmedRef = confirmed;
              const inFlightKey = `feishu:media-video:${confirmedRef.id}`;
              const senderIsAdmin = confirmedRef.senderOpenId
                ? isFeishuAdmin({ cfg, senderId: confirmedRef.senderOpenId })
                : false;
              startInFlightJob({
                key: inFlightKey,
                senderId: confirmedRef.senderOpenId || "unknown",
                isAdmin: senderIsAdmin,
              });
              log(`feishu: starting async video analysis (pendingId=${confirmedRef.id})`);
              // Update card to "processing" via delayed PATCH (after callback response completes).
              void (async () => {
                try {
                  const videoMedia = confirmedRef.mediaList.find(
                    (m) => m.contentType?.startsWith("video/") && m.path,
                  );
                  if (videoMedia) {
                    // Init GCS config in case analyzeVideo needs to auto-escalate to GCS for >20MB videos
                    const { initGcsConfig } = await import("./features/big-video/gcs-upload.js");
                    initGcsConfig(cfg);
                    const videoProvider = (() => {
                      try { return resolveVideoProvider(cfg); }
                      catch { return undefined; }
                    })();
                    const result = await analyzeVideo(videoMedia.path, { log, provider: videoProvider });

                    // Build result card
                    const costStr = result.estimatedCostUsd != null
                      ? `$${result.estimatedCostUsd.toFixed(4)}`
                      : "未知";
                    const durationStr = `${(result.durationMs / 1000).toFixed(1)}s`;
                    const tokensStr = result.usage
                      ? `${result.usage.promptTokens} → ${result.usage.completionTokens}`
                      : "未知";

                    const target = confirmedRef.event.message.chat_type === "p2p"
                      ? `user:${confirmedRef.senderOpenId}`
                      : `chat:${confirmedRef.chatId}`;

                    await sendCardFeishu({
                      cfg,
                      to: target,
                      card: {
                        config: { wide_screen_mode: true },
                        header: {
                          title: { tag: "plain_text", content: "🎬 视频分析完成" },
                          template: "green",
                        },
                        elements: [
                          {
                            tag: "markdown",
                            content: result.text,
                          },
                          { tag: "hr" },
                          {
                            tag: "note",
                            elements: [
                              {
                                tag: "plain_text",
                                content: `模型: ${result.model} | 耗时: ${durationStr} | Tokens: ${tokensStr} | 成本: ${costStr}`,
                              },
                            ],
                          },
                        ],
                      },
                      replyToMessageId: confirmedRef.event.message.message_id,
                    });

                    // Update the confirmation card to show completion
                    try {
                      await updateCardFeishu({
                        cfg,
                        messageId: confirmedRef.cardMessageId,
                        card: {
                          config: { wide_screen_mode: true },
                          header: {
                            title: { tag: "plain_text", content: "🎬 视频消息 — 分析完成" },
                            template: "green",
                          },
                          elements: [
                            {
                              tag: "markdown",
                              content: `✅ 分析完成（${durationStr}，${costStr}）`,
                            },
                          ],
                        },
                      });
                    } catch (updateErr) {
                      log(`feishu: failed to update confirmation card: ${String(updateErr)}`);
                    }

                    log(`feishu: video analysis sent to chat (pendingId=${confirmedRef.id})`);
                  } else {
                    log(`feishu: no valid video file found in media list, falling back to agent dispatch`);
                    await handleFeishuMessage({
                      cfg,
                      event: confirmedRef.event,
                      botOpenId,
                      runtime,
                      chatHistories,
                      skipMediaConfirm: true,
                      preResolvedMediaList: confirmedRef.mediaList,
                    });
                  }
                } catch (analyzeErr) {
                  error(`feishu: video analysis failed: ${String(analyzeErr)}`);
                  const target = confirmedRef.event.message.chat_type === "p2p"
                    ? `user:${confirmedRef.senderOpenId}`
                    : `chat:${confirmedRef.chatId}`;
                  try {
                    await sendCardFeishu({
                      cfg,
                      to: target,
                      card: {
                        config: { wide_screen_mode: true },
                        header: {
                          title: { tag: "plain_text", content: "🎬 视频分析失败" },
                          template: "red",
                        },
                        elements: [
                          {
                            tag: "markdown",
                            content: `分析过程中出现错误：\n\n${String(analyzeErr)}`,
                          },
                        ],
                      },
                      replyToMessageId: confirmedRef.event.message.message_id,
                    });
                  } catch {
                    // Ignore card send errors
                  }

                  // Fall back to normal agent dispatch
                  await handleFeishuMessage({
                    cfg,
                    event: confirmedRef.event,
                    botOpenId,
                    runtime,
                    chatHistories,
                    skipMediaConfirm: true,
                    preResolvedMediaList: confirmedRef.mediaList,
                  });
                }
                finally {
                  endInFlightJob(inFlightKey);
                }
              })();
              // Delayed PATCH to processing card (after callback response completes)
              const confirmCardMsgId = confirmed.cardMessageId || actionData.context?.open_message_id;
              if (confirmCardMsgId) {
                const msgId = confirmCardMsgId;
                setTimeout(async () => {
                  try {
                    await updateCardFeishu({ cfg, messageId: msgId, card: buildProcessingCard(confirmed.mediaType) });
                    log(`feishu: media confirm delayed PATCH to processing succeeded (messageId=${msgId})`);
                  } catch (err) {
                    log(`feishu: media confirm delayed PATCH failed: ${String(err)}`);
                  }
                }, 500);
              }
              return undefined;
            } else {
              // Non-video media (audio, etc.) — resume normal agent dispatch
              log(`feishu: resuming media processing after confirmation (pendingId=${confirmed.id})`);
              void handleFeishuMessage({
                cfg,
                event: confirmed.event,
                botOpenId,
                runtime,
                chatHistories,
                skipMediaConfirm: true,
                preResolvedMediaList: confirmed.mediaList,
              });
              // Delayed PATCH to processing card
              const audioCardMsgId = confirmed.cardMessageId || actionData.context?.open_message_id;
              if (audioCardMsgId) {
                const msgId = audioCardMsgId;
                setTimeout(async () => {
                  try {
                    await updateCardFeishu({ cfg, messageId: msgId, card: buildProcessingCard(confirmed.mediaType) });
                    log(`feishu: media confirm delayed PATCH to processing succeeded (messageId=${msgId})`);
                  } catch (err) {
                    log(`feishu: media confirm delayed PATCH failed: ${String(err)}`);
                  }
                }, 500);
              }
              return undefined;
            }
          }
          return;
        }

        if (isBitableVideoAction(actionValue)) {
          const cardResponse = await handleBitableVideoCardAction({ actionData, cfg, log });
          log(`feishu: bitable video callback response type=${cardResponse ? typeof cardResponse : 'undefined'}, keys=${cardResponse ? Object.keys(cardResponse).join(',') : 'none'}`);
          return cardResponse ?? undefined;
        }

        if (isVoteAction(actionValue)) {
          const response = await handleVoteCardAction({ actionData, cfg, log });
          // Return toast for immediate feedback; debounced PATCH updates the card.
          return response ?? undefined;
        }

        // Unknown card action — try media confirm as fallback (backward compat)
        const confirmed = await handleMediaCardAction({
          actionData,
          log,
        });

        if (confirmed) {
          log(`feishu: resuming media processing after confirmation (pendingId=${confirmed.id})`);
          void handleFeishuMessage({
            cfg,
            event: confirmed.event,
            botOpenId,
            runtime,
            chatHistories,
            skipMediaConfirm: true,
            preResolvedMediaList: confirmed.mediaList,
          });
          return { toast: { type: "info" as const, content: "⏳ 正在处理中..." } };
        }
      } catch (err) {
        error(`feishu: error handling card action: ${String(err)}`);
      }
    },
  });

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (currentWsClient === wsClient) {
        currentWsClient = null;
      }
    };

    const handleAbort = () => {
      log("feishu: abort signal received, stopping WebSocket client");
      cleanup();
      resolve();
    };

    if (abortSignal?.aborted) {
      cleanup();
      resolve();
      return;
    }

    abortSignal?.addEventListener("abort", handleAbort, { once: true });

    try {
      wsClient.start({
        eventDispatcher,
      });

      log("feishu: WebSocket client started");
    } catch (err) {
      cleanup();
      abortSignal?.removeEventListener("abort", handleAbort);
      reject(err);
    }
  });
}

export function stopFeishuMonitor(): void {
  if (currentWsClient) {
    currentWsClient = null;
  }
}
