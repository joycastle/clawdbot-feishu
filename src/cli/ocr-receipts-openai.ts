import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function processImage(filePath: string): Promise<{ orderNo: string; amount: string }> {
  const imageData = fs.readFileSync(filePath);
  const base64Image = imageData.toString('base64');
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`,
              detail: 'low'
            }
          },
          {
            type: 'text',
            text: '这是一张 App Store 收据截图。请提取：1. 订单号（Order ID）2. 总计金额（Total后面的数字）。只返回JSON：{"orderNo": "订单号", "amount": "金额"}'
          }
        ]
      }
    ],
    max_tokens: 150
  });
  
  const text = response.choices[0]?.message?.content || '{}';
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
  
  // Print table
  console.log('\n| 序号 | 订单号 | 金额 |');
  console.log('|------|--------|------|');
  results.forEach((r, i) => {
    console.log(`| ${i+1} | ${r.orderNo} | ${r.amount} |`);
  });
  
  fs.writeFileSync('/tmp/receipt_results.json', JSON.stringify(results, null, 2));
  console.log('\n详细结果已保存到 /tmp/receipt_results.json');
}

main();
