# 飞书任务 API

**端口：** localhost:18794
**位置：** `/home/ubuntu/.clawdbot/extensions/feishu/src/services/task-api.ts`
**SDK：** @larksuiteoapi/node-sdk (task v2 API)
**权限：** task:task:read, task:task:write

## API 端点

```
基础：
  GET  /status              - 状态检查

任务：
  POST /task                - 创建任务
  GET  /tasks               - 列出任务
  GET  /task/:guid          - 获取详情
  PATCH /task/:guid         - 更新任务（只能改 summary/description/due 等，不能改 members）
  DELETE /task/:guid        - 删除任务
  POST /task/:guid/complete - 完成任务
  POST /task/:guid/uncomplete - 取消完成
  POST /task/:guid/members  - 添加成员（⚠️ 必须单独调用，不能在创建时或 patch 时加）

子任务：
  GET  /task/:guid/subtasks - 列出子任务
  POST /task/:guid/subtask  - 创建子任务

评论：
  GET  /task/:guid/comments - 列出评论
  POST /task/:guid/comment  - 创建评论

清单：
  POST /tasklist            - 创建清单
  GET  /tasklists           - 列出清单
  GET  /tasklist/:guid      - 获取清单详情
  DELETE /tasklist/:guid    - 删除清单
  GET  /tasklist/:guid/tasks - 获取清单任务
  GET  /tasklist/:guid/sections - 获取分组列表
  POST /tasklist/:guid/section  - 创建分组

分组：
  GET  /section/:guid       - 获取分组详情
  DELETE /section/:guid     - 删除分组
  GET  /section/:guid/tasks - 获取分组任务
```

## ⚠️ 创建任务的正确流程

```bash
# 1. 创建任务
curl -X POST http://127.0.0.1:18794/task -H "Content-Type: application/json" -d '{
  "summary": "任务标题",
  "description": "任务描述"
}'
# 返回 { "guid": "xxx", ... }

# 2. 添加执行者（必须单独调用！）
curl -X POST http://127.0.0.1:18794/task/<guid>/members -H "Content-Type: application/json" -d '{
  "members": [
    {"id": "ou_xxx", "type": "user", "role": "assignee"}
  ]
}'
```

## members 角色

- `assignee`: 执行者（会出现在用户任务中心）
- `follower`: 关注者

## 注意事项

- 用 tenant_access_token 创建的任务 owner 是应用
- 必须添加用户为执行者才能在用户任务中心看到
- patch 不能修改 members，必须用 /members 端点
