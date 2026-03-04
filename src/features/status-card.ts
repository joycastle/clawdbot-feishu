import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import type { FeishuConfig } from "../types.js";
import { createFeishuClient } from "../client.js";

export type StatusCardState = {
  triggerMessageId: string;  // 用户消息 ID，用于 session 隔离
  cardMessageId: string | null;  // 卡片消息 ID，用于更新
  status: "running" | "completed" | "aborted";
};

// 状态卡片存储，按 triggerMessageId 隔离
const statusCardStore = new Map<string, StatusCardState>();

/**
 * 构建状态卡片内容
 */
function buildStatusCard(status: "running" | "completed" | "aborted"): object {
  const statusConfig = {
    running: {
      icon: "🔄",
      text: "处理中...",
      color: "blue",
      template: "blue",
    },
    completed: {
      icon: "✅", 
      text: "已完成",
      color: "green",
      template: "green",
    },
    aborted: {
      icon: "⚠️",
      text: "已中断",
      color: "orange", 
      template: "orange",
    },
  };

  const cfg = statusConfig[status];

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: cfg.template,
      title: {
        tag: "plain_text",
        content: `${cfg.icon} ${cfg.text}`,
      },
    },
    elements: status === "running" ? [
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: {
              tag: "plain_text",
              content: "🛑 中断",
            },
            type: "danger",
            value: {
              action: "abort",
            },
          },
        ],
      },
    ] : [],
  };
}

/**
 * 发送状态卡片（开始处理时调用）
 */
export async function sendStatusCard(params: {
  cfg: ClawdbotConfig;
  chatId: string;
  triggerMessageId: string;
  replyToMessageId?: string;
}): Promise<StatusCardState> {
  const { cfg, chatId, triggerMessageId, replyToMessageId } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  
  const state: StatusCardState = {
    triggerMessageId,
    cardMessageId: null,
    status: "running",
  };

  if (!feishuCfg) {
    return state;
  }

  const client = createFeishuClient(feishuCfg);
  const card = buildStatusCard("running");

  try {
    const response = await client.im.message.create({
      params: { receive_id_type: chatId.startsWith("oc_") ? "chat_id" : "open_id" },
      data: {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(card),
        ...(replyToMessageId ? { reply_in_thread: false } : {}),
      },
    });

    state.cardMessageId = (response as any)?.data?.message_id ?? null;
    statusCardStore.set(triggerMessageId, state);
    
    return state;
  } catch (err) {
    console.log(`[feishu] failed to send status card: ${err}`);
    return state;
  }
}

/**
 * 更新状态卡片（状态变化时调用）
 */
export async function updateStatusCard(params: {
  cfg: ClawdbotConfig;
  triggerMessageId: string;
  status: "running" | "completed" | "aborted";
}): Promise<void> {
  const { cfg, triggerMessageId, status } = params;
  const state = statusCardStore.get(triggerMessageId);
  
  if (!state?.cardMessageId) {
    return;
  }

  // Skip if already in the target status
  if (state.status === status) {
    return;
  }

  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    return;
  }

  const client = createFeishuClient(feishuCfg);
  const card = buildStatusCard(status);

  try {
    await client.im.message.patch({
      path: { message_id: state.cardMessageId },
      data: {
        content: JSON.stringify(card),
      },
    });

    state.status = status;
    statusCardStore.set(triggerMessageId, state);
  } catch (err) {
    console.log(`[feishu] failed to update status card: ${err}`);
  }
}

/**
 * 删除状态卡片（可选，清理用）
 */
export async function deleteStatusCard(params: {
  cfg: ClawdbotConfig;
  triggerMessageId: string;
}): Promise<void> {
  const { cfg, triggerMessageId } = params;
  const state = statusCardStore.get(triggerMessageId);
  
  if (!state?.cardMessageId) {
    statusCardStore.delete(triggerMessageId);
    return;
  }

  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    statusCardStore.delete(triggerMessageId);
    return;
  }

  const client = createFeishuClient(feishuCfg);

  try {
    await client.im.message.delete({
      path: { message_id: state.cardMessageId },
    });
  } catch (err) {
    console.log(`[feishu] failed to delete status card: ${err}`);
  }

  statusCardStore.delete(triggerMessageId);
}

/**
 * 获取状态卡片状态
 */
export function getStatusCardState(triggerMessageId: string): StatusCardState | undefined {
  return statusCardStore.get(triggerMessageId);
}

/**
 * 清理过期的状态卡片（可选，定期清理用）
 */
export function cleanupStatusCards(maxAgeMs: number = 30 * 60 * 1000): void {
  // 简单实现：只保留最近 100 条
  if (statusCardStore.size > 100) {
    const keys = Array.from(statusCardStore.keys());
    const toDelete = keys.slice(0, keys.length - 100);
    toDelete.forEach(key => statusCardStore.delete(key));
  }
}

/**
 * 检查是否是状态卡片的中断 action
 */
export function isStatusCardAbortAction(actionValue: Record<string, unknown> | undefined): boolean {
  if (!actionValue) return false;
  return actionValue.action === "abort";
}

/**
 * 构建已中断状态的卡片
 */
export function buildAbortedCard(): object {
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: "orange",
      title: {
        tag: "plain_text",
        content: "⚠️ 已中断",
      },
    },
    elements: [],
  };
}
