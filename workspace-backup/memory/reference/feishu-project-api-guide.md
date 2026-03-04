# 飞书项目 OpenAPI 实战指南

> 2026-02-09 与宝根一起调试总结，踩坑无数得出的经验。
> 2026-02-12 已将 `feishu-project-schema.md` 内容整合至此，统一维护。

## 🔑 基础配置

```bash
BASE='https://project.feishu.cn'
PLUGIN_ID='MII_69855DF6DF814CC2'
PLUGIN_SECRET='${FEISHU_PROJECT_SECRET}'
USER_KEY='7586496668992949190'  # 宝根
PROJECT_KEY='62b29e862be43458fc1ef6b2'  # 格式塔 - Bingo Frenzy (gestalt)
```

## 🎫 获取 Token

```bash
TOKEN=$(curl -sS -X POST "${BASE}/open_api/authen/plugin_token" \
  -H 'Content-Type: application/json' \
  -d "{\"plugin_id\":\"${PLUGIN_ID}\",\"plugin_secret\":\"${PLUGIN_SECRET}\",\"type\":0}" \
  | jq -r '.data.token')
# 返回 token 有效期 2 小时
```

---

## 🏗️ 空间 Schema (Bingo Frenzy)

### 工作项类型 (type_key)

| type_key | 名称 | 状态 | 说明 |
|----------|------|------|------|
| `story` | 需求 | 启用 | 产品需求 |
| `issue` | 缺陷 | 启用 | Bug/问题 |
| `version` | 版本 | 启用 | 发布版本 |
| `sub_task` | 任务 | 启用 | 子任务 |
| `62c7b9bcc0db72994eb121c7` | 产品优化 | 启用 | 产品改进项 |

### 工作项关系与核心字段

- **规划版本 (planning_version)**：关联到 `version` 类型的 work_item_id。
- **关联需求/关联缺陷**：通过 `search_by_relation` 接口查询。
- **业务线 (business)**：BF 的 ID 是 `62bbc4d0e762af0479562a46`。

---

## 🔍 搜索工作项（重点！）

### 正确的接口
```
POST /open_api/{project_key}/work_item/{type}/search/params
```

### ⚠️ 关键：使用 `search_group` 结构

```json
{
  "search_group": {
    "conjunction": "AND",
    "search_params": [
      {
        "param_key": "name",
        "value": "关键词",
        "operator": "~"
      }
    ],
    "search_groups": []
  },
  "page_num": 1,
  "page_size": 20
}
```

### 常用搜索字段和操作符

| 字段 | 类型 | 支持的操作符 | value类型 | 说明 |
|------|------|-------------|----------|------|
| `name` | text | `~`, `!~`, `=`, `!=` | string | **`~` 是前后模糊匹配** |
| `work_item_id` | number | `=`, `HAS ANY OF` | array | 工作项ID |
| `owner` | user | `=`, `HAS ANY OF` | array | 工作项负责人 |
| `current_status_operator` | multi_user | `HAS ANY OF` | array | **当前节点负责人（≈待办）** |
| `created_by` | user | `=` | array | 创建人 |
| `created_at` | date | `>`, `<`, `>=`, `<=` | timestamp | 创建时间 |

### 示例：按名称模糊搜索

```bash
curl -sS -X POST "${BASE}/open_api/${PROJECT_KEY}/work_item/story/search/params" \
  -H 'Content-Type: application/json' \
  -H "X-PLUGIN-TOKEN: ${TOKEN}" \
  -H "X-USER-KEY: ${USER_KEY}" \
  -d '{
    "search_group": {
      "conjunction": "AND",
      "search_params": [
        {"param_key": "name", "value": "gemini", "operator": "~"}
      ],
      "search_groups": []
    },
    "page_num": 1,
    "page_size": 20
  }'
```

### 🔥 关联查询：查版本下的需求/缺陷 (search_by_relation)

**用途**：查询某个版本下挂载的所有需求/缺陷。

```bash
# 查版本 r3.197.0 (ID: 6479555049) 的关联需求
curl -X POST "${BASE}/open_api/${PROJECT_KEY}/work_item/version/6479555049/search_by_relation" \
  -H "X-PLUGIN-TOKEN: ${TOKEN}" \
  -H "X-USER-KEY: ${USER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "relation_key": "planning_version",
    "relation_work_item_type_key": "story"
  }'
```

---

## 📋 工作流节点子任务操作

### 1️⃣ 查询工作流（获取节点信息）

```bash
curl -sS -X POST "${BASE}/open_api/${PROJECT_KEY}/work_item/story/${WORK_ITEM_ID}/workflow/query" \
  -H 'Content-Type: application/json' \
  -H "X-PLUGIN-TOKEN: ${TOKEN}" \
  -H "X-USER-KEY: ${USER_KEY}" \
  -d '{}'
```

### 2️⃣ 创建子任务

```bash
TASK_ID=$(curl -sS -X POST "${BASE}/open_api/${PROJECT_KEY}/work_item/story/${WORK_ITEM_ID}/workflow/task" \
  -H 'Content-Type: application/json' \
  -H "X-PLUGIN-TOKEN: ${TOKEN}" \
  -H "X-USER-KEY: ${USER_KEY}" \
  -H "X-IDEM-UUID: $(uuidgen)" \
  -d "{\"node_id\":\"${NODE_ID}\",\"name\":\"子任务名称\"}" \
  | jq -r '.data')
```

### 3️⃣ 设置负责人和排期

```bash
curl -sS -X POST "${BASE}/open_api/${PROJECT_KEY}/work_item/story/${WORK_ITEM_ID}/workflow/${NODE_ID}/task/${TASK_ID}" \
  -H 'Content-Type: application/json' \
  -H "X-PLUGIN-TOKEN: ${TOKEN}" \
  -H "X-USER-KEY: ${USER_KEY}" \
  -H "X-IDEM-UUID: $(uuidgen)" \
  -d '{
    "assignee": ["7586496668992949190"],
    "owners": ["7586496668992949190"],
    "schedule": {"points": 0.5}
  }'
```

---

## 📝 常用字段更新

### 关注人 (watchers)
```bash
curl -sS -X PUT "${BASE}/open_api/${PROJECT_KEY}/work_item/story/${WORK_ITEM_ID}" \
  -H 'Content-Type: application/json' \
  -H "X-PLUGIN-TOKEN: ${TOKEN}" \
  -H "X-USER-KEY: ${USER_KEY}" \
  -H "X-IDEM-UUID: $(uuidgen)" \
  -d '{
    "update_fields": [
      {"field_key": "watchers", "field_value": ["7586496668992949190"]}
    ]
  }'
```

### 规划版本 (planning_version)
```bash
# field_value 直接传版本的 work_item_id 数组
{"field_key": "planning_version", "field_value": [6787840550]}
```

---

## ⚠️ 踩坑记录

1. **filter 接口不生效**：`POST /work_item/filter` 的 `search.conditions` 无效，改用 `search/params`。
2. **操作符**：`name` 模糊匹配用 `~`。
3. **子任务负责人**：必须同时传 `assignee` 和 `owners`。
4. **节点操作路径**：节点完成 API 是 `/open_api/{project}/workflow/...`，注意没有 `work_item`。
5. **role_owners 覆盖**：更新角色负责人时需带上全量角色，否则会被清空。

---

## 🔧 已封装的 API 服务

本地服务：`localhost:18793` (SDK 封装)

---

## 📚 参考文档

- [搜索参数格式官方文档](https://project.feishu.cn/b/helpcenter/1p8d7djs/1l8il0l6)
- [飞书项目开放平台 API 列表](https://project.feishu.cn/open_api/)
