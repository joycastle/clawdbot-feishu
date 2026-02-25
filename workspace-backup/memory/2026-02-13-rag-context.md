# 2026-02-13 RAG 开发上下文（从聊天记录恢复）

## 背景
宝根想给我建一个飞书知识库问答系统，避免每次都重读文档炸 token。

## 那天完成的事

### 1. RAG MVP（端口 18800）
- 用 fastembed（BAAI/bge-small-zh-v1.5，50MB 中文模型）
- ChromaDB 做向量存储
- 三个接口：
  - GET /search?q=问题&top_k=5 → 向量检索
  - GET /stats → 索引统计
  - GET /health → 健康检查
- 代码在 scripts/rag/ 下（index.py, server.py, config.json）

### 2. 升级到 Advanced RAG
- "摘要-详情"双层索引架构
- summaries 集合：每篇文档用 Gemini 提炼 300 字摘要
- 搜索时先搜摘要，再找原文
- 支持 mode=advanced

### 3. 测试效果
- "特殊玩法"下 5 篇文档已索引
- 问"小鸟放置算法"能精准命中
- 做了综合分析，效果不错

### 4. 持久化
- 写到 TOOLS.md 和 MEMORY.md
- 广播给其他 session
- 加了 @reboot crontab 自启动

## 最后卡住的问题

### 飞书 Wiki API Bug
- "需求分析"节点下有 45+ 文档
- API 只返回 14 个（has_more=false 但实际有遗漏）
- 旧版 doc 类型节点大面积丢失

### 429 限流事故
- 大量 API 调用 + session 膨胀
- 触发 Claude 429
- 凌晨宝根用 trae 修复

## 丢失的东西
- scripts/rag/ 目录（代码）
- ChromaDB 数据
- 端口 18800 服务
- TOOLS.md/MEMORY.md 里的 RAG 相关更新

## 需要重建
1. RAG 服务代码（index.py, server.py）
2. 向量数据库
3. 持久化配置（crontab 自启动）
4. TOOLS.md 里加回 RAG 说明

## 宝根提的其他要求
- "如果用户对 Gemini 不满意，立即切回 Claude"（写到持久化文件）
- RAG 只在企业数据库/项目/知识库相关问题时触发，不要"通用 RAG 优先"
