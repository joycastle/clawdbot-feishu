#!/bin/bash
# Bingo2 (BV) Jenkins 操作脚本
# 用法: bv-jenkins.sh <action> <env> [options]
# action: restart | hotupdate | deploy | check
# env: dev | test | test2 | test3 | test4 | design

set -e

ACTION="${1:-restart}"
ENV="${2:-dev}"

# Jenkins API
JENKINS_URL="https://bingo2-jenkins.superbgame.net"
AUTH="Basic $(echo -n 'api:113995b6d7ffc3909410569c41c6837cab' | base64)"

# BingoTool API (配置检查)
BINGOTOOL_URL="https://bingotool.superbgame.net"
BINGOTOOL_SHEET="1z4sKu6XQJDcsRagUFjvZWp-jXh_uvzFfkcOSN7q9AIA"

get_view() {
    case "$1" in
        dev) echo "Develop" ;;
        test) echo "Test" ;;
        test2) echo "Test2" ;;
        test3) echo "Test3" ;;
        test4) echo "Test4" ;;
        design) echo "Design" ;;
        *) echo "Test" ;;
    esac
}

get_job_env() {
    case "$1" in
        dev) echo "develop" ;;
        *) echo "$1" ;;
    esac
}

VIEW=$(get_view "$ENV")
JOB_ENV=$(get_job_env "$ENV")

trigger_job() {
    local job_name="$1"
    local url="${JENKINS_URL}/view/${VIEW}/job/${job_name}/buildWithParameters"
    echo "Triggering: $job_name"
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
    echo "=== BV $ENV: 配置检查 ==="
    IGNORE_DEV="${1:-false}"
    echo "IgnoreDev: $IGNORE_DEV"
    curl -s -X POST "${BINGOTOOL_URL}/gds/diccheck" \
        -H "Content-Type: application/json" \
        -H "ServerName: BingoTool" \
        -H "APIKey: bingo2" \
        -d "{\"Flags\":{\"Sheet\":\"${BINGOTOOL_SHEET}\",\"DicTitle\":\"${ENV}\",\"IsCheckUserTag\":true,\"IgnoreDev\":${IGNORE_DEV}}}" \
        --connect-timeout 30 \
        --max-time 600
    echo ""
}

case "$ACTION" in
    restart|update-gds)
        echo "=== BV $ENV: 更新 GDS + 部署 Model ==="
        trigger_job "bingo2-update-gds-${JOB_ENV}"
        trigger_job "bingo2-deploy-${JOB_ENV}-model"
        [ "$ENV" = "dev" ] && trigger_job "bingo2-deploy-${JOB_ENV}-model-gpu"
        ;;
    hotupdate|hot-update)
        echo "=== BV $ENV: 热更新 ==="
        trigger_job "bingo2-hot_update-gds-${JOB_ENV}"
        trigger_job "bingo2-deploy-${JOB_ENV}-model"
        [ "$ENV" = "dev" ] && trigger_job "bingo2-deploy-${JOB_ENV}-model-gpu"
        ;;
    deploy)
        echo "=== BV $ENV: 完整部署 ==="
        trigger_job "bingo2-deploy-${JOB_ENV}"
        trigger_job "bingo2-deploy-${JOB_ENV}-model"
        [ "$ENV" = "dev" ] && trigger_job "bingo2-deploy-${JOB_ENV}-model-gpu"
        ;;
    check|diccheck)
        IGNORE_DEV="${3:-false}"
        check_config "$IGNORE_DEV"
        ;;
    *)
        echo "用法: $0 <action> <env> [options]"
        echo "  action: restart | hotupdate | deploy | check"
        echo "  env: dev | test | test2 | test3 | test4 | design"
        echo ""
        echo "check 选项:"
        echo "  第三个参数: true/false - 是否忽略 -DEV 表 (默认 false)"
        exit 1
        ;;
esac

echo "✅ 完成！"
