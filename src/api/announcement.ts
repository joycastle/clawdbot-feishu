import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import type { FeishuConfig } from "../types.js";
import { createFeishuClient } from "../client.js";

export type AnnouncementInfo = {
  content: string;
  revision: string;
  createTime: string;
  updateTime: string;
  ownerIdType: string;
  ownerId: string;
  modifierIdType: string;
  modifierId: string;
  // For docx type announcements
  docToken?: string;
};

/**
 * Get group announcement content.
 * Note: Modern Feishu announcements use docx format. This function will:
 * 1. Try the standard API first
 * 2. If it fails with docx error (232097), get chat info to find the document token
 * @see https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/chat-announcement/get
 */
export async function getAnnouncementFeishu(params: {
  cfg: ClawdbotConfig;
  chatId: string;
  userIdType?: "open_id" | "union_id" | "user_id";
}): Promise<AnnouncementInfo | null> {
  const { cfg, chatId, userIdType = "open_id" } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);

  try {
    const response = (await client.im.chatAnnouncement.get({
      path: { chat_id: chatId },
      params: { user_id_type: userIdType },
    })) as {
      code?: number;
      msg?: string;
      data?: {
        content?: string;
        revision?: string;
        create_time?: string;
        update_time?: string;
        owner_id_type?: string;
        owner_id?: string;
        modifier_id_type?: string;
        modifier_id?: string;
      };
    };

    if (response.code !== 0) {
      // Check if it's the docx type error
      if (response.code === 232097) {
        return getDocxAnnouncement(client, chatId, userIdType);
      }
      throw new Error(`Feishu get announcement failed: ${response.msg || `code ${response.code}`}`);
    }

    const data = response.data;
    if (!data || !data.content) {
      return null;
    }

    return {
      content: data.content ?? "",
      revision: data.revision ?? "",
      createTime: data.create_time ?? "",
      updateTime: data.update_time ?? "",
      ownerIdType: data.owner_id_type ?? "",
      ownerId: data.owner_id ?? "",
      modifierIdType: data.modifier_id_type ?? "",
      modifierId: data.modifier_id ?? "",
    };
  } catch (err: unknown) {
    // Check if it's the docx type error (232097) - SDK may throw directly
    const errStr = JSON.stringify(err);
    if (errStr.includes("232097") || errStr.includes("docx type")) {
      // Try to get the announcement document token from chat info
      return getDocxAnnouncement(client, chatId, userIdType);
    }
    throw err;
  }
}

/**
 * Get docx-type announcement by fetching the document content.
 */
async function getDocxAnnouncement(
  client: ReturnType<typeof createFeishuClient>,
  chatId: string,
  userIdType: string
): Promise<AnnouncementInfo | null> {
  // Get chat info which includes announcement document info
  const chatResponse = (await client.im.chat.get({
    path: { chat_id: chatId },
    params: { user_id_type: userIdType },
  })) as {
    code?: number;
    msg?: string;
    data?: {
      announcement?: {
        doc_token?: string;
        revision?: string;
        update_time?: string;
      };
    };
  };

  if (chatResponse.code !== 0) {
    throw new Error(`Feishu get chat failed: ${chatResponse.msg || `code ${chatResponse.code}`}`);
  }

  const announcementInfo = chatResponse.data?.announcement;
  if (!announcementInfo?.doc_token) {
    return null;
  }

  const docToken = announcementInfo.doc_token;

  // Get document raw content
  const docResponse = (await client.docx.documentRawContent({
    path: { document_id: docToken },
    params: { lang: 0 },
  })) as {
    code?: number;
    msg?: string;
    data?: {
      content?: string;
    };
  };

  if (docResponse.code !== 0) {
    throw new Error(`Feishu get document failed: ${docResponse.msg || `code ${docResponse.code}`}`);
  }

  return {
    content: docResponse.data?.content ?? "",
    revision: announcementInfo.revision ?? "",
    createTime: "",
    updateTime: announcementInfo.update_time ?? "",
    ownerIdType: "",
    ownerId: "",
    modifierIdType: "",
    modifierId: "",
    docToken,
  };
}

/**
 * Update/patch group announcement content.
 * @see https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/chat-announcement/patch
 */
export async function updateAnnouncementFeishu(params: {
  cfg: ClawdbotConfig;
  chatId: string;
  revision: string;
  content?: string;
}): Promise<void> {
  const { cfg, chatId, revision, content } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);

  const response = (await client.im.chatAnnouncement.patch({
    path: { chat_id: chatId },
    data: {
      revision,
      requests: content ? ["content"] : [],
      content,
    },
  })) as { code?: number; msg?: string };

  if (response.code !== 0) {
    throw new Error(`Feishu update announcement failed: ${response.msg || `code ${response.code}`}`);
  }
}
