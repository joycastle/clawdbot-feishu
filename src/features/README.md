# features/ - 功能模块

各种独立的功能实现，可被插件核心或其他模块调用。

## 目录结构

```
features/
├── big-video/        # 大视频分析（多维表格视频 → GCS → Gemini）
├── feishu-project/   # 飞书项目 SDK 客户端
├── vote/             # 投票功能
│   ├── index.ts      # 主入口
│   ├── card.ts       # 卡片构建
│   └── store.ts      # 数据存储
└── *.ts              # 其他功能模块
```

## 文件说明

| 文件/目录 | 说明 |
|-----------|------|
| `big-video/` | 大视频分析，处理多维表格里的大视频（>20MB） |
| `feishu-project/` | 飞书项目 SDK，封装了项目 API 调用 |
| `vote/` | 投票功能，支持群聊创建投票卡片 |
| `video-analyze.ts` | 视频分析核心，支持 Gemini/万界方舟 |
| `media-confirm.ts` | 媒体确认卡片，处理大文件的确认流程 |
| `cost-estimator.ts` | 成本估算，估算媒体处理成本 |
| `dev-lock.ts` | 开发锁状态管理（供 cli/dev-lock.ts 使用） |
| `doc-parser.ts` | 文档解析，处理飞书文档内容 |
| `table-card.ts` | 表格卡片，把表格数据转成卡片 |
| `typing.ts` | 打字指示器，用表情反应模拟打字状态 |

## 快速导航

- **分析视频** → `video-analyze.ts`（小视频）或 `big-video/`（大视频）
- **创建投票** → `vote/index.ts`
- **飞书项目操作** → `feishu-project/client.ts`
- **成本估算** → `cost-estimator.ts`
