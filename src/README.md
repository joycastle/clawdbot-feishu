# src/ - 飞书插件源码

## 目录结构

```
src/
├── api/              # 内部 API 封装（发消息、上传媒体等）
├── cli/              # CLI 工具（供 Agent 直接调用）
├── services/         # 独立 HTTP 服务（供 Agent 通过 HTTP 调用）
├── features/         # 功能模块（投票、视频分析等）
└── *.ts              # 插件核心文件
```

## 核心文件说明

| 文件 | 说明 |
|------|------|
| `channel.ts` | 插件主入口，注册 Clawdbot channel |
| `bot.ts` | 消息接收处理，解析飞书消息事件 |
| `outbound.ts` | 出站消息处理，支持 message tool 的各种 action |
| `monitor.ts` | 事件监听，处理卡片回调、机器人入群等 |
| `client.ts` | Lark SDK 客户端封装 |
| `runtime.ts` | 运行时状态管理 |
| `types.ts` | TypeScript 类型定义 |
| `config-schema.ts` | 配置 schema 定义 |
| `accounts.ts` | 账号/凭据管理 |
| `policy.ts` | 权限策略（allowlist、回复策略等） |
| `targets.ts` | 目标解析（user:xxx, chat:xxx） |
| `directory.ts` | 目录服务（用户/群聊查询） |
| `reply-dispatcher.ts` | 回复分发逻辑 |
| `probe.ts` | 健康检查 |
| `onboarding.ts` | 初始化引导 |

## 快速导航

- **想发消息？** → `api/send.ts`
- **想上传/下载媒体？** → `api/media.ts`
- **想查飞书项目？** → `services/project-api.ts` 或 `features/feishu-project/`
- **想做投票？** → `features/vote/`
- **想分析视频？** → `features/video-analyze.ts` 或 `features/big-video/`
- **想用 CLI 工具？** → `cli/`
