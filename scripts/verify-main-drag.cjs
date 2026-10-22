// Probe: test if main window titlebar drag works.
const { _electron: electron } = require('playwright');
const path = require('node:path');
const { isolatedArgs } = require('./harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APP_DIR = path.resolve(__dirname, '..');

(async () => {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-main-drag'),
    timeout: 60_000,
  });
  const main = await app.firstWindow();
  await main.waitForSelector('.app', { timeout: 30_000 });
  await sleep(1500);

  // Check main window titlebar app-region
  const titlebarInfo = await main.evaluate(() => {
    const tb = document.querySelector('.titlebar');
    return {
      rect: tb.getBoundingClientRect(),
      appRegion: getComputedStyle(tb).getPropertyValue('-webkit-app-region'),
      actionsAppRegion: getComputedStyle(document.querySelector('.titlebar-actions')).getPropertyValue('-webkit-app-region'),
    };
  });
  console.log('main titlebar:', JSON.stringify(titlebarInfo, null, 2));

  const before = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && !x.webContents.getURL().includes('widget=1'));
    return w ? w.getBounds() : null;
  });
  console.log('main bounds before:', JSON.stringify(before));

  // Drag the main window titlebar with Playwright mouse
  await main.mouse.move(titlebarInfo.rect.x + 50, titlebarInfo.rect.y + titlebarInfo.rect.height / 2);
  await main.mouse.down();
  await sleep(200);
  await main.mouse.move(titlebarInfo.rect.x + 50 + 150, titlebarInfo.rect.y + titlebarInfo.rect.height / 2 + 100, { steps: 10 });
  await sleep(200);
  await main.mouse.up();
  await sleep(500);

  const after = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && !x.webContents.getURL().includes('widget=1'));
    return w ? w.getBounds() : null;
  });
  console.log('main bounds after:', JSON.stringify(after));
  console.log('moved:', after && (after.x !== before.x || after.y !== before.y));

  await app.close();
  process.exit(0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });