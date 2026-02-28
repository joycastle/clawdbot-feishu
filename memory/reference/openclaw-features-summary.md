# OpenClaw 新功能总结

> 整理于 2026-02-12，基于 OpenClaw 2026.2.9 版本文档和 CHANGELOG

## 📱 移动端/IoT 支持

### iOS Node App (alpha)
- iOS 原生 app 可以作为 node 连接到 OpenClaw
- 支持设备配对、摄像头控制、屏幕录制、位置获取
- 通过 Telegram `/pair` 命令或 setup code 配对

### Android Node 支持
- 同样支持 Android 设备作为 node
- 相机/屏幕/位置控制

## 🧠 记忆系统增强

### Voyage AI 原生支持
- 可选 Voyage 作为向量嵌入 provider
- 设置 `memorySearch.provider: "voyage"` 即可启用
- 需要 `VOYAGE_API_KEY`

### QMD 记忆后端 (实验性)
- 本地优先的搜索引擎，结合 BM25 + 向量 + 重排序
- 完全本地运行，无需外部 API
- 配置 `memory.backend: "qmd"` 启用

### 混合搜索 (BM25 + Vector)
- 同时使用关键词匹配和语义搜索
- 对精确 token（ID、代码符号）更友好

### Session 记忆搜索 (实验性)
- 可索引会话历史，通过 memory_search 搜索
- `memorySearch.experimental.sessionMemory: true` 启用

## 🔌 新渠道/Provider

### Feishu/Lark 飞书插件
- 官方支持的飞书频道插件（我们已经在用）
- WebSocket 长连接，无需公网 webhook

### BlueBubbles (iMessage)
- 推荐的 iMessage 集成方案
- 比旧的 imsg channel 更稳定

### xAI (Grok) 支持
- 作为 web_search provider
- 作为模型 provider

### 百度千帆支持
- 国内模型 provider

### Cloudflare AI Gateway
- 可作为代理网关

## 🌐 Web UI 增强

### Agent 管理面板
- 管理 agent 文件、tools、skills、models、channels、cron jobs
- 可视化配置

### Token 用量仪表盘
- 追踪 token 使用情况

### Compaction 分隔线
- 聊天历史中显示压缩点

## ⏰ Cron 系统改进

### Announce 投递模式
- isolated job 完成后自动投递摘要到指定渠道
- 更可靠的定时任务系统

### 运行历史
- 可追踪每次 cron 运行的记录
- 从 dashboard deep-link 到会话

## 🔒 安全性增强

### Exec 审批增强
- 更安全的命令审批流程
- Windows exec allowlist 加固

### SSRF 防护
- skill 安装器下载时检查 URL
- 媒体理解 provider 的 SSRF 防护

### 凭证保护
- config.get 响应中自动隐藏敏感信息
- skill/plugin 代码安全扫描

### Voice Call 安全
- webhook 验证加固
- 匿名来电处理

## 🛠️ 其他改进

### 模型支持
- Anthropic Opus 4.6
- OpenAI Codex gpt-5.3-codex
- 模型 failover 更智能（HTTP 400 也触发）

### Context Overflow 恢复
- 自动处理过大的 tool result
- 预防性截断 + 回退截断

### 会话压缩
- 压缩后不再"失忆"
- transcript 写入保留 parentId 链

### Multi-Agent
- 支持创建/更新/删除 agent 的 RPC 方法
- 更好的多 agent 管理

---

## 🤔 对我们的价值评估

### 高价值（推荐启用）
1. **QMD 记忆后端** - 本地搜索更快更准
2. **混合搜索** - 对代码/ID 类查询更友好
3. **Web UI Agent 管理** - 可视化配置更方便
4. **Token 用量仪表盘** - 成本追踪

### 中等价值（按需启用）
1. **Session 记忆搜索** - 如果需要搜索历史对话
2. **Voyage 嵌入** - 如果对记忆检索有更高要求

### 暂不需要
1. **iOS/Android Node** - 我们目前没有移动端控制需求
2. **BlueBubbles** - 我们用飞书
3. **xAI/千帆** - 我们用 Claude + Gemini

### ⚠️ 注意事项
1. **消息实时发送问题** - OpenClaw 架构变化导致消息"一股脑"发送，需要进一步研究修复
2. **HTTP API 自动启动** - 插件的 HTTP 服务需要手动启动脚本
