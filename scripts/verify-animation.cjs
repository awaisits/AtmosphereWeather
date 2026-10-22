// Verifies the live weather animation end to end.
//
// The background canvas is driven by the *live* forecast (the "Demo scene"
// picker only changes the CSS fallback class), so this harness stubs the
// Open-Meteo endpoints with synthetic conditions and then measures whether
// the canvas actually changes over time.
//
// The app content sits on top of the canvas, so the content layer is hidden
// for the measurement - otherwise only the gaps between panels would show
// the sky and the motion would be masked.
//
// Motion is measured by diffing two real screenshots. The canvas is created
// with `desynchronized: true`, so `getImageData` on it returns stale
// snapshots; a PNG-level diff of what is actually on screen is reliable.
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');

const APP_DIR = path.resolve(__dirname, '..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(APP_DIR, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { isolatedArgs } = require('./harness.cjs');
const HOUR = 3600;

const CONDITIONS = [
  { name: 'clear-day',   code: 0,  isDay: 1, wind: 8,  cloud: 5,  precip: 0,   temp: 24, sun: true },
  { name: 'cloudy-day',  code: 3,  isDay: 1, wind: 12, cloud: 85, precip: 0,   temp: 18, sun: false },
  { name: 'rain',        code: 61, isDay: 1, wind: 18, cloud: 90, precip: 2.5, temp: 15, sun: false },
  { name: 'heavy-rain',  code: 65, isDay: 1, wind: 30, cloud: 95, precip: 8,   temp: 13, sun: false },
  { name: 'showers',     code: 80, isDay: 1, wind: 20, cloud: 70, precip: 1.5, temp: 16, sun: false },
  { name: 'storm',       code: 95, isDay: 1, wind: 45, cloud: 95, precip: 6,   temp: 17, sun: false },
  { name: 'snow',        code: 73, isDay: 1, wind: 15, cloud: 90, precip: 1.2, temp: -4, sun: false },
  { name: 'fog',         code: 45, isDay: 1, wind: 4,  cloud: 90, precip: 0,   temp: 9,  sun: false },
  { name: 'clear-night', code: 0,  isDay: 0, wind: 8,  cloud: 5,  precip: 0,   temp: 11, sun: false },
];

function buildForecast(condition, now) {
  const hours = [], temps = [], codes = [], pop = [], precip = [], wind = [], gust = [], pressure = [], visibility = [], uv = [], dew = [];
  for (let i = 0; i < 168; i++) {
    hours.push(now - 3600 + i * HOUR);
    temps.push(condition.temp + Math.sin(i / 4) * 3);
    codes.push(condition.code);
    pop.push(condition.code >= 51 ? 80 : 10);
    precip.push(condition.precip);
    wind.push(condition.wind);
    gust.push(condition.wind * 1.4);
    pressure.push(1013);
    visibility.push(20000);
    uv.push(condition.isDay ? 4 : 0);
    dew.push(condition.temp - 5);
  }
  const dayStart = Math.floor(now / 86400) * 86400;
  const dailyTime = [], sunrise = [], sunset = [], dmax = [], dmin = [], dcode = [], dpop = [], dprecip = [], dwind = [];
  for (let i = 0; i < 7; i++) {
    dailyTime.push(dayStart + i * 24 * HOUR);
    dmax.push(condition.temp + 4); dmin.push(condition.temp - 4); dcode.push(condition.code);
    dpop.push(condition.code >= 51 ? 80 : 10); dprecip.push(condition.precip * 24); dwind.push(condition.wind);
  }
  // Anchor the solar day to the moment the harness runs, so a "day" fixture
  // really is daytime and a "night" fixture really is after sunset. The
  // canvas reads sunrise/sunset to decide where the sun and moon sit, and
  // the app takes the *next* day's sunrise as the end of tonight.
  if (condition.isDay) {
    // Rose 4 hours ago, sets 8 hours from now: the sun is up and mid-arc.
    for (let i = 0; i < 7; i++) { sunrise.push(now - 4 * HOUR + i * 24 * HOUR); sunset.push(now + 8 * HOUR + i * 24 * HOUR); }
  } else {
    // Set 8 hours ago, next sunrise 4 hours from now: the night is well
    // under way and the moon is high in the sky.
    for (let i = 0; i < 7; i++) { sunrise.push(now - 20 * HOUR + i * 24 * HOUR); sunset.push(now - 8 * HOUR + i * 24 * HOUR); }
    sunrise[1] = now + 4 * HOUR;
  }
  return {
    latitude: 40, longitude: -74, generationtime_ms: 0, utc_offset_seconds: 0,
    timezone: 'UTC', timezone_abbreviation: 'UTC', elevation: 10,
    current: {
      time: now, interval: 900, temperature_2m: condition.temp, apparent_temperature: condition.temp - 1,
      relative_humidity_2m: 70, is_day: condition.isDay, precipitation: condition.precip, weather_code: condition.code,
      cloud_cover: condition.cloud, pressure_msl: 1013, wind_speed_10m: condition.wind, wind_direction_10m: 200,
      wind_gusts_10m: condition.wind * 1.4, visibility: 20000, uv_index: condition.isDay ? 4 : 0, dew_point_2m: condition.temp - 5,
    },
    hourly: { time: hours, temperature_2m: temps, weather_code: codes, precipitation_probability: pop, precipitation: precip, wind_speed_10m: wind, wind_gusts_10m: gust, pressure_msl: pressure, visibility, dew_point_2m: dew, uv_index: uv },
    daily: { time: dailyTime, weather_code: dcode, temperature_2m_max: dmax, temperature_2m_min: dmin, precipitation_probability_max: dpop, precipitation_sum: dprecip, wind_speed_10m_max: dwind, sunrise, sunset },
  };
}

const AIR = {
  latitude: 40, longitude: -74, utc_offset_seconds: 0, timezone: 'UTC',
  current: { time: Math.floor(Date.now() / 1000), european_aqi: 32, us_aqi: 68, pm2_5: 8.4, pm10: 14.2, ozone: 90, nitrogen_dioxide: 12, uv_index: 4, alder_pollen: 2, birch_pollen: 1, grass_pollen: 5, mugwort_pollen: 0, olive_pollen: 0, ragweed_pollen: 1 },
  hourly: { time: [], uv_index: [], alder_pollen: [], birch_pollen: [], grass_pollen: [], mugwort_pollen: [], olive_pollen: [], ragweed_pollen: [] },
};

const GEO = { results: [{ id: 1, name: 'Testville', admin1: 'Teststate', country: 'United States', latitude: 40, longitude: -74, timezone: 'UTC' }] };

// ---- PNG decode + diff (no external image dependency) ----
function decodePng(buf) {
  let pos = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1;
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0, v = line[x];
      cur[x] = f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1)
        : f === 4 ? v + (() => { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); })() : v;
    }
  }
  return { w, h, ch, data: out };
}

function diff(a, b) {
  const A = decodePng(a), B = decodePng(b);
  if (A.w !== B.w || A.h !== B.h) return { error: 'size mismatch' };
  let moved = 0, sum = 0, bright = 0, sunPx = 0;
  const n = A.w * A.h;
  for (let i = 0; i < A.data.length; i += A.ch) {
    const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
    sum += d;
    if (d > 8) moved++;
    bright += (A.data[i] + A.data[i + 1] + A.data[i + 2]) / 3;
    // A sun disc is warm and bright: high red with red clearly above blue.
    // Nothing else in the scene is warm, so any such pixel is the sun.
    const r = A.data[i], g = A.data[i + 1], bl = A.data[i + 2];
    if (r > 200 && g > 120 && g < 220 && r - bl > 55) sunPx++;
  }
  return { movedPct: (moved / n) * 100, meanDelta: sum / n, brightness: bright / n, sunPx, w: A.w, h: A.h };
}

(async () => {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-animation'),
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 160)));

  let condition = CONDITIONS[0];
  const now = Math.floor(Date.now() / 1000);
  await page.route('**/geocoding-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GEO) }));
  await page.route('**/air-quality-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AIR) }));
  await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildForecast(condition, now)) }));

  await page.waitForSelector('.app', { timeout: 30_000 });
  await sleep(3000);

  // Turn the animation on through the real Settings UI.
  await page.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes('Settings'))?.click());
  await sleep(800);
  const switches = await page.evaluate(() => {
    const out = [];
    for (const input of document.querySelectorAll('.settings-sheet input.switch')) {
      const l = input.getAttribute('aria-label');
      if (l === 'Reduce motion' && input.checked) input.click();
      if (l === 'Weather animation' && !input.checked) input.click();
      out.push(l + '=' + (input.checked ? 'on' : 'off'));
    }
    return out;
  });
  console.log('switches:', switches.join(', '));
  await sleep(400);
  await page.evaluate(() => document.querySelector('.modal-close')?.click());
  await sleep(800);

  // Pick the place through the real search UI.
  await page.evaluate(() => {
    const input = document.querySelector('.search-wrap input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Testville');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(2000);
  await page.evaluate(() => document.querySelector('.search-results button')?.click());
  await sleep(4000);

  const hero = await page.evaluate(() => document.querySelector('.hero-temp')?.textContent || document.querySelector('.content')?.innerText?.slice(0, 60) || '?');
  console.log('hero after selecting place:', JSON.stringify(hero));

  // Hide the content layer so the sky is fully visible for the measurement.
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = 'harness-hide-content';
    style.textContent = '.titlebar, .main-content, .sidebar { visibility: hidden !important; }';
    document.head.appendChild(style);
  });
  await sleep(1000);

  console.log('\ncondition        scene class     moved%   meanΔ   bright   sun  verdict');
  console.log('-'.repeat(78));

  const results = [];
  for (const c of CONDITIONS) {
    condition = c;
    await page.evaluate(() => document.querySelector('button[aria-label="Refresh weather"]')?.click());
    await sleep(4000);

    const appClass = await page.evaluate(() => document.querySelector('.app')?.className || '');
    const sceneClass = (appClass.match(/scene-([a-z-]+)/) || [])[1] || '?';
    const canvasPresent = await page.evaluate(() => !!document.querySelector('canvas.weather-canvas'));
    const diag = await page.evaluate(() => ({
      vis: document.visibilityState,
      canvasRect: (() => { const c = document.querySelector('canvas.weather-canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top)]; })(),
      settingsOpen: !!document.querySelector('.settings-sheet'),
      appCls: document.querySelector('.app')?.className,
    }));

    const s1 = await page.screenshot();
    await sleep(2500);
    const s2 = await page.screenshot();
    const d = diff(s1, s2);
    if (d.error) { console.log(`${c.name.padEnd(16)} ${d.error}`); results.push({ name: c.name, ok: false }); continue; }

    const shot = path.join(SHOT_DIR, `sky-${c.name}.png`);
    fs.writeFileSync(shot, s2);

    const animating = d.movedPct > 0.05 && d.meanDelta > 0.05;
    // The sun is only allowed to be on screen when the sky is genuinely
    // clear. A sun disc over a shower or a fog bank is a rendering bug, so
    // it is checked here rather than left to the eye.
    const sunOk = c.sun ? d.sunPx > 200 : d.sunPx < 200;
    const ok = animating && sunOk && canvasPresent;
    results.push({ name: c.name, ok, animating, sunOk, sceneClass, canvasPresent, movedPct: +d.movedPct.toFixed(2), meanDelta: +d.meanDelta.toFixed(3), brightness: +d.brightness.toFixed(1), sunPx: d.sunPx, shot });

    const verdicts = [];
    if (!animating) verdicts.push('STATIC');
    if (!sunOk) verdicts.push(c.sun ? 'SUN MISSING' : 'SUN SHOULD BE HIDDEN');
    if (!canvasPresent) verdicts.push('NO CANVAS');

    console.log(
      `${c.name.padEnd(16)} ${String(sceneClass).padEnd(15)} ` +
      `${d.movedPct.toFixed(2).padStart(6)}% ${d.meanDelta.toFixed(3).padStart(7)} ${d.brightness.toFixed(1).padStart(7)} ` +
      `${String(d.sunPx).padStart(6)}  ${verdicts.length ? verdicts.join(', ') : 'OK'}`
    );
    if (verdicts.length) console.log('    diag:', JSON.stringify(diag));
  }

  console.log('\npage errors:', errors.length ? errors.slice(0, 6) : 'none');
  const failed = results.filter((r) => !r.ok);
  const animated = results.filter((r) => r.animating).length;
  console.log(`\n${animated}/${results.length} conditions animating, ${results.length - failed.length}/${results.length} passing all checks`);
  if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join(', '));
  console.log('screenshots:', SHOT_DIR);

  await app.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
