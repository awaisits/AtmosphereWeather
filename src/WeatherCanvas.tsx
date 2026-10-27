import { useEffect, useRef } from 'react';

type LiveWeather = {
  code: number; isDay: boolean; wind: number; windDirection: number;
  precipitation: number; cloud: number; temperature: number;
  sunrise?: string; sunset?: string; nextSunrise?: string;
};

type Particle = { x: number; y: number; z: number; vx: number; vy: number; size: number; phase: number; alpha: number; speed: number; type: 'rain' | 'snow' | 'mist' };
type Cloud = { x: number; y: number; baseX: number; scale: number; depth: number; seed: number; sprite: HTMLCanvasElement; opacity: number };
type Star = { x: number; y: number; baseAlpha: number; phase: number; speed: number; size: number };

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const smoothstep = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0 || 1), 0, 1); return t * t * (3 - 2 * t); };

type Rgb = { r: number; g: number; b: number };
const hex = (v: string): Rgb => { const c = v.replace('#',''); return { r: parseInt(c.slice(0,2),16), g: parseInt(c.slice(2,4),16), b: parseInt(c.slice(4,6),16) }; };
const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb => ({ r: Math.round(a.r + (b.r-a.r)*k), g: Math.round(a.g + (b.g-a.g)*k), b: Math.round(a.b + (b.b-a.b)*k) });
const css = (c: Rgb, a = 1) => a >= 1 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${a})`;

type Sky = { top: string; mid: string; bot: string };
type SkyRgb = { top: Rgb; mid: Rgb; bot: Rgb };
const toRgb = (sky: Sky): SkyRgb => ({ top: hex(sky.top), mid: hex(sky.mid), bot: hex(sky.bot) });
const mixSky = (a: SkyRgb, b: SkyRgb, k: number): SkyRgb => ({
  top: mixRgb(a.top, b.top, k), mid: mixRgb(a.mid, b.mid, k), bot: mixRgb(a.bot, b.bot, k),
});

const SKY_NIGHT  = { top:'#060a16', mid:'#0c1428', bot:'#132038' };
const SKY_GOLDEN = { top:'#354a7a', mid:'#a88a6b', bot:'#f5c078' };
const SKY_DAY    = { top:'#3d72b8', mid:'#72a0d4', bot:'#a6cbf0' };
const SKY_OVERCAST={ top:'#3a4658', mid:'#54637a', bot:'#6d7c92' };
const SKY_FOG    = { top:'#8f9aa6', mid:'#a8b2bc', bot:'#c3cad2' };
const SKY_STORM  = { top:'#141c2c', mid:'#2c3a4e', bot:'#3d4a5c' };

/** Premium animated weather canvas with layered depth, parallax, and cinematic lighting. */
export default function WeatherCanvas({ weather, enabled, nightBackdrop = false }: { weather: LiveWeather; enabled: boolean; nightBackdrop?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: true, desynchronized: true });
    if (!canvas || !ctx) return;

    let width = 1, height = 1, raf = 0, lastTime = 0, frameQueued = false;
    let particles: Particle[] = [], clouds: Cloud[] = [], stars: Star[] = [];
    let shootingStars: { x: number; y: number; length: number; speed: number; opacity: number; life: number; maxLife: number }[] = [];
    let dustParticles: { x: number; y: number; vx: number; vy: number; size: number; alpha: number; phase: number }[] = [];
    let ripples: { x: number; y: number; radius: number; maxRadius: number; alpha: number }[] = [];
    let flashUntil = 0, nextFlash = 0;
    let tintKey = '';
    let mouseX = 0.5, mouseY = 0.5;

    const rebuildDust = () => {
      dustParticles = Array.from({ length: 40 }, () => ({
        x: rand(0, width), y: rand(0, height), vx: rand(-0.2, 0.4), vy: rand(-0.15, 0.1), size: rand(1, 2.4), alpha: rand(0.12, 0.38), phase: rand(0, Math.PI * 2)
      }));
    };

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const rain = weather.code >= 51 && weather.code <= 67 || weather.code >= 80 && weather.code <= 82 || weather.code >= 95;
    const snow = weather.code >= 71 && weather.code <= 77 || weather.code >= 85 && weather.code <= 86;
    const storm = weather.code >= 95;
    const fog = weather.code === 45 || weather.code === 48;
    const cloudy = weather.code >= 2 || weather.cloud > 55;
    const windRadians = ((weather.windDirection + 180) * Math.PI) / 180;
    const windX = Math.cos(windRadians);
    const windY = Math.sin(windRadians);
    const windFactor = clamp(weather.wind / 50, 0.08, 1.35);
    const rainIntensity = clamp(Math.max(weather.precipitation * 0.16, weather.code >= 65 ? 0.8 : 0.24), 0.18, 1);

    const sunrise = weather.sunrise ? Date.parse(weather.sunrise) : NaN;
    const sunset = weather.sunset ? Date.parse(weather.sunset) : NaN;
    // The next sunrise gives the true length of tonight, which drifts with the
    // seasons. A fixed 24-hour night would misplace the moon near solstices.
    const nextSunrise = weather.nextSunrise ? Date.parse(weather.nextSunrise) : NaN;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const TWILIGHT = 38 * 60 * 1000;
    const GOLDEN_WIDTH = 52 * 60 * 1000;

    const solar = (now: number) => {
      if (!Number.isFinite(sunrise) || !Number.isFinite(sunset) || sunset <= sunrise) {
        const day = weather.isDay;
        return { dayFactor: day ? 1 : 0, golden: 0, sunX: 0.76, sunY: 0.3, sunVisible: day, moonX: 0.24, moonY: 0.3, moonVisible: !day, dayProgress: day ? 0.5 : 0, nightProgress: day ? 0 : 0.5 };
      }
      const inDay = now >= sunrise && now <= sunset;
      const dayFactor = inDay
        ? smoothstep(sunrise - TWILIGHT, sunrise + TWILIGHT, now) * (1 - smoothstep(sunset - TWILIGHT, sunset + TWILIGHT, now))
        : (now < sunrise ? smoothstep(sunrise - TWILIGHT, sunrise + TWILIGHT, now) : 1 - smoothstep(sunset - TWILIGHT, sunset + TWILIGHT, now));
      const golden = Math.max(
        Math.exp(-Math.pow((now - (sunrise + 18 * 60 * 1000)) / GOLDEN_WIDTH, 2)),
        Math.exp(-Math.pow((now - (sunset - 18 * 60 * 1000)) / GOLDEN_WIDTH, 2)),
      );
      const dayProgress = inDay ? (now - sunrise) / (sunset - sunrise) : 0;
      const sunArc = (p: number) => ({ x: 0.08 + p * 0.84, y: 0.72 - 0.54 * Math.sin(p * Math.PI) });
      const sun = inDay ? sunArc(dayProgress) : { x: 0.08, y: 0.82 };
      const nightStart = sunset;
      // Use the real length of tonight when the next sunrise is known.
      const nightEnd = Number.isFinite(nextSunrise) && nextSunrise > nightStart ? nextSunrise : sunrise + DAY_MS;
      const nightProgress = now >= nightStart ? (now - nightStart) / (nightEnd - nightStart) : 0;
      const moon = now >= nightStart ? sunArc(clamp(nightProgress, 0, 1)) : { x: 0.08, y: 0.82 };
      return { dayFactor: clamp(dayFactor, 0, 1), golden: clamp(golden, 0, 1), sunX: sun.x, sunY: sun.y, sunVisible: inDay, moonX: moon.x, moonY: moon.y, moonVisible: !inDay, dayProgress, nightProgress };
    };

    const moonPhase = (now: number) => {
      const SYNODIC = 29.530588853;
      const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
      const days = (now - NEW_MOON) / 86400000;
      return ((days % SYNODIC) + SYNODIC) % SYNODIC / SYNODIC;
    };

    // --- Star field ---
    const buildStars = () => {
      stars = Array.from({ length: 60 }, () => ({
        x: rand(0, 1), y: rand(0, 0.7), baseAlpha: rand(0.15, 0.9), phase: rand(0, Math.PI * 2), speed: rand(0.0004, 0.0012), size: rand(0.5, 1.8)
      }));
    };

    // --- Cloud sprites with depth-aware tinting ---
    const makeCloudSprite = (seed: number, dayFactor: number, golden: number, storm: boolean) => {
      let state = Math.floor(seed * 1000) || 1;
      const random = () => { state = (state * 16807) % 2147483647; return (state - 1) / 2147483646; };
      const sprite = document.createElement('canvas');
      sprite.width = 420; sprite.height = 210;
      const cctx = sprite.getContext('2d');
      if (!cctx) return sprite;
      cctx.filter = 'blur(10px)';
      cctx.fillStyle = 'rgba(255,255,255,.7)';
      cctx.beginPath(); cctx.ellipse(210, 125, 180, 40, 0, 0, Math.PI * 2); cctx.fill();
      const lobes = 5 + Math.floor(random() * 5);
      for (let i = 0; i < lobes; i++) {
        const x = 40 + random() * 340;
        const y = 60 + random() * 70;
        const rx = 22 + random() * 45;
        const ry = 18 + random() * 35;
        cctx.globalAlpha = .35 + random() * .5;
        cctx.beginPath(); cctx.ellipse(x, y, rx, ry, (random() - .5) * .25, 0, Math.PI * 2); cctx.fill();
      }
      cctx.globalAlpha = 1; cctx.filter = 'none';
      cctx.globalCompositeOperation = 'source-in';
      // Color the cloud based on time of day
      const dayWhite = { r: 255, g: 255, b: 255 };
      const dayBlue  = { r: 180, g: 210, b: 240 };
      const warm     = { r: 255, g: 205, b: 130 };
      const night    = { r: 40,  g: 55,  b: 90  };
      const stormCol = { r: 50,  g: 60,  b: 85  };
      let base = mixRgb(dayBlue, dayWhite, 0.3 + dayFactor * 0.6);
      base = mixRgb(base, warm, golden * 0.55);
      base = mixRgb(base, night, 1 - dayFactor);
      if (storm) base = stormCol;
      const grad = cctx.createLinearGradient(0, 50, 0, 190);
      grad.addColorStop(0, css(base, .82));
      grad.addColorStop(.45, css(mixRgb(base, { r: 200, g: 220, b: 245 }, .4), .7));
      grad.addColorStop(1, css(mixRgb(base, { r: 30, g: 40, b: 70 }, .55), .6));
      cctx.fillStyle = grad; cctx.fillRect(0, 0, sprite.width, sprite.height);
      cctx.globalCompositeOperation = 'source-over';
      return sprite;
    };

    const buildClouds = (dayFactor: number, golden: number) => {
      const cloudCover = clamp(weather.cloud / 100, 0, 1);
      const cloudCount = cloudy ? Math.max(1, Math.round(1 + cloudCover * 5)) : (cloudCover > 0.15 ? 2 : 1);
      clouds = Array.from({ length: cloudCount }, (_, i) => {
        const seed = rand(1, 10000);
        const depth = rand(0.2, 1);
        return {
          x: (i / cloudCount) * (width + 700) - 350,
          y: rand(height * 0.08, height * 0.72),
          baseX: (i / cloudCount) * (width + 700) - 350,
          scale: rand(0.7, 1.6) * (0.6 + depth * 0.6),
          depth, seed,
          sprite: makeCloudSprite(seed, dayFactor, golden, storm),
          opacity: clamp(0.15 + cloudCover * 0.5, 0.06, 0.55) * (0.4 + depth * 0.5),
        };
      });
    };

    // --- Particles ---
    const rebuildParticles = () => {
      const amount = snow ? 120 : rain ? Math.round(60 + rainIntensity * 140) : (fog ? 80 : 0);
      particles = Array.from({ length: amount }, () => {
        const z = rand(0.15, 1);
        if (snow) return { x: rand(0, width), y: rand(-height * 0.3, height), z, vx: 0, vy: 0, size: rand(1, 2.8), phase: rand(0, Math.PI * 2), alpha: rand(0.4, 0.95), speed: rand(0.5, 1.5), type: 'snow' };
        if (rain) return { x: rand(0, width), y: rand(-height * 0.4, height), z, vx: 0, vy: 0, size: rand(0.6, 1.8), phase: 0, alpha: rand(0.25, 0.7), speed: rand(0.8, 1.4), type: 'rain' };
        return { x: rand(0, width), y: rand(height * 0.3, height * 0.85), z, vx: 0, vy: 0, size: rand(1.5, 4), phase: rand(0, Math.PI * 2), alpha: rand(0.03, 0.12), speed: rand(0.5, 1.2), type: 'mist' };
      });
    };

    // --- Mouse parallax ---
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseX = (e.clientX - rect.left) / rect.width;
      mouseY = (e.clientY - rect.top) / rect.height;
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      width = rect.width; height = rect.height;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildStars();
      rebuildParticles();
      rebuildDust();
      const t = solar(Date.now());
      tintKey = `${Math.round(t.dayFactor * 10)}-${Math.round(t.golden * 5)}`;
      buildClouds(t.dayFactor, t.golden);
    };

    const drawCloud = (c: Cloud, now: number, parallaxX: number) => {
      const gust = Math.sin(now * 0.0015 + c.seed) * (weather.wind * 0.002);
      const travel = (windX * (0.018 + (weather.wind + gust) * 0.0035) + parallaxX * 0.0008) * c.depth * now;
      const span = width + 840;
      const x = ((c.baseX + travel + 420) % span + span) % span - 420;
      const sway = Math.sin(now * .00004 + c.seed) * 12 * c.depth + windY * weather.wind * .0006 * c.depth;
      const y = c.y + sway;
      const shear = 1 + Math.sin(now * 0.0005 + c.seed) * 0.08;
      const scaleX = c.scale * (.7 + c.depth * .5) * shear;
      const scaleY = c.scale * (.7 + c.depth * .5);
      const coverage = cloudy ? .18 + weather.cloud / 120 : .1;
      const opacity = clamp(coverage * (.32 + c.depth * .48), .05, .52) * c.opacity;
      ctx.save(); ctx.globalAlpha = opacity;
      ctx.drawImage(c.sprite, x - 210 * scaleX, y - 105 * scaleY, 420 * scaleX, 210 * scaleY);
      ctx.restore();
    };

    const drawSunrays = (sx: number, sy: number, clock: number, golden: number) => {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < 6; i++) {
        const angle = 0.2 + i * 0.25 + Math.sin(clock * 0.0002 + i) * 0.05;
        const len = height * 1.2;
        const grad = ctx.createLinearGradient(sx, sy, sx + Math.cos(angle) * len, sy + Math.sin(angle) * len);
        const a = (0.04 + golden * 0.06).toFixed(3);
        grad.addColorStop(0, `rgba(255,240,180,${a})`);
        grad.addColorStop(0.5, `rgba(255,220,150,${(Number(a) * 0.5).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(255,220,150,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(angle - 0.08) * len, sy + Math.sin(angle - 0.08) * len);
        ctx.lineTo(sx + Math.cos(angle + 0.08) * len, sy + Math.sin(angle + 0.08) * len);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    };

    const drawShootingStars = (nightFactor: number) => {
      if (nightFactor < 0.6 || cloudy || storm) return;
      if (Math.random() < 0.006 && shootingStars.length < 2) {
        shootingStars.push({
          x: rand(width * 0.1, width * 0.9), y: rand(0, height * 0.3),
          length: rand(60, 140), speed: rand(8, 14), opacity: rand(0.6, 0.95), life: 0, maxLife: rand(30, 60)
        });
      }
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const s = shootingStars[i];
        s.life++;
        s.x += s.speed;
        s.y += s.speed * 0.6;
        const fade = 1 - s.life / s.maxLife;
        if (fade <= 0) { shootingStars.splice(i, 1); continue; }
        const grad = ctx.createLinearGradient(s.x, s.y, s.x - s.length, s.y - s.length * 0.6);
        grad.addColorStop(0, `rgba(255,255,255,${(s.opacity * fade).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - s.length, s.y - s.length * 0.6);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawDust = (dt: number, now: number) => {
      const tNow = solar(Date.now());
      if (tNow.dayFactor < 0.3 || rain || snow || storm || fog) return;
      for (const d of dustParticles) {
        d.phase += dt * 0.002;
        d.x += (d.vx + windX * 0.5 + Math.sin(d.phase) * 0.4) * dt;
        d.y += (d.vy + Math.cos(d.phase * 0.7) * 0.2) * dt;
        if (d.x > width + 10) d.x = -10;
        if (d.x < -10) d.x = width + 10;
        if (d.y > height + 10) d.y = -10;
        if (d.y < -10) d.y = height + 10;
        const shimmer = 0.4 + 0.6 * Math.sin(now * 0.003 + d.phase);
        ctx.fillStyle = `rgba(255,245,210,${(d.alpha * shimmer).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawRipples = (dt: number) => {
      ctx.lineWidth = 1;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.radius += dt * 1.8;
        r.alpha -= dt * 0.03;
        if (r.alpha <= 0 || r.radius >= r.maxRadius) { ripples.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(200,230,255,${r.alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, r.radius, r.radius * 0.35, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const drawStars = (now: number, nightFactor: number) => {
      if (nightFactor < 0.03) return;
      for (const s of stars) {
        const twinkle = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(now * s.speed + s.phase));
        const a = clamp(twinkle * s.baseAlpha * nightFactor * 1.2, 0, 1);
        if (a < 0.02) continue;
        ctx.fillStyle = `rgba(235,242,255,${a})`;
        const r = s.size * (0.7 + 0.5 * twinkle);
        ctx.beginPath(); ctx.arc(width * s.x, height * s.y, r, 0, Math.PI * 2); ctx.fill();
      }
    };

    const drawSky = (wall: number, clock: number) => {
      const t = solar(wall);
      const stormy = storm;
      const warm = weather.temperature >= 28;
      const cold = weather.temperature <= 2;

      if (!nightBackdrop) {
        const nightRgb = toRgb(SKY_NIGHT);
        const dayRgb   = toRgb(SKY_DAY);
        let pal = mixSky(nightRgb, dayRgb, t.dayFactor);
        if (warm && t.dayFactor > 0.15) pal = mixSky(pal, toRgb({ top:'#4878b2', mid:'#829ed0', bot:'#f0c288' }), 0.22 * t.dayFactor);
        if (cold  && t.dayFactor > 0.15) pal = mixSky(pal, toRgb({ top:'#5d8acc', mid:'#96b4d6', bot:'#cce0f2' }), 0.18 * t.dayFactor);
        if (t.golden > 0.015) pal = mixSky(pal, toRgb(SKY_GOLDEN), t.golden * 0.7);
        // Storm has to be checked before rain: a thunderstorm is also a rain
        // code, so testing rain first would shade a storm with the mild
        // overcast palette and leave it looking like a bright blue sky.
        // Cloud and snow get the overcast palette too - a sky that is 90%
        // covered in cloud, or that is dropping snow, is not a blue sky.
        if (stormy)        pal = mixSky(pal, mixSky(toRgb(SKY_STORM), nightRgb, 1 - t.dayFactor), 0.95);
        else if (fog)      pal = mixSky(pal, mixSky(toRgb(SKY_FOG), nightRgb, 1 - t.dayFactor), 0.9);
        else if (rain)     pal = mixSky(pal, mixSky(toRgb(SKY_OVERCAST), nightRgb, 1 - t.dayFactor), 0.8);
        else if (snow)     pal = mixSky(pal, mixSky(toRgb(SKY_OVERCAST), nightRgb, 1 - t.dayFactor), 0.78);
        else if (cloudy)   pal = mixSky(pal, mixSky(toRgb(SKY_OVERCAST), nightRgb, 1 - t.dayFactor), clamp(weather.cloud / 100 * 0.62, 0.12, 0.6));

        const sky = ctx.createLinearGradient(0, 0, 0, height);
        sky.addColorStop(0, css(pal.top)); sky.addColorStop(.35, css(pal.mid)); sky.addColorStop(1, css(pal.bot));
        ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);

        // Subtle atmospheric glow at the horizon. The band fades in from
        // nothing as well as out, otherwise its top edge draws a hard
        // horizontal line across the sky. Wet and foggy skies have no
        // bright horizon, so they are left alone.
        if (t.dayFactor > 0.05 && !storm && !rain && !snow && !fog) {
          const hz = ctx.createLinearGradient(0, height * 0.6, 0, height);
          hz.addColorStop(0, 'rgba(255,255,255,0)');
          hz.addColorStop(0.45, `rgba(${t.golden > 0.2 ? '255,190,110' : '255,220,160'},0.07)`);
          hz.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = hz; ctx.fillRect(0, height * 0.6, width, height * 0.4);
        }
      } else {
        // Clear night: paint a deep-sky gradient instead of leaving whatever is
        // behind the canvas showing through. The sky is drawn before the stars
        // so the star field still reads clearly against it.
        const deep = ctx.createLinearGradient(0, 0, 0, height);
        deep.addColorStop(0, '#030711');
        deep.addColorStop(0.55, '#0a1730');
        deep.addColorStop(1, '#12294b');
        ctx.fillStyle = deep; ctx.fillRect(0, 0, width, height);
        // Faint milky-way band for texture.
        const band = ctx.createLinearGradient(0, height * 0.08, width * 0.85, height * 0.52);
        band.addColorStop(0, 'rgba(120,150,220,0)');
        band.addColorStop(0.5, 'rgba(130,160,225,0.07)');
        band.addColorStop(1, 'rgba(120,150,220,0)');
        ctx.fillStyle = band; ctx.fillRect(0, 0, width, height * 0.6);
      }

      // Stars
      const nightFactor = clamp(1 - t.dayFactor * 1.25, 0, 1);
      drawStars(clock, nightFactor);

      // Sun. A sun that is behind fog, a solid overcast or falling rain
      // should not be drawn as a bright disc in the middle of the sky.
      // Precipitation obscures the sun whatever the cloud cover says: a
      // shower with 70% cloud still hides it completely, so the test has
      // to be on whether it is raining, not only on how much cloud there is.
      const sunObscured = storm || fog || rain || snow || (cloudy && weather.cloud > 72);
      if (t.sunVisible && !sunObscured) {
        const sx = width * t.sunX, sy = height * t.sunY, sr = Math.min(height * 0.22, 50);
        if (t.golden > 0.05) drawSunrays(sx, sy, clock, t.golden);
        const pulse = 1 + Math.sin(clock * 0.0005) * 0.02;
        const sunGrad = ctx.createRadialGradient(sx - 6, sy - 6, 4, sx, sy, sr * pulse);
        if (t.golden > 0.2) { sunGrad.addColorStop(0, '#fff1d0'); sunGrad.addColorStop(.5, '#ffc470'); sunGrad.addColorStop(1, '#f5944d'); }
        else { sunGrad.addColorStop(0, '#fff8db'); sunGrad.addColorStop(.5, '#ffdd8c'); sunGrad.addColorStop(1, '#ffc068'); }
        ctx.save();
        // Corona
        ctx.shadowColor = `rgba(255,${t.golden > 0.2 ? '180' : '200'},100,${(0.45 + t.golden * 0.35).toFixed(2)})`;
        ctx.shadowBlur = 55;
        ctx.fillStyle = sunGrad; ctx.beginPath(); ctx.arc(sx, sy, sr * pulse, 0, Math.PI * 2); ctx.fill();
        // Lens flare streaks. These fade out along their length: a flat
        // 1px line of constant alpha reads as a scratch on the sky rather
        // than as light, so each streak is drawn with a gradient that
        // starts at the disc and dies away from it.
        ctx.lineCap = 'round';
        for (let i = 0; i < 5; i++) {
          const ang = (clock * 0.00003 + i * 1.2) % (Math.PI * 2);
          const inner = sr * 1.1, len = sr * pulse * (1.2 + i * 0.35);
          const x0 = sx + Math.cos(ang) * inner, y0 = sy + Math.sin(ang) * inner;
          const x1 = sx + Math.cos(ang) * len,   y1 = sy + Math.sin(ang) * len;
          const streak = ctx.createLinearGradient(x0, y0, x1, y1);
          const a = (0.14 + t.golden * 0.1).toFixed(3);
          streak.addColorStop(0, `rgba(255,220,140,${a})`);
          streak.addColorStop(0.35, `rgba(255,220,140,${(Number(a) * 0.35).toFixed(3)})`);
          streak.addColorStop(1, 'rgba(255,220,140,0)');
          ctx.strokeStyle = streak;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
        ctx.restore();
      }

      // Moon with a correct phase.
      //
      // The lit region is bounded by the sunward limb on one side and the
      // terminator on the other, so it is drawn as one closed path rather
      // than as a full disc with a shape erased out of it. The terminator
      // is the half-ellipse x = r*cos(phase)*cos(t): it is a straight line
      // at a quarter moon and reaches the limb at new and full moon.
      // `sign` flips the terminator between the waxing and waning halves so
      // a crescent is always a crescent and a gibbous always a gibbous.
      if (t.moonVisible && !storm) {
        const mx = width * t.moonX, my = height * t.moonY, mr = Math.min(height * 0.19, 38);
        // phase: 0 = new, PI/2 = first quarter, PI = full, 3PI/2 = last quarter.
        const phase = moonPhase(wall) * Math.PI * 2;
        const cosPhase = Math.cos(phase);
        const lit = (1 - cosPhase) / 2;
        if (lit > 0.003) {
          const waxing = phase <= Math.PI;
          const sign = waxing ? 1 : -1;
          ctx.save();
          // Soft halo, drawn separately so the glow is not clipped by the
          // phase path.
          const glow = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 2.4);
          glow.addColorStop(0, 'rgba(225,238,255,.32)');
          glow.addColorStop(1, 'rgba(225,238,255,0)');
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(mx, my, mr * 2.4, 0, Math.PI * 2); ctx.fill();

          ctx.fillStyle = '#e8edff';
          ctx.beginPath();
          ctx.moveTo(mx, my - mr);
          // Sunward limb: the right half while waxing, the left while waning.
          // An anticlockwise arc sweeps the long way round, which is what
          // takes the limb past the bottom of the disc.
          ctx.arc(mx, my, mr, -Math.PI / 2, Math.PI / 2, !waxing);
          // Terminator, back up to the top of the disc.
          for (let i = 0; i <= 32; i++) {
            const th = Math.PI / 2 - (i / 32) * Math.PI;
            ctx.lineTo(mx + sign * mr * cosPhase * Math.cos(th), my + mr * Math.sin(th));
          }
          ctx.closePath();
          ctx.fill();
          // Subtle crater hint, kept inside the lit region.
          ctx.clip();
          ctx.globalAlpha = 0.06;
          ctx.fillStyle = '#8a9ab3';
          for (let i = 0; i < 3; i++) {
            const cx = mx + rand(-mr*0.6, mr*0.6), cy = my + rand(-mr*0.5, mr*0.5), cr = rand(2, 6);
            ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalAlpha = 1; ctx.restore();
        }
      }
    };

    const drawRain = (dt: number) => {
      if (!rain) return;
      const alpha = storm ? .52 : rainIntensity > .65 ? .46 : .32;
      ctx.lineCap = 'round';
      for (const p of particles) {
        p.x += (windX * 3.2 + 1.3) * p.z * dt * windFactor + (mouseX - 0.5) * 0.8 * dt;
        p.y += (8.5 + weather.wind * .09) * p.z * dt;
        if (p.y > height + 20) { p.y = rand(-height * .25, -8); p.x = rand(-15, width + 15); }
        if (p.x > width + 20) p.x = -15; if (p.x < -20) p.x = width + 20;
        const a = alpha * p.z * p.alpha;
        ctx.strokeStyle = `rgba(225,240,255,${a.toFixed(3)})`;
        ctx.lineWidth = p.size * p.z * 0.9;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - (4 + windX * 9) * p.z, p.y + 14 * p.z); ctx.stroke();
        if (p.y > height - 20 && Math.random() < 0.002 * p.z && ripples.length < 15) {
          ripples.push({ x: p.x, y: height - 4, radius: 2, maxRadius: rand(8, 16), alpha: rand(0.3, 0.6) });
        }
        if (p.y > height - 20 && Math.random() < 0.001 * p.z) {
          ctx.fillStyle = `rgba(220,235,255,${0.12 * p.z})`;
          ctx.beginPath(); ctx.arc(p.x, height - 2, rand(1.5, 3), 0, Math.PI); ctx.fill();
        }
      }
    };

    const drawSnow = (dt: number, now: number) => {
      if (!snow) return;
      for (const p of particles) {
        p.phase += dt * 0.0012;
        p.x += (windX * (1.3 + weather.wind * .05) + Math.sin(p.phase) * .3) * p.z * dt;
        p.y += (1.1 + p.speed * 1.15) * p.z * dt;
        if (p.y > height + 10) { p.y = -12; p.x = rand(0, width); }
        if (p.x > width + 12) p.x = -8; if (p.x < -12) p.x = width + 8;
        const shimmer = 0.5 + 0.4 * Math.sin(now * .0025 + p.phase);
        ctx.fillStyle = `rgba(250,254,255,${(shimmer * p.z * p.alpha).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, (1.2 + p.size * 1.4) * p.z, 0, Math.PI * 2); ctx.fill();
      }
    };

    const drawLightning = (now: number) => {
      if (!storm) return;
      if (!nextFlash) nextFlash = now + rand(2500, 6000);
      if (now > nextFlash) { flashUntil = now + rand(70, 160); nextFlash = now + rand(5000, 12000); }
      if (now > flashUntil) return;
      const boltX = width * rand(.5, .9), segments = 10;
      ctx.save(); ctx.globalAlpha = .92; ctx.shadowColor = '#dff8ff'; ctx.shadowBlur = 30;
      ctx.strokeStyle = '#eef8ff'; ctx.lineWidth = 2.8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(boltX, 0);
      let x = boltX, y = 0;
      for (let i = 1; i <= segments; i++) { y = height * .65 * i / segments; x += rand(-28, 28); ctx.lineTo(x, y); }
      ctx.stroke(); ctx.restore();
      const flash = ctx.createRadialGradient(boltX, height * .22, 12, boltX, height * .22, width * .9);
      flash.addColorStop(0, 'rgba(228,245,255,.32)'); flash.addColorStop(1, 'rgba(228,245,255,0)');
      ctx.fillStyle = flash; ctx.fillRect(0, 0, width, height);
    };

    const drawFog = (now: number) => {
      if (!fog) return;
      // Each bank is a soft ellipse. A rectangle filled with a horizontal
      // gradient still has hard top and bottom edges, which read as solid
      // horizontal bars across the sky.
      //
      // The ellipse and its gradient have to be built in the same space.
      // The shape is drawn as a circle of radius rx and the context is
      // squashed vertically, which turns it into an rx-by-ry ellipse; the
      // radial gradient is then squashed with it, so the falloff reaches
      // zero exactly at the shape's edge. If the two disagree the shape
      // clips the gradient at full opacity and the edge shows up as a bar.
      for (let i = 0; i < 6; i++) {
        const drift = ((now * (0.006 + i * .0025) * (windFactor + .15)) % (width + 900)) - 450;
        const cy = height * (.46 + i * .085);
        const rx = width * .55;
        const ry = height * .17;
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        g.addColorStop(0, `rgba(232,241,252,${(.13 - i * .015).toFixed(3)})`);
        g.addColorStop(.55, `rgba(232,241,252,${(.07 - i * .008).toFixed(3)})`);
        g.addColorStop(1, 'rgba(232,241,252,0)');
        ctx.save();
        ctx.translate(drift, cy);
        ctx.scale(1, ry / rx);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    };

    const draw = (rafTime: number) => {
      frameQueued = false;
      const dt = lastTime ? Math.min((rafTime - lastTime) / 16.67, 2.2) : 1;
      lastTime = rafTime;
      // Two clocks on purpose:
      //   `clock` is the animation clock (performance.now()). Drift, sway and
      //   twinkle are rates per millisecond, so they need a small monotonic
      //   value - an epoch timestamp would overflow the modulo arithmetic.
      //   `wall` is the wall-clock time. The solar and lunar calculations
      //   compare against real sunrise/sunset timestamps, so they need the
      //   epoch. Passing the RAF timestamp here made every scene render as
      //   night, because a small timestamp is always before sunrise.
      const clock = rafTime;
      const wall = Date.now();
      const t = solar(wall);
      const key = `${Math.round(t.dayFactor * 10)}-${Math.round(t.golden * 5)}`;
      if (key !== tintKey) { tintKey = key; buildClouds(t.dayFactor, t.golden); }

      // Parallax from mouse
      const parallaxX = (mouseX - 0.5) * 120;
      const parallaxY = (mouseY - 0.5) * 60;

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(parallaxX * 0.08, parallaxY * 0.05);
      drawSky(wall, clock);
      for (const c of clouds) drawCloud(c, clock, parallaxX);
      ctx.restore();
      drawFog(clock); drawRain(dt); drawSnow(dt, clock); drawLightning(clock);
      drawShootingStars(clamp(1 - t.dayFactor * 1.25, 0, 1));
      drawDust(dt, clock);
      drawRipples(dt);

      // Only ever one animation chain in flight. Guarding on `frameQueued`
      // keeps a stray extra draw() call from spawning a second loop.
      if (enabled && document.visibilityState === 'visible' && !frameQueued) {
        frameQueued = true;
        raf = requestAnimationFrame(draw);
      }
    };

    // Event listeners
    const onVisibility = () => {
      cancelAnimationFrame(raf); frameQueued = false; lastTime = 0;
      draw(performance.now());
    };
    document.addEventListener('visibilitychange', onVisibility);

    // The canvas bitmap is sized from the element's box. Without a resize
    // listener the scene keeps rendering at the old dimensions and is scaled
    // (stretched) by CSS when the window or the layout changes size.
    const onResize = () => { resize(); lastTime = 0; draw(performance.now()); };
    window.addEventListener('resize', onResize);

    resize();
    draw(performance.now());

    return () => {
      cancelAnimationFrame(raf);
      frameQueued = false;
      canvas.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
    };
  }, [weather.code, weather.isDay, weather.wind, weather.windDirection, weather.precipitation, weather.cloud, weather.temperature, weather.sunrise, weather.sunset, weather.nextSunrise, enabled, nightBackdrop]);

  return <canvas ref={canvasRef} className="weather-canvas" aria-hidden="true" />;
}