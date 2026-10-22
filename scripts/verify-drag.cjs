// Probe: drag the widget header with real OS mouse to verify it works.
const { _electron: electron } = require('playwright');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isolatedArgs } = require('./harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APP_DIR = path.resolve(__dirname, '..');

const drag = (hwnd, startCss, endCss, cssSize) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'os-drag-window.ps1'),
  '-Hwnd', hwnd,
  '-StartCssX', String(startCss.x), '-StartCssY', String(startCss.y),
  '-EndCssX', String(endCss.x), '-EndCssY', String(endCss.y),
  '-CssWidth', String(cssSize[0]), '-CssHeight', String(cssSize[1])], { stdio: 'pipe' }).toString();

(async () => {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-drag'),
    timeout: 60_000,
  });
  const main = await app.firstWindow();
  await main.waitForSelector('.app', { timeout: 30_000 });
  await sleep(1500);

  // Minimize main window so it doesn't interfere
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

  // Check header layout and app-region
  const headerInfo = await widget.evaluate(() => {
    const h = document.querySelector('.widget-header');
    const place = document.querySelector('.widget-place');
    return {
      headerRect: h.getBoundingClientRect(),
      placeRect: place.getBoundingClientRect(),
      headerAppRegion: getComputedStyle(h).getPropertyValue('-webkit-app-region'),
      placeAppRegion: getComputedStyle(place).getPropertyValue('-webkit-app-region'),
      rootAppRegion: getComputedStyle(document.querySelector('.weather-widget')).getPropertyValue('-webkit-app-region'),
    };
  });
  console.log('header layout:', JSON.stringify(headerInfo, null, 2));

  const win = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes('widget=1'));
    return { hwnd: w.getNativeWindowHandle().readBigUInt64LE(0).toString(), bounds: w.getBounds(), cssSize: w.getContentSize() };
  });
  console.log('widget bounds before:', JSON.stringify(win.bounds));

  // Drag from the header's place name
  const start = { x: headerInfo.placeRect.x + headerInfo.placeRect.w / 2, y: headerInfo.placeRect.y + headerInfo.placeRect.h / 2 };
  const end = { x: start.x + 150, y: start.y + 100 };
  drag(win.hwnd, start, end, win.cssSize);
  await sleep(600);

  const after = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes('widget=1'));
    return w ? w.getBounds() : null;
  });
  console.log('widget bounds after drag:', JSON.stringify(after));
  console.log('moved:', after && (after.x !== win.bounds.x || after.y !== win.bounds.y));

  // What events did the renderer see?
  await widget.evaluate(() => {
    window.__mouseEvents = [];
    document.addEventListener('mousedown', (e) => window.__mouseEvents.push(`DOWN ${e.target.tagName}.${String(e.target.className)} @ ${Math.round(e.clientX)},${Math.round(e.clientY)}`), true);
    document.addEventListener('mousemove', (e) => window.__mouseEvents.push(`MOVE ${e.target.tagName}.${String(e.target.className)} @ ${Math.round(e.clientX)},${Math.round(e.clientY)}`), true);
    document.addEventListener('mouseup', (e) => window.__mouseEvents.push(`UP ${e.target.tagName}.${String(e.target.className)} @ ${Math.round(e.clientX)},${Math.round(e.clientY)}`), true);
  });

  // Second drag to check events
  drag(win.hwnd, start, end, win.cssSize);
  await sleep(600);
  const events = await widget.evaluate(() => window.__mouseEvents);
  console.log('mouse events:', JSON.stringify(events));

  await app.close();
  process.exit(0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });