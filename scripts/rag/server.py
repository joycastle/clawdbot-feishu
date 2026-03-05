#!/usr/bin/env python3
"""
RAG 知识库检索服务
端口: 18800

⚠️ 安全注意事项（防止 2026-02-13 事故重演）：
1. 所有操作都有 try-catch，错误返回友好消息，绝不 raise
2. 返回结果有长度限制，避免塞爆上下文
3. 超时控制
4. 不要在错误消息里放太多细节给 LLM 去"修复"
"""

import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path

# 配置
PORT = 18800
DATA_DIR = Path(__file__).parent / "data"
MAX_RESULTS = 10  # 最多返回条数
MAX_CONTENT_LENGTH = 8000  # 单条内容最大字符数

# 懒加载，避免启动时就报错炸掉
_embedding_model = None
_chroma_client = None
_collection = None
_summaries_collection = None
_reranker_model = None

def get_embedding_model():
    """懒加载 embedding 模型"""
    global _embedding_model
    if _embedding_model is None:
        try:
            from fastembed import TextEmbedding
            _embedding_model = TextEmbedding("BAAI/bge-small-zh-v1.5")
        except Exception as e:
            print(f"[RAG] Warning: Failed to load embedding model: {e}")
            return None
    return _embedding_model

def get_reranker_model():
    """懒加载 reranker 模型"""
    global _reranker_model
    if _reranker_model is None:
        try:
            from sentence_transformers import CrossEncoder
            _reranker_model = CrossEncoder("BAAI/bge-reranker-base")
            print("[RAG] Reranker model loaded: BAAI/bge-reranker-base")
        except Exception as e:
            print(f"[RAG] Warning: Failed to load reranker model: {e}")
            return None
    return _reranker_model

def rerank_results(query: str, results: list, top_k: int = 5) -> list:
    """用 cross-encoder 重排序结果"""
    if not results:
        return results
    
    try:
        model = get_reranker_model()
        if model is None:
            return results
        
        # 准备 query-doc pairs
        pairs = [[query, r["content"]] for r in results]
        
        # 打分
        scores = model.predict(pairs)
        
        # 添加 rerank_score 并排序
        for i, r in enumerate(results):
            r["rerank_score"] = float(scores[i])
        
        results.sort(key=lambda x: x.get("rerank_score", 0), reverse=True)
        return results[:top_k]
        
    except Exception as e:
        print(f"[RAG] Rerank failed: {e}")
        return results[:top_k]

def get_collection(name="feishu_docs"):
    """懒加载 ChromaDB collection"""
    global _chroma_client, _collection, _summaries_collection
    try:
        if _chroma_client is None:
            import chromadb
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            _chroma_client = chromadb.PersistentClient(path=str(DATA_DIR / "chromadb"))
        
        if name == "feishu_docs":
            if _collection is None:
                _collection = _chroma_client.get_or_create_collection(
                    name="feishu_docs",
                    metadata={"description": "飞书文档详情切片"}
                )
            return _collection
        elif name == "feishu_summaries":
            if _summaries_collection is None:
                _summaries_collection = _chroma_client.get_or_create_collection(
                    name="feishu_summaries",
                    metadata={"description": "飞书文档摘要索引"}
                )
            return _summaries_collection
    except Exception as e:
        print(f"[RAG] Warning: Failed to get collection {name}: {e}")
        return None
    return None

def rrf_fusion(vector_results: list, bm25_results: list, k: int = 60) -> list:
    """
    Reciprocal Rank Fusion (RRF) 融合两路检索结果
    
    RRF 公式: score = sum(1 / (k + rank_i))
    k 默认 60，平滑因子
    """
    scores = {}  # id -> rrf_score
    items = {}   # id -> item
    
    # 处理向量检索结果
    for rank, item in enumerate(vector_results):
        doc_id = item.get("metadata", {}).get("url", "") + "_" + str(item.get("metadata", {}).get("chunk_index", 0))
        if not doc_id:
            doc_id = f"vec_{rank}"
        
        rrf_score = 1.0 / (k + rank + 1)
        scores[doc_id] = scores.get(doc_id, 0) + rrf_score
        if doc_id not in items:
            items[doc_id] = item
    
    # 处理 BM25 结果
    for rank, item in enumerate(bm25_results):
        doc_id = item.get("metadata", {}).get("url", "") + "_" + str(item.get("metadata", {}).get("chunk_index", 0))
        if not doc_id:
            doc_id = f"bm25_{rank}"
        
        rrf_score = 1.0 / (k + rank + 1)
        scores[doc_id] = scores.get(doc_id, 0) + rrf_score
        if doc_id not in items:
            # 转换 BM25 结果格式
            items[doc_id] = {
                "type": "detail",
                "content": item.get("content", "")[:MAX_CONTENT_LENGTH],
                "metadata": item.get("metadata", {}),
                "score": item.get("score", 0)
            }
    
    # 按 RRF 分数排序
    sorted_ids = sorted(scores.keys(), key=lambda x: scores[x], reverse=True)
    
    results = []
    for doc_id in sorted_ids:
        item = items[doc_id].copy()
        item["rrf_score"] = scores[doc_id]
        results.append(item)
    
    return results

def safe_search(query: str, top_k: int = 5, mode: str = "normal", rerank: bool = False) -> dict:
    """
    安全的搜索函数，保证不会抛异常
    
    mode:
      - normal: 只搜详情库（向量）
      - advanced: 先搜摘要库，再搜详情库
      - hybrid: 向量 + BM25 混合检索（RRF 融合）
    
    rerank: 是否用 cross-encoder 重排序（可与任意 mode 组合）
    """
    try:
        model = get_embedding_model()
        if model is None:
            return {"ok": False, "error": "Embedding 模型未加载", "results": []}
        
        # 生成查询向量
        query_embedding = list(model.embed([query]))[0].tolist()
        
        results = []
        vector_results = []
        bm25_results = []
        
        # Advanced 模式：先搜摘要
        if mode == "advanced":
            summaries = get_collection("feishu_summaries")
            if summaries and summaries.count() > 0:
                summary_results = summaries.query(
                    query_embeddings=[query_embedding],
                    n_results=min(top_k, MAX_RESULTS)
                )
                if summary_results and summary_results.get("documents"):
                    for i, doc in enumerate(summary_results["documents"][0]):
                        meta = summary_results["metadatas"][0][i] if summary_results.get("metadatas") else {}
                        distance = summary_results["distances"][0][i] if summary_results.get("distances") else 0
                        results.append({
                            "type": "summary",
                            "content": doc[:MAX_CONTENT_LENGTH],
                            "metadata": meta,
                            "score": 1 - distance  # 转换为相似度
                        })
        
        # 搜详情库（向量）
        docs = get_collection("feishu_docs")
        if docs and docs.count() > 0:
            # 多取一些用于融合
            fetch_k = top_k * 2 if mode == "hybrid" else top_k
            doc_results = docs.query(
                query_embeddings=[query_embedding],
                n_results=min(fetch_k, MAX_RESULTS * 2)
            )
            if doc_results and doc_results.get("documents"):
                for i, doc in enumerate(doc_results["documents"][0]):
                    meta = doc_results["metadatas"][0][i] if doc_results.get("metadatas") else {}
                    distance = doc_results["distances"][0][i] if doc_results.get("distances") else 0
                    item = {
                        "type": "detail",
                        "content": doc[:MAX_CONTENT_LENGTH],
                        "metadata": meta,
                        "score": 1 - distance
                    }
                    if mode == "hybrid":
                        vector_results.append(item)
                    else:
                        results.append(item)
        
        # Hybrid 模式：加入 BM25 搜索
        if mode == "hybrid":
            try:
                import bm25_index
                bm25_results = bm25_index.search(query, top_k=top_k * 2)
            except Exception as e:
                print(f"[RAG] BM25 search failed: {e}")
                bm25_results = []
            
            # RRF 融合
            results = rrf_fusion(vector_results, bm25_results)
        
        # 按相似度/RRF 分数排序
        if mode == "hybrid":
            results.sort(key=lambda x: x.get("rrf_score", 0), reverse=True)
        else:
            results.sort(key=lambda x: x["score"], reverse=True)
        
        # Rerank：用 cross-encoder 精排
        if rerank and results:
            # 先取多一些候选，再精排
            candidates = results[:top_k * 2]
            results = rerank_results(query, candidates, top_k)
        else:
            results = results[:top_k]
        
        return {"ok": True, "results": results, "total": len(results), "mode": mode, "rerank": rerank}
    
    except Exception as e:
        # ⚠️ 关键：捕获所有异常，返回友好消息，不要让 LLM 看到堆栈
        return {"ok": False, "error": f"搜索失败: {str(e)[:100]}", "results": []}

def safe_stats() -> dict:
    """安全获取统计信息"""
    try:
        docs = get_collection("feishu_docs")
        summaries = get_collection("feishu_summaries")
        
        # BM25 统计
        bm25_stats = {}
        try:
            import bm25_index
            bm25_stats = bm25_index.get_stats()
        except Exception as e:
            bm25_stats = {"error": str(e)[:50]}
        
        return {
            "ok": True,
            "docs_count": docs.count() if docs else 0,
            "summaries_count": summaries.count() if summaries else 0,
            "bm25": bm25_stats,
            "data_dir": str(DATA_DIR)
        }
    except Exception as e:
        return {"ok": False, "error": f"获取统计失败: {str(e)[:100]}"}

class RAGHandler(BaseHTTPRequestHandler):
    """HTTP 请求处理器"""
    
    def log_message(self, format, *args):
        """静默日志，避免刷屏"""
        pass
    
    def send_json(self, data: dict, status: int = 200):
        """发送 JSON 响应"""
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))
    
    def do_GET(self):
        """处理 GET 请求"""
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            params = parse_qs(parsed.query)
            
            # 健康检查
            if path == "/health":
                self.send_json({"ok": True, "service": "rag", "port": PORT})
                return
            
            # 统计信息
            if path == "/stats":
                self.send_json(safe_stats())
                return
            
            # 搜索
            if path == "/search":
                query = params.get("q", [""])[0]
                if not query:
                    self.send_json({"ok": False, "error": "缺少参数 q"}, 400)
                    return
                
                top_k = int(params.get("top_k", ["5"])[0])
                top_k = min(top_k, MAX_RESULTS)  # 限制最大返回数
                
                mode = params.get("mode", ["normal"])[0]
                rerank = params.get("rerank", ["0"])[0] in ["1", "true", "yes"]
                
                result = safe_search(query, top_k, mode, rerank)
                self.send_json(result)
                return
            
            # 队列状态（兼容旧接口）
            if path == "/queue":
                self.send_json({
                    "ok": True,
                    "queue_len": 0,
                    "processing": None,
                    "completed": 0,
                    "errors": 0
                })
                return
            
            # 404
            self.send_json({"ok": False, "error": "Not found"}, 404)
            
        except Exception as e:
            # ⚠️ 捕获所有异常
            self.send_json({"ok": False, "error": f"服务器错误: {str(e)[:100]}"}, 500)

def main():
    """启动服务"""
    print(f"[RAG] Starting server on port {PORT}...")
    
    # 预加载模型（可选，失败也不影响启动）
    try:
        get_embedding_model()
        print("[RAG] Embedding model loaded")
    except:
        print("[RAG] Warning: Embedding model not loaded, will retry on first request")
    
    # 启动 HTTP 服务
    server = HTTPServer(("127.0.0.1", PORT), RAGHandler)
    print(f"[RAG] Server running at http://127.0.0.1:{PORT}")
    print("[RAG] Endpoints:")
    print("  GET /health - 健康检查")
    print("  GET /stats - 统计信息")
    print("  GET /search?q=问题&top_k=5&mode=normal|advanced - 搜索")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[RAG] Shutting down...")
        server.shutdown()

if __name__ == "__main__":
    main()
