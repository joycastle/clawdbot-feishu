# 飞书表格结构索引

当有人让我读飞书表格时，先查这里看有没有已分析过的结构。

## 已知表格

| 名称 | Token | 描述文件 |
|------|-------|---------|
| Bingo 人员排期 | shtcn1tbqOiZsv2ROOQ7RltYXRb | [bingo-schedule.yaml](./bingo-schedule.yaml) |

## Sheets API

端口：18796

```bash
# 状态检查
curl http://127.0.0.1:18796/status

# 搜索（推荐！飞书原生 API，高效）
curl "http://127.0.0.1:18796/find?token=TOKEN&sheetId=SHEET_ID&text=宝根&range=B1:B200"
# 返回: {"matchedCells":["B110"],"rowsCount":1}

# 读取数据
curl "http://127.0.0.1:18796/read?token=TOKEN&sheetId=SHEET_ID&range=A1:Z50"

# 合并单元格
curl "http://127.0.0.1:18796/merges?token=TOKEN&sheetId=SHEET_ID"

# 日期转换
curl "http://127.0.0.1:18796/date/to-serial?date=2026-02-10"
curl "http://127.0.0.1:18796/date/from-serial?serial=46063"

# 解析 URL
curl "http://127.0.0.1:18796/parse-url?url=..."

# 列出 sheets
curl "http://127.0.0.1:18796/sheets?token=TOKEN"
```

## 查询策略

1. **parse-url** → 获取 spreadsheetToken
2. **sheets** → 列出所有 sheet，选对的
3. **find** → 搜索目标（人名/关键词），拿到单元格位置
4. **read 周围** → 先读 5x5 左右的范围看上下文
5. **信息不够？扩大范围**：
   - 读整行：`range=A57:Z57`（看这行都有谁）
   - 读整列：`range=J1:J100`（看这列的表头/分类）
   - 读更大区域理解表结构

## 遇到新表格怎么办

1. 解析 URL 获取 token
2. 读取前 20x30 格 + 合并单元格信息
3. 分析结构：哪行是表头、哪列是什么、日期格式等
4. 在此目录创建 `xxx.yaml` 描述文件
5. 更新此索引
