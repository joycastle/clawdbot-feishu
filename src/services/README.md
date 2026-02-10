# services/ - 独立 HTTP 服务

独立运行的 HTTP API 服务，供 Agent 通过 curl/fetch 调用。

## 文件说明

| 文件 | 端口 | 说明 |
|------|------|------|
| `docs-router.ts` | 18798 | **文档统一入口** - 一个接口读取所有飞书文档 |
| `wiki.ts` | - | Wiki 知识库解析（被 docs-router 调用） |
| `docx.ts` | - | Docx 文档读取（被 docs-router 调用） |
| `bitable-api.ts` | 18795 | 多维表格 API（Bitable 增删改查） |
| `sheets-api.ts` | 18796 | 飞书电子表格 API（读取、合并单元格、日期转换） |
| `project-api.ts` | 18793 | 飞书项目 API（工作项、缺陷、需求、子任务等） |
| `task-api.ts` | 18794 | 飞书任务 API（待办任务） |
| `cron-api.ts` | 18797 | 定时任务 API（添加/列表/删除定时提醒、延时任务） |

## 架构图

```
飞书文档 URL
     │
     ▼
┌──────────────────┐
│  docs-router.ts  │  ← 统一入口 (18798)
│  /read?url=xxx   │
└────────┬─────────┘
         │ 解析 URL 类型
         ▼
    ┌────┴────┐
    │         │
    ▼         ▼
┌───────┐ ┌───────────────┐
│ wiki  │ │ 独立文档      │
│ 二级  │ │ docx/sheet/   │
│ 解析  │ │ bitable       │
└───┬───┘ └───────┬───────┘
    │             │
    ▼             ▼
┌───────────────────────────────────┐
│  docx.ts  │  sheets-api  │  bitable-api  │
│           │   (18796)    │    (18795)    │
└───────────────────────────────────┘
```

## 使用方法

### 📄 读取任意飞书文档（推荐）

```bash
# 一个接口搞定所有类型
curl "http://127.0.0.1:18798/read?url=<飞书文档URL>"

# 支持的 URL 格式：
# - https://xxx.feishu.cn/wiki/xxxtoken    (知识库)
# - https://xxx.feishu.cn/docx/xxxtoken    (独立文档)
# - https://xxx.feishu.cn/sheets/xxxtoken  (独立电子表格)
# - https://xxx.feishu.cn/base/xxxtoken    (独立多维表格)
```

**返回格式：**
- docx → `{ type: "docx", content: "..." }`
- sheet → `{ type: "sheet", sheets: [...], data: [...] }`
- bitable → `{ type: "bitable", tables: [...], data: [...] }`

### 其他服务

```bash
# 飞书项目 - 查询缺陷列表
curl "http://127.0.0.1:18793/workitems?typeKey=issue&pageSize=10"

# 飞书任务 - 检查状态
curl http://127.0.0.1:18794/status

# 多维表格 - 直接读取（跳过 docs-router）
curl "http://127.0.0.1:18795/app/<app_token>/table/<table_id>/records"

# 定时任务 - 添加延时提醒
curl -X POST http://127.0.0.1:18797/add \
  -H "Content-Type: application/json" \
  -d '{
    "job": {
      "schedule": "in 10 seconds",
      "text": "时间到了！记得去开会"
    }
  }'
```

## 详细文档

- **飞书项目 API**：见 `memory/feishu-project-api-guide.md`（实战指南）
- **工作项类型和字段**：见 `memory/feishu-project-schema.md`
