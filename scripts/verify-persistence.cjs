// Checks that the "Transparent panels" setting survives a restart.
//
// The main process validates every persisted key through sanitizeSettings(),
// which drops anything it does not recognise. A setting that is not added to
// that allowlist silently resets to its default on the next launch, so this
// has to be tested by actually restarting the app - reading the stored file
// is not enough.
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const APP_DIR = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { isolatedArgs, harnessUserData } = require('./harness.cjs');

const GEO = { results: [{ id: 1, name: 'Testville', admin1: 'Teststate', country: 'United States', latitude: 40, longitude: -74, timezone: 'UTC' }] };
const AIR = { latitude: 40, longitude: -74, utc_offset_seconds: 0, timezone: 'UTC', current: { time: Math.floor(Date.now() / 1000), european_aqi: 32, us_aqi: 68, pm2_5: 8.4, pm10: 14.2, ozone: 90, nitrogen_dioxide: 12, uv_index: 4 }, hourly: { time: [], uv_index: [] } };
function buildForecast(now) {
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
const HOUR = 3600;

async function launch() {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-persistence', { keep: true }),
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  const now = Math.floor(Date.now() / 1000);
  await page.route('**/geocoding-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GEO) }));
  await page.route('**/air-quality-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AIR) }));
  await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildForecast(now)) }));
  await page.waitForSelector('.app', { timeout: 30_000 });
  await sleep(2500);
  return { app, page };
}

const switchState = (page, label) => page.evaluate((l) => {
  const input = [...document.querySelectorAll('.settings-sheet input.switch')].find((i) => i.getAttribute('aria-label') === l);
  return input ? input.checked : null;
}, label);

const appHasClass = (page, cls) => page.evaluate((c) => document.querySelector('.app').classList.contains(c), cls);

(async () => {
  // Start from a clean directory, so the first run is a genuine first run.
  fs.rmSync(harnessUserData('verify-persistence'), { recursive: true, force: true });

  // --- First run: turn the setting on -------------------------------------
  let { app, page } = await launch();
  await page.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes('Settings'))?.click());
  await sleep(700);
  const before = await switchState(page, 'Transparent panels');
  await page.evaluate(() => {
    const input = [...document.querySelectorAll('.settings-sheet input.switch')].find((i) => i.getAttribute('aria-label') === 'Transparent panels');
    if (input && !input.checked) input.click();
  });
  await sleep(600);
  const after = await switchState(page, 'Transparent panels');
  const clsBefore = await appHasClass(page, 'transparent-panels');
  console.log(`run 1: switch before=${before} after=${after}   .app has transparent-panels: ${clsBefore}`);
  await sleep(1500); // let the preference be written to disk
  await app.close();
  await sleep(2000);

  // --- Second run: the setting must still be on ---------------------------
  ({ app, page } = await launch());
  await page.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes('Settings'))?.click());
  await sleep(900);
  const persisted = await switchState(page, 'Transparent panels');
  const clsAfter = await appHasClass(page, 'transparent-panels');
  console.log(`run 2: switch=${persisted}   .app has transparent-panels: ${clsAfter}`);

  const ok = persisted === true && clsAfter === true;
  console.log(ok ? '\nPASS: the setting survived the restart' : '\nFAIL: the setting did not survive the restart');

  // --- Third run: turn it off and confirm the default comes back ----------
  await page.evaluate(() => {
    const input = [...document.querySelectorAll('.settings-sheet input.switch')].find((i) => i.getAttribute('aria-label') === 'Transparent panels');
    if (input && input.checked) input.click();
  });
  await sleep(1200);
  await app.close();
  await sleep(2000);

  ({ app, page } = await launch());
  await page.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes('Settings'))?.click());
  await sleep(900);
  const offPersisted = await switchState(page, 'Transparent panels');
  const offCls = await appHasClass(page, 'transparent-panels');
  console.log(`run 3: switch=${offPersisted}   .app has transparent-panels: ${offCls}`);
  const okOff = offPersisted === false && offCls === false;
  console.log(okOff ? 'PASS: turning it off is persisted too' : 'FAIL: turning it off was not persisted');

  await app.close();
  process.exit(ok && okOff ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
