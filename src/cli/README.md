# cli/ - 命令行工具

供 Agent 直接通过 `npx tsx` 调用的 CLI 工具。

## 文件说明

| 文件 | 说明 | 用途 |
|------|------|------|
| `dev-lock.ts` | 开发锁管理 | 重启/更新前检查用户状态，避免打断别人 |
| `history.ts` | 聊天历史查询 | 获取会话历史消息，解决跨 session 失忆问题 |
| `reaction.ts` | 消息表情反应 | 给消息加 emoji 反应 |
| `announcement.ts` | 群公告查询 | 获取群聊公告内容 |
| `pin.ts` | 置顶消息管理 | 查询/置顶/取消置顶消息 |
| `send.ts` | 发送消息 | 直接发送飞书消息 |
| `log-analyze.ts` | 日志分析 | 分析玩家游戏日志 |
| `gcs-gemini-analyze.ts` | GCS 视频分析 | 通过 GCS + Gemini 分析大文件 |
| `write-sheet.ts` | 电子表格写入 | 写入飞书电子表格 |
| `check-perm.ts` | 权限检查 | 检查应用权限配置 |

## 使用方法

### 开发锁

```bash
cd /home/ubuntu/.clawdbot/extensions/feishu

# 查看使用状态（有多少人在用）
npx tsx src/cli/dev-lock.ts usage

# 查看开发锁状态
npx tsx src/cli/dev-lock.ts status

# 开启开发锁（默认 2 小时）
npx tsx src/cli/dev-lock.ts enable

# 开启开发锁（自定义时长，毫秒）
npx tsx src/cli/dev-lock.ts enable 3600000 "更新代码"

# 关闭开发锁
npx tsx src/cli/dev-lock.ts disable
```

### 聊天历史

```bash
cd /home/ubuntu/.clawdbot/extensions/feishu

# 通过 message_id 获取会话历史（自动识别 chat_id）
npx tsx src/cli/history.ts --message <message_id> --count 20

# 直接用 chat_id 获取历史
npx tsx src/cli/history.ts --chat <chat_id> --count 20
```

### 表情反应

```bash
cd /home/ubuntu/.clawdbot/extensions/feishu

# 给消息加反应
npx tsx src/cli/reaction.ts add --message <message_id> --emoji THUMBSUP

# 常用 emoji: THUMBSUP, OK, DONE, LAUGH, SWEAT, HEART, THINKING
```

### 群公告

```bash
cd /home/ubuntu/.clawdbot/extensions/feishu

# 查看群公告
npx tsx src/cli/announcement.ts --chat <chat_id>

# 查看原始 JSON
npx tsx src/cli/announcement.ts --chat <chat_id> --raw
```

### 日志分析

```bash
cd /home/ubuntu/.clawdbot/extensions/feishu

# 分析玩家日志
npx tsx src/cli/log-analyze.ts <日志文件路径>
```

## 使用场景

- **开发锁**：重启/更新服务前，先检查有没有人在用
- **聊天历史**：收到突兀消息时，拉历史补充上下文
- **表情反应**：简单确认、表达情绪，比打字更轻量
- **群公告**：了解群规则和重要通知
