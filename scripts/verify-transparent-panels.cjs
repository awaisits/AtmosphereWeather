// Verifies the "Transparent panels" setting end to end.
//
// The point of the setting is that the live animated weather shows *through*
// the content tiles, so it cannot be checked by looking at the bare canvas.
// This harness drives the real Settings UI and measures the pixels.
//
// The trick is what to measure. A translucent panel is NOT "closer to the
// sky colour" - a dark-tinted glass panel is supposed to be darker than a
// bright sky. What distinguishes glass from an opaque card is that glass
// preserves the *structure* of what is behind it: the sky's brightness
// profile, top to bottom, still shows through the panel, softened. An opaque
// card flattens it to a constant.
//
// So for each theme the harness takes three shots:
//
//   off  - setting off, content visible   -> the panel is opaque
//   on   - setting on,  content visible   -> the panel is glass
//   sky  - setting on,  content hidden    -> the bare sky behind it
//
// and compares the row-brightness profile of the panel's own rectangle
// against the same rows of the bare sky. The correlation between the two
// profiles is the real signal:
//
//   off  -> correlation near zero (the panel is flat, the sky is not)
//   on   -> correlation high (the sky's shape is still visible through it)
//
// It then switches the scene from day to night, which changes the sky
// dramatically, and checks that the change is visible *inside* the panel -
// that is the "live background shows through the tiles" claim, verified.
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');

const APP_DIR = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(APP_DIR, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { isolatedArgs } = require('./harness.cjs');
const HOUR = 3600;

const GEO = { results: [{ id: 1, name: 'Testville', admin1: 'Teststate', country: 'United States', latitude: 40, longitude: -74, timezone: 'UTC' }] };

const AIR = {
  latitude: 40, longitude: -74, utc_offset_seconds: 0, timezone: 'UTC',
  current: { time: Math.floor(Date.now() / 1000), european_aqi: 32, us_aqi: 68, pm2_5: 8.4, pm10: 14.2, ozone: 90, nitrogen_dioxide: 12, uv_index: 4, alder_pollen: 2, birch_pollen: 1, grass_pollen: 5, mugwort_pollen: 0, olive_pollen: 0, ragweed_pollen: 1 },
  hourly: { time: [], uv_index: [], alder_pollen: [], birch_pollen: [], grass_pollen: [], mugwort_pollen: [], olive_pollen: [], olive_pollen: [], ragweed_pollen: [] },
};

// The scene the canvas draws. Swapped at runtime so the harness can turn the
// sun off and watch the sky change behind the panels.
let SCENE = { code: 0, isDay: 1, cloud: 5, precip: 0, wind: 8, temp: 24 };

function buildForecast(now) {
  const s = SCENE;
  const hours = [], temps = [], codes = [], pop = [], precip = [], wind = [], gust = [], pressure = [], visibility = [], uv = [], dew = [];
  for (let i = 0; i < 168; i++) {
    hours.push(now - 3600 + i * HOUR);
    temps.push(s.temp + Math.sin(i / 4) * 3);
    codes.push(s.code);
    pop.push(s.code >= 51 ? 80 : 10);
    precip.push(s.precip); wind.push(s.wind); gust.push(s.wind * 1.4);
    pressure.push(1013); visibility.push(20000); uv.push(s.isDay ? 4 : 0); dew.push(s.temp - 5);
  }
  const dayStart = Math.floor(now / 86400) * 86400;
  const dailyTime = [], sunrise = [], sunset = [], dmax = [], dmin = [], dcode = [], dpop = [], dprecip = [], dwind = [];
  for (let i = 0; i < 7; i++) {
    dailyTime.push(dayStart + i * 24 * HOUR);
    dmax.push(s.temp + 4); dmin.push(s.temp - 4); dcode.push(s.code);
    dpop.push(s.code >= 51 ? 80 : 10); dprecip.push(s.precip * 24); dwind.push(s.wind);
  }
  if (s.isDay) {
    // Rose 4 hours ago, sets 8 hours from now: the sun is up and mid-arc.
    for (let i = 0; i < 7; i++) { sunrise.push(now - 4 * HOUR + i * 24 * HOUR); sunset.push(now + 8 * HOUR + i * 24 * HOUR); }
  } else {
    // Set 8 hours ago, next sunrise 4 hours from now.
    for (let i = 0; i < 7; i++) { sunrise.push(now - 20 * HOUR + i * 24 * HOUR); sunset.push(now - 8 * HOUR + i * 24 * HOUR); }
    sunrise[1] = now + 4 * HOUR;
  }
  return {
    latitude: 40, longitude: -74, generationtime_ms: 0, utc_offset_seconds: 0,
    timezone: 'UTC', timezone_abbreviation: 'UTC', elevation: 10,
    current: {
      time: now, interval: 900, temperature_2m: s.temp, apparent_temperature: s.temp - 1,
      relative_humidity_2m: 70, is_day: s.isDay, precipitation: s.precip, weather_code: s.code,
      cloud_cover: s.cloud, pressure_msl: 1013, wind_speed_10m: s.wind, wind_direction_10m: 200,
      wind_gusts_10m: s.wind * 1.4, visibility: 20000, uv_index: s.isDay ? 4 : 0, dew_point_2m: s.temp - 5,
    },
    hourly: { time: hours, temperature_2m: temps, weather_code: codes, precipitation_probability: pop, precipitation: precip, wind_speed_10m: wind, wind_gusts_10m: gust, pressure_msl: pressure, visibility, dew_point_2m: dew, uv_index: uv },
    daily: { time: dailyTime, weather_code: dcode, temperature_2m_max: dmax, temperature_2m_min: dmin, precipitation_probability_max: dpop, precipitation_sum: dprecip, wind_speed_10m_max: dwind, sunrise, sunset },
  };
}

// ---- PNG decode (no external image dependency) ----
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

const lum = (img, x, y) => {
  const i = (y * img.w + x) * img.ch;
  return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
};

const at = (img, x, y) => {
  const i = (y * img.w + x) * img.ch;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

// Pearson correlation of two equally long series.
function correlate(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 4) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da < 1e-6 || db < 1e-6) return 0;
  return num / Math.sqrt(da * db);
}

// Mean brightness of each row of a rectangle, in image pixels.
function rowProfile(img, box) {
  const rows = [];
  for (let y = box.y; y < box.y + box.h; y++) {
    let s = 0, n = 0;
    for (let x = box.x; x < box.x + box.w; x++) { s += lum(img, x, y); n++; }
    rows.push(n ? s / n : 0);
  }
  return rows;
}

// Mean brightness of a whole rectangle.
function meanLum(img, box) {
  let s = 0, n = 0;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) { s += lum(img, x, y); n++; }
  }
  return n ? s / n : 0;
}

const movedPct = (a, b) => {
  let moved = 0;
  for (let i = 0; i < a.data.length; i += a.ch) {
    if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i+1] - b.data[i+1]) + Math.abs(a.data[i+2] - b.data[i+2]) > 8) moved++;
  }
  return (moved / (a.w * a.h)) * 100;
};

// Fraction of pixels inside a box that changed between two shots.
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

(async () => {
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
    args: isolatedArgs('verify-transparent-panels'),
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 160)));

  const now = Math.floor(Date.now() / 1000);
  await page.route('**/geocoding-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GEO) }));
  await page.route('**/air-quality-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AIR) }));
  // The forecast is rebuilt on every request, so changing SCENE and clicking
  // Refresh swaps what the canvas draws.
  await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildForecast(now)) }));

  await page.waitForSelector('.app', { timeout: 30_000 });
  await sleep(3000);

  const setSwitch = async (label, on) => {
    await page.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes('Settings'))?.click());
    await sleep(700);
    const found = await page.evaluate(([l, want]) => {
      const input = [...document.querySelectorAll('.settings-sheet input.switch')].find((i) => i.getAttribute('aria-label') === l);
      if (!input) return false;
      if (input.checked !== want) input.click();
      return true;
    }, [label, on]);
    if (!found) throw new Error('settings switch not found: ' + label);
    await sleep(300);
    await page.evaluate(() => document.querySelector('.modal-close')?.click());
    await sleep(600);
  };

  const setSelect = async (label, value) => {
    await page.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes('Settings'))?.click());
    await sleep(700);
    await page.evaluate(([l, v]) => {
      const blocks = [...document.querySelectorAll('.settings-sheet .setting-block')];
      const block = blocks.find((b) => b.querySelector('.label')?.textContent.trim() === l);
      const sel = block?.querySelector('select');
      if (!sel) throw new Error('select not found: ' + l);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, v);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, [label, value]);
    await sleep(400);
    await page.evaluate(() => document.querySelector('.modal-close')?.click());
    await sleep(600);
  };

  await setSwitch('Weather animation', true);
  // Reduce motion and high contrast are seeded from the operating system, and
  // if either is on the canvas never renders - which would make this whole
  // check meaningless.
  await setSwitch('Reduce motion', false);
  await setSwitch('High contrast', false);
  await setSwitch('Transparent panels', false);

  // Give the app a place to render, through the real search UI.
  await page.evaluate(() => {
    const input = document.querySelector('.search-wrap input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Testville');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(2000);
  await page.evaluate(() => document.querySelector('.search-results button')?.click());
  await sleep(4000);

  // The screenshot is in device pixels but the DOM rect is in CSS pixels, so
  // the scale between them has to be applied to every probe box.
  const cssSize = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const shot = async () => decodePng(await page.screenshot());

  const hideContent = () => page.evaluate(() => {
    const st = document.createElement('style');
    st.id = 'harness-hide';
    st.textContent = '.titlebar, .main-content, .sidebar { visibility: hidden !important; }';
    document.head.appendChild(st);
  });
  const showContent = () => page.evaluate(() => document.getElementById('harness-hide')?.remove());

  const results = [];
  for (const theme of ['dark', 'light']) {
    await setSelect('Theme', theme);
    await sleep(1500);
    // Each round has to start from the same state. The previous round leaves
    // the setting on, and a stale "off" shot would silently compare glass
    // against glass.
    await setSwitch('Transparent panels', false);
    await sleep(800);
    // And it has to start from the same scene, or the day/night comparison
    // below would be between two identical skies.
    SCENE = { code: 0, isDay: 1, cloud: 5, precip: 0, wind: 8, temp: 24 };
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Refresh weather');
      btn?.click();
    });
    await sleep(2500);

    // The hero card at the top of the current view: a big, mostly empty
    // panel, which is the best place to see the sky through the glass. It is
    // scrolled into view first, because a screenshot only covers the
    // viewport and a panel below the fold would be outside the image.
    const box = await page.evaluate(() => {
      const s = document.querySelector('.hero') || document.querySelector('.section');
      s.scrollIntoView({ block: 'center' });
      const r = s.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: Math.min(r.height, 240), tag: s.className };
    });
    await sleep(800);
    console.log(`\n[${theme}] probe panel: .${box.tag.split(' ')[0]}  ${Math.round(box.w)}x${Math.round(box.h)} css px at (${Math.round(box.x)}, ${Math.round(box.y)})`);

    const off = await shot();
    const scale = off.w / cssSize.w;
    const imgBox = { x: Math.round(box.x * scale), y: Math.round(box.y * scale), w: Math.round(box.w * scale), h: Math.round(box.h * scale) };
    // Clamp to the image, or a probe that runs off the edge samples garbage.
    imgBox.x = Math.max(0, Math.min(imgBox.x, off.w - 4));
    imgBox.y = Math.max(0, Math.min(imgBox.y, off.h - 4));
    imgBox.w = Math.max(4, Math.min(imgBox.w, off.w - imgBox.x));
    imgBox.h = Math.max(4, Math.min(imgBox.h, off.h - imgBox.y));
    console.log(`[${theme}] image ${off.w}x${off.h} scale ${scale.toFixed(3)}  probe ${imgBox.x},${imgBox.y} ${imgBox.w}x${imgBox.h}`);

    await setSwitch('Transparent panels', true);
    await sleep(1200);
    const on = await shot();
    fs.writeFileSync(path.join(SHOT_DIR, `transparent-panels-on-${theme}.png`), await page.screenshot());

    await hideContent();
    await sleep(800);
    const sky = await shot();
    fs.writeFileSync(path.join(SHOT_DIR, `transparent-panels-sky-${theme}.png`), await page.screenshot());
    await showContent();
    await sleep(400);

    // --- The translucency test -------------------------------------------------
    // The sky's row-brightness profile, and the panel's own row-brightness
    // profile over the same rows. Glass preserves the shape of what is behind
    // it, so the two should track each other. An opaque card does not.
    const skyProfile = rowProfile(sky, imgBox);
    const offProfile = rowProfile(off, imgBox);
    const onProfile = rowProfile(on, imgBox);

    const corrOff = Math.abs(correlate(skyProfile, offProfile));
    const corrOn = Math.abs(correlate(skyProfile, onProfile));

    // The panel must also get *closer* to the sky in the sense of showing
    // more of the sky's contrast: the spread of the profile widens.
    const spread = (p) => Math.max(...p) - Math.min(...p);
    const spreadOff = spread(offProfile);
    const spreadOn = spread(onProfile);
    if (!Number.isFinite(corrOff) || !Number.isFinite(corrOn)) {
      console.log(`[${theme}] ERROR: degenerate profile (off rows=${offProfile.length} on rows=${onProfile.length} sky rows=${skyProfile.length})`);
    }

    // The correlation has to *improve* when the setting is switched on. The
    // size of the improvement depends on how translucent the base card
    // already is - the light theme's card is rgba(255,255,255,.8), so it
    // keeps some of the sky's shape even when opaque-ish. The day/night
    // check below is the decisive one; this is the corroborating signal.
    const skyVisible = corrOn > corrOff + 0.1;
    console.log(`[${theme}] profile correlation with sky: off=${corrOff.toFixed(3)} on=${corrOn.toFixed(3)}`);
    console.log(`[${theme}] profile spread (sky contrast through panel): off=${spreadOff.toFixed(1)} on=${spreadOn.toFixed(1)}  sky=${spread(skyProfile).toFixed(1)}`);
    console.log(`[${theme}] sky visible through panel: ${skyVisible ? 'YES' : 'NO'}`);

    // --- Legibility ------------------------------------------------------------
    // Every piece of text in the panel is measured, not just the heading: the
    // muted tones are the ones that fail first over a live sky. Each
    // element's own computed colour is used to decide which of its pixels
    // are text, so the measurement never has to guess.
    const textEls = await page.evaluate(() => {
      const panel = document.querySelector('.hero') || document.querySelector('.section');
      const pr = panel.getBoundingClientRect();
      const out = [];
      for (const el of panel.querySelectorAll('h1,h2,h3,p,span,div.temperature,div.today-range,div.live-condition,div.eyebrow')) {
        if (!el.textContent || !el.textContent.trim()) continue;
        // Only leaf text nodes, or the parent and the child get counted twice.
        if (el.children.length && [...el.children].some((c) => c.textContent.trim())) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 12 || r.height < 6) continue;
        if (r.top < pr.top - 4 || r.bottom > pr.bottom + 4) continue;
        if (r.left < pr.left - 4 || r.right > pr.right + 4) continue;
        const m = getComputedStyle(el).color.match(/[\d.]+/g).map(Number);
        out.push({ x: r.left, y: r.top, w: r.width, h: r.height, text: el.textContent.trim().slice(0, 24), color: m.slice(0, 3) });
      }
      return out;
    });
    if (!textEls.length) throw new Error('no text found inside the probe panel');

    const rel = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    let worst = null;
    for (const el of textEls) {
      const tb = {
        x: Math.round(el.x * scale), y: Math.round(el.y * scale),
        w: Math.round(el.w * scale), h: Math.round(el.h * scale),
      };
      // The text side is the element's own computed colour - that is exactly
      // what the browser draws, so there is nothing to sample and no
      // antialiasing error. The background side is the median of the
      // element's pixels that are *not* glyphs. A median rather than a mean
      // or an extreme is what makes this robust: a bright sun showing
      // through the glass is a minority of the pixels and cannot drag the
      // measurement, whereas picking the brightest pixel would.
      const lums = [];
      for (let y = tb.y; y < tb.y + tb.h; y++) {
        for (let x = tb.x; x < tb.x + tb.w; x++) {
          const c = at(on, x, y);
          const d = Math.abs(c[0] - el.color[0]) + Math.abs(c[1] - el.color[1]) + Math.abs(c[2] - el.color[2]);
          if (d >= 60) lums.push(lum(on, x, y)); // not a glyph pixel
        }
      }
      if (lums.length < 20) continue;
      const bgLum = median(lums);
      const a = rel((0.2126 * el.color[0] + 0.7152 * el.color[1] + 0.0722 * el.color[2])), b = rel(bgLum);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      console.log(`    "${el.text}" color=rgb(${el.color.join(',')}) bg lum=${bgLum.toFixed(0)} contrast=${ratio.toFixed(2)}:1`);
      if (!worst || ratio < worst.ratio) worst = { text: el.text, ratio, color: el.color };
    }
    if (!worst) throw new Error('could not measure any text in the probe panel');
    // 3:1 is the WCAG threshold for large text; the muted body copy is small,
    // so it should be held to the 4.5:1 that small text needs.
    const legible = worst.ratio >= 4.5;
    console.log(`[${theme}] ${textEls.length} text elements, worst: "${worst.text}" ${worst.ratio.toFixed(2)}:1 ${legible ? '(legible)' : '(NOT LEGIBLE)'}`);

    // --- The live background, through the tiles --------------------------------
    // Switch the scene from day to night. The sky changes enormously. If the
    // panels are really glass, that change shows up inside the panel.
    SCENE = { code: 0, isDay: 0, cloud: 5, precip: 0, wind: 8, temp: 11 };
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Refresh weather');
      btn?.click();
    });
    await sleep(2500);

    const onNight = await shot();
    fs.writeFileSync(path.join(SHOT_DIR, `transparent-panels-night-${theme}.png`), await page.screenshot());

    // The same switch, with the setting off, for comparison.
    await setSwitch('Transparent panels', false);
    await sleep(1200);
    const offNight = await shot();
    fs.writeFileSync(path.join(SHOT_DIR, `transparent-panels-night-off-${theme}.png`), await page.screenshot());
    await setSwitch('Transparent panels', true);
    await sleep(1200);

    const changeThrough = changedInBox(on, onNight, imgBox);
    const changeOpaque = changedInBox(off, offNight, imgBox);
    const liveShowsThrough = changeThrough > changeOpaque + 1;
    console.log(`[${theme}] day->night change inside the panel: glass=${changeThrough.toFixed(1)}%  opaque=${changeOpaque.toFixed(1)}%  ${liveShowsThrough ? '(LIVE SHOWS THROUGH)' : '(NOT VISIBLE)'}`);

    // --- Animation of the canvas ----------------------------------------------
    // The night sky has a moving moon and stars, so it is a far better motion
    // target than a clear day, where almost nothing moves.
    await hideContent();
    await sleep(800);
    const a1 = await shot();
    await sleep(2500);
    const a2 = await shot();
    await showContent();
    await sleep(400);
    const mp = movedPct(a1, a2);
    const animating = mp > 0.05;
    console.log(`[${theme}] sky animating: ${mp.toFixed(2)}% of pixels changed over 2.5s ${animating ? '(ANIMATING)' : '(STATIC)'}`);

    results.push({ theme, skyVisible, legible, liveShowsThrough, mp });
  }

  console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none');
  const failed = results.filter((r) => !r.skyVisible || !r.legible || !r.liveShowsThrough || r.mp <= 0.05);
  console.log(`\n${results.length - failed.length}/${results.length} themes verified`);
  if (failed.length) console.log('FAILED:', failed.map((f) => f.theme).join(', '));
  console.log('screenshots: ' + SHOT_DIR + '/transparent-panels-*.png');

  await app.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
