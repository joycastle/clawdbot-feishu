/**
 * 群欢迎新人功能
 *
 * 两种触发方式：
 * 1. im.chat.member.user.added_v1 事件 — 新成员入群时自动发送欢迎消息
 * 2. 图片检测 — 白名单群中收到图片时，用 LLM 判断是否为入职海报，是则生成欢迎语
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import type { FeishuConfig } from "../types.js";
import { createFeishuClient } from "../client.js";
import { sendMessageFeishu } from "../api/send.js";
import { getModel, complete } from "@mariozechner/pi-ai";
import type { Model, Api, TextContent, ImageContent, UserMessage } from "@mariozechner/pi-ai";
import { getFeishuRuntime } from "../runtime.js";

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
  {
    chatId: "oc_3a33e2074a803f48ee10d73cbabc79e7",
    name: "公司大群",
    docs: [],
  },
  {
    chatId: "oc_2499ac5d01531133e77ed4ecb3ca4833",
    name: "欢迎预览测试群",
    docs: [],
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
export function isWelcomeGroup(chatId: string): boolean {
  return WELCOME_GROUPS.some((g) => g.chatId === chatId);
}

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
        text: message,
      });
      log(`[welcome] sent welcome message to ${groupConfig.name}`);
    } catch (err) {
      log(`[welcome] failed to send message: ${String(err)}`);
    }
  }
}

// ─── 图片检测欢迎 ─────────────────────────────────────────────────────────────

/** 从配置中解析 LLM model ref（优先 imageModel，回退 model） */
function resolveImageModelRef(cfg: ClawdbotConfig): string | null {
  const defaults = (cfg as any)?.agents?.defaults;
  return defaults?.imageModel?.primary || defaults?.model?.primary || null;
}

/** 加载 per-group welcome prompt 文件 */
function loadGroupWelcomePrompt(chatId: string): string | null {
  const workspace = process.env.CLAWDBOT_WORKSPACE || process.cwd();
  // 按 chatId 查找对应的 prompt 文件
  const groupConfig = getGroupConfig(chatId);
  if (!groupConfig) return null;

  // 尝试多种路径: memory/welcome/groups/{name}/prompt.md 或 memory/welcome/groups/{chatId}.prompt.md
  const candidates = [
    path.join(workspace, "memory/welcome/groups", `${chatId}.prompt.md`),
    path.join(workspace, "memory/welcome/groups", groupConfig.name, "prompt.md"),
  ];

  for (const p of candidates) {
    try {
      return fs.readFileSync(p, "utf-8").trim();
    } catch {
      // 文件不存在，继续尝试下一个
    }
  }
  return null;
}

/** 默认 prompt（当没有 per-group prompt 时使用） */
const DEFAULT_WELCOME_PROMPT = `你是"王总"，公司飞书群里的 AI 助手。
看到一张图片，请判断这是否是新员工入职欢迎海报/介绍。

如果**不是**入职海报（例如表情包、截图、工作图片等），只回复 JSON：
{"isWelcome": false}

如果**是**入职海报，请从图片中提取新人信息，并用热情友好的语气写一段简短的欢迎语。
回复 JSON（不要包含其他内容）：
{"isWelcome": true, "name": "姓名", "welcome": "你的欢迎语"}

要求：
- 欢迎语要简短自然，1-3 句话
- 可以提到从海报中看到的信息（部门、职位等），让新人感到被关注
- 语气亲切但不油腻，像一个热心的同事
- 结尾可以提示有问题随时 @ 你`;

/**
 * 处理白名单群中的图片消息：判断是否为入职海报，是则生成欢迎语。
 * 返回 true 表示已处理（不管是否发送了欢迎），false 表示应跳过。
 */
export async function handleWelcomeImageDetection(params: {
  cfg: ClawdbotConfig;
  chatId: string;
  imagePath: string;
  messageId: string;
  log?: (...args: unknown[]) => void;
}): Promise<boolean> {
  const { cfg, chatId, imagePath, messageId, log = console.log } = params;

  const groupConfig = getGroupConfig(chatId);
  if (!groupConfig) return false;

  log(`[welcome-image] checking image in ${groupConfig.name}`);

  // 读取图片为 base64
  let imageBase64: string;
  let contentType: string;
  try {
    const buffer = fs.readFileSync(imagePath);
    imageBase64 = buffer.toString("base64");
    // 从扩展名推断 mime type
    const ext = path.extname(imagePath).toLowerCase();
    contentType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  } catch (err) {
    log(`[welcome-image] failed to read image: ${String(err)}`);
    return false;
  }

  // 构建 LLM 调用
  const modelRef = resolveImageModelRef(cfg);
  if (!modelRef) {
    log(`[welcome-image] no image model configured (agents.defaults.imageModel or agents.defaults.model), skipping`);
    return false;
  }
  log(`[welcome-image] using model: ${modelRef}`);

  const groupPrompt = loadGroupWelcomePrompt(chatId);
  const systemPrompt = groupPrompt || DEFAULT_WELCOME_PROMPT;

  // 解析 provider/model-id
  const slashIdx = modelRef.indexOf("/");
  if (slashIdx <= 0) {
    log(`[welcome-image] invalid model format: ${modelRef}`);
    return false;
  }
  const provider = modelRef.slice(0, slashIdx);
  const modelId = modelRef.slice(slashIdx + 1);

  // 解析模型（pi-ai 内置注册表）
  const model = getModel(provider as any, modelId as any);
  if (!model) {
    log(`[welcome-image] model not found in pi-ai registry: ${modelRef}`);
    return false;
  }

  // 解析 API key（google-vertex 不传 apiKey，走 ADC 自动认证）
  let apiKey: string | undefined;
  if (provider !== "google-vertex") {
    try {
      const runtime = getFeishuRuntime();
      const auth = await runtime.modelAuth.resolveApiKeyForProvider({ provider, cfg: cfg as any });
      apiKey = auth.apiKey;
    } catch (authErr) {
      log(`[welcome-image] auth error: ${String(authErr)}`);
      return false;
    }
  }

  const userContent: (TextContent | ImageContent)[] = [
    { type: "image", data: imageBase64, mimeType: contentType },
    { type: "text", text: "请分析这张图片。" },
  ];

  const piMessages: UserMessage[] = [
    { role: "user" as const, content: userContent, timestamp: Date.now() },
  ];

  try {
    const completeOpts: Record<string, unknown> = {
      temperature: 0.7,
      maxTokens: 2048,
    };
    if (apiKey) {
      completeOpts.apiKey = apiKey;
    }
    if (provider === "google-vertex") {
      completeOpts.project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
      completeOpts.location = process.env.GOOGLE_CLOUD_LOCATION || "global";
    }
    // 最多重试 2 次（截断时重试）
    let parsed: { isWelcome: boolean; name?: string; welcome?: string } | null = null;
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await complete(model, { systemPrompt, messages: piMessages }, completeOpts as any);
      const stopReason = (response as any).stopReason;
      log(`[welcome-image] attempt ${attempt}: stopReason=${stopReason}`);

      if (stopReason === "error") {
        log(`[welcome-image] LLM error: ${(response as any).errorMessage}`);
        return false;
      }

      const resultText = response.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("");
      log(`[welcome-image] LLM response (len=${resultText.length}): ${resultText.replace(/\n/g, "\\n").slice(0, 400)}`);

      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        if (stopReason === "length" && attempt < maxAttempts) {
          log(`[welcome-image] truncated, retrying...`);
          continue;
        }
        log(`[welcome-image] no valid JSON in response, skipping`);
        return true;
      }

      try {
        parsed = JSON.parse(jsonMatch[0]);
        break;
      } catch {
        if (stopReason === "length" && attempt < maxAttempts) {
          log(`[welcome-image] JSON parse failed (truncated), retrying...`);
          continue;
        }
        log(`[welcome-image] JSON parse failed, skipping`);
        return true;
      }
    }

    if (!parsed || !parsed.isWelcome) {
      log(`[welcome-image] not a welcome poster, skipping`);
      return true;
    }

    // 是入职海报，发送欢迎语
    const welcomeText = parsed.welcome || `欢迎 ${parsed.name || "新同事"} 加入！有问题随时 @ 我～`;
    log(`[welcome-image] detected welcome poster for ${parsed.name || "unknown"}`);

    await sendMessageFeishu({
      cfg,
      to: `chat:${chatId}`,
      text: welcomeText,
      replyToMessageId: messageId,
    });
    log(`[welcome-image] sent welcome to ${groupConfig.name}`);
    return true;
  } catch (err) {
    log(`[welcome-image] LLM call failed: ${String(err)}`);
    return false;
  }
}
