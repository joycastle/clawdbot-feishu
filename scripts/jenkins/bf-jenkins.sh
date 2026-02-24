#!/bin/bash
# Bingo Frenzy (BF) Jenkins 操作脚本
# 用法: bf-jenkins.sh <action> <env>
# action: restart | update | check
# env: develop | develop1 | release | plan

set -e

ACTION="${1:-restart}"
ENV="${2:-develop}"

# Jenkins API
JENKINS_URL="https://jenkins.bingo-testing.elitescastle.com"
AUTH="Basic $(echo -n 'api:11955f2db05f55a72f0f86283ca0279bfa' | base64)"

# BingoTool API (配置检查)
BINGOTOOL_URL="https://bingo-tools.bingo-testing.elitescastle.com"
BINGOTOOL_SHEET="1XkorKsp8XLiXubD9ffpFsvS6gSXTtbMqk1fe-EDv3ss"
BINGOTOOL_APIKEY="BingoFrenzy"

# 环境映射
# develop1 比较特殊：view 名和 job 后缀都用 develop-1
get_view() {
    case "$1" in
        develop) echo "develop" ;;
        develop1) echo "develop-1" ;;
        release) echo "release" ;;
        plan) echo "plan" ;;
        *) echo "develop" ;;
    esac
}

get_job_suffix() {
    case "$1" in
        develop1) echo "develop-1" ;;
        *) echo "$1" ;;
    esac
}

# BingoTool API 用的环境名（develop1 用 develop）
get_bingotool_env() {
    case "$1" in
        develop1) echo "develop" ;;
        *) echo "$1" ;;
    esac
}

VIEW=$(get_view "$ENV")
JOB_SUFFIX=$(get_job_suffix "$ENV")
BINGOTOOL_ENV=$(get_bingotool_env "$ENV")

trigger_job() {
    local job_name="$1"
    local url="${JENKINS_URL}/view/${VIEW}/job/${job_name}/buildWithParameters"
    echo "Triggering: $job_name"
    echo "  URL: $url"
    local status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$url" \
        -H "Authorization: $AUTH" \
        -H "Content-Type: application/json")
    if [ "$status" = "201" ] || [ "$status" = "200" ]; then
        echo "  ✓ Triggered (HTTP $status)"
    else
        echo "  ✗ Failed (HTTP $status)"
        return 1
    fi
}

check_config() {
    echo "=== BF $ENV: 配置检查 ==="
    local response=$(curl -s -X POST "${BINGOTOOL_URL}/gds/check" \
        -H "Content-Type: application/json" \
        -H "X-APIKey: ${BINGOTOOL_APIKEY}" \
        -d "{\"env\":\"${BINGOTOOL_ENV}\",\"sheet\":\"${BINGOTOOL_SHEET}\"}" \
        --connect-timeout 30 \
        --max-time 120)
    
    echo "Response: $response"
    
    # 解析响应
    local code=$(echo "$response" | jq -r '.code // empty' 2>/dev/null)
    local message=$(echo "$response" | jq -r '.message // empty' 2>/dev/null)
    
    if [ "$code" = "0" ]; then
        echo "✅ 配置检查通过"
        return 0
    else
        echo "❌ 配置检查失败: code=$code, message=$message"
        return 1
    fi
}

case "$ACTION" in
    restart)
        # 重启 = 先检查配置，再触发重启 job
        echo "=== BF $ENV: 重启服务器 ==="
        check_config || { echo "配置检查失败，中止重启"; exit 1; }
        trigger_job "bingo1-update-gds-${JOB_SUFFIX}"
        ;;
    update)
        # 只更新配置，不重启
        echo "=== BF $ENV: 更新配置（不重启） ==="
        check_config || { echo "配置检查失败，中止更新"; exit 1; }
        trigger_job "bingo1-gds-${JOB_SUFFIX}"
        ;;
    check)
        # 只检查配置
        check_config
        ;;
    *)
        echo "用法: $0 <action> <env>"
        echo ""
        echo "Actions:"
        echo "  restart  - 配置检查 + 重启服务器"
        echo "  update   - 配置检查 + 更新配置（不重启）"
        echo "  check    - 仅检查配置"
        echo ""
        echo "Environments:"
        echo "  develop  - 开发服（默认）"
        echo "  develop1 - 开发服 1"
        echo "  release  - 预发布"
        echo "  plan     - 策划服"
        exit 1
        ;;
esac

echo "✅ 完成！"
