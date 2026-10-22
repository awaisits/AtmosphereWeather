// Probe: drag using Playwright's mouse (goes through renderer) to verify
// the drag handling works at the Electron level.
const { _electron: electron } = require('playwright');
const path = require('node:path');
const { isolatedArgs } = require('./harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APP_DIR = path.resolve(__dirname, '..');

(async () => {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-drag-playwright'),
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

  const headerInfo = await widget.evaluate(() => {
    const place = document.querySelector('.widget-place');
    return place.getBoundingClientRect();
  });
  console.log('place rect:', JSON.stringify(headerInfo));

  const before = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes('widget=1'));
    return w ? w.getBounds() : null;
  });
  console.log('widget bounds before:', JSON.stringify(before));

  // Drag with Playwright's mouse (through renderer)
  await widget.mouse.move(headerInfo.x + headerInfo.width / 2, headerInfo.y + headerInfo.height / 2);
  await widget.mouse.down();
  await sleep(200);
  await widget.mouse.move(headerInfo.x + headerInfo.width / 2 + 150, headerInfo.y + headerInfo.height / 2 + 100, { steps: 10 });
  await sleep(200);
  await widget.mouse.up();
  await sleep(500);

  const after = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes('widget=1'));
    return w ? w.getBounds() : null;
  });
  console.log('widget bounds after:', JSON.stringify(after));
  console.log('moved:', after && (after.x !== before.x || after.y !== before.y));

  await app.close();
  process.exit(0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });