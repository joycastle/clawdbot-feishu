# Memory 索引

> 快速找到需要的文档。**不确定读哪个？先看这里。**

---

## 📋 场景路由表

| 场景 | 必读文档 | 备注 |
|------|----------|------|
| **主 session（私聊宝根）** | `MEMORY.md` + 今日/昨日笔记 | 有上下文时可跳过 |
| **群聊** | `groups/<群名>.md` | 没有则不读 |
| **工具/API 使用** | `tools/<工具名>.md` | 详见下方工具索引 |
| **美术审核** | `reference/art-review-standards.md` | 必须按标准逐条过 |
| **关卡审核** | `reference/level-design-standards.md` | |
| **飞书项目操作** | `reference/feishu-project-*.md` | |
| **上下文断裂** | 先 `memory_search`，再拉聊天历史 | |

---

## 📁 目录结构

```
memory/
├── INDEX.md          ← 你在这里
├── YYYY-MM-DD.md     # 通用每日摘要
├── tools/            # 工具文档
├── reference/        # 参考文档（标准、schema、映射表）
├── groups/           # 群聊规则（简短，如"不自动发卡片"）
├── sessions/         # ⭐ Session 独立记忆（重要！）
│   └── <session-id>/
│       ├── MEMORY.md      # session 长期记忆
│       └── YYYY-MM-DD.md  # session 每日记忆
└── welcome/          # 新人欢迎配置
```

### sessions/ vs groups/ 的区别
- **groups/** — 群的简单规则（几行），如"不自动发卡片"
- **sessions/** — session 完整记忆，包括专属知识、历史决策等

---

## 🔧 工具文档索引 (`tools/`)

| 文档 | 用途 |
|------|------|
| `cron-api.md` | ⭐ 定时任务/提醒 API（必须用完整 schema！） |
| `jenkins.md` | BF/BV Jenkins 重启/更新 |
| `project-api.md` | 飞书项目 API（工作项、缺陷） |
| `task-api.md` | 飞书任务 API |
| `log-analysis.md` | 玩家日志分析 |
| `feishu-docs.md` | 飞书云文档 API |
| `vertex-gcs.md` | GCS/Vertex AI |
| `html-deploy.md` | HTML 快速部署（cloudflared） |

---

## 📚 参考文档索引 (`reference/`)

| 文档 | 用途 |
|------|------|
| `feishu-groups.md` | ⭐ 群 chat_id 映射（发消息必查） |
| `feishu-project-userkeys.md` | 用户 user_key 映射 |
| `feishu-bf-project-schema.md` | BF 项目字段 schema |
| `art-review-standards.md` | ⭐ 美术审核验收标准 |
| `level-design-standards.md` | 关卡设计标准 |
| `feishu-reactions.md` | 飞书表情反应用法 |

---

## 👥 群聊记忆 (`groups/`)

| 群 | 文件 | 特殊规则 |
|------|------|----------|
| AI 沙盒群 | `ai-sandbox.md` | 非严肃话题用原句 |
| 美术审核群 | `art-review.md` | 按验收标准审核 |
| 三消口播群 | `三消口播.md` | 不自动发卡片 |

---

## 🔍 找不到？

1. `memory_search` 语义搜索
2. `grep -r "关键词" ~/clawd/memory/`
3. 问宝根
