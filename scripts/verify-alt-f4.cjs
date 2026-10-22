// Alt+F4 is the operating system's own close gesture. Playwright cannot send
// it - it is a WM_CLOSE to the window, not a DOM key event - so this drives
// the real window with a real keystroke through PowerShell's SendKeys.
//
// The concern is real: a frameless window with `Menu.setApplicationMenu(null)`
// has no system menu, and Alt+F4 has to still work, because it is now the
// primary way to close the app.
//
// The signal is the app process exiting, not the window closing: the window
// is destroyed as part of the quit, so the renderer is gone by the time we
// look. A still-running app after Alt+F4 would mean the gesture did nothing.
const { _electron: electron } = require('playwright');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const APP_DIR = path.resolve(__dirname, '..');
const { isolatedArgs } = require('./harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sends Alt+F4 to the focused window.
function sendAltF4() {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$wsh = New-Object -ComObject WScript.Shell
$null = $wsh.AppActivate($PID)
Start-Sleep -Milliseconds 400
$wsh.SendKeys('%{F4}')
`;
  return spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 20_000 });
}

// Polls until the app process is gone, or the timeout expires.
async function waitForExit(app, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await app.evaluate(async ({ app: a }) => a.getAppPath());
    } catch {
      return true; // the main process is no longer reachable: it quit
    }
    await sleep(500);
  }
  return false;
}

(async () => {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-alt-f4'),
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.titlebar', { timeout: 30_000 });
  await sleep(2500);

  const alive = await app.evaluate(async ({ app: a }) => { a.getAppPath(); return true; });
  console.log('app running before Alt+F4:', alive);

  const result = sendAltF4();
  if (result.error) console.log('SendKeys error:', result.error.message);
  else if (result.stdout && result.stdout.trim()) console.log('SendKeys output:', result.stdout.trim());

  const exited = await waitForExit(app, 8000);
  console.log('app exited after Alt+F4  :', exited);

  console.log(exited ? '\nPASS: Alt+F4 closes the app' : '\nFAIL: Alt+F4 did not close the app');
  try { await app.close(); } catch {}
  process.exit(exited ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
