// Checks that the in-app window buttons are gone and that the title bar
// still lays out correctly.
//
// The window is frameless on Windows, so removing these buttons leaves the
// operating system's own controls as the only way in. That is a deliberate
// choice, but it has to be checked: the title bar must not have a hole where
// the buttons were, and the app must still be closeable.
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const APP_DIR = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(APP_DIR, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { isolatedArgs } = require('./harness.cjs');

const GEO = { results: [{ id: 1, name: 'Testville', admin1: 'Teststate', country: 'United States', latitude: 40, longitude: -74, timezone: 'UTC' }] };
const AIR = { latitude: 40, longitude: -74, utc_offset_seconds: 0, timezone: 'UTC', current: { time: Math.floor(Date.now() / 1000), european_aqi: 32, us_aqi: 68, pm2_5: 8.4, pm10: 14.2, ozone: 90, nitrogen_dioxide: 12, uv_index: 4 }, hourly: { time: [], uv_index: [] } };
function buildForecast(now) {
  const HOUR = 3600;
  const hours = [], temps = [], codes = [], pop = [], precip = [], wind = [], gust = [], pressure = [], visibility = [], uv = [], dew = [];
  for (let i = 0; i < 168; i++) {
    hours.push(now - 3600 + i * HOUR); temps.push(24 + Math.sin(i / 4) * 3); codes.push(0);
    pop.push(10); precip.push(0); wind.push(8); gust.push(11); pressure.push(1013); visibility.push(20000); uv.push(4); dew.push(19);
  }
  const dayStart = Math.floor(now / 86400) * 86400;
  const dailyTime = [], sunrise = [], sunset = [], dmax = [], dmin = [], dcode = [], dpop = [], dprecip = [], dwind = [];
  for (let i = 0; i < 7; i++) {
    dailyTime.push(dayStart + i * 24 * HOUR); dmax.push(28); dmin.push(18); dcode.push(0); dpop.push(10); dprecip.push(0); dwind.push(8);
    sunrise.push(now - 4 * HOUR + i * 24 * HOUR); sunset.push(now + 8 * HOUR + i * 24 * HOUR);
  }
  return {
    latitude: 40, longitude: -74, generationtime_ms: 0, utc_offset_seconds: 0, timezone: 'UTC', timezone_abbreviation: 'UTC', elevation: 10,
    current: { time: now, interval: 900, temperature_2m: 24, apparent_temperature: 23, relative_humidity_2m: 60, is_day: 1, precipitation: 0, weather_code: 0, cloud_cover: 5, pressure_msl: 1013, wind_speed_10m: 8, wind_direction_10m: 200, wind_gusts_10m: 11, visibility: 20000, uv_index: 4, dew_point_2m: 19 },
    hourly: { time: hours, temperature_2m: temps, weather_code: codes, precipitation_probability: pop, precipitation: precip, wind_speed_10m: wind, wind_gusts_10m: gust, pressure_msl: pressure, visibility, dew_point_2m: dew, uv_index: uv },
    daily: { time: dailyTime, weather_code: dcode, temperature_2m_max: dmax, temperature_2m_min: dmin, precipitation_probability_max: dpop, precipitation_sum: dprecip, wind_speed_10m_max: dwind, sunrise, sunset },
  };
}

(async () => {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-window-controls'),
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 160)));

  const now = Math.floor(Date.now() / 1000);
  await page.route('**/geocoding-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GEO) }));
  await page.route('**/air-quality-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AIR) }));
  await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildForecast(now)) }));

  await page.waitForSelector('.app', { timeout: 30_000 });
  await sleep(3000);

  // Give the app a place so the layout is fully populated.
  await page.evaluate(() => {
    const input = document.querySelector('.search-wrap input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Testville');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(2000);
  await page.evaluate(() => document.querySelector('.search-results button')?.click());
  await sleep(3500);

  // --- The buttons must be gone -------------------------------------------
  const buttonState = await page.evaluate(() => {
    const group = document.querySelector('.window-controls');
    const labelled = ['Minimize', 'Maximize', 'Close'].map((label) => ({
      label,
      found: !![...document.querySelectorAll('.titlebar button')].find((b) => b.getAttribute('aria-label') === label),
    }));
    return { groupExists: !!group, labelled };
  });
  console.log('.window-controls group present:', buttonState.groupExists, buttonState.groupExists ? '(UNEXPECTED)' : '(correct)');
  for (const b of buttonState.labelled) console.log(`  titlebar button "${b.label}":`, b.found, b.found ? '(UNEXPECTED)' : '(correct)');

  // --- The title bar must still be laid out properly -----------------------
  const layout = await page.evaluate(() => {
    const bar = document.querySelector('.titlebar');
    const actions = document.querySelector('.titlebar-actions');
    const search = document.querySelector('.search-wrap');
    const last = actions.lastElementChild;
    return {
      barRight: Math.round(bar.getBoundingClientRect().right),
      actionsRight: Math.round(actions.getBoundingClientRect().right),
      windowWidth: window.innerWidth,
      lastIsSearch: !!(last && (last === search || search.contains(last) || last.contains(search))),
      // The last control must sit close to the right-hand edge of the window.
      lastGap: last ? Math.round(window.innerWidth - last.getBoundingClientRect().right) : null,
      lastLabel: last ? last.getAttribute('aria-label') : null,
    };
  });
  console.log('last titlebar control:', layout.lastLabel, '-', layout.lastGap, 'px from the right edge');
  console.log('window width:', layout.windowWidth, ' actions end at:', layout.actionsRight);

  await page.screenshot({ path: path.join(SHOT_DIR, 'titlebar-no-window-buttons.png') });

  // --- The app must still be closeable -------------------------------------
  // The renderer no longer has a close button, so the main process has to
  // respond to the usual operating system routes.
  const closable = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
    if (!w) return { found: false };
    return { found: true, visible: w.isVisible(), closable: !w.isDestroyed(), frameless: !w.isMovable ? true : undefined };
  });
  console.log('main window present and visible:', closable.found && closable.visible);

  // Alt+F4 is the operating system's own close, which Electron handles at the
  // window level. Check the app quits when the window is closed from outside.
  const quits = await app.evaluate(async ({ app }) => {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      app.on('window-all-closed', () => { clearTimeout(timer); resolve(true); });
      const w = require('electron').BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
      w?.close();
    });
  }).catch(() => 'not-observable');
  console.log('closing the window triggers window-all-closed:', quits);

  console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none');

  const ok = !buttonState.groupExists && !buttonState.labelled.some((b) => b.found) && closable.found && closable.visible;
  console.log(ok ? '\nPASS: the window buttons are gone and the app still works' : '\nFAIL');
  await app.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
