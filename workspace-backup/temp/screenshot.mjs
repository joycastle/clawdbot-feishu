import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 850, height: 320 });
await page.goto('file:///home/ubuntu/clawd/temp/help-bubble-mockup.html');
await page.screenshot({ path: '/home/ubuntu/clawd/temp/help-bubble.png' });
await browser.close();
console.log('Done!');
