#!/bin/bash
# 测试不同模型的 memory_query 性能

OLLAMA_URL="http://127.0.0.1:11434"
MEMORY_CONTENT=$(cat ~/clawd/IDENTITY.md ~/clawd/SOUL.md 2>/dev/null | head -80)

QUERY="你是谁？简单介绍一下你自己。"

PROMPT="## 记忆内容
$MEMORY_CONTENT

## 问题
$QUERY"

SYSTEM_PROMPT="你是一个记忆检索助手。根据提供的记忆文档内容，回答用户的问题。如果文档中没有相关信息，回复 NO_RELEVANT_INFO。只根据文档内容回答，不要编造。回答要简洁准确。"

test_model() {
    local model=$1
    echo "=========================================="
    echo "测试模型: $model"
    echo "=========================================="
    
    local start=$(date +%s%N)
    
    local result=$(curl -s "$OLLAMA_URL/api/chat" \
        -d "{
            \"model\": \"$model\",
            \"messages\": [
                {\"role\": \"system\", \"content\": \"$SYSTEM_PROMPT\"},
                {\"role\": \"user\", \"content\": $(echo "$PROMPT" | jq -Rs .)}
            ],
            \"stream\": false,
            \"options\": {\"temperature\": 0.1, \"num_predict\": 512}
        }" | jq -r '.message.content // .error // "ERROR"' | head -20)
    
    local end=$(date +%s%N)
    local elapsed=$(echo "scale=2; ($end - $start) / 1000000000" | bc)
    
    echo "耗时: ${elapsed}s"
    echo "回答:"
    echo "$result"
    echo ""
}

echo "可用模型:"
ollama list
echo ""

# 测试各个模型
for model in "qwen2.5:0.5b" "cnmoro/LFM2-2.6B:q4_k_m" "lfm2.5-thinking:1.2b"; do
    if ollama list | grep -q "$model"; then
        test_model "$model"
    else
        echo "跳过 $model (未安装)"
    fi
done
