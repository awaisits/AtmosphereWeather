// Probe: check what mouse events reach the renderer when dragging the header.
const { _electron: electron } = require('playwright');
const path = require('node:path');
const { isolatedArgs } = require('./harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APP_DIR = path.resolve(__dirname, '..');

(async () => {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-drag-events'),
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

  // Log all mouse events
  await widget.evaluate(() => {
    window.__mouseEvents = [];
    document.addEventListener('mousedown', (e) => window.__mouseEvents.push(`DOWN ${e.target.tagName}.${String(e.target.className)} @ ${Math.round(e.clientX)},${Math.round(e.clientY)}`), true);
    document.addEventListener('mousemove', (e) => window.__mouseEvents.push(`MOVE ${e.target.tagName}.${String(e.target.className)} @ ${Math.round(e.clientX)},${Math.round(e.clientY)}`), true);
    document.addEventListener('mouseup', (e) => window.__mouseEvents.push(`UP ${e.target.tagName}.${String(e.target.className)} @ ${Math.round(e.clientX)},${Math.round(e.clientY)}`), true);
  });

  const headerInfo = await widget.evaluate(() => {
    const place = document.querySelector('.widget-place');
    return place.getBoundingClientRect();
  });
  console.log('place rect:', JSON.stringify(headerInfo));

  await widget.mouse.move(headerInfo.x + headerInfo.width / 2, headerInfo.y + headerInfo.height / 2);
  await widget.mouse.down();
  await sleep(200);
  await widget.mouse.move(headerInfo.x + headerInfo.width / 2 + 150, headerInfo.y + headerInfo.height / 2 + 100, { steps: 10 });
  await sleep(200);
  await widget.mouse.up();
  await sleep(300);

  const events = await widget.evaluate(() => window.__mouseEvents);
  console.log('mouse events:', JSON.stringify(events));

  // Check the computed styles again
  const styles = await widget.evaluate(() => {
    const h = document.querySelector('.widget-header');
    const p = document.querySelector('.widget-place');
    return {
      header: getComputedStyle(h).getPropertyValue('-webkit-app-region'),
      place: getComputedStyle(p).getPropertyValue('-webkit-app-region'),
      root: getComputedStyle(document.querySelector('.weather-widget')).getPropertyValue('-webkit-app-region'),
    };
  });
  console.log('app-region styles:', JSON.stringify(styles));

  await app.close();
  process.exit(0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });