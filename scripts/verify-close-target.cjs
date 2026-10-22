// Debug: what element is hit by the OS click?
const { _electron: electron } = require('playwright');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isolatedArgs } = require('./harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APP_DIR = path.resolve(__dirname, '..');

const click = (hwnd, css, cssSize) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'os-click-window.ps1'),
  '-Hwnd', hwnd, '-CssX', String(css.x), '-CssY', String(css.y), '-CssWidth', String(cssSize[0]), '-CssHeight', String(cssSize[1])], { stdio: 'pipe' }).toString();

(async () => {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-close-target'),
    timeout: 60_000,
  });
  const main = await app.firstWindow();
  await main.waitForSelector('.app', { timeout: 30_000 });
  await sleep(1500);

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && !x.webContents.getURL().includes('widget=1'));
    w?.minimize();
  });
  await sleep(500);

  const widgetPromise = app.waitForEvent('window', { timeout: 20_000 });
  await main.evaluate(() => void window.atmosphere?.showWidget?.());
  const widget = await widgetPromise;
  await widget.waitForSelector('.weather-widget', { timeout: 20_000 });
  await sleep(1500);

  await widget.evaluate(() => {
    window.__clicks = [];
    document.addEventListener('click', (e) => window.__clicks.push(`${e.target.tagName}.${String(e.target.className)} @ ${Math.round(e.clientX)},${Math.round(e.clientY)}`), true);
  });

  const win = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes('widget=1'));
    return { hwnd: w.getNativeWindowHandle().readBigUInt64LE(0).toString(), cssSize: w.getContentSize() };
  });
  const box = await widget.evaluate(() => {
    const c = document.querySelector('.widget-close').getBoundingClientRect();
    return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
  });
  console.log('click target:', box);
  click(win.hwnd, box, win.cssSize);
  await sleep(1500);

  const clicks = await widget.evaluate(() => window.__clicks);
  console.log('renderer clicks:', JSON.stringify(clicks));

  const stillOpen = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.getURL().includes('widget=1')));
  console.log('widget still open:', stillOpen);

  await app.close();
  process.exit(0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });