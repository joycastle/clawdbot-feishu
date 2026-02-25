#!/bin/bash
# 安全扫描脚本 - 检查可疑活动
# 如果发现问题输出警告信息，否则输出 OK

# 检查异常登录
FAILED_LOGINS=$(grep "Failed password" /var/log/auth.log 2>/dev/null | tail -20 | wc -l)

# 检查可疑进程
SUSPICIOUS_PROCS=$(ps aux | grep -E "(cryptominer|xmrig)" | grep -v grep | wc -l)

# 检查磁盘使用
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')

if [ "$FAILED_LOGINS" -gt 10 ]; then
    echo "⚠️ 警告: 最近20条日志中有 $FAILED_LOGINS 次失败登录尝试"
    exit 1
fi

if [ "$SUSPICIOUS_PROCS" -gt 0 ]; then
    echo "⚠️ 警告: 发现可疑进程"
    exit 1
fi

if [ "$DISK_USAGE" -gt 90 ]; then
    echo "⚠️ 警告: 磁盘使用率 $DISK_USAGE%"
    exit 1
fi

echo "OK"
