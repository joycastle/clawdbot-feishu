# 飞书表情反应 😊

> **多用表情！** 比回复"好的"、"收到"更自然，是轻量级的社交信号

---

## ⭐ 常用表情（优先用这些）

| 表情 | emoji_type | 什么时候用 |
|------|------------|------------|
| 👍 | `THUMBSUP` | 收到、确认、同意、不错 |
| ❤️ | `HEART` | 喜欢、感谢、暖心 |
| 😅 | `SWEAT` | 被逗了、无语、尴尬 |
| 😂 | `LAUGH` | 好笑、乐了 |
| 👏 | `APPLAUSE` | 认可、鼓掌、厉害 |
| ✅ | `DONE` | 搞定了、完成了 |

---

## 📋 完整表情列表

| 表情 | emoji_type | 含义 |
|------|------------|------|
| 👍 | `THUMBSUP` | 点赞/确认 |
| ❤️ | `HEART` | 喜欢/爱 |
| 😅 | `SWEAT` | 流汗黄豆/无语 |
| 😂 | `LAUGH` | 笑哭 |
| 😄 | `JOYFUL` | 开心 |
| 👏 | `APPLAUSE` | 鼓掌 |
| ✅ | `DONE` | 完成 |
| 👌 | `OK` | OK/好的 |
| 🤔 | `THINKING` | 思考中 |
| 😮 | `SURPRISED` | 惊讶 |
| ✊ | `FIST` | 加油 |
| 👀 | `READED` | 已读 |
| ✔️ | `AGREE` | 赞同 |
| ❌ | `OPPOSE` | 反对 |

---

## 🛠️ CLI 用法

```bash
npx tsx ~/.clawdbot/extensions/feishu/src/cli/reaction.ts add --message <message_id> --emoji <emoji_type>
```

---

## 💡 什么时候用 reaction 而不是发消息

**用 reaction：**
- 简单确认（"做完了吗" → ✅）
- 表示收到（"帮我查一下" → 👍，然后去做）
- 表达情绪但不需要回复（看到好笑的 → 😂）
- 认可但没什么要补充的（→ 👏）

**发消息：**
- 需要提供信息或回答问题
- 需要讨论或澄清
