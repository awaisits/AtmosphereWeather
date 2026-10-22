// Debug: check close button computed style
const { _electron: electron } = require('playwright');
const path = require('node:path');
const { isolatedArgs } = require('./harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APP_DIR = path.resolve(__dirname, '..');

(async () => {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-close-debug'),
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

  const styles = await widget.evaluate(() => {
    const root = document.querySelector('.weather-widget');
    const close = document.querySelector('.widget-close');
    const content = document.querySelector('.widget-content');
    return {
      root: getComputedStyle(root).getPropertyValue('-webkit-app-region'),
      close: getComputedStyle(close).getPropertyValue('-webkit-app-region'),
      content: getComputedStyle(content).getPropertyValue('-webkit-app-region'),
      header: getComputedStyle(document.querySelector('.widget-header')).getPropertyValue('-webkit-app-region'),
    };
  });
  console.log('app-region styles:', JSON.stringify(styles));

  await app.close();
  process.exit(0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });