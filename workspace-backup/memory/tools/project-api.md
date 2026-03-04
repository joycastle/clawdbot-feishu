# 飞书项目 API

**端口：** localhost:18793（⚠️ 不是18791）
**位置：** `/home/ubuntu/.clawdbot/extensions/feishu/src/services/project-api.ts`
**默认 Project Key：** 62b29e862be43458fc1ef6b2 (格式塔 - Bingo Frenzy)

---

## ⚠️ 重要：两套 API

| | 本地封装 (18793) | 飞书原生 API |
|---|---|---|
| 用途 | 简单查询、增删改 | **高级搜索（我参与的、按条件筛选）** |
| 认证 | 自动 | 需要 TOKEN + USER_KEY |
| 功能 | 有限 | 完整 |

**查"我参与的"、"我创建的"等 → 必须用飞书原生 API**

---

## 🔥 常用场景（直接复制用）

### 查"我参与的"（当前节点负责人是我）

```bash
BASE='https://project.feishu.cn'
PLUGIN_ID='MII_69855DF6DF814CC2'
PLUGIN_SECRET='${FEISHU_PROJECT_SECRET}'
USER_KEY='7586496668992949190'  # 宝根
PROJECT_KEY='62b29e862be43458fc1ef6b2'

TOKEN=$(curl -sS -X POST "${BASE}/open_api/authen/plugin_token" \
  -H 'Content-Type: application/json' \
  -d "{\"plugin_id\":\"${PLUGIN_ID}\",\"plugin_secret\":\"${PLUGIN_SECRET}\",\"type\":0}" \
  | jq -r '.data.token')

# 关键字段：current_status_operator，值用 user_key
curl -sS -X POST "${BASE}/open_api/${PROJECT_KEY}/work_item/story/search/params" \
  -H "Content-Type: application/json" \
  -H "X-PLUGIN-TOKEN: ${TOKEN}" \
  -H "X-USER-KEY: ${USER_KEY}" \
  -d '{
    "search_group": {
      "conjunction": "AND",
      "search_params": [
        {"param_key": "current_status_operator", "value": ["7586496668992949190"], "operator": "HAS ANY OF"},
        {"param_key": "finish_status", "value": false, "operator": "="}
      ],
      "search_groups": []
    },
    "page_num": 1,
    "page_size": 50
  }'
```

### 查"我负责的"（owner 是我）

```bash
# 关键字段：owner，值用 user_id (不是 user_key！)
curl -sS -X POST "${BASE}/open_api/${PROJECT_KEY}/work_item/story/search/params" \
  -H "Content-Type: application/json" \
  -H "X-PLUGIN-TOKEN: ${TOKEN}" \
  -H "X-USER-KEY: ${USER_KEY}" \
  -d '{
    "search_group": {
      "conjunction": "AND",
      "search_params": [
        {"param_key": "owner", "value": ["7111584692842840092"], "operator": "="},
        {"param_key": "finish_status", "value": false, "operator": "="}
      ],
      "search_groups": []
    },
    "page_num": 1,
    "page_size": 100
  }'
```

---

## ⚠️ user_key vs user_id

飞书项目有两套 ID，容易混淆：

| 字段 | 宝根的值 | 用在哪 |
|------|----------|--------|
| **user_key** | 7586496668992949190 | API 认证 header (X-USER-KEY)、current_status_operator 搜索 |
| **user_id** | 7111584692842840092 | owner、created_by 等字段的值 |

**完整对照表见** `memory/reference/feishu-project-userkeys.md`

---

## 🔥 我的工作台（新增！）

```bash
# 我参与的（当前节点负责人是我）
curl "http://127.0.0.1:18793/my/todo?typeKey=story"

# 我负责的（owner 是我）
curl "http://127.0.0.1:18793/my/owned?typeKey=story"

# 我创建的
curl "http://127.0.0.1:18793/my/created?typeKey=story"

# 汇总（需求+缺陷的待办/负责数量）
curl "http://127.0.0.1:18793/my/summary"
```

> 支持 `typeKey=story|issue`，默认 story

---

## 本地 API (18793) 简单调用

```bash
# 检查服务状态
curl http://127.0.0.1:18793/status

# 工作项类型
curl http://127.0.0.1:18793/types

# 查工作项列表（简单列表，不支持按用户筛选）
curl "http://127.0.0.1:18793/workitems?typeKey=issue&pageSize=10"

# 关键词搜索
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

---

## 相关文档

- `memory/reference/feishu-project-api-guide.md` - 实战指南（搜索语法、子任务、踩坑）
- `memory/reference/feishu-project-userkeys.md` - User Key / User ID 对照表
