// Debug: what window receives the click at screen level?
const { _electron: electron } = require('playwright');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isolatedArgs } = require('./harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APP_DIR = path.resolve(__dirname, '..');

const click = (hwnd, css, cssSize) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'os-click-window.ps1'),
  '-Hwnd', hwnd, '-CssX', String(css.x), '-CssY', String(css.y), '-CssWidth', String(cssSize[0]), '-CssHeight', String(cssSize[1])], { stdio: 'pipe' }).toString();

const getHwndAt = (x, y) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'get-hwnd-at.ps1'), '-X', String(x), '-Y', String(y)], { stdio: 'pipe' }).toString().trim();

(async () => {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-close-hit'),
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

  const win = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes('widget=1'));
    return { hwnd: w.getNativeWindowHandle().readBigUInt64LE(0).toString(), bounds: w.getBounds(), cssSize: w.getContentSize() };
  });
  console.log('widget window:', JSON.stringify(win.bounds));

  const box = await widget.evaluate(() => {
    const c = document.querySelector('.widget-close').getBoundingClientRect();
    const h = document.querySelector('.widget-header');
    const place = document.querySelector('.widget-place');
    return {
      close: { x: c.left + c.width / 2, y: c.top + c.height / 2 },
      header: h.getBoundingClientRect(),
      place: place.getBoundingClientRect(),
    };
  });
  console.log('close button:', box.close);
  console.log('header:', box.header);
  console.log('place:', box.place);

  const scaleX = win.bounds.width / win.cssSize[0];
  const scaleY = win.bounds.height / win.cssSize[1];
  const screenX = Math.round(win.bounds.x + box.close.x * scaleX);
  const screenY = Math.round(win.bounds.y + box.close.y * scaleY);
  console.log('screen coords:', screenX, screenY);

  const hitHwnd = getHwndAt(screenX, screenY);
  console.log('WindowFromPoint at close:', hitHwnd);

  click(win.hwnd, box.close, win.cssSize);
  await sleep(1500);

  const stillOpen = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.getURL().includes('widget=1')));
  console.log('widget still open:', stillOpen);

  await app.close();
  process.exit(0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });