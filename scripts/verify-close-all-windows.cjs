// Debug: enumerate all windows at the widget's position
const { _electron: electron } = require('playwright');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isolatedArgs } = require('./harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APP_DIR = path.resolve(__dirname, '..');

const getHwndAt = (x, y) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'get-hwnd-at.ps1'), '-X', String(x), '-Y', String(y)], { stdio: 'pipe' }).toString().trim();

(async () => {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-close-all-windows'),
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

  const windows = await app.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed())
      .map((w) => ({
        hwnd: w.getNativeWindowHandle().readBigUInt64LE(0).toString(),
        bounds: w.getBounds(),
        cssSize: w.getContentSize(),
        url: w.webContents.getURL().slice(0, 60),
        focused: w.isFocused(),
        visible: w.isVisible(),
        alwaysOnTop: w.isAlwaysOnTop(),
      }));
  });
  console.log('ALL windows:', JSON.stringify(windows, null, 2));

  // Check multiple screen points
  const points = [
    { name: 'close button', x: 839, y: 340 },
    { name: 'widget center', x: 698, y: 414 },
    { name: 'header left', x: 550, y: 330 },
  ];

  for (const p of points) {
    console.log('\nWindowFromPoint at', p.name, p.x, p.y);
    console.log(getHwndAt(p.x, p.y));
  }

  await app.close();
  process.exit(0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });