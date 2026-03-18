/**
 * Test if docs:document.content:read permission is enabled
 */
import * as fs from "fs";

async function main() {
  // Load config
  const configPath = process.env.HOME + "/.clawdbot/clawdbot.json";
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const feishuCfg = cfg.channels?.feishu;
  
  if (!feishuCfg) {
    console.log("❌ 没有找到 feishu 配置");
    return;
  }

  const appId = feishuCfg.appId;
  const appSecret = feishuCfg.appSecret;
  
  if (!appId || !appSecret) {
    console.log("❌ 没有找到 feishu 凭据");
    return;
  }

  // Get tenant token
  const tokenResp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const tokenData = await tokenResp.json() as { tenant_access_token?: string; code?: number; msg?: string };
  if (!tokenData.tenant_access_token) {
    console.log("❌ 获取 token 失败:", tokenData.msg);
    return;
  }
  const token = tokenData.tenant_access_token;

  // Test raw_content API (requires docs:document.content:read)
  const docId = "GEFBdERgaoDngHxMfghcWhwlnlg";
  const docResp = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/raw_content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const docData = await docResp.json() as { code?: number; msg?: string; data?: { content?: string } };
  
  if (docData.code === 0) {
    console.log("✅ docs:document.content:read 权限已开通!");
    console.log("文档内容长度:", docData.data?.content?.length || 0, "字符");
  } else if (docData.msg?.includes("document.content:read") || docData.msg?.includes("Access denied")) {
    console.log("❌ 权限仍未开通");
    console.log("错误:", docData.msg);
  } else {
    console.log("其他错误:", docData.code, docData.msg);
  }
}

main().catch(console.error);
