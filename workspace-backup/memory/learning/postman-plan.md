# Postman 学习计划

**学员：** ou_e58d34370011de1c49b7768b04227fbb
**创建时间：** 2026-02-04
**练习环境：** http://127.0.0.1:5000 (cwrtool 本地 Flask 应用)
**总体进度：** 0/5 阶段完成

---

## 第一阶段：基础 GET 请求 ⬜ 未开始

**目标：** 熟悉 Postman 界面和发送请求

- [ ] 1. GET /get_config — 获取配置，学会看返回的 JSON
- [ ] 2. GET /list_snippets — 获取关键词列表
- [ ] 3. GET /get_keyword_titles — 获取标题配置
- [ ] 4. GET /get_template_marks — 获取标记字母
- [ ] 5. GET /get_template_time_intervals — 获取时间间隔
- [ ] 6. GET /list_template_rows — 获取模板行列表

**掌握技能：** 创建请求、选择 GET 方法、查看 Response Body/Status Code/Headers

---

## 第二阶段：POST + JSON Body ⬜ 未开始

**目标：** 学会发送带 Body 的请求

- [ ] 1. POST /get_snippet — Body: {"keyword": "hello"}
- [ ] 2. POST /get_template — Body: {"template_name": "guild"}
- [ ] 3. POST /get_template_row — 传入已有关键词
- [ ] 4. POST /calculate_pass_time — Body: {"pass_season": 1, "season_end_time": "2026-02-04-20-00-00", "duration": "1d"}

**掌握技能：** 设置 Body 为 raw JSON、Content-Type、理解请求响应对应关系

---

## 第三阶段：增删改完整 CRUD ⬜ 未开始

**目标：** 理解 RESTful 操作流程

- [ ] 1. POST /add_snippet — 添加测试关键词 {"keyword":"test123", "snippet":"hello world"}
- [ ] 2. POST /update_snippet — 修改 {"keyword":"test123", "snippet":"updated content"}
- [ ] 3. POST /get_snippet — 验证修改 {"keyword":"test123"}
- [ ] 4. POST /delete_snippet — 删除 {"keyword":"test123"}
- [ ] 5. GET /list_snippets — 确认删除成功

**掌握技能：** 完整 CRUD 流程、用请求验证操作结果

---

## 第四阶段：Collection 和环境变量 ⬜ 未开始

**目标：** 组织和复用请求

- [ ] 1. 把所有请求整理进 Collection "CWR Tool API"
- [ ] 2. 创建 Environment，设置变量 base_url = http://127.0.0.1:5000
- [ ] 3. 所有请求地址改为 {{base_url}}/xxx 形式
- [ ] 4. 创建第二个 Environment（为以后远程环境准备）

**掌握技能：** Collection 管理、环境变量、一键切环境

---

## 第五阶段：进阶功能 ⬜ 未开始

**目标：** 提升效率

- [ ] 1. Tests 脚本 — 自动断言 status 200
- [ ] 2. Pre-request Script — 自动生成时间戳
- [ ] 3. Collection Runner — 批量运行回归测试
- [ ] 4. 导出 Collection JSON 分享

**掌握技能：** 自动化测试、脚本编写、批量执行、团队协作

---

## 学习日志

| 日期 | 内容 | 备注 |
|------|------|------|
| 2026-02-04 | 创建学习计划 | 五个阶段，从 GET 到进阶 |
