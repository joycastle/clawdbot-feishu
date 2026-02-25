# TOOLS.md - Local Notes

详细文档在 `memory/tools/` 目录，这里只放快速索引。

---

## 🔧 HTTP API 服务

| 端口 | 服务 | 文档 |
|------|------|------|
| 18789 | Gateway | clawdbot 核心 |
| 18791 | Browser Control | Chrome 扩展 |
| 18793 | 飞书项目 API | `memory/tools/project-api.md` |
| 18794-18796 | 飞书其他 API | sheets, docs, bitable |
| 18797 | ⭐ 定时任务/提醒 API (Cron) | `memory/tools/cron-api.md` |
| **18800** | **⭐ RAG 知识库** | `scripts/rag/README.md` |

---

## ⭐ RAG 知识库检索

**适用场景：** 涉及公司项目、企业知识库、飞书文档的问题

```bash
# 搜索（基础）
curl "http://127.0.0.1:18800/search?q=小鸟放置算法&top_k=5"

# 搜索（Advanced，先搜摘要）
curl "http://127.0.0.1:18800/search?q=...&mode=advanced"

# 健康检查
curl http://127.0.0.1:18800/health

# 统计
curl http://127.0.0.1:18800/stats
```

**索引文档：**
```bash
cd ~/.clawdbot/extensions/feishu/scripts/rag
python3 index.py --url "https://xxx.feishu.cn/wiki/xxxtoken" --advanced
```

详见 `~/.clawdbot/extensions/feishu/scripts/rag/README.md`

---

## ⏰ 定时任务 (Cron)

**适用场景：** 定时提醒、延时任务、周期推送

> ⭐ **默认规则：所有定时类任务必须用 cron job！** 不要用 sleep，cron job 可追溯、可取消。
> 
> ⚠️ **必须用完整 schema！** 人类友好格式（`"in 5 minutes"`）未实现。

```bash
# 列出所有任务
curl http://127.0.0.1:18797/list

# 一次性任务（30秒后）- 先算时间戳
atMs=$(($(date +%s)*1000 + 30000))
curl -X POST http://127.0.0.1:18797/add -H "Content-Type: application/json" -d "{
  \"job\": {
    \"name\": \"my-task\",
    \"schedule\": {\"kind\": \"at\", \"atMs\": $atMs},
    \"sessionTarget\": \"isolated\",
    \"payload\": {\"kind\": \"agentTurn\", \"message\": \"任务内容\"}
  }
}"

# 周期任务（cron 表达式，UTC 时间！）
# 北京时间 9:00 = UTC 1:00 = "0 1 * * *"

# 删除任务
curl -X POST http://127.0.0.1:18797/remove -H "Content-Type: application/json" -d '{"id": "job-uuid"}'
```

详见 `memory/tools/cron-api.md`

---

## 📱 飞书 CLI 工具

**聊天历史**
```bash
npx tsx ~/.clawdbot/extensions/feishu/src/cli/history.ts --message <message_id> --count 20
```

**表情反应**
```bash
npx tsx ~/.clawdbot/extensions/feishu/src/cli/reaction.ts add --message <message_id> --emoji THUMBSUP
```
详见 `memory/tools/feishu-reactions.md`

**日志分析**
```bash
npx tsx ~/.clawdbot/extensions/feishu/src/cli/log-analyze.ts --pid <player_id>
```
详见 `memory/tools/log-analysis.md`

---

## 📋 数据索引文件（重要！）

| 文件 | 说明 |
|------|------|
| **`CONTACTS.md`** | ⭐ 用户 open_id / user_key、常用群 chat_id、管理员白名单 |
| **`memory/feishu-groups.md`** | ⭐ 完整飞书群 chat_id 映射表（发消息/定时任务必查） |
| `memory/feishu-project-userkeys.md` | 飞书项目用户 user_key 映射 |
| `memory/feishu-bf-project-schema.md` | BF 项目字段 schema |
| `memory/art-review-standards.md` | 美术审核验收标准 |
| `memory/level-design-standards.md` | 关卡设计标准 |

---

## 🚀 Jenkins 服务器操作（关键路径！）

> ⚠️ **重启规则：**
> 1. **restart 会自动先检查配置**，检查不通过会中止重启
> 2. **重启完成后必须向群里报告**：说清楚重启了哪个环境、触发了什么 job、结果如何

**BF 项目：**
```bash
~/.clawdbot/extensions/feishu/scripts/jenkins/bf-jenkins.sh <操作> <环境>

# 操作: restart | update | check
# 环境: develop | develop1 | release | plan

# 示例
~/.clawdbot/extensions/feishu/scripts/jenkins/bf-jenkins.sh restart develop1
```

**BV 项目：**
```bash
~/.clawdbot/extensions/feishu/scripts/jenkins/bv-jenkins.sh <操作> <环境>

# 操作: restart | hotupdate | deploy | check
# 环境: dev | test | test2 | test3 | test4 | design

# 示例
~/.clawdbot/extensions/feishu/scripts/jenkins/bv-jenkins.sh restart dev
```

详见 `memory/tools/jenkins.md`

---

## 📚 工具文档索引

| 文件 | 说明 |
|------|------|
| `memory/tools/project-api.md` | 飞书项目 API（工作项、缺陷、任务） |
| `memory/tools/cron-api.md` | ⭐ 定时任务/提醒 API |
| `memory/tools/task-api.md` | 飞书任务 API（任务中心） |
| `memory/tools/feishu-reactions.md` | 飞书表情反应 |
| `memory/tools/feishu-docs.md` | 飞书云文档 API |
| `memory/tools/log-analysis.md` | 玩家日志分析 |
| `memory/tools/vertex-gcs.md` | GCS/Vertex AI |
| `memory/tools/jenkins.md` | Jenkins 操作 |

---

## 🔑 凭证位置

- AWS S3: `~/.clawdbot/aws-s3.json`
- GCS/Vertex: `memory/tools/vertex-gcs.md` 里有说明

---

## ⚠️ 注意事项

- TOOLS.md 可能过时，实际使用前先验证端口/路径
- 详细用法看 memory/tools/ 里的文档
- 有问题先查 memory，别自己造轮子
