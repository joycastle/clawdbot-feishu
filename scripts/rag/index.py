#!/usr/bin/env python3
"""
RAG 文档索引脚本

⚠️ 安全注意事项（防止 2026-02-13 事故重演）：
1. 所有操作都有 try-catch
2. 错误时打印日志并跳过，不要 raise
3. 单个文档失败不影响其他文档
4. 有进度输出，方便观察
5. 可以 Ctrl+C 安全中断

使用方法：
  # 索引单个文档
  python index.py --url "https://xxx.feishu.cn/wiki/xxxtoken"
  
  # 索引多个文档
  python index.py --urls urls.txt
  
  # 重建索引
  python index.py --rebuild
"""

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Optional, List, Dict

# 配置
DATA_DIR = Path(__file__).parent / "data"
DOCS_API = "http://127.0.0.1:18798"  # docs-router 服务
CHUNK_SIZE = 500  # 切片大小（字符）
CHUNK_OVERLAP = 50  # 切片重叠

# 全局变量
_embedding_model = None
_chroma_client = None

def get_embedding_model():
    """懒加载 embedding 模型"""
    global _embedding_model
    if _embedding_model is None:
        from fastembed import TextEmbedding
        _embedding_model = TextEmbedding("BAAI/bge-small-zh-v1.5")
        print("[Index] Embedding model loaded: BAAI/bge-small-zh-v1.5")
    return _embedding_model

def get_chroma_client():
    """懒加载 ChromaDB"""
    global _chroma_client
    if _chroma_client is None:
        import chromadb
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        _chroma_client = chromadb.PersistentClient(path=str(DATA_DIR / "chromadb"))
        print(f"[Index] ChromaDB initialized at {DATA_DIR / 'chromadb'}")
    return _chroma_client

def fetch_document(url: str) -> Optional[Dict]:
    """从 docs-router 获取文档内容"""
    import urllib.request
    import urllib.parse
    
    try:
        api_url = f"{DOCS_API}/read?url={urllib.parse.quote(url)}"
        with urllib.request.urlopen(api_url, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
            if data.get("error"):
                print(f"[Index] Warning: {data['error']}")
                return None
            return data
    except Exception as e:
        print(f"[Index] Failed to fetch {url}: {e}")
        return None

def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """将文本切分成小块"""
    if not text:
        return []
    
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        if chunk.strip():
            chunks.append(chunk.strip())
        start = end - overlap
    
    return chunks

def compute_hash(text: str) -> str:
    """计算文本哈希，用于去重"""
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:12]

def index_document(url: str, force: bool = False) -> bool:
    """
    索引单个文档
    
    返回: True 成功, False 失败或跳过
    """
    try:
        print(f"[Index] Processing: {url}")
        
        # 获取文档内容
        doc = fetch_document(url)
        if not doc:
            return False
        
        content = doc.get("content", "")
        if not content:
            print(f"[Index] Warning: Empty content for {url}")
            return False
        
        title = doc.get("title", url)
        doc_type = doc.get("type", "unknown")
        
        # 计算哈希检查是否需要更新
        content_hash = compute_hash(content)
        
        client = get_chroma_client()
        docs_collection = client.get_or_create_collection("feishu_docs")
        
        # 检查是否已存在（通过 metadata 里的 url）
        existing = docs_collection.get(where={"url": url})
        if existing and existing.get("ids") and not force:
            existing_hash = existing["metadatas"][0].get("hash", "")
            if existing_hash == content_hash:
                print(f"[Index] Skipped (unchanged): {title}")
                return True
            else:
                # 删除旧的
                docs_collection.delete(ids=existing["ids"])
                print(f"[Index] Updating: {title}")
        
        # 切片
        chunks = chunk_text(content)
        if not chunks:
            print(f"[Index] Warning: No chunks for {url}")
            return False
        
        print(f"[Index] Generating embeddings for {len(chunks)} chunks...")
        
        # 生成 embedding
        model = get_embedding_model()
        embeddings = list(model.embed(chunks))
        
        # 存入 ChromaDB
        ids = [f"{content_hash}_{i}" for i in range(len(chunks))]
        metadatas = [{
            "url": url,
            "title": title,
            "type": doc_type,
            "hash": content_hash,
            "chunk_index": i,
            "total_chunks": len(chunks)
        } for i in range(len(chunks))]
        
        docs_collection.add(
            ids=ids,
            embeddings=[e.tolist() for e in embeddings],
            documents=chunks,
            metadatas=metadatas
        )
        
        print(f"[Index] ✅ Indexed: {title} ({len(chunks)} chunks)")
        return True
        
    except KeyboardInterrupt:
        print("\n[Index] Interrupted by user")
        raise
    except Exception as e:
        # ⚠️ 捕获异常，打印日志，不 raise
        print(f"[Index] ❌ Error indexing {url}: {e}")
        return False

def generate_summary(content: str, title: str) -> Optional[str]:
    """
    用 Gemini 生成文档摘要
    
    ⚠️ 这里调用外部 API，需要特别注意错误处理
    """
    try:
        # TODO: 调用 Gemini API 生成摘要
        # 暂时用简单截取代替
        summary = content[:500] if content else ""
        if len(content) > 500:
            summary += "..."
        return f"【{title}】{summary}"
    except Exception as e:
        print(f"[Index] Warning: Failed to generate summary: {e}")
        return None

def index_with_summary(url: str, force: bool = False) -> bool:
    """索引文档并生成摘要（Advanced RAG）"""
    try:
        # 先做基础索引
        if not index_document(url, force):
            return False
        
        # 获取文档内容生成摘要
        doc = fetch_document(url)
        if not doc:
            return True  # 基础索引成功就算成功
        
        content = doc.get("content", "")
        title = doc.get("title", url)
        
        summary = generate_summary(content, title)
        if not summary:
            return True
        
        # 存入摘要库
        client = get_chroma_client()
        summaries = client.get_or_create_collection("feishu_summaries")
        
        content_hash = compute_hash(content)
        
        # 检查是否已存在
        existing = summaries.get(where={"url": url})
        if existing and existing.get("ids"):
            summaries.delete(ids=existing["ids"])
        
        # 生成 embedding
        model = get_embedding_model()
        embedding = list(model.embed([summary]))[0].tolist()
        
        summaries.add(
            ids=[f"summary_{content_hash}"],
            embeddings=[embedding],
            documents=[summary],
            metadatas=[{
                "url": url,
                "title": title,
                "hash": content_hash
            }]
        )
        
        print(f"[Index] ✅ Summary indexed: {title}")
        return True
        
    except Exception as e:
        print(f"[Index] ❌ Error indexing summary for {url}: {e}")
        return True  # 摘要失败不影响整体

def main():
    parser = argparse.ArgumentParser(description="RAG 文档索引工具")
    parser.add_argument("--url", help="单个文档 URL")
    parser.add_argument("--urls", help="包含多个 URL 的文件（每行一个）")
    parser.add_argument("--advanced", action="store_true", help="同时生成摘要索引")
    parser.add_argument("--force", action="store_true", help="强制重建索引")
    parser.add_argument("--stats", action="store_true", help="显示统计信息")
    
    args = parser.parse_args()
    
    # 显示统计
    if args.stats:
        try:
            client = get_chroma_client()
            docs = client.get_or_create_collection("feishu_docs")
            summaries = client.get_or_create_collection("feishu_summaries")
            print(f"Documents: {docs.count()}")
            print(f"Summaries: {summaries.count()}")
            print(f"Data dir: {DATA_DIR}")
        except Exception as e:
            print(f"Error: {e}")
        return
    
    # 收集要处理的 URL
    urls = []
    if args.url:
        urls.append(args.url)
    if args.urls:
        try:
            with open(args.urls, "r") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        urls.append(line)
        except Exception as e:
            print(f"Error reading URLs file: {e}")
            return
    
    if not urls:
        parser.print_help()
        return
    
    # 处理
    success = 0
    failed = 0
    
    index_func = index_with_summary if args.advanced else index_document
    
    for i, url in enumerate(urls):
        print(f"\n[{i+1}/{len(urls)}]")
        try:
            if index_func(url, args.force):
                success += 1
            else:
                failed += 1
        except KeyboardInterrupt:
            print("\n[Index] Stopped by user")
            break
        
        # 小延迟，避免打爆 API
        if i < len(urls) - 1:
            time.sleep(0.5)
    
    print(f"\n[Index] Done: {success} success, {failed} failed")

if __name__ == "__main__":
    main()
