#!/bin/bash
# RAG 服务启动脚本

cd "$(dirname "$0")"

# 检查是否已经在运行
if curl -s http://127.0.0.1:18800/health > /dev/null 2>&1; then
    echo "RAG server already running on port 18800"
    exit 0
fi

# 启动服务
echo "Starting RAG server..."
nohup python3 server.py >> /tmp/rag.log 2>&1 &

# 等待启动
sleep 2

# 验证
if curl -s http://127.0.0.1:18800/health > /dev/null 2>&1; then
    echo "RAG server started successfully on port 18800"
else
    echo "Failed to start RAG server, check /tmp/rag.log"
    exit 1
fi
