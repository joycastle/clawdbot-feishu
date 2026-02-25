# 长期记忆

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
