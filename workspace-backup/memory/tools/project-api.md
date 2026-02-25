# 飞书项目 API

**端口：** localhost:18793（⚠️ 不是18791）
**位置：** `/home/ubuntu/.clawdbot/extensions/feishu/src/services/project-api.ts`
**SDK封装：** `/home/ubuntu/.clawdbot/extensions/feishu/src/feishu-project/`
**默认 Project Key：** 62b29e862be43458fc1ef6b2 (格式塔 - Bingo Frenzy)

## 常用调用

```bash
# 检查服务状态
curl http://127.0.0.1:18793/status

# 工作项类型
curl http://127.0.0.1:18793/types

# 查工作项列表
curl "http://127.0.0.1:18793/workitems?typeKey=issue&pageSize=10"

# 搜索
curl -X POST http://127.0.0.1:18793/search -H "Content-Type: application/json" -d '{"keyword":"测试"}'
```

## 完整 API 端点

```
基础：/status, /projects, /types, /fields

工作项：
  GET  /workitems, /workitem/:id
  POST /workitem, /search
  PUT  /workitem/:id
  DELETE /workitem/:id

评论：
  GET  /workitem/:id/comments
  POST /workitem/:id/comment
  DELETE /comment/:id

子任务：
  GET  /workitem/:id/subtasks
  POST /workitem/:id/subtask
  PUT/DELETE /subtask/:id

关联关系：
  GET  /workitem/:id/relations
  POST /workitem/:id/relation
  DELETE /relation/:id

工作流：
  GET  /workflow
  POST /workitem/:id/transition

工时：
  GET  /workitem/:id/manhours
  POST /workitem/:id/manhour
  PUT/DELETE /manhour/:id
```

## 相关文档

- `memory/feishu-project-api-guide.md` - 实战指南（搜索、子任务、踩坑）
- `memory/feishu-project-schema.md` - 工作项类型和字段
- `memory/feishu-project-userkeys.md` - User Key 对照表

## 常用 User Key

| 名字 | user_key |
|------|----------|
| 宝根 | 7586496668992949190 |
| 何森 | 7111562106205470723 |
