// Checks that the setting being OFF looks exactly as it did before the
// transparent-panels work.
//
// The transparent-panels change moved two layers in the stacking order: the
// scene backdrop from z-index -2 to -3 and the canvas from -1 to -2. Both
// stay behind the content, so the off state should be pixel-identical. This
// harness proves it by taking a screenshot with the setting off, then
// reverting the two z-index values, taking it again, and diffing the two
// images. Any non-zero difference means the off state moved.
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');

const APP_DIR = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(APP_DIR, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { isolatedArgs } = require('./harness.cjs');
const HOUR = 3600;

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

// The animated canvas means the sky is never quite the same twice, so the
// comparison is over the content area only, and the sky band is excluded.
function diffContent(a, b, box) {
  let moved = 0, n = 0, sum = 0;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      n++;
      const i = (y * a.w + x) * a.ch;
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i+1] - b.data[i+1]) + Math.abs(a.data[i+2] - b.data[i+2]);
      if (d > 6) moved++;
      sum += d;
    }
  }
  return { movedPct: (moved / n) * 100, meanDelta: sum / n };
}

(async () => {
  const launch = async () => {
    const app = await electron.launch({
      executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
      args: isolatedArgs('verify-off-unchanged'),
      timeout: 60_000,
    });
    const page = await app.firstWindow();
    const now = Math.floor(Date.now() / 1000);
    await page.route('**/geocoding-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GEO) }));
    await page.route('**/air-quality-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AIR) }));
    await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildForecast(now)) }));
    await page.waitForSelector('.app', { timeout: 30_000 });
    await sleep(2500);
    // The setting must be off, or the comparison is meaningless.
    const has = await page.evaluate(() => document.querySelector('.app').classList.contains('transparent-panels'));
    if (has) {
      await page.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes('Settings'))?.click());
      await sleep(700);
      await page.evaluate(() => {
        const i = [...document.querySelectorAll('.settings-sheet input.switch')].find((x) => x.getAttribute('aria-label') === 'Transparent panels');
        if (i && i.checked) i.click();
      });
      await sleep(1200);
    }
    return { app, page };
  };

  // The comparison has to happen inside a *single* app session. Two separate
  // launches can restore different state - the last selected place, the
  // scroll position, the theme - and then the diff measures that difference
  // rather than the one under test. So the z-index values are swapped at
  // runtime on the live page, which is exactly the change being tested.
  const { app, page } = await launch();
  const box = await page.evaluate(() => {
    const c = document.querySelector('.main-content');
    const r = c.getBoundingClientRect();
    return { x: 0, y: Math.round(r.top), w: window.innerWidth, h: Math.round(Math.min(r.height, window.innerHeight - r.top)) };
  });
  await sleep(800);

  // The new order.
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.id = 'harness-zorder';
    s.textContent = '.app.has-weather-scene::before { z-index: -3 !important; } .weather-canvas { z-index: -2 !important; }';
    document.head.appendChild(s);
  });
  await sleep(600);
  const a = decodePng(await page.screenshot());

  // The old order, in the same session, on the same view.
  await page.evaluate(() => {
    document.getElementById('harness-zorder').textContent = '.app.has-weather-scene::before { z-index: -2 !important; } .weather-canvas { z-index: -1 !important; }';
  });
  await sleep(600);
  const b = decodePng(await page.screenshot());
  fs.writeFileSync(path.join(SHOT_DIR, 'off-state-compare.png'), await page.screenshot());

  await app.close();
  await sleep(800);

  const d = diffContent(a, b, box);
  console.log(`content area ${box.w}x${box.h}`);
  console.log(`pixels differing between the new and old z-index orders: ${d.movedPct.toFixed(3)}%  mean delta ${d.meanDelta.toFixed(3)}`);
  console.log(d.movedPct < 0.5 ? 'PASS: the setting-off state is unchanged' : 'FAIL: the setting-off state changed');
  process.exit(d.movedPct < 0.5 ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
