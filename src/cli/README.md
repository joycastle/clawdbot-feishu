# cli/ - 命令行工具

供 Agent 直接通过 `npx tsx` 调用的 CLI 工具。

## 文件说明

| 文件 | 说明 | 用途 |
|------|------|------|
| `dev-lock.ts` | 开发锁管理 | 重启/更新前检查用户状态，避免打断别人 |
| `history.ts` | 聊天历史查询 | 获取会话历史消息，解决跨 session 失忆问题 |
| `test-history.ts` | 历史查询测试 | 开发测试用，可删除 |

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

## 使用场景

- **开发锁**：重启/更新服务前，先检查有没有人在用
- **聊天历史**：收到突兀消息时，拉历史补充上下文
