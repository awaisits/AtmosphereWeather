// Probe: test drag on the actual packaged build (if it exists).
const { chromium } = require('playwright');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APP_DIR = path.resolve(__dirname, '..');
const EXE = path.join(APP_DIR, 'release/win-unpacked/Atmosphere Weather.exe');
const PORT = 9334;

if (!fs.existsSync(EXE)) {
  console.log('Packaged exe not found. Run npm run dist:win first.');
  process.exit(0);
}

(async () => {
  // Launch the real packaged app with remote debugging
  const userData = path.join(APP_DIR, '.harness-userdata', 'verify-drag-packaged');
  fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(userData, { recursive: true });
  
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, '--no-sandbox', `--user-data-dir=${userData}`], { stdio: 'ignore', detached: false });
  await sleep(8000);

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  } catch (e) {
    console.log('CDP connect failed:', String(e).split('\n')[0]);
    child.kill();
    process.exit(2);
  }

  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => p.url().includes('atmosphere://')) || ctx.pages()[0];
  if (!page) { console.log('no page'); child.kill(); process.exit(2); }
  console.log('attached to:', page.url());

  await page.waitForSelector('.app', { timeout: 30_000 });
  await sleep(3000);

  // Open widget
  await page.evaluate(() => void window.atmosphere?.showWidget?.());
  await sleep(2000);

  // Find widget page
  const widgetPage = ctx.pages().find((p) => p.url().includes('widget=1'));
  if (!widgetPage) { console.log('widget page not found'); child.kill(); process.exit(2); }
  console.log('widget page:', widgetPage.url());

  await widgetPage.waitForSelector('.weather-widget', { timeout: 20_000 });
  await sleep(1500);

  // Log all mouse events
  await widgetPage.evaluate(() => {
    window.__mouseEvents = [];
    document.addEventListener('mousedown', (e) => window.__mouseEvents.push(`DOWN ${e.target.tagName}.${String(e.target.className)} @ ${Math.round(e.clientX)},${Math.round(e.clientY)}`), true);
    document.addEventListener('mousemove', (e) => window.__mouseEvents.push(`MOVE ${e.target.tagName}.${String(e.target.className)} @ ${Math.round(e.clientX)},${Math.round(e.clientY)}`), true);
    document.addEventListener('mouseup', (e) => window.__mouseEvents.push(`UP ${e.target.tagName}.${String(e.target.className)} @ ${Math.round(e.clientX)},${Math.round(e.clientY)}`), true);
  });

  const headerInfo = await widgetPage.evaluate(() => {
    const place = document.querySelector('.widget-place');
    return place.getBoundingClientRect();
  });
  console.log('place rect:', JSON.stringify(headerInfo));

  await widgetPage.mouse.move(headerInfo.x + headerInfo.width / 2, headerInfo.y + headerInfo.height / 2);
  await widgetPage.mouse.down();
  await sleep(200);
  await widgetPage.mouse.move(headerInfo.x + headerInfo.width / 2 + 150, headerInfo.y + headerInfo.height / 2 + 100, { steps: 10 });
  await sleep(200);
  await widgetPage.mouse.up();
  await sleep(500);

  const events = await widgetPage.evaluate(() => window.__mouseEvents);
  console.log('mouse events:', JSON.stringify(events));

  await browser.close();
  child.kill();
  await sleep(500);
  process.exit(0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });