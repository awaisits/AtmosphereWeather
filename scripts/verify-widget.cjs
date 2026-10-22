// Verifies the desktop widget's rendering.
//
// The widget is a separate frameless, transparent, always-on-top window, so
// none of the main app's checks apply to it. These are the specific things
// that were broken:
//
//   1. The window was not actually transparent. `body` painted an opaque
//      background, which filled the window with a solid rectangle and
//      defeated the rounded corners. The check is on the ALPHA CHANNEL, so
//      the screenshot has to be taken with `omitBackground: true` - a plain
//      screenshot composites over an opaque backdrop and cannot see the bug.
//   2. The theme was ignored - every colour was hardcoded, so the light theme
//      left dark text on a dark card.
//   3. The live weather scene was missing entirely.
//   4. The opacity and size settings did nothing, because the widget never
//      re-read its preferences.
//
// The checks measure pixels, not computed styles, because the bug was exactly
// that the computed styles disagreed with what was painted.
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');

const APP_DIR = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(APP_DIR, 'shots');
const { isolatedArgs, harnessUserData } = require('./harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GEO = { results: [{ id: 1, name: 'Testville', admin1: 'Teststate', country: 'United States', latitude: 40, longitude: -74, timezone: 'UTC' }] };
const AIR = { latitude: 40, longitude: -74, utc_offset_seconds: 0, timezone: 'UTC', current: { time: Math.floor(Date.now() / 1000), european_aqi: 32, us_aqi: 68, pm2_5: 8.4, pm10: 14.2, ozone: 90, nitrogen_dioxide: 12, uv_index: 4 }, hourly: { time: [], uv_index: [] } };
let forecastTemp = 24;
function buildForecast(now) {
  const HOUR = 3600;
  const hours = [], temps = [], codes = [], pop = [], precip = [], wind = [], gust = [], pressure = [], visibility = [], uv = [], dew = [];
  for (let i = 0; i < 168; i++) {
    hours.push(now - 3600 + i * HOUR); temps.push(forecastTemp + Math.sin(i / 4) * 3); codes.push(0);
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
    current: { time: now, interval: 900, temperature_2m: forecastTemp, apparent_temperature: forecastTemp - 1, relative_humidity_2m: 60, is_day: 1, precipitation: 0, weather_code: 0, cloud_cover: 5, pressure_msl: 1013, wind_speed_10m: 8, wind_direction_10m: 200, wind_gusts_10m: 11, visibility: 20000, uv_index: 4, dew_point_2m: 19 },
    hourly: { time: hours, temperature_2m: temps, weather_code: codes, precipitation_probability: pop, precipitation: precip, wind_speed_10m: wind, wind_gusts_10m: gust, pressure_msl: pressure, visibility, dew_point_2m: dew, uv_index: uv },
    daily: { time: dailyTime, weather_code: dcode, temperature_2m_max: dmax, temperature_2m_min: dmin, precipitation_probability_max: dpop, precipitation_sum: dprecip, wind_speed_10m_max: dwind, sunrise, sunset },
  };
}

// --- minimal PNG reader (8-bit, non-interlaced) ---------------------------
function readPng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (bitDepth !== 8 || !channels) throw new Error(`unsupported png ${bitDepth}/${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride); rp += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}
const px = (img, x, y) => {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.channels === 4 ? img.data[i + 3] : 255];
};
const relLuminance = ([r, g, b]) => {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const l1 = relLuminance(a), l2 = relLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const med = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
// Core glyph pixels in a region: those that differ most from the background.
function coreGlyphContrast(textImg, bgImg, x0, y0, x1, y1) {
  const diffs = [], bgs = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (x < 0 || y < 0 || x >= textImg.width || y >= textImg.height) continue;
      const pa = px(textImg, x, y), pb = px(bgImg, x, y);
      if (pa[3] < 200) continue;
      const d = Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]);
      diffs.push({ d, pa, pb });
      bgs.push(pb);
    }
  }
  if (!diffs.length) return 0;
  const maxD = Math.max(...diffs.map((v) => v.d));
  const core = diffs.filter((v) => v.d >= maxD * 0.6);
  const fg = med(core.map((v) => v.pa));
  const bg = med(bgs);
  return contrast(fg, bg);
}

function analyseTransparency(file) {
  const img = readPng(file);
  const corners = [[2, 2], [img.width - 3, 2], [2, img.height - 3], [img.width - 3, img.height - 3]];
  const cornerAlphas = corners.map(([x, y]) => px(img, x, y)[3]);
  // A pixel just inside the corner arc should still be opaque, which is what
  // distinguishes a rounded card from a hole.
  const insideAlpha = px(img, Math.round(img.width * 0.5), Math.round(img.height * 0.5))[3];
  let transparent = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (px(img, x, y)[3] === 0) transparent++;
  return { img, cornerAlphas, insideAlpha, transparent, total: img.width * img.height };
}

(async () => {
  const failures = [];
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-widget'),
    timeout: 60_000,
  });
  const main = await app.firstWindow();
  const errors = [];
  main.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 160)));

  const now = Math.floor(Date.now() / 1000);
  const stub = (page) => {
    page.route('**/geocoding-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GEO) }));
    page.route('**/air-quality-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AIR) }));
    page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildForecast(now)) }));
  };
  stub(main);
  await main.waitForSelector('.app', { timeout: 30_000 });
  await sleep(2500);
  await main.evaluate(() => {
    const input = document.querySelector('.search-wrap input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Testville');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(2000);
  await main.evaluate(() => document.querySelector('.search-results button')?.click());
  await sleep(3000);

  const widgetPromise = app.waitForEvent('window', { timeout: 20_000 });
  await main.evaluate(() => void window.atmosphere?.showWidget?.());
  const widget = await widgetPromise;
  stub(widget);
  widget.on('pageerror', (e) => errors.push('WIDGET PAGEERROR: ' + String(e.message).slice(0, 160)));
  await widget.waitForSelector('.weather-widget', { timeout: 20_000 });
  await sleep(3500);

  // --- 1. The window is genuinely transparent ----------------------------
  const shot = path.join(SHOT_DIR, 'widget-transparent.png');
  await widget.screenshot({ path: shot, omitBackground: true });
  const tr = analyseTransparency(shot);
  console.log('\n== transparency ==');
  console.log('  corner alphas      :', tr.cornerAlphas.join(', '));
  console.log('  centre alpha       :', tr.insideAlpha);
  console.log('  transparent pixels :', tr.transparent, '/', tr.total);
  const cornersClear = tr.cornerAlphas.every((a) => a === 0);
  const centreSolid = tr.insideAlpha > 200;
  if (!cornersClear) failures.push(`the window is not transparent: the corners are ${tr.cornerAlphas.join(', ')} instead of 0`);
  if (!centreSolid) failures.push(`the middle of the widget is transparent (alpha ${tr.insideAlpha})`);
  console.log('  corners transparent :', cornersClear ? 'yes' : 'NO');
  console.log('  centre opaque      :', centreSolid ? 'yes' : 'NO');

  // --- 2. The theme actually changes the colours -------------------------
  // The contrast is measured per text element, against the background that is
  // actually painted behind that element. A second render with the text
  // hidden gives that background pixel for pixel. Measuring the whole card
  // at once, the way this used to, mixes the sky and the card together and
  // reports a legible widget as illegible.
  const themeCheck = async (theme) => {
    await main.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes('Settings'))?.click());
    await sleep(700);
    // The theme is a <select>, not a row of buttons.
    await main.evaluate((t) => {
      const block = [...document.querySelectorAll('.settings-section')].find((s) => s.textContent.includes('Appearance'));
      const row = [...block.querySelectorAll('.setting-block')].find((r) => r.querySelector('.label')?.textContent.trim() === 'Theme');
      const select = row?.querySelector('select');
      if (!select) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, t);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, theme);
    await sleep(2500);
    const file = path.join(SHOT_DIR, `widget-theme-${theme}.png`);
    const bgFile = path.join(SHOT_DIR, `widget-theme-${theme}-bg.png`);
    await widget.screenshot({ path: file, omitBackground: true });
    // The same card with the text hidden, so the backdrop behind each
    // element can be read off the pixels.
    await widget.evaluate(() => {
      document.querySelectorAll('.widget-content > *').forEach((el) => { el.style.visibility = 'hidden'; });
    });
    await sleep(500);
    await widget.screenshot({ path: bgFile, omitBackground: true });
    await widget.evaluate(() => {
      document.querySelectorAll('.widget-content > *').forEach((el) => { el.style.visibility = ''; });
    });

    const textImg = readPng(file);
    const bgImg = readPng(bgFile);
    const scale = textImg.width / (await widget.evaluate(() => window.innerWidth));
    const regions = await widget.evaluate(() => {
      const out = [];
      const add = (el, name) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        out.push({ name, x: r.x, y: r.y, w: r.width, h: r.height });
      };
      add(document.querySelector('.widget-place'), 'place');
      add(document.querySelector('.widget-reading'), 'reading');
      add(document.querySelector('.widget-content > strong'), 'description');
      document.querySelectorAll('.widget-summary').forEach((el, i) => add(el, `summary${i}`));
      return out;
    });
    const elements = regions.map((reg) => {
      const x0 = Math.round(reg.x * scale), x1 = Math.round((reg.x + reg.w) * scale);
      const y0 = Math.round(reg.y * scale), y1 = Math.round((reg.y + reg.h) * scale);
      return { name: reg.name, ratio: coreGlyphContrast(textImg, bgImg, x0, y0, x1, y1) };
    });
    // The card's own surface, sampled away from the text.
    const cardBg = med((() => {
      const out = [];
      for (let y = 0; y < bgImg.height; y += 2) for (let x = 0; x < bgImg.width; x += 2) {
        const p = px(bgImg, x, y);
        if (p[3] > 200) out.push(p);
      }
      return out;
    })());
    const worst = elements.reduce((m, e) => (e.ratio < m.ratio ? e : m), elements[0]);
    return { theme, cardBg, elements, worst, file };
  };

  console.log('\n== theme ==');
  const light = await themeCheck('light');
  for (const el of light.elements) console.log(`  light ${el.name.padEnd(11)} contrast=${el.ratio.toFixed(2)}:1`);
  const dark = await themeCheck('dark');
  for (const el of dark.elements) console.log(`  dark  ${el.name.padEnd(11)} contrast=${el.ratio.toFixed(2)}:1`);

  const lightIsLight = light.cardBg && relLuminance(light.cardBg) > 0.4;
  const darkIsDark = dark.cardBg && relLuminance(dark.cardBg) < 0.35;
  if (!lightIsLight) failures.push(`the light theme still has a dark background (luminance ${light.cardBg ? relLuminance(light.cardBg).toFixed(3) : 'n/a'})`);
  if (!darkIsDark) failures.push(`the dark theme does not have a dark background (luminance ${dark.cardBg ? relLuminance(dark.cardBg).toFixed(3) : 'n/a'})`);
  console.log('  light theme is light :', lightIsLight ? 'yes' : 'NO');
  console.log('  dark theme is dark   :', darkIsDark ? 'yes' : 'NO');
  for (const t of [light, dark]) {
    const ok = t.worst.ratio >= 4.5;
    console.log(`  ${t.theme.padEnd(5)} worst element     : ${t.worst.name} ${t.worst.ratio.toFixed(2)}:1 ${ok ? '(legible)' : 'TOO LOW'}`);
    if (!ok) failures.push(`the ${t.theme} theme's "${t.worst.name}" contrast is only ${t.worst.ratio.toFixed(2)}:1`);
  }

  // --- 3. The live scene is there and animating --------------------------
  console.log('\n== live scene ==');
  const hasCanvas = await widget.evaluate(() => {
    const c = document.querySelector('.weather-widget canvas.weather-canvas');
    if (!c) return { present: false };
    const r = c.getBoundingClientRect();
    return { present: true, w: Math.round(r.width), h: Math.round(r.height), scene: document.querySelector('.weather-widget').className };
  });
  console.log('  canvas:', JSON.stringify(hasCanvas));
  if (!hasCanvas.present) failures.push('the widget has no weather canvas');

  const a = await widget.screenshot({ omitBackground: true });
  await sleep(2500);
  const b = await widget.screenshot({ omitBackground: true });
  fs.writeFileSync(path.join(SHOT_DIR, 'widget-scene-a.png'), a);
  fs.writeFileSync(path.join(SHOT_DIR, 'widget-scene-b.png'), b);
  const ia = readPng(path.join(SHOT_DIR, 'widget-scene-a.png'));
  const ib = readPng(path.join(SHOT_DIR, 'widget-scene-b.png'));
  let moved = 0, counted = 0;
  for (let y = 0; y < ia.height; y += 2) for (let x = 0; x < ia.width; x += 2) {
    const pa = px(ia, x, y), pb = px(ib, x, y);
    if (pa[3] < 200) continue;
    counted++;
    if (Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]) > 12) moved++;
  }
  const movedPct = counted ? (moved / counted) * 100 : 0;
  console.log(`  animating: ${movedPct.toFixed(2)}% of pixels changed over 2.5s`);
  if (movedPct < 0.05) failures.push(`the widget's scene is not animating (${movedPct.toFixed(2)}%)`);

  // --- 4. Opacity and size take effect immediately ------------------------
  console.log('\n== opacity and size ==');
  const setWidgetPref = async (label, value) => {
    await main.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes('Settings'))?.click());
    await sleep(600);
    await main.evaluate(([l, v]) => {
      const block = [...document.querySelectorAll('.settings-section')].find((s) => s.textContent.includes('Desktop widget'));
      const row = [...block.querySelectorAll('.setting-block')].find((r) => r.querySelector('.label')?.textContent.trim() === l);
      [...row.querySelectorAll('.segmented button')].find((b) => b.textContent.trim() === v)?.click();
    }, [label, value]);
    await sleep(2200);
  };
  const widgetBounds = () => app.evaluate(async ({ BrowserWindow }) => {
    // The widget window's `getTitle()` returns the loaded page's <title>,
    // which is the app's own title, not the BrowserWindow `title:` option.
    // The only reliable marker is the `widget=1` query on the URL.
    const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('widget=1'));
    return wins[0] ? wins[0].getContentSize() : null;
  });
  // The window's own limits, which the size preference is clamped to.
  const WIDGET_BASE = [330, 190];
  const WIDGET_MIN = [280, 150];
  const WIDGET_MAX = [500, 340];
  const expectedSize = (scale) => [0, 1].map((i) => {
    const scaled = WIDGET_BASE[i] * (scale / 100);
    return Math.round(Math.min(Math.max(scaled, WIDGET_MIN[i]), WIDGET_MAX[i]));
  });

  await setWidgetPref('Opacity', '50%');
  const opacity = await widget.evaluate(() => getComputedStyle(document.querySelector('.weather-widget')).opacity);
  console.log('  opacity after setting 50%:', opacity);
  if (Math.abs(Number(opacity) - 0.5) > 0.02) failures.push(`the opacity setting did not reach the widget (got ${opacity})`);

  await setWidgetPref('Size', '150%');
  const big = await widgetBounds();
  const bigExpected = expectedSize(150);
  console.log('  content size at 150%   :', JSON.stringify(big), 'expected', JSON.stringify(bigExpected));
  if (!big || Math.abs(big[0] - bigExpected[0]) > 2 || Math.abs(big[1] - bigExpected[1]) > 2) {
    failures.push(`the widget window did not grow to 150% (got ${JSON.stringify(big)}, expected ${JSON.stringify(bigExpected)})`);
  }

  await setWidgetPref('Size', '75%');
  const small = await widgetBounds();
  const smallExpected = expectedSize(75);
  console.log('  content size at  75%   :', JSON.stringify(small), 'expected', JSON.stringify(smallExpected));
  if (!small || Math.abs(small[0] - smallExpected[0]) > 2 || Math.abs(small[1] - smallExpected[1]) > 2) {
    failures.push(`the widget window did not shrink to 75% (got ${JSON.stringify(small)}, expected ${JSON.stringify(smallExpected)})`);
  }

  // The card must fill its window exactly - no dead space.
  const fills = await widget.evaluate(() => {
    const r = document.querySelector('.weather-widget').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight };
  });
  console.log('  card vs window        :', JSON.stringify(fills));
  if (Math.abs(fills.w - fills.vw) > 2 || Math.abs(fills.h - fills.vh) > 2) failures.push('the card does not fill its window');

  // --- 5. The content fits at every size --------------------------------
  // The card used to be laid out in fixed pixels, so the smallest size
  // preference squeezed the text stack until the place name was clipped away
  // entirely. Every text row has to be laid out and visible at every size.
  console.log('\n== layout at every size ==');
  for (const scale of [75, 100, 125, 150]) {
    await setWidgetPref('Size', `${scale}%`);
    await sleep(1200);
    const layout = await widget.evaluate(() => {
      const root = document.querySelector('.weather-widget');
      const rr = root.getBoundingClientRect();
      const rows = [...root.querySelectorAll('.widget-place, .widget-reading, .widget-content > strong, .widget-summary')];
      return {
        window: { w: window.innerWidth, h: window.innerHeight },
        rows: rows.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            cls: el.className || el.tagName,
            text: (el.textContent || '').trim().slice(0, 20),
            height: Math.round(r.height),
            clipped: Math.max(0, Math.round(rr.top - r.top)) + Math.max(0, Math.round(r.bottom - rr.bottom)),
            outside: r.bottom > rr.bottom + 1 || r.top < rr.top - 1 || r.right > rr.right + 1 || r.left < rr.left - 1,
          };
        }),
        overflow: (() => { const c = document.querySelector('.widget-content'); return c.scrollHeight > c.clientHeight + 1; })(),
      };
    });
    const bad = layout.rows.filter((r) => r.height <= 0 || r.clipped > 0 || r.outside);
    console.log(`  ${String(scale).padStart(3)}%  window ${layout.window.w}x${layout.window.h}  overflow=${layout.overflow}  ${bad.length ? 'CLIPPED: ' + bad.map((b) => `${b.cls}("${b.text}" h=${b.height})`).join(', ') : 'all rows visible'}`);
    if (bad.length) failures.push(`at ${scale}% the widget clips its content: ${bad.map((b) => b.cls).join(', ')}`);
    if (layout.overflow) failures.push(`at ${scale}% the widget's content overflows its box`);
  }
  await setWidgetPref('Size', '100%');
  await sleep(1200);

  // --- 5. The widget refreshes -------------------------------------------
  console.log('\n== refresh ==');
  const before = await widget.evaluate(() => document.querySelector('.widget-reading')?.textContent);
  forecastTemp = 31;
  // Refresh from the main window. The main window signals the widget, which
  // then re-fetches, so both end up on the same reading.
  await main.evaluate(() => {
    const btn = [...document.querySelectorAll('.titlebar button')].find((b) => b.getAttribute('aria-label') === 'Refresh weather');
    btn?.click();
  });
  await sleep(4000);
  const after = await widget.evaluate(() => document.querySelector('.widget-reading')?.textContent);
  console.log('  reading before/after  :', before, '->', after);
  if (before === after) failures.push(`the widget did not refresh (still showing ${after})`);

  console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none');
  if (errors.length) failures.push('the widget raised page errors');

  console.log('');
  if (failures.length) {
    console.log('FAIL:');
    for (const f of failures) console.log('  - ' + f);
  } else {
    console.log('PASS: the widget renders correctly');
  }
  await app.close();
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
