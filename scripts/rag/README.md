# RAG 知识库检索服务

飞书文档向量检索服务，支持 Advanced RAG（摘要-详情双层索引）。

## ⚠️ 重要警告

**2026-02-13 事故教训：**
- RAG 脚本报错后 fallback 回给 Claude
- 模型尝试修复 → 产生更多 token → session 膨胀
- 最终触发 429 限流，gateway 崩溃

**防护措施（已实现）：**
1. 所有操作都有 try-catch，错误返回友好消息
2. 绝不把详细错误信息抛给 LLM
3. 返回结果有长度限制（MAX_RESULTS=10, MAX_CONTENT_LENGTH=8000）
4. 单个文档失败不影响整体流程

## 架构

```
用户提问
    │
    ▼
┌──────────────────────────────────┐
│  RAG Server (18800)              │
│  GET /search?q=问题&mode=advanced │
└──────────────┬───────────────────┘
               │
      ┌────────┴────────┐
      │                 │
      ▼                 ▼
┌───────────┐    ┌───────────┐
│ summaries │    │   docs    │
│  摘要库    │    │  详情库   │
└───────────┘    └───────────┘
      │                 │
      └────────┬────────┘
               │
               ▼
         ChromaDB + fastembed
```

## 快速开始

### 1. 启动服务

```bash
cd ~/clawd/scripts/rag
python server.py
# 或后台运行
nohup python server.py > /tmp/rag.log 2>&1 &
```

### 2. 索引文档

```bash
# 单个文档
python index.py --url "https://xxx.feishu.cn/wiki/xxxtoken"

# 多个文档
echo "https://xxx.feishu.cn/wiki/doc1" > urls.txt
echo "https://xxx.feishu.cn/wiki/doc2" >> urls.txt
python index.py --urls urls.txt

# Advanced 模式（同时生成摘要）
python index.py --url "..." --advanced

# 查看统计
python index.py --stats
```

### 3. 搜索

```bash
# 基础搜索
curl "http://127.0.0.1:18800/search?q=小鸟放置算法&top_k=5"

# Advanced 模式（先搜摘要）
curl "http://127.0.0.1:18800/search?q=小鸟放置算法&top_k=5&mode=advanced"

# 健康检查
curl http://127.0.0.1:18800/health

# 统计
curl http://127.0.0.1:18800/stats
```

## API 接口

| 端点 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/health` | GET | - | 健康检查 |
| `/stats` | GET | - | 索引统计 |
| `/search` | GET | `q`, `top_k`, `mode` | 向量搜索 |
| `/queue` | GET | - | 队列状态（兼容） |

### 搜索参数

- `q` (必需): 查询文本
- `top_k` (可选, 默认 5): 返回条数，最大 10
- `mode` (可选): 
  - `normal`: 只搜详情库
  - `advanced`: 先搜摘要库，再搜详情库

## 依赖

```bash
pip install fastembed chromadb
```

## 文件结构

```
scripts/rag/
├── server.py      # HTTP 服务
├── index.py       # 索引脚本
├── README.md      # 本文件
└── data/
    └── chromadb/  # 向量数据库
```

## 自启动（crontab）

```bash
# 编辑 crontab
crontab -e

# 添加
@reboot cd /home/ubuntu/clawd/scripts/rag && python server.py >> /tmp/rag.log 2>&1 &
```

## 注意事项

1. **依赖 docs-router (18798)**：index.py 需要 docs-router 服务来读取飞书文档
2. **首次加载慢**：fastembed 模型约 50MB，首次需要下载
3. **内存占用**：约 270MB（模型 + ChromaDB）
4. **不要暴力索引**：大量文档时加延迟，避免打爆飞书 API
