# api/ - 内部 API 封装

给插件核心模块（bot.ts、outbound.ts 等）调用的飞书 API 封装。

## 文件说明

| 文件 | 说明 | 主要函数 |
|------|------|----------|
| `send.ts` | 发送消息 | `sendMessageFeishu`, `sendCardFeishu`, `sendPostFeishu`, `updateCardFeishu`, `editMessageFeishu`, `getMessageFeishu` |
| `media.ts` | 媒体上传/下载 | `uploadImageFeishu`, `uploadFileFeishu`, `downloadImageFeishu`, `downloadMessageResourceFeishu`, `sendImageFeishu`, `sendFileFeishu`, `sendMediaFeishu` |
| `reactions.ts` | 消息表情反应 | `addReactionFeishu`, `removeReactionFeishu` |

## 使用示例

```typescript
import { sendMessageFeishu } from "./api/send.js";
import { uploadImageFeishu } from "./api/media.js";

// 发送文本消息
await sendMessageFeishu(client, "open_id", userId, "Hello!");

// 上传图片
const imageKey = await uploadImageFeishu(client, imagePath);
```

## 注意

这些是**内部封装**，供插件代码使用。如果你是 Agent，应该：
- 发消息 → 用 `message` tool
- 调用飞书项目 API → 用 `services/project-api.ts` 的 HTTP 接口
