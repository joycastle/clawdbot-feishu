# 减肥打卡群 (oc_6b354f88ad06b10a005ee4e7853c05dd)

## 成员
- 小王子 (ou_4650478bf5396cbe50c893b9f9ea2d5c) - 基础代谢 1789
- 千里 (ou_a88f1d9ba4dbfc25326566c59b6f5622) - 基础代谢 1833

## 自动规则

### 美食图片识别
群里发美食图 → 自动识别食物 → 估算热量 → 累加到发送人今日摄入 → 回复确认

### 每日数据记录
- 成员随时发摄入/运动消耗，我累计记录
- 体重没更新就用上次的
- 每晚 21:30 自动生成战报

## 数据位置
- skill: ~/clawd/skills/weight-tracker-skill/
- 历史记录: data/records.csv
- 当日追踪: data/daily_tracking.json

## 定时任务
- weight-tracker-daily-report: 每晚 21:30 生成战报
