# 飞书项目

> 工作项、缺陷、任务、子任务、评论

**端口：** `localhost:18793`

---

## 常用操作

| 说法 | 我会做什么 |
|------|-----------|
| 查一下我的缺陷 | 搜索你负责的 issue |
| 帮我建个 bug | 创建缺陷工作项 |
| 这个需求进展怎么样 | 查询工作项详情 |
| 给这个任务加个评论 | 添加评论 |

---

## API 速查

```bash
# 工作项类型
curl http://127.0.0.1:18793/types

# 查列表
curl "http://127.0.0.1:18793/workitems?typeKey=issue"

# 搜索
curl -X POST http://127.0.0.1:18793/search \
  -H "Content-Type: application/json" \
  -d '{"keyword":"测试"}'

# 创建
curl -X POST http://127.0.0.1:18793/workitem \
  -H "Content-Type: application/json" \
  -d '{"typeKey":"issue","name":"标题"}'

# 添加评论
curl -X POST http://127.0.0.1:18793/workitem/123/comment \
  -H "Content-Type: application/json" \
  -d '{"content":"评论内容"}'
```

---

## 工作项类型

| typeKey | 说明 |
|---------|------|
| `story` | 需求 |
| `issue` | 缺陷 |
| `task` | 任务 |

---

## 详细文档

- `memory/tools/project-api.md`
- `memory/feishu-project-api-guide.md`
