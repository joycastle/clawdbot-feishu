# TOOLS.md - 快速索引

> 详细文档在 `memory/tools/`，这里只放常用命令。

---

## ⚠️ 代码分析必读

**遇到代码问题（某函数做什么、链路追踪、bug 分析等）**：

1. **先用工具，再回答！**
2. **调用图查询**（优先用这个）：
   ```bash
   # 谁调用了这个函数
   curl "http://127.0.0.1:18801/graph/callers?name=函数名"
   
   # 两点间的调用路径
   curl "http://127.0.0.1:18801/graph/path?from=起点&to=终点"
   
   # 这个函数调用了谁
   curl "http://127.0.0.1:18801/graph/callees?name=函数名"
   
   # ⭐ 影响范围分析（改了这个函数会影响谁）
   curl "http://127.0.0.1:18801/graph/impact?name=函数名&depth=3"
   
   # 循环依赖检测（互相调用 + 自递归）
   curl "http://127.0.0.1:18801/graph/cycles?limit=10"
   ```
3. **类型继承**（理解架构层级）：
   ```bash
   curl "http://127.0.0.1:18801/graph/children?name=ServerResp"  # 子类
   curl "http://127.0.0.1:18801/graph/parents?name=类名"         # 父类
   ```
4. **装饰器索引**（快速查 RPC/Controller）：
   ```bash
   curl "http://127.0.0.1:18801/graph/rpc-endpoints?limit=50"    # 915个RPC
   curl "http://127.0.0.1:18801/graph/controllers"               # 141个Controller
   curl "http://127.0.0.1:18801/graph/decorator-targets?name=Validate"
   ```
5. **模块依赖**：
   ```bash
   curl "http://127.0.0.1:18801/graph/module-deps?module=src/bingo/campaign"
   ```
6. 关键词搜索：`curl "http://127.0.0.1:18801/search?q=函数名&p=bf-nakama-ts"`
7. 不确定的不要猜，追到底

**已有链路文档**：`~/work/bf/nakama-ts/docs/chains/`

---

## 🔧 HTTP API 端口

| 端口 | 服务 | 文档 |
|------|------|------|
| 18793 | 飞书项目 API（简单查询） | `memory/tools/project-api.md` |
| 18797 | ⭐ 定时任务 API | `memory/tools/cron-api.md` |
| 18800 | ⭐ RAG 知识库 | `scripts/rag/README.md` |
| 18801 | ⭐ 代码索引服务 | `memory/tools/code-index-api.md` |

> ⚠️ **飞书项目"我参与的"查询**：18793 本地 API 功能有限，需用飞书原生 `search/params` API。详见 `memory/tools/project-api.md`

---

## ⏰ 定时任务（最常用）

> ⚠️ **必须用 Cron API！不要用 sleep！**

```bash
# 列出任务
curl http://127.0.0.1:18797/list

# 30秒后执行（先算时间戳）
atMs=$(($(date +%s)*1000 + 30000))
curl -X POST http://127.0.0.1:18797/add -H "Content-Type: application/json" -d "{
  \"job\": {
    \"name\": \"task-name\",
    \"schedule\": {\"kind\": \"at\", \"atMs\": $atMs},
    \"sessionTarget\": \"isolated\",
    \"payload\": {\"kind\": \"agentTurn\", \"message\": \"任务内容\"}
  }
}"

# 删除任务
curl -X POST http://127.0.0.1:18797/remove -d '{"id": "job-uuid"}'
```

---

## 🚀 Jenkins 重启

```bash
# BF 项目
~/.clawdbot/extensions/feishu/scripts/jenkins/bf-jenkins.sh <操作> <环境>
# 操作: restart | update | check
# 环境: develop | develop1 | release | plan

# BV 项目  
~/.clawdbot/extensions/feishu/scripts/jenkins/bv-jenkins.sh <操作> <环境>
# 操作: restart | hotupdate | deploy | check
# 环境: dev | test | test2 | test3 | test4 | design
```

---

## 📱 飞书 CLI

```bash
# 聊天历史
npx tsx ~/.clawdbot/extensions/feishu/src/cli/history.ts --message <msg_id> --count 20

# 表情反应
npx tsx ~/.clawdbot/extensions/feishu/src/cli/reaction.ts add --message <msg_id> --emoji THUMBSUP
```

---

## 📋 数据索引

| 文件 | 用途 |
|------|------|
| `CONTACTS.md` | ⭐ 用户 open_id、常用群 chat_id |
| `memory/reference/feishu-groups.md` | ⭐ 完整群 chat_id 映射 |
| `memory/reference/feishu-project-userkeys.md` | 飞书项目 user_key vs user_id 对照 |
| `memory/reference/art-review-standards.md` | 美术审核验收标准 |

---

## 💻 代码索引服务 (18801)

```bash
# 搜索代码
curl "http://127.0.0.1:18801/search?q=rescue&p=bf-nakama-ts"

# 查看已索引项目
curl http://127.0.0.1:18801/projects

# 索引新项目
curl -X POST http://127.0.0.1:18801/index -H "Content-Type: application/json" -d '{
  "name": "项目名",
  "path": "/项目路径",
  "summariesPath": "/摘要文件.jsonl"
}'
```

### 增量索引 (tree-sitter)

```bash
# 查询索引状态
curl "http://127.0.0.1:18801/incremental/status?projectRoot=/path/to/project"

# 触发增量索引（只处理变化的文件，首次69s → 二次0.5s）
curl -X POST http://127.0.0.1:18801/incremental/index \
  -H "Content-Type: application/json" \
  -d '{"projectRoot": "/home/ubuntu/work/bf/nakama-ts/src/src"}'

# CLI: watch 模式（实时监听文件变化）
cd ~/.clawdbot/extensions/feishu
npx tsx src/services/incremental-indexer.ts /path/to/project --watch
```

**已索引项目**：
- `bf-nakama-ts`: BF 后端 (3849 条摘要)
- 增量索引: 21265 节点, 51443 边, 3407 文件

---

## 🔍 更多

详细文档见 `memory/tools/` 和 `memory/INDEX.md`
