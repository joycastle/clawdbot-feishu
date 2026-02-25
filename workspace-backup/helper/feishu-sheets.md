# 飞书表格

> 读取、搜索电子表格数据

**端口：** `localhost:18796`

---

## 常用操作

| 说法 | 我会做什么 |
|------|-----------|
| 帮我查一下这个表 | 解析 URL，读取数据 |
| 找一下宝根的排期 | 搜索 + 读取周围 |

---

## API 速查

```bash
# 搜索（推荐，原生 API）
curl "http://127.0.0.1:18796/find?token=TOKEN&sheetId=SHEET&text=关键词"

# 读取
curl "http://127.0.0.1:18796/read?token=TOKEN&sheetId=SHEET&range=A1:Z50"

# 列出 sheets
curl "http://127.0.0.1:18796/sheets?token=TOKEN"

# 解析 URL
curl "http://127.0.0.1:18796/parse-url?url=<飞书表格URL>"

# 合并单元格
curl "http://127.0.0.1:18796/merges?token=TOKEN&sheetId=SHEET"

# 日期转换
curl "http://127.0.0.1:18796/date/to-serial?date=2026-02-10"
```

---

## 查询策略

1. **parse-url** → 获取 token
2. **sheets** → 列出所有 sheet
3. **find** → 搜索关键词，拿到位置
4. **read** → 读取周围区域

---

## 已知表格

| 名称 | 描述文件 |
|------|----------|
| Bingo 人员排期 | `memory/sheets/bingo-schedule.yaml` |

---

## 详细文档

- `memory/sheets/index.md`
