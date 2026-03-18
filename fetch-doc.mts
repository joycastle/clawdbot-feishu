// 直接调用飞书 API 获取文档内容

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';
const APP_ID = process.env.FEISHU_APP_ID!;
const APP_SECRET = process.env.FEISHU_APP_SECRET!;

async function getTenantAccessToken(): Promise<string> {
  const res = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await res.json() as any;
  if (data.code !== 0) throw new Error(`Auth failed: ${data.msg}`);
  return data.tenant_access_token;
}

async function resolveWikiToDocx(token: string, wikiToken: string): Promise<string> {
  const res = await fetch(`${FEISHU_API_BASE}/wiki/v2/spaces/get_node?token=${wikiToken}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json() as any;
  if (data.code !== 0) throw new Error(`Wiki resolve failed: ${data.msg}`);
  return data.data.node.obj_token;
}

async function fetchDocContent(token: string, docToken: string): Promise<string> {
  const res = await fetch(`${FEISHU_API_BASE}/docx/v1/documents/${docToken}/raw_content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json() as any;
  if (data.code !== 0) throw new Error(`Doc fetch failed: ${data.msg}`);
  return data.data.content;
}

const url = process.argv[2];
const wikiTokenMatch = url.match(/\/wiki\/([A-Za-z0-9]+)/);
if (!wikiTokenMatch) {
  console.error('Invalid wiki URL');
  process.exit(1);
}

const wikiToken = wikiTokenMatch[1];
const accessToken = await getTenantAccessToken();
const docToken = await resolveWikiToDocx(accessToken, wikiToken);
const content = await fetchDocContent(accessToken, docToken);
console.log(content);
