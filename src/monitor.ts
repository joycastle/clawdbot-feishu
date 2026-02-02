import * as Lark from "@larksuiteoapi/node-sdk";
import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "clawdbot/plugin-sdk";
import type { FeishuConfig } from "./types.js";
import { createFeishuWSClient, createEventDispatcher } from "./client.js";
import { resolveFeishuCredentials } from "./accounts.js";
import { handleFeishuMessage, type FeishuMessageEvent, type FeishuBotAddedEvent } from "./bot.js";
import { handleMediaCardAction, isMediaConfirmAction, type CardActionEvent } from "./media-confirm.js";
import { handleModelSwitchCardAction, isModelSwitchAction } from "./model-switch.js";
import { handleVoteCardAction, isVoteAction } from "./vote.js";
import { probeFeishu } from "./probe.js";
import { analyzeVideo } from "./video-analyze.js";
import { sendCardFeishu, updateCardFeishu } from "./send.js";
import { formatFileSize } from "./cost-estimator.js";

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

  const eventDispatcher = createEventDispatcher(feishuCfg);

  eventDispatcher.register({
    "im.message.receive_v1": async (data) => {
      try {
        const event = data as unknown as FeishuMessageEvent;
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

        // Route to the appropriate handler based on action type
        if (isModelSwitchAction(actionValue)) {
          const result = await handleModelSwitchCardAction({ actionData, log });
          if (result) {
            // User confirmed or skipped model switch — resume message processing
            log(`feishu: resuming after model switch (switched=${result.switched}, pendingId=${result.entry.id})`);
            await handleFeishuMessage({
              cfg,
              event: result.entry.event,
              botOpenId: result.entry.botOpenId,
              runtime,
              chatHistories,
              skipModelSwitch: true,
            });
          }
          return;
        }

        if (isMediaConfirmAction(actionValue)) {
          const confirmed = await handleMediaCardAction({
            actionData,
            log,
          });

          if (confirmed) {
            // Check if this is a video that should be auto-analyzed with Gemini
            const hasVideo = confirmed.mediaType === "video" ||
              confirmed.mediaList.some((m) => m.contentType?.startsWith("video/"));

            if (hasVideo) {
              // Auto-analyze video with Gemini — send result directly to chat
              log(`feishu: auto-analyzing video with Gemini (pendingId=${confirmed.id})`);
              try {
                const videoMedia = confirmed.mediaList.find(
                  (m) => m.contentType?.startsWith("video/") && m.path,
                );
                if (videoMedia) {
                  const result = await analyzeVideo(videoMedia.path, { log });

                  // Build result card
                  const costStr = result.estimatedCostUsd != null
                    ? `$${result.estimatedCostUsd.toFixed(4)}`
                    : "未知";
                  const durationStr = `${(result.durationMs / 1000).toFixed(1)}s`;
                  const tokensStr = result.usage
                    ? `${result.usage.promptTokens} → ${result.usage.completionTokens}`
                    : "未知";

                  const target = confirmed.event.message.chat_type === "p2p"
                    ? `user:${confirmed.senderOpenId}`
                    : `chat:${confirmed.chatId}`;

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
                    replyToMessageId: confirmed.event.message.message_id,
                  });

                  // Update the confirmation card to show completion
                  try {
                    await updateCardFeishu({
                      cfg,
                      messageId: confirmed.cardMessageId,
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

                  log(`feishu: video analysis sent to chat (pendingId=${confirmed.id})`);
                } else {
                  log(`feishu: no valid video file found in media list, falling back to agent dispatch`);
                  // Fall back to agent dispatch
                  await handleFeishuMessage({
                    cfg,
                    event: confirmed.event,
                    botOpenId,
                    runtime,
                    chatHistories,
                    skipMediaConfirm: true,
                    preResolvedMediaList: confirmed.mediaList,
                  });
                }
              } catch (analyzeErr) {
                error(`feishu: video analysis failed: ${String(analyzeErr)}`);
                // Send error card
                const target = confirmed.event.message.chat_type === "p2p"
                  ? `user:${confirmed.senderOpenId}`
                  : `chat:${confirmed.chatId}`;
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
                    replyToMessageId: confirmed.event.message.message_id,
                  });
                } catch {
                  // Ignore card send errors
                }

                // Fall back to normal agent dispatch
                await handleFeishuMessage({
                  cfg,
                  event: confirmed.event,
                  botOpenId,
                  runtime,
                  chatHistories,
                  skipMediaConfirm: true,
                  preResolvedMediaList: confirmed.mediaList,
                });
              }
            } else {
              // Non-video media (audio, etc.) — resume normal agent dispatch
              log(`feishu: resuming media processing after confirmation (pendingId=${confirmed.id})`);
              await handleFeishuMessage({
                cfg,
                event: confirmed.event,
                botOpenId,
                runtime,
                chatHistories,
                skipMediaConfirm: true,
                preResolvedMediaList: confirmed.mediaList,
              });
            }
          }
          return;
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
          await handleFeishuMessage({
            cfg,
            event: confirmed.event,
            botOpenId,
            runtime,
            chatHistories,
            skipMediaConfirm: true,
            preResolvedMediaList: confirmed.mediaList,
          });
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
