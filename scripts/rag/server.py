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
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from pathlib import Path

# 配置
PORT = 18800
VERTEX_PROJECT = os.environ.get("VERTEX_PROJECT", "larkbot-485707")
VERTEX_LOCATION = os.environ.get("VERTEX_LOCATION", "us-central1")
EXPANSION_MODEL = "gemini-2.0-flash-001"  # 便宜快速
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

_vertex_token = None
_vertex_token_expiry = 0

def get_vertex_token():
    """获取 Vertex AI 访问令牌"""
    global _vertex_token, _vertex_token_expiry
    import time
    
    # 检查缓存的令牌是否还有效（留 60 秒余量）
    if _vertex_token and time.time() < _vertex_token_expiry - 60:
        return _vertex_token
    
    try:
        import google.auth
        from google.auth.transport.requests import Request
        
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        credentials.refresh(Request())
        
        _vertex_token = credentials.token
        _vertex_token_expiry = credentials.expiry.timestamp() if credentials.expiry else time.time() + 3600
        
        return _vertex_token
    except Exception as e:
        print(f"[RAG] Failed to get Vertex token: {e}")
        return None

def expand_query(query: str, num_variants: int = 2) -> list:
    """
    用 Vertex AI (Gemini) 扩展查询为多个变体 (REST API)
    
    返回: [原始查询, 变体1, 变体2, ...]
    """
    try:
        token = get_vertex_token()
        if not token:
            return [query]
        
        prompt = f"""将以下搜索查询改写成 {num_variants} 个不同的变体，用于知识库检索。
保持语义相同，但用不同的表达方式、同义词或角度。注意保留专有名词（如"卡库"、"bingo"等游戏术语）。

原始查询: {query}

只输出变体，每行一个，不要编号或其他内容。"""
        
        url = f"https://{VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/{VERTEX_PROJECT}/locations/{VERTEX_LOCATION}/publishers/google/models/{EXPANSION_MODEL}:generateContent"
        data = json.dumps({
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.7, "maxOutputTokens": 150}
        }).encode("utf-8")
        
        req = urllib.request.Request(url, data=data, headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}"
        })
        
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            text = result.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        
        # 解析变体
        variants = [v.strip() for v in text.strip().split("\n") if v.strip()]
        
        print(f"[RAG] Query expanded: {query} -> {variants}")
        
        # 返回原始查询 + 变体
        return [query] + variants[:num_variants]
    
    except Exception as e:
        print(f"[RAG] Query expansion failed: {e}")
        return [query]

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

def safe_search(query: str, top_k: int = 5, mode: str = "normal", rerank: bool = False, expand: bool = False) -> dict:
    """
    安全的搜索函数，保证不会抛异常
    
    mode:
      - normal: 只搜详情库（向量）
      - advanced: 先搜摘要库，再搜详情库
      - hybrid: 向量 + BM25 混合检索（RRF 融合）
    
    rerank: 是否用 cross-encoder 重排序（可与任意 mode 组合）
    expand: 是否用 LLM 扩展查询为多个变体，多路召回合并
    """
    # Query Expansion: 多路召回
    if expand:
        queries = expand_query(query, num_variants=2)
        all_results = []
        seen_ids = set()
        
        for q in queries:
            # 递归调用，但不再 expand
            sub_result = safe_search(q, top_k=top_k, mode=mode, rerank=False, expand=False)
            if sub_result.get("ok") and sub_result.get("results"):
                for r in sub_result["results"]:
                    # 去重（按 content hash）
                    content_id = hash(r.get("content", "")[:200])
                    if content_id not in seen_ids:
                        seen_ids.add(content_id)
                        r["expanded_query"] = q  # 记录来源查询
                        all_results.append(r)
        
        # 按分数排序
        all_results.sort(key=lambda x: x.get("score", 0), reverse=True)
        results = all_results[:top_k * 2]  # 多取一些给 rerank
        
        # Rerank
        if rerank and results:
            results = rerank_results(query, results, top_k)
        else:
            results = results[:top_k]
        
        return {
            "ok": True,
            "results": results,
            "total": len(results),
            "mode": mode,
            "rerank": rerank,
            "expand": True,
            "queries": queries
        }
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
                expand = params.get("expand", ["0"])[0] in ["1", "true", "yes"]
                
                result = safe_search(query, top_k, mode, rerank, expand)
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
    
    def do_POST(self):
        """处理 POST 请求"""
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            
            # 读取请求体
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
            data = json.loads(body)
            
            # Rerank 端点
            if path == "/rerank":
                query = data.get("query", "")
                documents = data.get("documents", [])
                
                if not query or not documents:
                    self.send_json({"ok": False, "error": "缺少 query 或 documents"}, 400)
                    return
                
                # 转换格式并调用 rerank
                results = [{
                    "type": "detail",
                    "content": doc.get("content", "")[:MAX_CONTENT_LENGTH],
                    "metadata": doc.get("metadata", {}),
                    "score": 0,
                    "id": doc.get("id", "")
                } for doc in documents]
                
                reranked = rerank_results(query, results, len(results))
                
                # 返回带 rerank_score 的结果
                self.send_json({
                    "ok": True,
                    "results": [{
                        "id": r.get("id") or r.get("metadata", {}).get("path", ""),
                        "rerank_score": r.get("rerank_score", 0)
                    } for r in reranked]
                })
                return
            
            # 404
            self.send_json({"ok": False, "error": "Not found"}, 404)
            
        except Exception as e:
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
    server = ThreadingHTTPServer(("127.0.0.1", PORT), RAGHandler)
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
