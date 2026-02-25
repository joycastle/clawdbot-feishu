# 飞书任务

> 个人任务中心的任务（不是飞书项目里的任务）

**端口：** `localhost:18794`

---

## 和飞书项目的区别

| | 飞书项目 | 飞书任务 |
|--|---------|---------|
| 定位 | 团队协作、需求/缺陷管理 | 个人待办、轻量任务 |
| 入口 | 飞书项目 App | 任务中心 |
| 端口 | 18793 | 18794 |

---

## 常用操作

| 说法 | 我会做什么 |
|------|-----------|
| 帮我建个任务 | 创建任务 |
| 看看我的待办 | 列出任务 |
| 这个任务完成了 | 标记完成 |

---

## API 速查

```bash
# 创建任务
curl -X POST http://127.0.0.1:18794/task \
  -H "Content-Type: application/json" \
  -d '{"summary":"任务标题"}'

# 列出任务
curl http://127.0.0.1:18794/tasks

# 完成任务
curl -X POST http://127.0.0.1:18794/task/<guid>/complete

# 添加执行者（创建后必须单独调用！）
curl -X POST http://127.0.0.1:18794/task/<guid>/members \
  -H "Content-Type: application/json" \
  -d '{"members":[{"id":"ou_xxx","type":"user","role":"assignee"}]}'
```

---

## ⚠️ 注意

创建任务后**必须单独调用** `/members` 添加执行者，否则用户在任务中心看不到

---

## 详细文档

- `memory/tools/task-api.md`
