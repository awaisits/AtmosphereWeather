// Debug: check what window 262854 is
const { _electron: electron } = require('playwright');
const path = require('node:path');
const { isolatedArgs } = require('./harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APP_DIR = path.resolve(__dirname, '..');

(async () => {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-mystery-window'),
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
        url: w.webContents.getURL().slice(0, 60),
        focused: w.isFocused(),
        visible: w.isVisible(),
        alwaysOnTop: w.isAlwaysOnTop(),
      }));
  });
  console.log('Electron windows:', JSON.stringify(windows, null, 2));

  // The mystery window has hwnd 262854
  // Check if it's the widget's window but with different bounds
  const widgetDetails = await app.evaluate(({ BrowserWindow }) => {
    const widgetWin = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('widget=1'));
    return {
      hwnd: widgetWin.getNativeWindowHandle().readBigUInt64LE(0).toString(),
      bounds: widgetWin.getBounds(),
      isVisible: widgetWin.isVisible(),
      isFocused: widgetWin.isFocused(),
      alwaysOnTop: widgetWin.isAlwaysOnTop(),
    };
  });
  console.log('\nWidget window details:', JSON.stringify(widgetDetails, null, 2));

  // Check Windows API for all top-level windows
  const { execFileSync } = require('node:child_process');
  const allWindows = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'enum-windows.ps1')], { stdio: 'pipe' }).toString().trim();
  console.log('\nAll visible top-level windows:');
  console.log(allWindows);

  await app.close();
  process.exit(0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });