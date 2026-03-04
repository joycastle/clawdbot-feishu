---
name: weight-tracker
description: "生成 RPG 风格的减肥战报图片。用于：记录每日体重和热量数据、生成减肥战报、查看减肥进度、对比减肥成绩。触发词：减肥战报、体重记录、生成战报、减肥进度、热量统计、weight report、diet tracker。"
metadata:
  emoji: "⚔️"
  version: "1.1.0"
  requires:
    bins: ["python3"]
    pip: ["matplotlib", "Pillow", "pandas"]
allowed-tools: Bash(python3 *)
---

# 减肥勇士团 · RPG 战报生成器

生成可爱的 RPG 风格减肥战报图片，支持 2-3 人对比，方便在微信群分享。

## 工作目录

所有命令都在 skill 根目录下执行：

```bash
cd ~/.clawdbot/workspace/.agents/skills/weight-tracker
```

## 数据管理

数据存储在 `data/records.csv` 中，每天追加新记录。

### 初始化新成员（首次使用必须先做这一步）

```bash
python3 scripts/record.py init <昵称> <起始体重> <目标体重> <开始日期> <截止日期>
```

示例：
```bash
python3 scripts/record.py init 小王子 75 70 2026-02-15 2026-04-01
python3 scripts/record.py init 小红 67 63 2026-02-15 2026-04-01
```

### 录入每日数据（简化模式，自动补全目标信息）

```bash
python3 scripts/record.py quick <昵称> <体重> <摄入热量> <消耗热量> [日期]
```

日期可省略，默认今天。示例：
```bash
python3 scripts/record.py quick 小王子 72.5 1450 1800
python3 scripts/record.py quick 小红 64.8 1200 1520 2026-03-03
```

### 查看当前成员

```bash
python3 scripts/record.py members
```

### 查看某人历史记录

```bash
python3 scripts/record.py history 小王子
```

## 生成战报

```bash
python3 scripts/generate_report.py                    # 今天
python3 scripts/generate_report.py 2026-03-02          # 指定日期
```

输出路径: `reports/report_YYYY-MM-DD.png`

## CSV 数据格式

| 字段 | 含义 | 示例 |
|------|------|------|
| date | 记录日期 | 2026-03-02 |
| name | 昵称 | 小王子 |
| weight | 当日体重(kg) | 73.2 |
| calories_in | 当日摄入热量(kcal) | 1480 |
| calories_out | 当日消耗热量(kcal)，含基础代谢+运动 | 1800 |
| target_weight | 目标体重(kg) | 70 |
| start_weight | 起始体重(kg) | 75 |
| start_date | 开始日期 | 2026-02-15 |
| end_date | 截止日期 | 2026-04-01 |

## 常见对话触发

- "帮我初始化减肥记录，我叫小王子，现在75kg，目标70kg，从今天开始到4月1号" → 运行 `record.py init`
- "小王子今天73kg，吃了1500卡，消耗1800卡" → 解析数据，运行 `record.py quick`
- "记录今天的数据：小王子72.5kg 摄入1450 消耗1800" → 运行 `record.py quick`
- "生成今天的减肥战报" → 运行 `generate_report.py`
- "看看我们的减肥进度" → 生成战报
- "现在有哪些成员" → 运行 `record.py members`
- "看看小王子的历史记录" → 运行 `record.py history`

## 典型工作流

1. **首次使用**：用 `record.py init` 初始化每位成员的目标信息
2. **每天录入**：用 `record.py quick` 录入当天体重和热量（只需4个参数）
3. **生成战报**：用 `generate_report.py` 生成当天的 RPG 战报图片
4. **分享到微信**：打开生成的 PNG 图片发到群里

## 战报内容

生成的 PNG 图片 (800×1200) 包含:

1. **顶部标题栏** - 团队名 + 第N天 + 倒计时
2. **角色状态区** - 每人一行: 昵称、等级+经验值、HP体重进度条、热量数据
3. **体重趋势图** - 多人折线对比 + 目标虚线
4. **热量对比柱状图** - 每人摄入 vs 消耗
5. **底部彩蛋区** - 今日MVP + 随机鼓励语

## 经验值系统

- 每天热量达标（消耗 > 摄入）：+50 XP
- 每天 MVP（缺口最大的人）：额外 +100 XP
- 升级阶梯：LV.1 需 100 XP，LV.2 需 150 XP，每级多 50 XP
