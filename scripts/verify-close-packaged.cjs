// Test close button on packaged build
const { chromium } = require('playwright');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APP_DIR = path.resolve(__dirname, '..');
const EXE = path.join(APP_DIR, 'release/win-unpacked/Atmosphere Weather.exe');
const PORT = 9335;

if (!fs.existsSync(EXE)) {
  console.log('Packaged exe not found.');
  process.exit(0);
}

const click = (hwnd, css, cssSize) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'os-click-window.ps1'),
  '-Hwnd', hwnd, '-CssX', String(css.x), '-CssY', String(css.y), '-CssWidth', String(cssSize[0]), '-CssHeight', String(cssSize[1])], { stdio: 'pipe' }).toString();

const getHwndAt = (x, y) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'get-hwnd-at.ps1'), '-X', String(x), '-Y', String(y)], { stdio: 'pipe' }).toString().trim();

(async () => {
  const userData = path.join(APP_DIR, '.harness-userdata', 'verify-close-packaged');
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

  const widgetPage = ctx.pages().find((p) => p.url().includes('widget=1'));
  if (!widgetPage) { console.log('widget page not found'); child.kill(); process.exit(2); }
  console.log('widget page:', widgetPage.url());

  await widgetPage.waitForSelector('.weather-widget', { timeout: 20_000 });
  await sleep(1500);

// Check close button
  const box = await widgetPage.evaluate(() => {
    const c = document.querySelector('.widget-close').getBoundingClientRect();
    return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
  });
  console.log('close button (CSS):', box);

  // Get widget bounds via main page
  const widgetBounds = await page.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes('widget=1'));
    return { hwnd: w.getNativeWindowHandle().readBigUInt64LE(0).toString(), bounds: w.getBounds(), cssSize: w.getContentSize() };
  });
  console.log('widget bounds:', JSON.stringify(widgetBounds));

  const scaleX = widgetBounds.bounds.width / widgetBounds.cssSize[0];
  const scaleY = widgetBounds.bounds.height / widgetBounds.cssSize[1];
  const screenX = Math.round(widgetBounds.bounds.x + box.x * scaleX);
  const screenY = Math.round(widgetBounds.bounds.y + box.y * scaleY);
  console.log('screen coords:', screenX, screenY);

  const hitHwnd = getHwndAt(screenX, screenY);
  console.log('WindowFromPoint at close:', hitHwnd);

  click(widgetBounds.hwnd, box, widgetBounds.cssSize);
  await sleep(1500);

  const stillOpen = await page.evaluate(async ({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.getURL().includes('widget=1'));
  });
  console.log('widget still open:', stillOpen);

  await browser.close();
  child.kill();
  await sleep(500);
  process.exit(0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });