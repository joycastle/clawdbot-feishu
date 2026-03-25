#!/usr/bin/env npx tsx
import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "../utils/paths.js";

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const feishu = config?.channels?.feishu;

const client = new lark.Client({
  appId: feishu.appId,
  appSecret: feishu.appSecret,
});

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

function textEl(text: string, bold = false) {
  return { text_run: { content: text, text_element_style: bold ? { bold: true } : {} } };
}

function textBlock(text: string, bold = false): any {
  return { block_type: 2, text: { elements: [textEl(text, bold)] } };
}

function headingBlock(level: 1 | 2 | 3, text: string): any {
  const types = { 1: 3, 2: 4, 3: 5 };
  const keys = { 1: "heading1", 2: "heading2", 3: "heading3" };
  return { block_type: types[level], [keys[level]]: { elements: [textEl(text, true)] } };
}

function dividerBlock(): any {
  return { block_type: 22, divider: {} };
}

function bulletBlock(text: string): any {
  return { block_type: 12, bullet: { elements: [textEl(text)] } };
}

async function addBlock(docId: string, block: any) {
  try {
    await client.docx.documentBlockChildren.create({
      path: { document_id: docId, block_id: docId },
      params: { document_revision_id: -1 },
      data: { children: [block], index: -1 }
    });
    await delay(80);
  } catch (e: any) {
    // skip
  }
}

async function addTable(docId: string, headers: string[], rows: string[][]) {
  const rowCount = rows.length + 1;
  const colCount = headers.length;
  
  const createResp = await client.docx.documentBlockChildren.create({
    path: { document_id: docId, block_id: docId },
    params: { document_revision_id: -1 },
    data: {
      children: [{
        block_type: 31,
        table: {
          property: { row_size: rowCount, column_size: colCount, column_width: Array(colCount).fill(100), merge_info: [] }
        }
      }],
      index: -1
    }
  });
  
  if (createResp.code !== 0) {
    await addBlock(docId, textBlock("| " + headers.join(" | ") + " |"));
    for (const row of rows) await addBlock(docId, textBlock("| " + row.join(" | ") + " |"));
    return;
  }
  
  const tableBlockId = createResp.data?.children?.[0]?.block_id;
  if (!tableBlockId) return;
  await delay(150);
  
  const tableResp = await client.docx.documentBlockChildren.get({
    path: { document_id: docId, block_id: tableBlockId },
    params: { document_revision_id: -1 }
  });
  
  const cells = tableResp.data?.items || [];
  let cellIndex = 0;
  
  for (let i = 0; i < headers.length && cellIndex < cells.length; i++) {
    const cellId = cells[cellIndex]?.block_id;
    if (cellId) {
      await client.docx.documentBlockChildren.create({
        path: { document_id: docId, block_id: cellId },
        params: { document_revision_id: -1 },
        data: { children: [textBlock(headers[i], true)], index: 0 }
      });
      await delay(30);
    }
    cellIndex++;
  }
  
  for (const row of rows) {
    for (let i = 0; i < row.length && cellIndex < cells.length; i++) {
      const cellId = cells[cellIndex]?.block_id;
      if (cellId) {
        await client.docx.documentBlockChildren.create({
          path: { document_id: docId, block_id: cellId },
          params: { document_revision_id: -1 },
          data: { children: [textBlock(row[i])], index: 0 }
        });
        await delay(30);
      }
      cellIndex++;
    }
  }
}

async function main() {
  console.log("创建文档...");
  const createResp = await client.docx.document.create({ data: { title: "三消游戏生命值系统需求文档 v1.0" } });
  if (createResp.code !== 0) throw new Error(createResp.msg);
  const docId = createResp.data?.document?.document_id!;
  console.log("文档ID:", docId);

  await addBlock(docId, headingBlock(2, "📌 基础信息"));
  await addTable(docId, ["字段", "内容"], [
    ["功能名称", "生命值系统（Lives System）"],
    ["版本", "v1.0"],
    ["状态", "🟡 草稿"],
    ["负责人", "@策划"],
    ["创建日期", "2026-03-23"]
  ]);
  
  await addBlock(docId, headingBlock(3, "变更记录"));
  await addTable(docId, ["版本", "日期", "修改人", "变更内容"], [["1.0", "2026-03-23", "王总", "初稿"]]);
  await addBlock(docId, dividerBlock());
  
  await addBlock(docId, headingBlock(2, "一、功能需求"));
  
  await addBlock(docId, headingBlock(3, "1.1 生命值消耗与获取"));
  await addBlock(docId, textBlock("描述：", true));
  await addBlock(docId, textBlock("玩家挑战关卡失败时消耗生命值，生命值耗尽后无法继续挑战，需等待恢复或通过其他方式获取。"));
  await addBlock(docId, textBlock("规则：", true));
  await addBlock(docId, bulletBlock("挑战关卡失败时消耗 1 点生命值"));
  await addBlock(docId, bulletBlock("挑战关卡成功不消耗生命值"));
  await addBlock(docId, bulletBlock("主动退出关卡视为失败，消耗 1 点生命值"));
  await addBlock(docId, bulletBlock("生命值为 0 时，无法进入关卡"));
  await addBlock(docId, textBlock("边界 & 异常：", true));
  await addTable(docId, ["情况", "处理"], [
    ["生命值为 0 时点击关卡", "弹窗提示生命值不足，显示恢复倒计时和获取途径"],
    ["关卡中网络断开", "不消耗生命值，提示网络异常，可重新进入"],
    ["关卡中强制关闭 App", "下次启动时恢复关卡进度，不额外消耗生命值"],
    ["正在挑战时生命值恢复", "不影响当前关卡，正常结算"]
  ]);
  await addBlock(docId, textBlock("数据：", true));
  await addTable(docId, ["字段", "类型", "范围", "说明", "备注"], [
    ["max_lives", "int", "1-10", "生命值上限", "配置项，默认 5"],
    ["current_lives", "int", "0-max_lives", "当前生命值", "存储字段"]
  ]);

  await addBlock(docId, headingBlock(3, "1.2 生命值自动恢复"));
  await addBlock(docId, textBlock("描述：", true));
  await addBlock(docId, textBlock("生命值未满时，随时间自动恢复，直到达到上限。"));
  await addBlock(docId, textBlock("规则：", true));
  await addBlock(docId, bulletBlock("每 N 分钟恢复 1 点生命值（默认 20 分钟）"));
  await addBlock(docId, bulletBlock("生命值已满时停止计时，不再恢复"));
  await addBlock(docId, bulletBlock("恢复计时为服务器时间，防止本地改时间作弊"));
  await addBlock(docId, bulletBlock("离线期间正常累计恢复"));
  await addBlock(docId, textBlock("边界 & 异常：", true));
  await addTable(docId, ["情况", "处理"], [
    ["生命值已满", "停止恢复计时，不显示倒计时"],
    ["离线 24 小时后上线", "按实际时间差计算恢复量，最多恢复到上限"],
    ["恢复瞬间正好消耗", "先扣除再恢复，保证逻辑顺序"],
    ["服务器与本地时间差异大", "以服务器时间为准"]
  ]);
  await addBlock(docId, textBlock("数据：", true));
  await addTable(docId, ["字段", "类型", "范围", "说明", "备注"], [
    ["recover_interval_sec", "int", "60-7200", "恢复间隔（秒）", "配置项，默认 1200"],
    ["last_recover_time", "timestamp", "-", "上次恢复时间", "存储字段"]
  ]);

  await addBlock(docId, headingBlock(3, "1.3 生命值购买"));
  await addBlock(docId, textBlock("描述：玩家可使用钻石购买生命值，立即补满。"));
  await addBlock(docId, textBlock("规则：", true));
  await addBlock(docId, bulletBlock("消耗固定数量钻石，生命值补满至上限"));
  await addBlock(docId, bulletBlock("生命值已满时不可购买"));
  await addBlock(docId, bulletBlock("购买后立即生效"));
  await addBlock(docId, textBlock("边界 & 异常：", true));
  await addTable(docId, ["情况", "处理"], [
    ["钻石不足", "弹窗提示，引导充值"],
    ["生命值已满", "按钮置灰"],
    ["网络断开", "提示失败，不扣钻石"],
    ["连续快速点击", "防重复提交"]
  ]);

  await addBlock(docId, headingBlock(3, "1.4 无限生命值道具"));
  await addBlock(docId, textBlock("描述：限时道具，激活后生命值无限，失败不消耗。"));
  await addBlock(docId, textBlock("规则：", true));
  await addBlock(docId, bulletBlock("激活后 N 分钟内失败不消耗生命值"));
  await addBlock(docId, bulletBlock("多个道具可叠加时长"));
  await addBlock(docId, bulletBlock("倒计时在界面显示"));

  await addBlock(docId, headingBlock(3, "1.5 好友赠送生命值"));
  await addBlock(docId, textBlock("描述：玩家可向好友赠送生命值，增强社交互动。"));
  await addBlock(docId, textBlock("规则：", true));
  await addBlock(docId, bulletBlock("每位好友每天只能赠送/接收 1 次"));
  await addBlock(docId, bulletBlock("赠送不消耗自己的生命值"));
  await addBlock(docId, bulletBlock("接收的生命值存入邮箱"));

  await addBlock(docId, headingBlock(3, "1.6 邮箱领取生命值"));
  await addBlock(docId, textBlock("描述：好友赠送、活动奖励的生命值存入邮箱，手动领取。"));
  await addBlock(docId, textBlock("规则：", true));
  await addBlock(docId, bulletBlock("邮箱生命值不受上限限制"));
  await addBlock(docId, bulletBlock("领取时可超出上限"));
  await addBlock(docId, bulletBlock("可批量领取"));

  await addBlock(docId, dividerBlock());
  await addBlock(docId, headingBlock(2, "二、美术资源"));
  await addTable(docId, ["资源描述", "尺寸", "格式", "状态"], [
    ["生命值图标（满）", "64×64", "PNG", "⬜"],
    ["生命值图标（空）", "64×64", "PNG", "⬜"],
    ["生命值不足弹窗背景", "600×400", "PNG", "⬜"],
    ["无限生命图标", "64×64", "PNG", "⬜"]
  ]);

  await addBlock(docId, dividerBlock());
  await addBlock(docId, headingBlock(2, "三、音效位置"));
  await addTable(docId, ["触发点", "描述", "资源"], [
    ["生命值恢复", "清脆叮咚声", "sfx_life_recover"],
    ["生命值消耗", "碎裂声", "sfx_life_lose"],
    ["无限生命激活", "魔法音效", "sfx_unlimited_start"]
  ]);

  await addBlock(docId, dividerBlock());
  await addBlock(docId, headingBlock(2, "四、数据打点"));
  await addTable(docId, ["事件名", "触发时机", "参数", "用途"], [
    ["lives_consume", "关卡失败消耗生命", "level_id", "消耗统计"],
    ["lives_recover", "自动恢复生命", "lives_after", "恢复统计"],
    ["lives_buy", "购买补满生命", "cost", "付费分析"],
    ["lives_gift_send", "赠送好友生命", "friend_id", "社交分析"]
  ]);

  await addBlock(docId, dividerBlock());
  await addBlock(docId, headingBlock(2, "五、测试清单"));
  await addTable(docId, ["编号", "测试项", "前置条件", "操作", "预期结果"], [
    ["T01", "失败消耗生命", "生命值 > 0", "关卡失败", "生命值 -1"],
    ["T02", "成功不消耗", "任意", "关卡成功", "生命值不变"],
    ["T03", "零生命不能进入", "生命值 = 0", "点击关卡", "弹窗提示"],
    ["T04", "恢复计时", "生命值 < 上限", "等待", "生命值 +1"],
    ["T05", "购买补满", "钻石充足", "购买", "生命值满"]
  ]);

  await addBlock(docId, dividerBlock());
  await addBlock(docId, headingBlock(2, "六、待确认项"));
  await addTable(docId, ["编号", "问题", "相关方", "状态"], [
    ["Q1", "是否需要 VIP 恢复加速？", "策划", "⬜ 待确认"],
    ["Q2", "无限生命道具从哪里获取？", "策划", "⬜ 待确认"],
    ["Q3", "新手期是否不消耗生命？", "策划", "⬜ 待确认"],
    ["Q4", "是否需要看广告得生命？", "产品", "⬜ 待确认"]
  ]);

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
