# 长期记忆

## 🚫 铁律：项目代码只读

**对游戏项目仓库（Bingo 等业务代码）**：
- ✅ 可以：读取、分析、找问题、提方案
- ❌ 禁止：修改、提交、推送

**无论任何情况，不得违反。**

---

## 🔴 核心教训：代码链路分析要完整

**2026-03-01 教训**：分析"拯救球加球函数"时给出错误结论。

**问题**：
- 只看了函数本身，没追溯调用方
- 有工具但没用
- 急于回答而不是先调查

**标准动作**：
1. 遇到"某函数做什么"的问题 → **先用图查询 API**
2. 画出完整链路：上游 → 目标 → 下游
3. 追踪数据流向（从哪来、到哪去）
4. 再下结论

**工具（优先用这个）**：
```bash
# 谁调用了这个函数
curl "http://127.0.0.1:18801/graph/callers?name=函数名"

# 两点间的调用路径
curl "http://127.0.0.1:18801/graph/path?from=起点&to=终点"
```

**相关文档**：
- `~/work/bf/nakama-ts/docs/chains/` - 已分析的链路
- `memory/tools/code-index-api.md` - API 文档

---

## 🛠️ 代码索引工具包（2026-03-02）

**新项目接入代码智能分析的标准流程**：

```bash
# 一键索引
~/clawd/scripts/code-index/index-project.sh <项目名> <项目路径>
```

**已索引项目**：bf-nakama-ts, clawdbot

**详细文档**：
- `memory/tools/code-index-onboarding.md` - Onboarding 流程
- `memory/tools/code-index-api.md` - API 完整文档
- `scripts/code-index/README.md` - 工具包说明

---

## 🔴 核心教训：主动记忆

**2026-02-26 教训**：14 天没写过任何 session 独立记忆，被骂了。

**规则**：
1. 每个 session 每天要有记录
2. 跨 session 通用的内容必须同步到 MEMORY.md
3. 不等别人提醒，自己判断、自己写

详见 AGENTS.md「核心规则 #5」

---

## ⚠️ 已知问题：Compaction 上下文断裂

### 如果你发现上下文突然断了
**症状**：summary 显示 "Summary unavailable due to context limits. Older messages were truncated."

**这是已知问题**，不是你的锅。

### 根因
- `compaction-safeguard` 扩展在 `ctx.model === undefined` 时会走 fallback
- 旧逻辑：截断历史 + 写占位摘要 = 两头都没捞着
- 已于 2026-02-26 应用 GPT 补丁修复

### 补丁内容（简述）
1. 通过 runtime registry 注入 model
2. `model = ctx.model ?? runtime?.model`
3. 没有 model 就 `{ cancel: true }` 取消压缩，绝不截断+占位

### 如果补丁失效（npm 更新覆盖）
1. 检查 `~/.npm-global/lib/node_modules/clawdbot/dist/agents/pi-extensions/compaction-safeguard.js`
2. 看有没有 `setCompactionSafeguardRuntime` 函数
3. 没有就需要重新应用补丁，详见 `memory/2026-02-26.md`
4. 原始补丁：`~/.clawdbot/media/inbound/clawdbot-compaction-safeguard-fix---*`

---

## 2026-02-24 凭证恢复技巧

### 从 Session 历史找回丢失的凭证/脚本

当凭证或脚本丢失时，可以从旧的 session 历史文件中挖掘：

```bash
# 搜索包含关键词的 session 文件
grep -l "JENKINS\|github_pat\|PRIVATE KEY" ~/.clawdbot-260216/agents/main/sessions/*.jsonl

# 提取具体内容
grep -a "关键词" <session文件> | head -20
```

**今天找回的内容：**
- Jenkins API 凭证（BF/BV）
- GitHub PAT token（joycastle-jiuyi）

### 凭证/脚本存放规范

**不要散装放！** 统一放飞书扩展目录：

| 类型 | 位置 |
|------|------|
| Jenkins 脚本 | `~/.clawdbot/extensions/feishu/scripts/jenkins/` |
| 其他运维脚本 | `~/.clawdbot/extensions/feishu/scripts/` |
| 凭证配置 | `~/.clawdbot/credentials/` 或内置脚本 |

这样迁移时不会漏，也方便 git 管理。

---

## 2026-02-16 迁移完成

从旧环境 `~/.clawdbot-260216/` 迁移到新环境 `~/.clawdbot/`。

### 迁移内容
- Google Vertex 凭证
- 飞书配置（已内置）
- 图片模型配置
- 并发和心跳设置
- Skills (openai-image-gen, openai-whisper-api)
- Brave Search API Key
- 14个活跃定时任务
- 配对设备
- 视频缓存

### 待完善
- IDENTITY.md - 需要确定名字和人设
- USER.md - 需要补充用户信息

### Memory 文件迁移 ✅
- 18个日志文件 (2026-01-29 ~ 2026-02-15)
- 参考文档 (飞书项目API、美术审核标准等)
- 子目录 (groups, learning, sessions, sheets, tools, welcome)
- SQLite 语义搜索数据库
