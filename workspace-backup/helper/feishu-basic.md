# 飞书基础能力

> 零碎但常用的飞书功能

---

## 📜 拉聊天历史

上下文断了？让我拉一下历史记录：

```bash
npx tsx ~/.clawdbot/extensions/feishu/src/cli/history.ts \
  --message <message_id> --count 20
```

**使用场景：** session 压缩失忆、回复消息看不到原文

---

## 😊 表情反应

给消息加 emoji：

```bash
npx tsx ~/.clawdbot/extensions/feishu/src/cli/reaction.ts add \
  --message <message_id> --emoji THUMBSUP
```

**常用 emoji：**
| 代码 | 表情 |
|------|------|
| THUMBSUP | 👍 |
| HEART | ❤️ |
| SMILE | 😄 |
| CLAP | 👏 |
| FIRE | 🔥 |

---

## 👋 欢迎新人

新人入群自动欢迎 + 发送岗位文档

**配置位置：**
- `memory/welcome/config.md` - 总开关、规则
- `memory/welcome/personas.md` - 人设风格（随机）
- `memory/welcome/groups/*.md` - 各群配置

**流程：**
1. 检测新人入群
2. 判断岗位（从用户信息或主动询问）
3. 发送欢迎语 + 通用文档 + 岗位文档

**已配置的群：**
- 格式塔大群
- BF 研发大群
- BV 研发大群

---

## 📖 读飞书文档

看到飞书链接（wiki/docx/sheets/base）？

```bash
curl "http://127.0.0.1:18798/read?url=<飞书文档URL>"
```

⚠️ 不要用 web_fetch，需要登录权限会失败

---

## 📊 读飞书表格

```bash
# 搜索
curl "http://127.0.0.1:18796/find?token=TOKEN&sheetId=SHEET&text=关键词"

# 读取
curl "http://127.0.0.1:18796/read?token=TOKEN&sheetId=SHEET&range=A1:Z50"
```

---

## 详细文档

- `memory/tools/feishu-docs.md`
- `memory/tools/feishu-reactions.md`
- `memory/welcome/config.md`
