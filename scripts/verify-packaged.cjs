// Runs the transparent-panels check against the *packaged* app, not the dev
// server.
//
// The packaged build sets the EnableNodeCliInspectArguments fuse, so
// Playwright's _electron.launch() cannot attach to it - it needs the Node
// inspector, which the fuse deliberately removes. Chromium's own
// --remote-debugging-port is a different switch and is not fused, so the
// packaged app is driven over the DevTools protocol instead.
//
// The rest of the check is the same as verify-transparent-panels.cjs: the
// setting is toggled through the real Settings UI, and the sky is measured
// both through the panels and behind them.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const APP_DIR = path.resolve(__dirname, '..');
const EXE = path.join(APP_DIR, 'release/win-unpacked/Atmosphere Weather.exe');
const SHOT_DIR = path.join(APP_DIR, 'shots');
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { isolatedArgs, harnessUserData } = require('./harness.cjs');
const HOUR = 3600;

if (!fs.existsSync(EXE)) {
  console.log(`SKIP: ${EXE} does not exist. Run "npm run dist:win" first.`);
  process.exit(0);
}

const GEO = { results: [{ id: 1, name: 'Testville', admin1: 'Teststate', country: 'United States', latitude: 40, longitude: -74, timezone: 'UTC' }] };
const AIR = { latitude: 40, longitude: -74, utc_offset_seconds: 0, timezone: 'UTC', current: { time: Math.floor(Date.now() / 1000), european_aqi: 32, us_aqi: 68, pm2_5: 8.4, pm10: 14.2, ozone: 90, nitrogen_dioxide: 12, uv_index: 4 }, hourly: { time: [], uv_index: [] } };
// A rainy scene, not a clear one. A clear day barely moves - the sun is
// nearly static and there is nothing else in the sky - so it makes a poor
// motion target. Rain is unmistakable and moves fast.
function buildForecast(now) {
  const hours = [], temps = [], codes = [], pop = [], precip = [], wind = [], gust = [], pressure = [], visibility = [], uv = [], dew = [];
  for (let i = 0; i < 168; i++) {
    hours.push(now - 3600 + i * HOUR); temps.push(15 + Math.sin(i / 4) * 3); codes.push(61);
    pop.push(80); precip.push(2.5); wind.push(18); gust.push(25); pressure.push(1013); visibility.push(20000); uv.push(2); dew.push(12);
  }
  const dayStart = Math.floor(now / 86400) * 86400;
  const dailyTime = [], sunrise = [], sunset = [], dmax = [], dmin = [], dcode = [], dpop = [], dprecip = [], dwind = [];
  for (let i = 0; i < 7; i++) {
    dailyTime.push(dayStart + i * 24 * HOUR); dmax.push(19); dmin.push(11); dcode.push(61); dpop.push(80); dprecip.push(2.5 * 24); dwind.push(18);
    sunrise.push(now - 4 * HOUR + i * 24 * HOUR); sunset.push(now + 8 * HOUR + i * 24 * HOUR);
  }
  return {
    latitude: 40, longitude: -74, generationtime_ms: 0, utc_offset_seconds: 0, timezone: 'UTC', timezone_abbreviation: 'UTC', elevation: 10,
    current: { time: now, interval: 900, temperature_2m: 15, apparent_temperature: 14, relative_humidity_2m: 85, is_day: 1, precipitation: 2.5, weather_code: 61, cloud_cover: 90, pressure_msl: 1013, wind_speed_10m: 18, wind_direction_10m: 200, wind_gusts_10m: 25, visibility: 20000, uv_index: 2, dew_point_2m: 12 },
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

const movedPct = (a, b) => {
  let moved = 0;
  for (let i = 0; i < a.data.length; i += a.ch) {
    if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i+1] - b.data[i+1]) + Math.abs(a.data[i+2] - b.data[i+2]) > 8) moved++;
  }
  return (moved / (a.w * a.h)) * 100;
};
function changedInBox(a, b, box) {
  let moved = 0, n = 0;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      n++;
      const i = (y * a.w + x) * a.ch;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i+1] - b.data[i+1]) + Math.abs(a.data[i+2] - b.data[i+2]) > 8) moved++;
    }
  }
  return n ? (moved / n) * 100 : 0;
}
const correlate = (a, b) => {
  const n = Math.min(a.length, b.length);
  if (n < 4) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da < 1e-6 || db < 1e-6 ? 0 : num / Math.sqrt(da * db);
};

(async () => {
  // Isolate the packaged app from the user's real settings, the same way the
  // other harnesses do.
  const userData = harnessUserData('verify-packaged');
  fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(userData, { recursive: true });
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, '--no-sandbox', `--user-data-dir=${userData}`], { stdio: 'ignore', detached: false });
  await sleep(6000);

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  } catch (e) {
    console.log('could not connect over CDP:', String(e.message).split('\n')[0]);
    child.kill();
    process.exit(2);
  }

  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => p.url().includes('atmosphere://')) || ctx.pages()[0];
  if (!page) { console.log('no page found'); child.kill(); process.exit(2); }
  console.log('attached to:', page.url());

  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 160)));

  const now = Math.floor(Date.now() / 1000);
  await page.route('**/geocoding-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GEO) }));
  await page.route('**/air-quality-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AIR) }));
  await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildForecast(now)) }));

  await page.waitForSelector('.app', { timeout: 30_000 });
  await sleep(3000);

  // --- The in-app window buttons must not be in the packaged build either ---
  const chrome = await page.evaluate(() => ({
    group: !!document.querySelector('.window-controls'),
    buttons: ['Minimize', 'Maximize', 'Close'].filter((label) =>
      [...document.querySelectorAll('.titlebar button')].some((b) => b.getAttribute('aria-label') === label)),
  }));
  console.log('packaged title bar buttons:', chrome.buttons.length ? chrome.buttons.join(', ') : 'none', chrome.group ? '(+ stray .window-controls group)' : '');
  const chromeClean = chrome.buttons.length === 0 && !chrome.group;

  const setSwitch = async (label, on) => {
    await page.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes('Settings'))?.click());
    await sleep(700);
    const found = await page.evaluate(([l, want]) => {
      const i = [...document.querySelectorAll('.settings-sheet input.switch')].find((x) => x.getAttribute('aria-label') === l);
      if (!i) return false;
      if (i.checked !== want) i.click();
      return true;
    }, [label, on]);
    if (!found) throw new Error('switch not found: ' + label);
    await sleep(300);
    await page.evaluate(() => document.querySelector('.modal-close')?.click());
    await sleep(700);
  };

  await setSwitch('Weather animation', true);
  await setSwitch('Reduce motion', false);
  await setSwitch('High contrast', false);
  await setSwitch('Transparent panels', false);

  await page.evaluate(() => {
    const input = document.querySelector('.search-wrap input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Testville');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(2000);
  await page.evaluate(() => document.querySelector('.search-results button')?.click());
  await sleep(4000);

  const hasClass = await page.evaluate(() => document.querySelector('.app').classList.contains('transparent-panels'));
  console.log('setting off -> .app has transparent-panels:', hasClass, hasClass ? '(UNEXPECTED)' : '(correct)');

  await setSwitch('Transparent panels', true);
  await sleep(1500);
  const hasClassOn = await page.evaluate(() => document.querySelector('.app').classList.contains('transparent-panels'));
  console.log('setting on  -> .app has transparent-panels:', hasClassOn, hasClassOn ? '(correct)' : '(MISSING)');

  // The setting switch itself must exist in the packaged Settings sheet.
  const switchExists = await page.evaluate(() => {
    const i = [...document.querySelectorAll('.settings-sheet input.switch')].find((x) => x.getAttribute('aria-label') === 'Transparent panels');
    return !!i;
  });
  console.log('"Transparent panels" switch present in Settings:', switchExists);

  const box = await page.evaluate(() => {
    const s = document.querySelector('.hero');
    s.scrollIntoView({ block: 'center' });
    const r = s.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: Math.min(r.height, 240) };
  });
  await sleep(800);
  const shot = async () => decodePng(await page.screenshot());
  const on = await shot();
  const scale = on.w / await page.evaluate(() => window.innerWidth);
  const imgBox = { x: Math.round(box.x * scale), y: Math.round(box.y * scale), w: Math.round(box.w * scale), h: Math.round(box.h * scale) };
  imgBox.x = Math.max(0, Math.min(imgBox.x, on.w - 4));
  imgBox.y = Math.max(0, Math.min(imgBox.y, on.h - 4));
  imgBox.w = Math.max(4, Math.min(imgBox.w, on.w - imgBox.x));
  imgBox.h = Math.max(4, Math.min(imgBox.h, on.h - imgBox.y));

  const hideContent = () => page.evaluate(() => {
    const st = document.createElement('style');
    st.id = 'harness-hide';
    st.textContent = '.titlebar, .main-content, .sidebar { visibility: hidden !important; }';
    document.head.appendChild(st);
  });
  const showContent = () => page.evaluate(() => document.getElementById('harness-hide')?.remove());

  await hideContent();
  await sleep(800);
  const a1 = await shot();
  await sleep(2500);
  const a2 = await shot();
  await showContent();
  await sleep(400);
  const mp = movedPct(a1, a2);
  console.log(`sky animating behind the panels: ${mp.toFixed(2)}% ${mp > 0.05 ? '(ANIMATING)' : '(STATIC)'}`);

  // The sky's structure must show through the glass. The bare sky is the
  // reference; the panel's own rows are compared against it.
  const lum = (img, x, y) => { const i = (y * img.w + x) * img.ch; return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]; };
  const rowProfile = (img) => {
    const rows = [];
    for (let y = imgBox.y; y < imgBox.y + imgBox.h; y++) {
      let s = 0, n = 0;
      for (let x = imgBox.x; x < imgBox.x + imgBox.w; x++) { s += lum(img, x, y); n++; }
      rows.push(n ? s / n : 0);
    }
    return rows;
  };
  await hideContent();
  await sleep(700);
  const sky = await shot();
  await showContent();
  await sleep(400);
  const corr = Math.abs(correlate(rowProfile(sky), rowProfile(on)));
  console.log(`sky profile correlation through the panel: ${corr.toFixed(3)} ${corr > 0.3 ? '(SKY VISIBLE)' : '(NOT VISIBLE)'}`);

  fs.writeFileSync(path.join(SHOT_DIR, 'packaged-transparent-panels.png'), await page.screenshot());

  console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none');
  const ok = hasClassOn && !hasClass && switchExists && mp > 0.05 && corr > 0.3 && chromeClean;
  console.log(ok ? '\nPASS: the packaged app has the transparent panels feature working, and no in-app window buttons' : '\nFAIL');
  try { await browser.close(); } catch {}
  child.kill();
  await sleep(1000);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
