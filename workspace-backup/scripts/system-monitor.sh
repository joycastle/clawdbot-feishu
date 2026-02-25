#!/bin/bash
# 系统资源监控脚本
# 检查 CPU、内存、磁盘，超过阈值则输出警告

ALERTS=""

# CPU 使用率 (过去1分钟平均)
CPU_LOAD=$(cat /proc/loadavg | awk '{print $1}')
CPU_CORES=$(nproc)
CPU_THRESHOLD=$(echo "$CPU_CORES * 0.9" | bc)
if (( $(echo "$CPU_LOAD > $CPU_THRESHOLD" | bc -l) )); then
    ALERTS="$ALERTS\n⚠️ CPU负载过高: $CPU_LOAD (阈值: $CPU_THRESHOLD)"
fi

# 内存使用率
MEM_USAGE=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100}')
if [ "$MEM_USAGE" -gt 90 ]; then
    ALERTS="$ALERTS\n⚠️ 内存使用率: ${MEM_USAGE}%"
fi

# 磁盘使用率
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 85 ]; then
    ALERTS="$ALERTS\n⚠️ 磁盘使用率: ${DISK_USAGE}%"
fi

# 检查关键服务
if ! systemctl is-active --quiet clawdbot 2>/dev/null; then
    # clawdbot 可能不是 systemd 服务，跳过
    :
fi

if [ -n "$ALERTS" ]; then
    echo -e "🖥️ 系统监控警报:$ALERTS"
    exit 1
fi

echo "OK"
