import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const wikiUrls = [
  { name: 'bf', url: 'https://joycastle.feishu.cn/wiki/V60Fwgi83iTp8lklNEucpfg1nnd' },
  { name: 'bv', url: 'https://joycastle.feishu.cn/wiki/LKLOwGjCpi9wV2k0jVFcJPP4nvc' }
];

async function getTenantAccessToken(): Promise<string> {
  const appId = process.env.FEISHU_APP_ID!;
  const appSecret = process.env.FEISHU_APP_SECRET!;
  const res = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: appId,
    app_secret: appSecret
  });
  return res.data.tenant_access_token;
}

function extractToken(url: string): string {
  const match = url.match(/wiki\/([A-Za-z0-9]+)/);
  return match ? match[1] : '';
}

async function getDocumentId(token: string, accessToken: string): Promise<string> {
  // Get wiki node info to get obj_token (document id)
  const res = await axios.get(`https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { token }
  });
  return res.data.data.node.obj_token;
}

async function getDocumentBlocks(docToken: string, accessToken: string): Promise<any[]> {
  const blocks: any[] = [];
  let pageToken = '';
  
  do {
    const url = `https://open.feishu.cn/open-apis/docx/v1/documents/${docToken}/blocks`;
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { page_size: 500, page_token: pageToken || undefined }
    });
    
    blocks.push(...(res.data.data.items || []));
    pageToken = res.data.data.page_token || '';
  } while (pageToken);
  
  return blocks;
}

async function downloadImage(fileToken: string, accessToken: string, outputPath: string): Promise<boolean> {
  try {
    const url = `https://open.feishu.cn/open-apis/drive/v1/medias/${fileToken}/download`;
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: 'arraybuffer'
    });
    fs.writeFileSync(outputPath, Buffer.from(res.data));
    return true;
  } catch (err: any) {
    console.error(`Failed to download ${fileToken}: ${err.message}`);
    return false;
  }
}

async function main() {
  const accessToken = await getTenantAccessToken();
  console.log('Token obtained!');
  
  for (const wiki of wikiUrls) {
    console.log(`\n=== Processing ${wiki.name.toUpperCase()} ===`);
    
    const wikiToken = extractToken(wiki.url);
    console.log(`Wiki token: ${wikiToken}`);
    
    // Get document ID
    const docToken = await getDocumentId(wikiToken, accessToken);
    console.log(`Document token: ${docToken}`);
    
    // Get all blocks
    const blocks = await getDocumentBlocks(docToken, accessToken);
    console.log(`Total blocks: ${blocks.length}`);
    
    // Find image blocks (block_type = 27)
    const imageBlocks = blocks.filter(b => b.block_type === 27);
    console.log(`Image blocks: ${imageBlocks.length}`);
    
    // Create output directory
    const outputDir = `/tmp/${wiki.name}-images`;
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Download images
    let downloaded = 0;
    for (let i = 0; i < imageBlocks.length; i++) {
      const block = imageBlocks[i];
      const fileToken = block.image?.token;
      if (!fileToken) continue;
      
      const outputPath = path.join(outputDir, `image_${String(i + 1).padStart(3, '0')}.png`);
      const success = await downloadImage(fileToken, accessToken, outputPath);
      if (success) {
        downloaded++;
        const size = fs.statSync(outputPath).size;
        console.log(`[${i + 1}/${imageBlocks.length}] ✓ ${path.basename(outputPath)} (${(size / 1024).toFixed(1)}KB)`);
      }
    }
    
    console.log(`\n${wiki.name.toUpperCase()}: Downloaded ${downloaded}/${imageBlocks.length} images to ${outputDir}`);
  }
}

main().catch(console.error);
