/**
 * 群欢迎新人功能
 * 
 * 当新成员加入白名单群时，自动发送欢迎消息。
 * - 根据入职日期判断新人/老员工
 * - 随机选择人设风格
 * - 根据群配置发送相应文档
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import type { FeishuConfig } from "../types.js";
import { createFeishuClient } from "../client.js";
import { sendMessageFeishu } from "../api/send.js";

// ─── 配置 ─────────────────────────────────────────────────────────────────────

/** 白名单群配置 */
interface GroupConfig {
  chatId: string;
  name: string;
  docs: { name: string; url: string }[];
}

/** 岗位文档配置 */
interface RoleDocsConfig {
  [role: string]: { name: string; url: string }[];
}

/** 人设风格 */
interface Persona {
  name: string;
  newHireGreeting: string;
  oldEmployeeGreeting: string;
}

// 白名单群
const WELCOME_GROUPS: GroupConfig[] = [
  {
    chatId: "oc_8c20d2d6335231e679d2d2abc95f52bc",
    name: "格式塔大群",
    docs: [
      { name: "人员排期文档", url: "https://joycastle.feishu.cn/wiki/wikcnkot4X55otMpYPfitUtpMKf" },
      { name: "价值观说明文档", url: "https://joycastle.feishu.cn/wiki/Jic5wCtpviMsnkkh28AcrwVbnHf" },
    ],
  },
  {
    chatId: "oc_5252ab2e5ba8be93e3d74f2d46df622e",
    name: "BF研发大群",
    docs: [], // 格式塔大群已发，不重复发
  },
  {
    chatId: "oc_f4e9cc8fc4e19df7627026f16ebab054",
    name: "BV研发大群",
    docs: [], // 格式塔大群已发，不重复发
  },
];

// 岗位文档（由各 leader 指定，待补充）
const ROLE_DOCS: RoleDocsConfig = {
  // 后端: [{ name: "后端开发指南", url: "..." }],
  // 前端: [{ name: "前端开发指南", url: "..." }],
};

// 人设风格
const PERSONAS: Persona[] = [
  {
    name: "热情小哥",
    newHireGreeting: "哇！欢迎欢迎～我是王总，群里的 AI 助手！有啥问题随时 @ 我哈，不用客气～",
    oldEmployeeGreeting: "诶！老熟人来啦，欢迎欢迎～",
  },
  {
    name: "幽默大叔",
    newHireGreeting: "又来新战友了！欢迎入坑～我是王总，群里的打杂 AI。有事找我，没事...也可以找我聊天。",
    oldEmployeeGreeting: "哟，这不是老朋友嘛，换坑位了？欢迎欢迎！",
  },
  {
    name: "傲娇学姐",
    newHireGreeting: "哼，又来新人了...才、才不是特意来欢迎你的！我是王总，有问题可以问我啦...不过别问太笨的问题哦！",
    oldEmployeeGreeting: "诶？你怎么来了...不是说想你了啦！别误会！",
  },
  {
    name: "二次元萌娘",
    newHireGreeting: "欸嘿～新伙伴来啦！٩(๑>◡<๑)۶ 我是王总！有问题尽管问我哦～",
    oldEmployeeGreeting: "啊！是认识的人！欢迎欢迎～ ✧*。",
  },
];

// 新人阈值（入职天数）
const NEW_HIRE_THRESHOLD_DAYS = 30;

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 检查是否在白名单群 */
function getGroupConfig(chatId: string): GroupConfig | undefined {
  return WELCOME_GROUPS.find((g) => g.chatId === chatId);
}

/** 随机选择人设 */
function randomPersona(): Persona {
  return PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
}

/** 判断是否为新人（入职天数 < 阈值） */
function isNewHire(hireDate: string | undefined): boolean {
  if (!hireDate) return true; // 拿不到日期按新人处理
  
  const hire = new Date(hireDate);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - hire.getTime()) / (1000 * 60 * 60 * 24));
  
  return diffDays < NEW_HIRE_THRESHOLD_DAYS;
}

/** 获取用户信息 */
async function getUserInfo(
  client: ReturnType<typeof createFeishuClient>,
  openId: string,
): Promise<{ name: string; hireDate?: string; department?: string }> {
  try {
    const response = await client.contact.user.get({
      path: { user_id: openId },
      params: { user_id_type: "open_id" },
    }) as {
      code?: number;
      data?: {
        user?: {
          name?: string;
          en_name?: string;
          join_time?: number; // Unix timestamp in seconds
          department_ids?: string[];
        };
      };
    };

    if (response.code !== 0 || !response.data?.user) {
      return { name: "新朋友" };
    }

    const user = response.data.user;
    const name = user.name || user.en_name || "新朋友";
    
    // join_time 是 Unix 时间戳（秒）
    let hireDate: string | undefined;
    if (user.join_time) {
      hireDate = new Date(user.join_time * 1000).toISOString().split("T")[0];
    }

    return { name, hireDate };
  } catch (err) {
    console.error(`[welcome] Failed to get user info: ${String(err)}`);
    return { name: "新朋友" };
  }
}

/** 构建欢迎消息 */
function buildWelcomeMessage(params: {
  userName: string;
  userOpenId: string;
  isNew: boolean;
  persona: Persona;
  docs: { name: string; url: string }[];
}): string {
  const { userName, userOpenId, isNew, persona, docs } = params;

  // 飞书 @ 格式：<at user_id="open_id">名字</at>
  let message = `<at user_id="${userOpenId}">${userName}</at> `;
  message += isNew ? persona.newHireGreeting : persona.oldEmployeeGreeting;

  if (isNew && docs.length > 0) {
    message += "\n\n📚 这些文档可能对你有帮助：";
    for (const doc of docs) {
      message += `\n• [${doc.name}](${doc.url})`;
    }
  }

  return message;
}

// ─── 主入口 ─────────────────────────────────────────────────────────────────────

export interface MemberAddedEvent {
  chat_id: string;
  operator_id?: { open_id?: string };
  users?: Array<{
    user_id?: { open_id?: string };
    tenant_key?: string;
  }>;
}

export async function handleMemberAdded(params: {
  cfg: ClawdbotConfig;
  event: MemberAddedEvent;
  botOpenId?: string;
  log?: (...args: unknown[]) => void;
}): Promise<void> {
  const { cfg, event, botOpenId, log = console.log } = params;
  const { chat_id: chatId, users } = event;

  // 1. 检查是否在白名单群
  const groupConfig = getGroupConfig(chatId);
  if (!groupConfig) {
    log(`[welcome] chat ${chatId} not in whitelist, skipping`);
    return;
  }

  log(`[welcome] new member(s) added to ${groupConfig.name}`);

  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    log(`[welcome] feishu config not found`);
    return;
  }

  const client = createFeishuClient(feishuCfg);

  for (const user of users || []) {
    const openId = user.user_id?.open_id;
    if (!openId) continue;

    // 2. 过滤掉机器人自己
    if (botOpenId && openId === botOpenId) {
      log(`[welcome] skipping bot itself`);
      continue;
    }

    // 3. 获取用户信息
    const userInfo = await getUserInfo(client, openId);
    log(`[welcome] user: ${userInfo.name}, hireDate: ${userInfo.hireDate || "unknown"}`);

    // 4. 判断新人还是老员工
    const isNew = isNewHire(userInfo.hireDate);
    log(`[welcome] isNewHire: ${isNew}`);

    // 5. 随机选择人设
    const persona = randomPersona();
    log(`[welcome] persona: ${persona.name}`);

    // 6. 构建欢迎消息
    const message = buildWelcomeMessage({
      userName: userInfo.name,
      userOpenId: openId,
      isNew,
      persona,
      docs: groupConfig.docs,
    });

    // 7. 发送消息
    try {
      await sendMessageFeishu({
        cfg,
        to: `chat:${chatId}`,
        message,
      });
      log(`[welcome] sent welcome message to ${groupConfig.name}`);
    } catch (err) {
      log(`[welcome] failed to send message: ${String(err)}`);
    }
  }
}
