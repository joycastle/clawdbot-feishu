# 飞书项目 User Key / User ID 对照表

> 飞书项目有两套 ID 体系，必须区分使用场景。

## ⚠️ 两套 ID 的区别

| ID 类型 | 用途 | 示例场景 |
|---------|------|----------|
| **user_key** | API 认证、搜索 `current_status_operator` | Header `X-USER-KEY`、查"我参与的" |
| **user_id** | 数据字段值 | `owner`、`created_by`、`role_owners` 里的值 |

**踩坑**：搜索 `owner` 字段时要用 user_id，但认证 header 要用 user_key。

---

## 核心成员

| 姓名 | user_key (API认证/搜索) | user_id (字段值) |
|------|-------------------------|------------------|
| 宝根 | 7586496668992949190 | 7111584692842840092 |
| 何森 | - | 7111562106205470723 |
| 小熊（QA） | - | 7125748777704505372 |

---

## 如何获取 user_key

查询空间成员：
```bash
curl -sS "${BASE}/open_api/${PROJECT_KEY}/user/query" \
  -H "X-PLUGIN-TOKEN: ${TOKEN}" \
  -H "X-USER-KEY: ${USER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"user_keys": [], "emails": ["someone@example.com"]}'
```

---

## 如何获取 user_id

从工作项数据里的 `owner`、`created_by`、`role_owners` 等字段读取。
