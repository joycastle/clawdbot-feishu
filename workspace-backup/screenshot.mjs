import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1400, height: 1000 });
await page.goto('file:///home/ubuntu/clawd/scarecrow-mindmap.html');
await page.waitForTimeout(3000); // wait for mermaid to render
await page.screenshot({ path: '/home/ubuntu/clawd/scarecrow-mindmap.png', fullPage: true });
await browser.close();
console.log('Done!');
