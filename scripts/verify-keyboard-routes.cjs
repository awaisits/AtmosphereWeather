// The in-app window buttons are gone, so the keyboard and the operating
// system's own affordances are the remaining ways to control the window.
// This checks the ones a Windows user would actually reach for.
//
// A frameless BrowserWindow does NOT get these for free: with
// `Menu.setApplicationMenu(null)` the system menu is gone, and Win+Up is not
// bound by Electron unless the app binds it. So each of these has to be
// verified rather than assumed.
const { _electron: electron } = require('playwright');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { isolatedArgs } = require('./harness.cjs');

(async () => {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-keyboard-routes'),
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 160)));

  await page.waitForSelector('.titlebar', { timeout: 30_000 });
  await sleep(2500);

  const state = () => app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
    return w ? { maximized: w.isMaximized(), visible: w.isVisible() } : { gone: true };
  });

  const results = {};

  // --- Win+Up should maximize ---------------------------------------------
  await page.keyboard.press('Meta+ArrowUp');
  await sleep(900);
  results.winUp = await state();
  console.log('Win+ArrowUp     ->', JSON.stringify(results.winUp));

  // --- Win+Down should restore -------------------------------------------
  await page.keyboard.press('Meta+ArrowDown');
  await sleep(900);
  results.winDown = await state();
  console.log('Win+ArrowDown   ->', JSON.stringify(results.winDown));

  // Alt+F4 is the operating system's own close gesture. It is a WM_CLOSE to
  // the window, not a DOM key event, so Playwright cannot send it - it is
  // covered by scripts/verify-alt-f4.cjs, which drives a real keystroke.

  console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none');

  const winUpWorked = results.winUp && results.winUp.maximized === true;
  const winDownWorked = results.winDown && results.winDown.maximized === false;
  console.log('');
  console.log('Win+Up maximizes  :', winUpWorked ? 'yes' : 'NO');
  console.log('Win+Down restores :', winDownWorked ? 'yes' : 'NO');

  const ok = winUpWorked && winDownWorked;
  console.log(ok ? '\nPASS' : '\nFAIL');
  try { await app.close(); } catch {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
