import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "../utils/paths.js";

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const feishu = config?.channels?.feishu;
const client = new lark.Client({ appId: feishu.appId, appSecret: feishu.appSecret });

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

function textEl(text: string, bold = false) {
  return { text_run: { content: text, text_element_style: bold ? { bold: true } : {} } };
}

async function addBlock(docId: string, blockType: number, data: any) {
  try {
    const resp = await client.docx.documentBlockChildren.create({
      path: { document_id: docId, block_id: docId },
      params: { document_revision_id: -1 },
      data: { children: [{ block_type: blockType, ...data }], index: -1 }
    });
    await delay(80);
    return resp.data?.children?.[0]?.block_id;
  } catch (e) { return null; }
}

async function addTable(docId: string, rows: number, cols: number) {
  const resp = await client.docx.documentBlockChildren.create({
    path: { document_id: docId, block_id: docId },
    params: { document_revision_id: -1 },
    data: { children: [{ block_type: 31, table: { property: { row_size: rows, column_size: cols } } }], index: -1 }
  });
  if (resp.code !== 0) { console.log("表格创建失败:", resp.msg); return null; }
  await delay(150);
  return resp.data?.children?.[0]?.block_id;
}

async function fillTable(docId: string, tableId: string, data: string[][]) {
  const tableResp = await client.docx.documentBlockChildren.get({
    path: { document_id: docId, block_id: tableId },
    params: { document_revision_id: -1 }
  });
  const cells = tableResp.data?.items || [];
  let idx = 0;
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length && idx < cells.length; c++) {
      const cellId = cells[idx]?.block_id;
      if (cellId) {
        const bold = r === 0; // 表头加粗
        await client.docx.documentBlockChildren.create({
          path: { document_id: docId, block_id: cellId },
          params: { document_revision_id: -1 },
          data: { children: [{ block_type: 2, text: { elements: [textEl(data[r][c], bold)] } }], index: 0 }
        });
        await delay(30);
      }
      idx++;
    }
  }
}

async function main() {
  console.log("创建文档...");
  const createResp = await client.docx.document.create({ data: { title: "三消游戏生命值系统需求文档 v1.0" } });
  if (createResp.code !== 0) throw new Error(createResp.msg);
  const docId = createResp.data?.document?.document_id!;
  console.log("文档ID:", docId);

  // 基础信息
  await addBlock(docId, 4, { heading2: { elements: [textEl("📌 基础信息", true)] } });
  const t1 = await addTable(docId, 6, 2);
  if (t1) await fillTable(docId, t1, [
    ["字段", "内容"],
    ["功能名称", "生命值系统（Lives System）"],
    ["版本", "v1.0"],
    ["状态", "🟡 草稿"],
    ["负责人", "@策划"],
    ["创建日期", "2026-03-23"]
  ]);
  console.log("✓ 基础信息");

  await addBlock(docId, 5, { heading3: { elements: [textEl("变更记录", true)] } });
  const t2 = await addTable(docId, 2, 4);
  if (t2) await fillTable(docId, t2, [
    ["版本", "日期", "修改人", "变更内容"],
    ["1.0", "2026-03-23", "王总", "初稿"]
  ]);

  await addBlock(docId, 22, { divider: {} });

  // 一、功能需求
  await addBlock(docId, 4, { heading2: { elements: [textEl("一、功能需求", true)] } });
  
  // 1.1
  await addBlock(docId, 5, { heading3: { elements: [textEl("1.1 生命值消耗与获取", true)] } });
  await addBlock(docId, 2, { text: { elements: [textEl("描述：", true)] } });
  await addBlock(docId, 2, { text: { elements: [textEl("玩家挑战关卡失败时消耗生命值，生命值耗尽后无法继续挑战，需等待恢复或通过其他方式获取。")] } });
  await addBlock(docId, 2, { text: { elements: [textEl("规则：", true)] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("挑战关卡失败时消耗 1 点生命值")] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("挑战关卡成功不消耗生命值")] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("主动退出关卡视为失败，消耗 1 点生命值")] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("生命值为 0 时，无法进入关卡")] } });
  
  await addBlock(docId, 2, { text: { elements: [textEl("边界 & 异常：", true)] } });
  const t3 = await addTable(docId, 5, 2);
  if (t3) await fillTable(docId, t3, [
    ["情况", "处理"],
    ["生命值为 0 时点击关卡", "弹窗提示生命值不足，显示恢复倒计时"],
    ["关卡中网络断开", "不消耗生命值，提示网络异常"],
    ["关卡中强制关闭 App", "下次启动恢复进度，不额外消耗"],
    ["正在挑战时生命值恢复", "不影响当前关卡，正常结算"]
  ]);
  
  await addBlock(docId, 2, { text: { elements: [textEl("数据：", true)] } });
  const t4 = await addTable(docId, 3, 5);
  if (t4) await fillTable(docId, t4, [
    ["字段", "类型", "范围", "说明", "备注"],
    ["max_lives", "int", "1-10", "生命值上限", "配置项，默认5"],
    ["current_lives", "int", "0-max", "当前生命值", "存储字段"]
  ]);
  console.log("✓ 1.1 生命值消耗与获取");

  // 1.2
  await addBlock(docId, 5, { heading3: { elements: [textEl("1.2 生命值自动恢复", true)] } });
  await addBlock(docId, 2, { text: { elements: [textEl("描述：生命值未满时，随时间自动恢复，直到达到上限。")] } });
  await addBlock(docId, 2, { text: { elements: [textEl("规则：", true)] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("每 N 分钟恢复 1 点生命值（默认 20 分钟）")] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("生命值已满时停止计时")] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("恢复计时为服务器时间，防止作弊")] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("离线期间正常累计恢复")] } });
  
  await addBlock(docId, 2, { text: { elements: [textEl("边界 & 异常：", true)] } });
  const t5 = await addTable(docId, 5, 2);
  if (t5) await fillTable(docId, t5, [
    ["情况", "处理"],
    ["生命值已满", "停止计时，不显示倒计时"],
    ["离线24小时后上线", "按时间差计算，最多恢复到上限"],
    ["恢复瞬间正好消耗", "先扣除再恢复"],
    ["服务器与本地时间差异大", "以服务器时间为准"]
  ]);
  console.log("✓ 1.2 生命值自动恢复");

  // 1.3
  await addBlock(docId, 5, { heading3: { elements: [textEl("1.3 生命值购买", true)] } });
  await addBlock(docId, 2, { text: { elements: [textEl("描述：玩家可使用钻石购买生命值，立即补满。")] } });
  await addBlock(docId, 2, { text: { elements: [textEl("规则：", true)] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("消耗固定数量钻石，生命值补满至上限")] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("生命值已满时不可购买")] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("购买后立即生效")] } });
  console.log("✓ 1.3 生命值购买");

  // 1.4
  await addBlock(docId, 5, { heading3: { elements: [textEl("1.4 无限生命值道具", true)] } });
  await addBlock(docId, 2, { text: { elements: [textEl("描述：限时道具，激活后生命值无限，失败不消耗。")] } });
  await addBlock(docId, 2, { text: { elements: [textEl("规则：", true)] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("激活后 N 分钟内失败不消耗生命值")] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("多个道具可叠加时长")] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("倒计时在界面显示")] } });
  console.log("✓ 1.4 无限生命值道具");

  // 1.5
  await addBlock(docId, 5, { heading3: { elements: [textEl("1.5 好友赠送生命值", true)] } });
  await addBlock(docId, 2, { text: { elements: [textEl("描述：玩家可向好友赠送生命值，增强社交互动。")] } });
  await addBlock(docId, 2, { text: { elements: [textEl("规则：", true)] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("每位好友每天只能赠送/接收 1 次")] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("赠送不消耗自己的生命值")] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("接收的生命值存入邮箱")] } });
  console.log("✓ 1.5 好友赠送生命值");

  // 1.6
  await addBlock(docId, 5, { heading3: { elements: [textEl("1.6 邮箱领取生命值", true)] } });
  await addBlock(docId, 2, { text: { elements: [textEl("描述：好友赠送、活动奖励的生命值存入邮箱，手动领取。")] } });
  await addBlock(docId, 2, { text: { elements: [textEl("规则：", true)] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("邮箱生命值不受上限限制")] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("领取时可超出上限")] } });
  await addBlock(docId, 12, { bullet: { elements: [textEl("可批量领取")] } });
  console.log("✓ 1.6 邮箱领取生命值");

  await addBlock(docId, 22, { divider: {} });

  // 二、美术资源
  await addBlock(docId, 4, { heading2: { elements: [textEl("二、美术资源", true)] } });
  await addBlock(docId, 2, { text: { elements: [textEl("命名规则见《美术资源命名规范》")] } });
  const t6 = await addTable(docId, 5, 4);
  if (t6) await fillTable(docId, t6, [
    ["资源描述", "尺寸", "格式", "状态"],
    ["生命值图标（满）", "64×64", "PNG", "⬜"],
    ["生命值图标（空）", "64×64", "PNG", "⬜"],
    ["生命值不足弹窗背景", "600×400", "PNG", "⬜"],
    ["无限生命图标", "64×64", "PNG", "⬜"]
  ]);
  console.log("✓ 二、美术资源");

  await addBlock(docId, 22, { divider: {} });

  // 三、音效位置
  await addBlock(docId, 4, { heading2: { elements: [textEl("三、音效位置", true)] } });
  const t7 = await addTable(docId, 4, 3);
  if (t7) await fillTable(docId, t7, [
    ["触发点", "描述", "资源"],
    ["生命值恢复", "清脆叮咚声", "sfx_life_recover"],
    ["生命值消耗", "碎裂声", "sfx_life_lose"],
    ["无限生命激活", "魔法音效", "sfx_unlimited_start"]
  ]);
  console.log("✓ 三、音效位置");

  await addBlock(docId, 22, { divider: {} });

  // 四、数据打点
  await addBlock(docId, 4, { heading2: { elements: [textEl("四、数据打点", true)] } });
  const t8 = await addTable(docId, 5, 4);
  if (t8) await fillTable(docId, t8, [
    ["事件名", "触发时机", "参数", "用途"],
    ["lives_consume", "关卡失败消耗", "level_id", "消耗统计"],
    ["lives_recover", "自动恢复", "lives_after", "恢复统计"],
    ["lives_buy", "购买补满", "cost", "付费分析"],
    ["lives_gift_send", "赠送好友", "friend_id", "社交分析"]
  ]);
  console.log("✓ 四、数据打点");

  await addBlock(docId, 22, { divider: {} });

  // 五、测试清单
  await addBlock(docId, 4, { heading2: { elements: [textEl("五、测试清单", true)] } });
  const t9 = await addTable(docId, 6, 5);
  if (t9) await fillTable(docId, t9, [
    ["编号", "测试项", "前置条件", "操作", "预期结果"],
    ["T01", "失败消耗生命", "生命值 > 0", "关卡失败", "生命值 -1"],
    ["T02", "成功不消耗", "任意", "关卡成功", "生命值不变"],
    ["T03", "零生命不能进入", "生命值 = 0", "点击关卡", "弹窗提示"],
    ["T04", "恢复计时", "生命值 < 上限", "等待", "生命值 +1"],
    ["T05", "购买补满", "钻石充足", "购买", "生命值满"]
  ]);
  console.log("✓ 五、测试清单");

  await addBlock(docId, 22, { divider: {} });

  // 六、待确认项
  await addBlock(docId, 4, { heading2: { elements: [textEl("六、待确认项", true)] } });
  const t10 = await addTable(docId, 5, 4);
  if (t10) await fillTable(docId, t10, [
    ["编号", "问题", "相关方", "状态"],
    ["Q1", "是否需要 VIP 恢复加速？", "策划", "⬜ 待确认"],
    ["Q2", "无限生命道具从哪获取？", "策划", "⬜ 待确认"],
    ["Q3", "新手期是否不消耗生命？", "策划", "⬜ 待确认"],
    ["Q4", "是否需要看广告得生命？", "产品", "⬜ 待确认"]
  ]);
  console.log("✓ 六、待确认项");

  // 转让所有权
  console.log("\n转让所有权...");
  const transferResp = await client.drive.permissionMember.transferOwner({
    path: { token: docId },
    params: { type: "docx" },
    data: { member_type: "openid", member_id: "ou_151836a79685a5c53bbbf1401c5bdb3f" }
  });
  console.log(transferResp.code === 0 ? "✅ 所有权已转让" : "转让失败: " + transferResp.msg);
  
  console.log("\n📄 文档链接: https://shulex.feishu.cn/docx/" + docId);
}

main().catch(console.error);
