# services/ - 独立 HTTP 服务

独立运行的 HTTP API 服务，供 Agent 通过 curl/fetch 调用。

## 文件说明

| 文件 | 端口 | 说明 |
|------|------|------|
| `project-api.ts` | 18793 | 飞书项目 API（工作项、缺陷、需求、子任务等） |
| `task-api.ts` | 18794 | 飞书任务 API（待办任务） |
| `bitable-api.ts` | 18795 | 多维表格 API（Bitable 增删改查） |

## 使用方法

这些服务随 Clawdbot 自动启动，通过 HTTP 调用：

```bash
# 飞书项目 - 检查状态
curl http://127.0.0.1:18793/status

# 飞书项目 - 查询缺陷列表
curl "http://127.0.0.1:18793/workitems?typeKey=issue&pageSize=10"

# 飞书项目 - 搜索
curl -X POST http://127.0.0.1:18793/search \
  -H "Content-Type: application/json" \
  -d '{"keyword":"测试"}'

# 飞书任务 - 检查状态
curl http://127.0.0.1:18794/status

# 多维表格 - 检查状态
curl http://127.0.0.1:18795/status
```

## 详细文档

- **飞书项目 API**：见 `memory/feishu-project-api-guide.md`（实战指南）
- **工作项类型和字段**：见 `memory/feishu-project-schema.md`

## 注意

- 端口号是 **18793**、18794、18795，不是 18791！
- 这些服务依赖 `features/feishu-project/` 里的 SDK 客户端
