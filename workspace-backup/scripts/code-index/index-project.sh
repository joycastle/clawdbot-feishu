#!/bin/bash
#
# 一键索引 TypeScript 项目
#
# 用法: ./index-project.sh <项目名> <项目路径>
#
# 示例:
#   ./index-project.sh my-app ~/work/my-app/src
#   ./index-project.sh bf-nakama-ts ~/work/bf/nakama-ts/src
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$HOME/.clawdbot/extensions/feishu/data/code-index"

# 参数检查
if [ $# -lt 2 ]; then
    echo "用法: $0 <项目名> <项目路径>"
    echo ""
    echo "示例:"
    echo "  $0 my-app ~/work/my-app/src"
    echo ""
    echo "要求:"
    echo "  - 项目路径必须包含 tsconfig.json"
    echo "  - code-index-api 服务需要在 18801 端口运行"
    exit 1
fi

PROJECT_NAME="$1"
PROJECT_ROOT="$(realpath "$2")"

# 验证项目路径
if [ ! -d "$PROJECT_ROOT" ]; then
    echo "❌ 错误: 目录不存在 $PROJECT_ROOT"
    exit 1
fi

if [ ! -f "$PROJECT_ROOT/tsconfig.json" ]; then
    echo "❌ 错误: 未找到 $PROJECT_ROOT/tsconfig.json"
    echo "提示: 项目路径应该是包含 tsconfig.json 的目录"
    exit 1
fi

# 设置输出路径
DB_PATH="$DATA_DIR/${PROJECT_NAME}-call-graph.db"
JSONL_PATH="$DATA_DIR/${PROJECT_NAME}.jsonl"

echo "═══════════════════════════════════════════════════════════════"
echo "  代码索引工具 - $PROJECT_NAME"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "📁 项目路径: $PROJECT_ROOT"
echo "💾 数据库:   $DB_PATH"
echo "📄 摘要文件: $JSONL_PATH"
echo ""

# 确保数据目录存在
mkdir -p "$DATA_DIR"

# 切换到脚本目录
cd "$SCRIPT_DIR"

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 首次运行，安装依赖..."
    npm install
    echo ""
fi

# 设置环境变量
export PROJECT_ROOT
export DB_PATH

# Step 1: 提取调用图
echo "═══════════════════════════════════════════════════════════════"
echo "  Step 1/4: 提取调用图 (nodes + edges)"
echo "═══════════════════════════════════════════════════════════════"
npx tsx extract-call-graph.ts
echo ""

# Step 2: 提取继承关系
echo "═══════════════════════════════════════════════════════════════"
echo "  Step 2/4: 提取继承关系 (inheritance)"
echo "═══════════════════════════════════════════════════════════════"
npx tsx extract-inheritance.ts
echo ""

# Step 3: 提取装饰器
echo "═══════════════════════════════════════════════════════════════"
echo "  Step 3/4: 提取装饰器 (decorators)"
echo "═══════════════════════════════════════════════════════════════"
npx tsx extract-decorators.ts
echo ""

# Step 4: 生成摘要
echo "═══════════════════════════════════════════════════════════════"
echo "  Step 4/4: 生成代码摘要 (JSONL)"
echo "═══════════════════════════════════════════════════════════════"
npx tsx extract-summaries.ts > "$JSONL_PATH"
SUMMARY_COUNT=$(wc -l < "$JSONL_PATH")
echo "✅ 生成了 $SUMMARY_COUNT 条摘要"
echo ""

# Step 5: 注册到 API 服务
echo "═══════════════════════════════════════════════════════════════"
echo "  Step 5: 注册项目到 code-index-api"
echo "═══════════════════════════════════════════════════════════════"

# 检查 API 服务是否运行
if curl -s http://127.0.0.1:18801/health > /dev/null 2>&1; then
    # 注册项目
    curl -s -X POST http://127.0.0.1:18801/index \
        -H "Content-Type: application/json" \
        -d "{
            \"name\": \"$PROJECT_NAME\",
            \"path\": \"$PROJECT_ROOT\",
            \"summariesPath\": \"$JSONL_PATH\"
        }" | jq .
    echo ""
    
    # 更新 API 中的数据库路径映射 (需要重启服务生效)
    echo "⚠️  注意: 如果是新项目，需要在 code-index-api.ts 中添加数据库映射"
    echo "   位置: ~/.clawdbot/extensions/feishu/src/services/code-index-api.ts"
    echo "   添加: '$PROJECT_NAME': join(DATA_DIR, '${PROJECT_NAME}-call-graph.db'),"
else
    echo "⚠️  code-index-api 服务未运行 (18801)"
    echo "   手动注册命令:"
    echo "   curl -X POST http://127.0.0.1:18801/index -H 'Content-Type: application/json' -d '{\"name\": \"$PROJECT_NAME\", \"path\": \"$PROJECT_ROOT\", \"summariesPath\": \"$JSONL_PATH\"}'"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ 完成!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "查询示例:"
echo "  # 搜索函数"
echo "  curl 'http://127.0.0.1:18801/search?q=login&p=$PROJECT_NAME'"
echo ""
echo "  # 调用关系"
echo "  curl 'http://127.0.0.1:18801/graph/callers?name=handleLogin&p=$PROJECT_NAME'"
echo ""
