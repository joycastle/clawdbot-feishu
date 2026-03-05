#!/usr/bin/env python3
"""
BM25 关键词索引模块

用于 Hybrid RAG：向量 + BM25 混合检索
"""

import json
import pickle
from pathlib import Path
from typing import List, Dict, Optional, Tuple

import jieba

# 配置
DATA_DIR = Path(__file__).parent / "data"
BM25_INDEX_FILE = DATA_DIR / "bm25_index.pkl"
BM25_DOCS_FILE = DATA_DIR / "bm25_docs.json"

# 全局缓存
_bm25_index = None
_bm25_docs = None

def tokenize(text: str) -> List[str]:
    """中文分词"""
    # jieba 分词，去除空白和单字符
    tokens = jieba.lcut(text)
    return [t.strip() for t in tokens if len(t.strip()) > 1]

def load_index() -> Tuple[Optional[object], Optional[List[Dict]]]:
    """加载 BM25 索引"""
    global _bm25_index, _bm25_docs
    
    if _bm25_index is not None:
        return _bm25_index, _bm25_docs
    
    try:
        if BM25_INDEX_FILE.exists() and BM25_DOCS_FILE.exists():
            with open(BM25_INDEX_FILE, "rb") as f:
                _bm25_index = pickle.load(f)
            with open(BM25_DOCS_FILE, "r", encoding="utf-8") as f:
                _bm25_docs = json.load(f)
            print(f"[BM25] Loaded index with {len(_bm25_docs)} documents")
            return _bm25_index, _bm25_docs
    except Exception as e:
        print(f"[BM25] Failed to load index: {e}")
    
    return None, None

def save_index(bm25, docs: List[Dict]):
    """保存 BM25 索引"""
    global _bm25_index, _bm25_docs
    
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        
        with open(BM25_INDEX_FILE, "wb") as f:
            pickle.dump(bm25, f)
        
        with open(BM25_DOCS_FILE, "w", encoding="utf-8") as f:
            json.dump(docs, f, ensure_ascii=False)
        
        _bm25_index = bm25
        _bm25_docs = docs
        
        print(f"[BM25] Saved index with {len(docs)} documents")
        return True
    except Exception as e:
        print(f"[BM25] Failed to save index: {e}")
        return False

def add_documents(new_docs: List[Dict]) -> bool:
    """
    添加文档到 BM25 索引
    
    new_docs: [{"id": "...", "content": "...", "metadata": {...}}, ...]
    """
    try:
        from rank_bm25 import BM25Okapi
        
        # 加载现有索引
        _, existing_docs = load_index()
        if existing_docs is None:
            existing_docs = []
        
        # 合并文档（按 id 去重）
        existing_ids = {d["id"] for d in existing_docs}
        for doc in new_docs:
            if doc["id"] not in existing_ids:
                existing_docs.append(doc)
                existing_ids.add(doc["id"])
        
        # 重建 BM25 索引
        tokenized_corpus = [tokenize(d["content"]) for d in existing_docs]
        bm25 = BM25Okapi(tokenized_corpus)
        
        # 保存
        return save_index(bm25, existing_docs)
        
    except Exception as e:
        print(f"[BM25] Failed to add documents: {e}")
        return False

def remove_documents(doc_ids: List[str]) -> bool:
    """删除文档"""
    try:
        from rank_bm25 import BM25Okapi
        
        _, existing_docs = load_index()
        if not existing_docs:
            return True
        
        # 过滤掉要删除的
        ids_to_remove = set(doc_ids)
        remaining_docs = [d for d in existing_docs if d["id"] not in ids_to_remove]
        
        if not remaining_docs:
            # 全删了，清空索引
            BM25_INDEX_FILE.unlink(missing_ok=True)
            BM25_DOCS_FILE.unlink(missing_ok=True)
            global _bm25_index, _bm25_docs
            _bm25_index = None
            _bm25_docs = None
            return True
        
        # 重建索引
        tokenized_corpus = [tokenize(d["content"]) for d in remaining_docs]
        bm25 = BM25Okapi(tokenized_corpus)
        
        return save_index(bm25, remaining_docs)
        
    except Exception as e:
        print(f"[BM25] Failed to remove documents: {e}")
        return False

def search(query: str, top_k: int = 5) -> List[Dict]:
    """
    BM25 搜索
    
    返回: [{"id": "...", "content": "...", "metadata": {...}, "score": float}, ...]
    """
    try:
        bm25, docs = load_index()
        if bm25 is None or not docs:
            return []
        
        # 分词查询
        query_tokens = tokenize(query)
        if not query_tokens:
            return []
        
        # BM25 打分
        scores = bm25.get_scores(query_tokens)
        
        # 排序取 top_k
        scored_docs = [(docs[i], scores[i]) for i in range(len(docs))]
        scored_docs.sort(key=lambda x: x[1], reverse=True)
        
        results = []
        for doc, score in scored_docs[:top_k]:
            if score > 0:  # 只返回有分数的
                results.append({
                    "id": doc["id"],
                    "content": doc["content"],
                    "metadata": doc.get("metadata", {}),
                    "score": float(score)
                })
        
        return results
        
    except Exception as e:
        print(f"[BM25] Search failed: {e}")
        return []

def get_stats() -> Dict:
    """获取统计信息"""
    try:
        _, docs = load_index()
        return {
            "doc_count": len(docs) if docs else 0,
            "index_file": str(BM25_INDEX_FILE),
            "index_exists": BM25_INDEX_FILE.exists()
        }
    except Exception as e:
        return {"error": str(e)}

def rebuild_from_chromadb():
    """从 ChromaDB 重建 BM25 索引"""
    try:
        import chromadb
        from rank_bm25 import BM25Okapi
        
        client = chromadb.PersistentClient(path=str(DATA_DIR / "chromadb"))
        collection = client.get_collection("feishu_docs")
        
        # 获取所有文档
        all_data = collection.get(include=["documents", "metadatas"])
        
        if not all_data or not all_data.get("ids"):
            print("[BM25] No documents in ChromaDB")
            return False
        
        docs = []
        for i, doc_id in enumerate(all_data["ids"]):
            content = all_data["documents"][i] if all_data.get("documents") else ""
            metadata = all_data["metadatas"][i] if all_data.get("metadatas") else {}
            docs.append({
                "id": doc_id,
                "content": content,
                "metadata": metadata
            })
        
        # 建立 BM25 索引
        print(f"[BM25] Building index from {len(docs)} documents...")
        tokenized_corpus = [tokenize(d["content"]) for d in docs]
        bm25 = BM25Okapi(tokenized_corpus)
        
        return save_index(bm25, docs)
        
    except Exception as e:
        print(f"[BM25] Failed to rebuild: {e}")
        return False

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        if sys.argv[1] == "rebuild":
            rebuild_from_chromadb()
        elif sys.argv[1] == "stats":
            print(json.dumps(get_stats(), indent=2, ensure_ascii=False))
        elif sys.argv[1] == "search" and len(sys.argv) > 2:
            query = " ".join(sys.argv[2:])
            results = search(query, top_k=5)
            for r in results:
                print(f"[{r['score']:.2f}] {r['metadata'].get('title', 'N/A')}")
                print(f"    {r['content'][:100]}...")
                print()
    else:
        print("Usage:")
        print("  python bm25_index.py rebuild  - Rebuild from ChromaDB")
        print("  python bm25_index.py stats    - Show stats")
        print("  python bm25_index.py search <query>  - Test search")
