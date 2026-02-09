# 飞书插件源码 - 完整指南

> 读完这个文档，你就能找到任何功能、做任何操作。

## 目录结构

```
src/
├── api/              # 内部 API 封装（发消息、媒体、表情）
├── cli/              # CLI 工具（开发锁、聊天历史）
├── services/         # 独立 HTTP 服务（项目、任务、多维表格）
├── features/         # 功能模块
│   ├── big-video/    # 大视频分析
│   ├── feishu-project/  # 飞书项目 SDK
│   ├── vote/         # 投票功能
│   └── *.ts          # 其他功能
├── smart-router/     # 智能路由（消息分类）
└── *.ts              # 插件核心
```

---

## 🚀 快速导航 - 我要做什么？

### 发消息相关

| 需求 | 位置 | 说明 |
|------|------|------|
| 发文本/卡片/富文本 | `api/send.ts` | `sendMessageFeishu`, `sendCardFeishu`, `sendPostFeishu` |
| 更新/编辑卡片 | `api/send.ts` | `updateCardFeishu`, `editMessageFeishu` |
| 获取消息详情 | `api/send.ts` | `getMessageFeishu` |
| 添加/删除表情 | `api/reactions.ts` | `addReactionFeishu`, `removeReactionFeishu` |

### 媒体相关

| 需求 | 位置 | 说明 |
|------|------|------|
| 上传图片/文件 | `api/media.ts` | `uploadImageFeishu`, `uploadFileFeishu` |
| 下载图片/文件 | `api/media.ts` | `downloadImageFeishu`, `downloadMessageResourceFeishu` |
| 发送图片/文件 | `api/media.ts` | `sendImageFeishu`, `sendFileFeishu`, `sendMediaFeishu` |
| 估算媒体成本 | `features/cost-estimator.ts` | `estimateMediaCost`, `formatFileSize` |
| 媒体确认流程 | `features/media-confirm.ts` | 大文件发送前的确认卡片 |

### 视频分析

| 需求 | 位置 | 说明 |
|------|------|------|
| 分析小视频（≤100MB） | `features/video-analyze.ts` | `analyzeVideo`, `analyzeVideoFromGcs` |
| 分析多维表格大视频 | `features/big-video/bitable-video-cli.ts` | CLI 入口，见下方用法 |
| 视频分析配置 | `features/video-analyze.ts` | `resolveVideoProvider`, `setCredentialsPath` |
| GCS 上传 | `features/big-video/gcs-upload.ts` | `uploadToGcs`, `streamUploadToGcs` |

**大视频分析 CLI 用法：**
```bash
npx tsx src/features/big-video/bitable-video-cli.ts \
  --target <latest|number> \
  --prompt "分析需求" \
  --to "user:<open_id>" \
  --reply-to "<message_id>" \
  --sender "<sender_open_id>"
```

### 飞书项目 API（工作项/缺陷/需求）

| 需求 | 位置 | 说明 |
|------|------|------|
| HTTP API 服务 | `services/project-api.ts` | 端口 **18793** |
| SDK 客户端 | `features/feishu-project/client.ts` | `FeishuProjectClient` |

**常用 HTTP 调用：**
```bash
# 状态检查
curl http://127.0.0.1:18793/status

# 查询缺陷
curl "http://127.0.0.1:18793/workitems?typeKey=issue&pageSize=10"

# 查询需求
curl "http://127.0.0.1:18793/workitems?typeKey=story"

# 搜索
curl -X POST http://127.0.0.1:18793/search -H "Content-Type: application/json" -d '{"keyword":"测试"}'

# 创建工作项
curl -X POST http://127.0.0.1:18793/workitem -H "Content-Type: application/json" -d '{"typeKey":"issue","name":"标题"}'

# 查询子任务
curl "http://127.0.0.1:18793/workitem/<id>/subtasks"
```

### 飞书任务 API（待办）

| 需求 | 位置 | 说明 |
|------|------|------|
| HTTP API 服务 | `services/task-api.ts` | 端口 **18794** |

```bash
curl http://127.0.0.1:18794/status
curl http://127.0.0.1:18794/tasks
```

### 多维表格 API

| 需求 | 位置 | 说明 |
|------|------|------|
| HTTP API 服务 | `services/bitable-api.ts` | 端口 **18795** |

```bash
curl http://127.0.0.1:18795/status
```

### 投票功能

| 需求 | 位置 | 说明 |
|------|------|------|
| 创建投票 | `features/vote/index.ts` | `createPoll` |
| 处理投票点击 | `features/vote/index.ts` | `handleVoteCardAction`, `isVoteAction` |
| 获取投票数据 | `features/vote/index.ts` | `getPoll` |
| 投票卡片构建 | `features/vote/card.ts` | `buildVoteCard` |
| 投票数据存储 | `features/vote/store.ts` | `loadVoteData`, `saveVoteData` |

### CLI 工具

| 需求 | 位置 | 用法 |
|------|------|------|
| 开发锁管理 | `cli/dev-lock.ts` | 见下方 |
| 聊天历史查询 | `cli/history.ts` | 见下方 |

**开发锁：**
```bash
cd /home/ubuntu/.clawdbot/extensions/feishu
npx tsx src/cli/dev-lock.ts usage      # 查使用状态
npx tsx src/cli/dev-lock.ts status     # 查开发锁状态
npx tsx src/cli/dev-lock.ts enable     # 开启（默认2小时）
npx tsx src/cli/dev-lock.ts disable    # 关闭
```

**聊天历史：**
```bash
cd /home/ubuntu/.clawdbot/extensions/feishu
npx tsx src/cli/history.ts --message <message_id> --count 20
npx tsx src/cli/history.ts --chat <chat_id> --count 20
```

### 用户/群聊查询

| 需求 | 位置 | 说明 |
|------|------|------|
| 列出用户 | `directory.ts` | `listFeishuDirectoryPeers`, `listFeishuDirectoryPeersLive` |
| 列出群聊 | `directory.ts` | `listFeishuDirectoryGroups` |
| 解析目标 ID | `targets.ts` | `normalizeFeishuTarget`, `detectIdType` |

### 文档解析

| 需求 | 位置 | 说明 |
|------|------|------|
| 提取文档链接 | `features/doc-parser.ts` | `extractFeishuDocUrls` |
| 获取文档内容 | `features/doc-parser.ts` | `fetchFeishuDocContent` |
| 消息富化（自动拉取链接内容） | `features/doc-parser.ts` | `enrichMessageWithDocs` |

### 表格卡片

| 需求 | 位置 | 说明 |
|------|------|------|
| Markdown 表格转卡片 | `features/table-card.ts` | `buildTableCard`, `parseMarkdownTable` |
| 检测是否有表格 | `features/table-card.ts` | `containsMarkdownTable` |

### 打字指示器

| 需求 | 位置 | 说明 |
|------|------|------|
| 添加打字状态 | `features/typing.ts` | `addTypingIndicator` |
| 移除打字状态 | `features/typing.ts` | `removeTypingIndicator` |

### 权限/策略

| 需求 | 位置 | 说明 |
|------|------|------|
| 检查管理员 | `features/dev-lock.ts` | `isFeishuAdmin` |
| 解析群组配置 | `policy.ts` | `resolveFeishuGroupConfig` |
| 检查允许列表 | `policy.ts` | `isFeishuGroupAllowed`, `resolveFeishuAllowlistMatch` |

### 智能路由

| 需求 | 位置 | 说明 |
|------|------|------|
| 消息分类 | `smart-router/classifier.ts` | `classifyMessage` |
| 路由配置 | `smart-router/types.ts` | `RouterConfig`, `RouteDecision` |

---

## 🔧 插件核心文件

| 文件 | 说明 |
|------|------|
| `channel.ts` | 插件主入口，注册 Clawdbot channel |
| `bot.ts` | 消息接收处理，`handleFeishuMessage` |
| `outbound.ts` | 出站消息处理，message tool 的实现 |
| `monitor.ts` | 事件监听，卡片回调、机器人入群等 |
| `client.ts` | Lark SDK 客户端，`createFeishuClient` |
| `runtime.ts` | 运行时状态，`getFeishuRuntime` |
| `types.ts` | 类型定义 |
| `config-schema.ts` | 配置 schema |
| `accounts.ts` | 账号管理 |
| `probe.ts` | 健康检查，`probeFeishu` |
| `onboarding.ts` | 初始化引导 |
| `reply-dispatcher.ts` | 回复分发 |

---

## 📋 常用配置

### 多维表格（大视频分析用）
- app_token: `OW7lbIpSlaf4nEsiDKLcqiYGn7c`
- table_token: `tblPFJHzLTyXMGcJ`
- GCS bucket: `larkbot-storage`

### HTTP 服务端口
- 飞书项目 API: **18793**
- 飞书任务 API: **18794**
- 多维表格 API: **18795**

### 飞书群 Chat ID
见 TOOLS.md 中的"飞书群 Chat ID"章节。

---

## 📚 相关文档

- `memory/feishu-project-api-guide.md` - 飞书项目 API 实战指南
- `memory/feishu-project-schema.md` - 工作项类型和字段
- `memory/feishu-project-userkeys.md` - User Key 表
- 各目录下的 `README.md` - 子模块详细说明
