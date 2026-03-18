import * as fs from 'fs';
import * as path from 'path';
import { VertexAI } from '@google-cloud/vertexai';

const vertexAI = new VertexAI({
  project: 'jc-ai-dev',
  location: 'us-central1',
});

const model = vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

async function processImage(filePath: string): Promise<{ orderNo: string; amount: string }> {
  const imageData = fs.readFileSync(filePath);
  const base64Image = imageData.toString('base64');
  
  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Image
          }
        },
        {
          text: '这是一张 App Store 收据截图。请提取以下信息：\n1. 订单号（Order ID / 订单编号）\n2. 总计金额（Total / 总计后面的数字）\n\n只返回 JSON 格式，格式如下：\n{"orderNo": "订单号", "amount": "金额"}\n\n不要添加任何其他文字。如果找不到，返回 "N/A"'
        }
      ]
    }]
  });
  
  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  try {
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {}
  
  return { orderNo: 'N/A', amount: 'N/A' };
}

async function main() {
  const receiptsDir = '/tmp/receipts';
  const files = fs.readdirSync(receiptsDir)
    .filter(f => f.endsWith('.jpg'))
    .sort();
  
  console.log(`Processing ${files.length} receipts...\n`);
  
  const results: Array<{ file: string; orderNo: string; amount: string }> = [];
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(receiptsDir, file);
    
    try {
      const data = await processImage(filePath);
      results.push({ file, ...data });
      console.log(`[${i+1}/${files.length}] ${file}: 订单号=${data.orderNo}, 金额=${data.amount}`);
    } catch (err: any) {
      console.error(`[${i+1}/${files.length}] ${file}: Error - ${err.message}`);
      results.push({ file, orderNo: 'ERROR', amount: 'ERROR' });
    }
    
    await new Promise(r => setTimeout(r, 100));
  }
  
  let total = 0;
  results.forEach(r => {
    const amt = parseFloat(r.amount.replace(/[¥,]/g, ''));
    if (!isNaN(amt)) total += amt;
  });
  
  console.log('\n=== 统计结果 ===');
  console.log(`总收据数: ${results.length}`);
  console.log(`总金额: ¥${total.toFixed(2)}`);
  
  fs.writeFileSync('/tmp/receipt_results.json', JSON.stringify(results, null, 2));
  console.log('\n详细结果已保存到 /tmp/receipt_results.json');
}

main();
