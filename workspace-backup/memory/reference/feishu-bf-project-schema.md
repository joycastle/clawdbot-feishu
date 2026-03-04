# 飞书项目 BF 空间 (Bingo Frenzy) 核心约定

> 本文件记录 BF 空间的业务约定，包括任务类型、字段标识及取值规范。
> 项目 Key: `62b29e862be43458fc1ef6b2`

---

## 🏗️ 工作项类型 (work_item_type_key)

| 类型名称 | key | api_name | 颜色 |
| :--- | :--- | :--- | :--- |
| **需求** | `story` | `story` | 靛蓝 indigo-1 |
| **缺陷** | `issue` | `issue` | 红色 red-1 |
| **版本** | `version` | `version` | 琥珀色 amber-1 |
| **产品优化** | `62c7b9bcc0db72994eb121c7` | `optimization` | 青柠色 lime-1 |
| **任务** | `sub_task` | `sub_task` | 天蓝色 light-blue-1 |
| 迭代 | `sprint` | `sprint` | 蓝色 blue-1 (已禁用) |
| 项目 | `project` | `project` | 靛蓝 (已禁用) |

---

## 📦 版本 (version) 字段

### 基础字段
| 字段名称 | field_key | 字段类型 | 说明/取值 |
| :--- | :--- | :--- | :--- |
| **名称** | `name` | `text` | 版本标题 |
| **业务线** | `business` | `business` | `BF` (value: `62bbc4d0e762af0479562a46`) |
| **优先级** | `priority` | `select` | 见下方取值 |
| **版本类型** | `template` | `work_item_template` | `默认版本类型` (value: `38040`) |
| **状态** | `work_item_status` | `work_item_status` | 见下方取值 |

### 日期字段
| 字段名称 | field_key | 字段类型 |
| :--- | :--- | :--- |
| 版本封版日期 | `envelope_date` | `date` |
| 预计灰度日期 | `schedule_gray_date` | `date` |
| 实际灰度日期 | `actual_gray_date` | `date` |
| 预计发布日期 | `schedule_publish_date` | `date` |
| 实际发布日期 | `actual_publish_date` | `date` |
| 完成日期 | `archiving_date` | `date` |
| 提出时间 | `start_time` | `date` |
| 完成时间 | `finish_time` | `date` |
| 更新时间 | `updated_at` | `date` |

### 关联字段
| 字段名称 | field_key | 字段类型 |
| :--- | :--- | :--- |
| 实际上车版本 | `actual_online_version` | `work_item_related_multi_select` |
| 所属项目 | `field_554c7b` | `work_item_related_multi_select` |
| 规划版本 | `planning_version` | `work_item_related_multi_select` |
| 规划迭代 | `planning_sprint` | `work_item_related_multi_select` |
| 优化管理 | `field_81c16e` | `work_item_related_multi_select` |

### 其他字段
| 字段名称 | field_key | 字段类型 |
| :--- | :--- | :--- |
| 任务描述 | `description` | `multi_text` |
| 线上版本号 | `field_08ac5b` | `text` |
| 前端测试范围 | `field_f04b36` | `multi_text` |
| 测试用例 | `field_d2fbbf` | `link` |
| 标签 | `tags` | `multi_select` |
| 当前负责人 | `current_status_operator` | `multi_user` |
| 创建者 | `owner` | `user` |
| 关注人 | `watchers` | `multi_user` |
| 是否完成 | `archiving_status` | `bool` |
| 是否冻结 | `is_frozen` | `bool` |
| 终止原因 | `abort_reason` | `select` |
| 补充终止原因 | `abort_detail` | `text` |

### 优先级 (priority) 取值
| label | value |
| :--- | :--- |
| P0 | `0` |
| P1 | `1` |
| P2 | `2` |
| 待定 | `99` |

### 状态 (work_item_status) 取值
| label | value | 说明 |
| :--- | :--- | :--- |
| 未启动 | `Not started` | |
| 开发中 | `Developing` | |
| 已封版 | `Code frozen` | |
| 灰度中 | `Grey released` | |
| 已发布 | `Public released` | |
| 跳版 | `Skip version` | |
| 已终止 | `systemEnded` | |

### 标签 (tags) 取值
| label | value |
| :--- | :--- |
| 一级重点项目 | `测试` |
| 二级重点项目 | `oyoh0y1xl` |

### 终止原因 (abort_reason) 取值
| label | value |
| :--- | :--- |
| 取消，现在先不做了 | `cancel` |
| 重复/合并，与其他在做工作项一同推进 | `repeat` |
| 测试一下 | `test` |
| 其他 | `other` |

---

## 🐞 缺陷 (issue) 字段

### 基础字段
| 字段名称 | field_key | 字段类型 | 说明/取值 |
| :--- | :--- | :--- | :--- |
| **名称** | `name` | `text` | 缺陷标题 |
| **业务线** | `business` | `business` | `BF` (value: `62bbc4d0e762af0479562a46`) |
| **优先级** | `priority` | `select` | P0/P1/P2/待定 |
| **严重程度** | `severity` | `select` | 见下方取值 |
| **缺陷类型** | `template` | `work_item_template` | 见下方取值 |
| **状态** | `work_item_status` | `work_item_status` | 见下方取值 |

### 人员字段
| 字段名称 | field_key | 字段类型 |
| :--- | :--- | :--- |
| 报告人 | `issue_reporter` | `multi_user` |
| 经办人 | `issue_operator` | `multi_user` |
| 当前负责人 | `current_status_operator` | `multi_user` |
| 创建者 | `owner` | `user` |
| 关注人 | `watchers` | `multi_user` |

### 版本关联字段
| 字段名称 | field_key | 字段类型 |
| :--- | :--- | :--- |
| 发现版本 | `discovery_version` | `work_item_related_multi_select` |
| 影响版本 | `influence_version` | `work_item_related_multi_select` |
| 规划版本 | `planning_version` | `work_item_related_multi_select` |
| 解决版本 | `resolve_version` | `work_item_related_multi_select` |
| 实际上车版本 | `actual_online_version` | `work_item_related_multi_select` |
| 规划迭代 | `planning_sprint` | `work_item_related_multi_select` |
| 关联需求 | `_field_linked_story` | `work_item_related_select` |
| 所属项目 | `field_554c7b` | `work_item_related_multi_select` |

### 分类字段
| 字段名称 | field_key | 字段类型 |
| :--- | :--- | :--- |
| Bug端分类 | `bug_classification` | `select` |
| 发现阶段 | `issue_stage` | `select` |
| 机型 | `field_b8e0a0` | `multi_select` |
| 复现概率 | `field_6d968e` | `select` |

### 其他字段
| 字段名称 | field_key | 字段类型 |
| :--- | :--- | :--- |
| 任务描述 | `description` | `multi_text` |
| 多个附件 | `multi_attachment` | `multi_file` |
| 发生时间 | `field_a86f25` | `date` |
| 复现率 | `field_e82148` | `number` |
| 广告ID | `field_9d2943` | `text` |
| Build号 | `field_576725` | `text` |
| 线上版本号 | `field_08ac5b` | `text` |
| 前端测试范围 | `field_f04b36` | `multi_text` |
| 测试用例 | `field_d2fbbf` | `link` |
| 缺陷排期 | `field_47e903` | `schedule` |
| 缺陷估分 | `field_48e7f3` | `number` |
| 标签 | `tags` | `multi_select` |

### 严重程度 (severity) 取值
| label | value | 颜色 |
| :--- | :--- | :--- |
| 严重 | `1` | red-3 |
| 重要 | `2` | orange-3 |
| 一般 | `3` | yellow-3 |
| 微小 | `5` | yellow-1 |

### 缺陷类型 (template) 取值
| label | value |
| :--- | :--- |
| 普通缺陷 | `38032` |
| 表现优化 | `38529` |
| 线上问题 | `45050` |

### 状态 (work_item_status) 取值
| label | value |
| :--- | :--- |
| 待修复 | `OPEN` |
| 已解决 | `IN PROGRESS` |
| 待验证 | `RESOLVED` |
| 重新打开 | `REOPENED` |
| 关闭 | `CLOSED` |
| 无需修复 | `hTzyYz0-Z` |
| 已终止 | `systemEnded` |

### Bug端分类 (bug_classification) 取值
| label | value |
| :--- | :--- |
| iOS | `ios` |
| Android | `android` |
| FE | `fe` |
| Server | `server` |

### 发现阶段 (issue_stage) 取值
| label | value | 颜色 |
| :--- | :--- | :--- |
| 测试阶段 | `stage_test` | yellow-3 |
| 线上 | `0ual5caho` | red-3 |
| 回归阶段 | `stage_regression` | pink-3 |
| 美术/产品/PM验收 | `stage_verify` | light-blue-1 |

### 机型 (field_b8e0a0) 取值
| label | value |
| :--- | :--- |
| Android | `m0x2e48d9` |
| IOS | `owmyu397a` |
| 网页版 | `easo8c8zj` |

### 复现概率 (field_6d968e) 取值
| label | value |
| :--- | :--- |
| 必现 | `ysusvuxbv` |
| 偶现 | `cut22_6w6` |
| 一次 | `p6187k5p8` |

---

## ✨ 产品优化 (62c7b9bcc0db72994eb121c7) 字段

### 基础字段
| 字段名称 | field_key | 字段类型 | 说明/取值 |
| :--- | :--- | :--- | :--- |
| **名称** | `name` | `text` | 优化标题 |
| **业务线** | `business` | `business` | `BF` (value: `62bbc4d0e762af0479562a46`) |
| **优先级** | `priority` | `select` | P0/P1/P2/待定 |
| **产品优化类型** | `template` | `work_item_template` | `产品优化` (value: `44173`) |
| **状态** | `work_item_status` | `work_item_status` | 见下方取值 |

### 人员字段
| 字段名称 | field_key | 字段类型 |
| :--- | :--- | :--- |
| 当前负责人 | `current_status_operator` | `multi_user` |
| 创建者 | `owner` | `user` |
| 关注人 | `watchers` | `multi_user` |

### 角色 (current_status_operator_role)
| label | value |
| :--- | :--- |
| 美术经办人 | `role_62b29e862be43458fc1ef6b2_62c7b9bcc0db72994eb121c7_role_e225ad` |
| 后端经办人 | `role_62b29e862be43458fc1ef6b2_62c7b9bcc0db72994eb121c7_role_a6b75d` |
| 前端经办人 | `role_62b29e862be43458fc1ef6b2_62c7b9bcc0db72994eb121c7_role_c719cb` |
| 发起人 | `role_62b29e862be43458fc1ef6b2_62c7b9bcc0db72994eb121c7_role_d4a629` |
| 验收人 | `role_62b29e862be43458fc1ef6b2_62c7b9bcc0db72994eb121c7_role_fc6b30` |

### 关联字段
| 字段名称 | field_key | 字段类型 |
| :--- | :--- | :--- |
| 实际上车版本 | `actual_online_version` | `work_item_related_multi_select` |
| 规划版本 | `planning_version` | `work_item_related_multi_select` |
| 规划迭代 | `planning_sprint` | `work_item_related_multi_select` |
| 关联需求 | `_field_linked_story` | `work_item_related_select` |
| 所属项目 | `field_554c7b` | `work_item_related_multi_select` |
| 优化管理 | `field_81c16e` | `work_item_related_multi_select` |

### 其他字段
| 字段名称 | field_key | 字段类型 |
| :--- | :--- | :--- |
| 任务描述 | `description` | `multi_text` |
| 线上版本号 | `field_08ac5b` | `text` |
| 前端测试范围 | `field_f04b36` | `multi_text` |
| 测试用例 | `field_d2fbbf` | `link` |
| 附件 | `field_cad5db` | `multi_file` |
| 优化排期 | `field_8caf1d` | `schedule` |
| 优化估分 | `field_f82cef` | `number` |
| 标签 | `tags` | `multi_select` |
| 完成日期 | `archiving_date` | `date` |
| 完成时间 | `finish_time` | `date` |

### 状态 (work_item_status) 取值
| label | value |
| :--- | :--- |
| 开始 | `Not started` |
| 美术优化 | `In Progress` |
| 前端优化 | `1Qmxkidl5` |
| 后端优化 | `kZqA4a3Tq` |
| 优化中 | `arZwM52Yb` |
| 待验收 | `check` |
| 已完成 | `Finished` |
| 已终止 | `systemEnded` |

---

## 📝 需求 (story) 模板与字段

### 1. 基础字段
| 字段名称 | field_key | 字段类型 | 说明/取值 |
| :--- | :--- | :--- | :--- |
| **名称** | `name` | `text` | 工作项标题 |
| **需求类型** | `template_type` | `select` | 即需求模板，见下方列表 |
| **业务线** | `business` | `select` | 取值：`BF` (`62bbc4d0e762af0479562a46`) |
| **优先级** | `priority` | `select` | `P0`, `P1`, `P2`, `待定` |
| **规划版本** | `planning_version` | `related` | 关联到类型为 `version` 的工作项 |
| **需求状态** | `work_item_status` | `status` | 开始、进行中、已结束、测试中、待验收等 |

### 2. 文档与链接
| 字段名称 | field_key | 字段类型 | 说明 |
| :--- | :--- | :--- | :--- |
| **任务描述** | `description` | `multi_text` | 详细描述 |
| **任务文档** | `wiki` | `link` | 飞书云文档链接 |
| **策划案** | `field_75fd84` | `link` | 飞书文档链接 |
| **资源清单** | `field_eab9d2` | `link` | 飞书电子表格链接 |
| **测试文档** | `field_c5e632` | `link` | 飞书文档链接 |
| **测试用例** | `field_d2fbbf` | `link` | 飞书文档链接 |

### 3. 角色与人员 (role_owners)
*注：更新时需全量提交，否则未提交角色会被清空。*
- **PM**: 产品经理
- **QA**: 测试
- **DE**: 服务端工程师 (Server)
- **FE**: 客户端工程师 (Client)
- **策划**: 策划人员

> 💡 **提示**：若遇到上述未列出的角色，请自行通过 API (`/types` 或 `/fields`) 查询对应 key。

### 4. 需求类型 (template_type) 取值参考
- 新开发流程: `62b29e862be43458fc1ef6b2_template_1715333732882095323`
- 新活动开发流程: `62b29e862be43458fc1ef6b2_template_1715594177812680204`
- 探险活动制作流程: `62b29e862be43458fc1ef6b2_template_1689847607100498373`
- ... (更多见 API dump)

> 💡 **提示**：若遇到上述未列出的需求模版，请自行通过 API 查询或查看项目后台配置。

---

## 🔗 通用字段 (跨类型共享)

以下字段在多个工作项类型中都存在：

| 字段名称 | field_key | 出现在 |
| :--- | :--- | :--- |
| 优先级 | `priority` | 全部 |
| 业务线 | `business` | 全部 |
| 标签 | `tags` | 全部 |
| 规划版本 | `planning_version` | 全部 |
| 规划迭代 | `planning_sprint` | 全部 |
| 实际上车版本 | `actual_online_version` | 版本、缺陷、产品优化 |
| 所属项目 | `field_554c7b` | 版本、缺陷、产品优化 |
| 优化管理 | `field_81c16e` | 版本、缺陷、产品优化 |
| 线上版本号 | `field_08ac5b` | 版本、缺陷、产品优化 |
| 前端测试范围 | `field_f04b36` | 版本、缺陷、产品优化 |
| 测试用例 | `field_d2fbbf` | 版本、缺陷、产品优化 |
| 终止原因 | `abort_reason` | 版本、缺陷、产品优化 |
| 补充终止原因 | `abort_detail` | 版本、缺陷、产品优化 |

---

*最后更新: 2026-02-12*
