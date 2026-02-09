# vote/ - 投票功能

在飞书群聊中创建投票卡片，支持单选/多选、匿名/实名投票。

## 文件说明

| 文件 | 说明 |
|------|------|
| `index.ts` | 主入口，导出 `createPoll`, `handleVoteCardAction`, `isVoteAction`, `getPoll`, `cleanupOldPolls` |
| `card.ts` | 卡片构建，生成投票卡片的 JSON 结构 |
| `store.ts` | 数据存储，投票数据持久化到文件 |

## 使用方式

通过 `message` tool 的 poll action 触发：

```typescript
// Clawdbot message tool 会调用这里的函数
import { createPoll, handleVoteCardAction } from "./features/vote/index.js";

// 创建投票
const poll = await createPoll(client, cfg, chatId, {
  question: "今天吃什么？",
  options: ["火锅", "烧烤", "外卖"],
  multi: false,      // 单选
  anonymous: false,  // 实名
});

// 处理投票点击
await handleVoteCardAction(client, cfg, event);
```

## 数据存储

投票数据存储在 `/tmp/clawdbot/votes/` 目录下，按投票 ID 命名的 JSON 文件。

## 功能特性

- ✅ 单选/多选
- ✅ 匿名/实名
- ✅ 实时更新卡片显示投票结果
- ✅ 防止重复投票（实名模式）
- ✅ 自动清理过期投票
