const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto('file:///home/ubuntu/clawd/scarecrow-mindmap.html', { waitUntil: 'networkidle0' });
  await page.waitForTimeout(2000); // wait for mermaid to render
  await page.screenshot({ path: '/home/ubuntu/clawd/scarecrow-mindmap.png', fullPage: true });
  await browser.close();
  console.log('Screenshot saved!');
})();
