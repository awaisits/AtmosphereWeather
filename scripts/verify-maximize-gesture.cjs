// Verifies that double-clicking the title bar maximizes and restores the
// window, now that the in-app maximize button is gone.
//
// The catch is that the title bar is a `-webkit-app-region: drag` region.
// Electron's drag regions swallow mouse input, so it is not obvious that a
// DOM `dblclick` ever reaches the renderer. This drives the real app and
// checks the window state in the main process, not the DOM.
const { _electron: electron } = require('playwright');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { isolatedArgs } = require('./harness.cjs');

(async () => {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-maximize-gesture'),
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 160)));

  await page.waitForSelector('.titlebar', { timeout: 30_000 });
  await sleep(2500);

  const state = () => app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
    return { maximized: w.isMaximized(), bounds: w.getBounds() };
  });

  console.log('before      :', JSON.stringify(await state()));

  // Double-click the empty part of the title bar, well away from the search
  // box and the action buttons on the right.
  const bar = await page.locator('.titlebar').boundingBox();
  await page.mouse.dblclick(Math.round(bar.x + bar.width * 0.3), Math.round(bar.y + bar.height / 2));
  await sleep(1200);
  const afterMax = await state();
  console.log('after dblclick:', JSON.stringify(afterMax));
  console.log('  maximized  :', afterMax.maximized, afterMax.maximized ? '(correct)' : '(FAILED - the gesture did not reach the renderer)');

  // And back down again.
  await page.mouse.dblclick(Math.round(bar.x + bar.width * 0.3), Math.round(bar.y + bar.height / 2));
  await sleep(1200);
  const afterRestore = await state();
  console.log('after 2nd    :', JSON.stringify(afterRestore));
  console.log('  restored   :', !afterRestore.maximized, !afterRestore.maximized ? '(correct)' : '(FAILED)');

  // A double-click on the search box must NOT maximize the window.
  await page.mouse.dblclick(Math.round(bar.x + bar.width * 0.78), Math.round(bar.y + bar.height / 2));
  await sleep(1200);
  const afterSearch = await state();
  console.log('after dblclick on search:', JSON.stringify(afterSearch));
  console.log('  did not maximize:', !afterSearch.maximized, !afterSearch.maximized ? '(correct)' : '(FAILED)');

  console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none');

  const ok = afterMax.maximized && !afterRestore.maximized && !afterSearch.maximized;
  console.log(ok ? '\nPASS: double-click on the title bar toggles maximize' : '\nFAIL');
  await app.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
