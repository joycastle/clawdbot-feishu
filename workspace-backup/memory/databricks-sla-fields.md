# Databricks SLA 监控字段

**更新时间**：2026-02-25

## 相关统计表

| 项目 | 表名 |
|------|------|
| BF (Bingo Frenzy) | `prod.bingofrenzy.dwb_aihelp_complaints_content` |
| BV (Bingo Voyage) | `prod.bingovoyage.dwb_aihelp_complaints_content` |

---

## 字段清单

### 基础信息

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `platform` | string | 反馈平台 |
| `language` | string | 语言 |
| `status` | string | 客诉状态（内容是数字） |
| `customer_true_name` | string | 处理人（客服工作人员） |
| `sentiment` | string | 玩家首次消息情绪值 |

### ⏱️ 时间字段（SLA 关键）

| 字段名 | 类型 | 说明 | 格式示例 |
|--------|------|------|----------|
| `birth_time_readable` | string | 玩家首次反馈时间 | `2026-02-10 00:01:49` |
| `close_time_readable` | string | 对话关闭时间 | `2026-02-10 00:01:49` |

### 📊 评价信息

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `evaluater_info` | string | 玩家评价（JSON 格式） |

**示例**：
```json
{
  "evaluaterTime": 1770705804236,
  "evaluaterMessage": "Dissatisfied with the result",
  "starIndex": 1
}
```

### 🏷️ 标签

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `tag_list` | array\<string\> | 标签列表（包含付费标签、问题类型标签、处理日期标签等） |

### 📋 分配记录（SLA 关键）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `assign_record_list` | array\<struct\> | 客诉分配记录 |

**Struct 字段**：
- `fromCustomer`: string - 来源
- `toCustomer`: string - 分配给
- `assigneeTime`: bigint - 分配时间戳（毫秒）
- `fromType`: int
- `toType`: int
- `fromGroup`: string
- `toGroup`: string
- `operateCustomer`: string - 操作人
- `operateType`: int

**示例**：
```json
[
  {
    "fromCustomer": "Routing Bot",
    "toCustomer": "Bugs Report (BV)",
    "assigneeTime": 1770682866505,
    "fromType": 1,
    "toType": 1,
    "fromGroup": null,
    "toGroup": null,
    "operateCustomer": "Bugs Report (BV)",
    "operateType": 1
  },
  {
    "fromCustomer": "Bugs Report (BV)",
    "toCustomer": "",
    "assigneeTime": 1770682986976,
    "fromType": 1,
    "toType": 0,
    "fromGroup": "Default Group",
    "toGroup": "Default Group(Bingo 2)",
    "operateCustomer": "Bugs Report (BV)",
    "operateType": 1
  },
  {
    "fromCustomer": "",
    "toCustomer": "bingocs_bv@vertexgames.net",
    "assigneeTime": 1770685500372,
    "fromType": 0,
    "toType": 0,
    "fromGroup": null,
    "toGroup": null,
    "operateCustomer": "bingocs_pm@vertexgames.net",
    "operateType": 0
  }
]
```

### 📝 备注

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `note_list` | array\<struct\> | 客服打的备注 |

**Struct 字段**：
- `noteTime`: bigint - 备注时间戳
- `noteUser`: string - 备注人
- `noteContent`: string - 备注内容

### 💬 对话记录（SLA 关键）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `conversations` | string | 完整对话记录 |

**包含信息**：
- 玩家消息内容及时间
- 机器人消息及时间
- 客服消息及时间
- 玩家首条消息时间
- 客服首次回复时间
- 客诉解决时间

---

## 🎯 SLA 监控可用字段分析

### 响应时间 SLA
- **玩家首次反馈** → `birth_time_readable`
- **首次分配时间** → `assign_record_list[0].assigneeTime`
- **客服首次回复时间** → 需从 `conversations` 解析

### 解决时间 SLA
- **开始时间** → `birth_time_readable`
- **结束时间** → `close_time_readable`
- **总处理时长** = `close_time_readable - birth_time_readable`

### 流转追踪
- **分配链路** → `assign_record_list` 完整记录每次流转
- **处理人** → `customer_true_name`

### 质量指标
- **玩家评价** → `evaluater_info.starIndex`
- **情绪值** → `sentiment`

---

## 待确认问题

- [ ] `status` 字段的数字含义映射？
- [ ] `fromType` / `toType` / `operateType` 的含义？
- [ ] 如何从 `conversations` 精确提取客服首次回复时间？
