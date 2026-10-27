import { cloneElement, createElement, ElementType, Fragment, isValidElement, lazy, ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, AlertTriangle, Clock3, Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Droplets, LocateFixed, MapPin, RefreshCw, Search, Settings, Sun, Wind, X } from 'lucide-react';
import { celsius, description, europeanAqiLabel, fetchWeather, forecastSignals, isRainCode, isSnowCode, kmh, localTime as formatLocalTime, outdoorAirAdvice, Place, scene, searchPlaces, usAqiLabel, uvAdvice, WeatherBundle, WeatherScene } from './weather';
import { fetchOfficialAlerts, OfficialAlertsResult, OfficialSeverity, severityRank } from './officialAlerts';
import WeatherCanvas from './WeatherCanvas';
import { version as appVersion } from '../package.json';
import { isUrduLocale, translate, weatherDescription } from './i18n';
const WeatherMap = lazy(() => import('./WeatherMap'));

type Preferences = { unit: 'C'|'F'; wind: 'km/h'|'mph'; theme: 'system'|'light'|'dark'; locale: 'system'|'en-US'|'en-GB'|'ur-PK'; geocoderEndpoint: string; animate: boolean; reducedMotion: boolean; transparentPanels: boolean; pureBackground: boolean; layout: 'detailed'|'compact'; backgroundMode: boolean; dailyReminder: string; refresh: number; saved: Place[]; active?: Place; locationStatus: string; alerts: boolean; alertCategories: string[]; alertNotified: string[]; officialAlertNotifications: boolean; officialAlertMinimumSeverity: Exclude<OfficialSeverity,'unknown'>; officialAlertNotified: string[]; defaultPlaceId: string; quietHoursStart: string; quietHoursEnd: string; highContrast: boolean; widgetOpacity: number; widgetScale: number };
const defaults: Preferences = { unit: 'C', wind: 'km/h', theme: 'system', locale: 'system', geocoderEndpoint: 'https://nominatim.openstreetmap.org/reverse', animate: true, reducedMotion: false, transparentPanels: false, pureBackground: false, layout: 'detailed', backgroundMode: false, dailyReminder: '', refresh: 30, saved: [], locationStatus: 'Location access has not been requested', alerts: false, alertCategories: ['thunderstorm','heavy-rain','high-wind'], alertNotified: [], officialAlertNotifications: false, officialAlertMinimumSeverity: 'moderate', officialAlertNotified: [], defaultPlaceId: '', quietHoursStart: '', quietHoursEnd: '', highContrast: false, widgetOpacity: 100, widgetScale: 100 };
const severityLabel = (value: OfficialSeverity) => value === 'unknown' ? 'Severity not provided' : value[0].toUpperCase() + value.slice(1);
const temperatureFor = (value: number, unit: 'C'|'F') => `${celsius(value,unit)}°${unit}`;

// A dedicated crescent moon. Lucide's moon is a thin stroked path, and filling
// it for the solid icon treatment turns it into a heavy blob, so the night
// condition uses this smooth filled crescent instead.
const CrescentMoon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
    <path d="M9.37 5.51A7.35 7.35 0 0 0 9.1 7.5c0 4.08 3.32 7.4 7.4 7.4.68 0 1.35-.09 1.99-.27A7.014 7.014 0 0 1 12 19c-3.86 0-7-3.14-7-7 0-2.93 1.81-5.45 4.37-6.49Z"/>
  </svg>
);

const iconFor = (code: number, day = true, size = 22) => {
  const props = { size, strokeWidth: 2, fill: 'currentColor' };
  if (code >= 95) return <CloudLightning {...props}/>;
  // Use the shared WMO helpers so the icon agrees with `scene()` and the
  // canvas. Showers of rain (80-82) must not render as snow.
  if (isSnowCode(code)) return <CloudSnow {...props}/>;
  if (isRainCode(code)) return <CloudRain {...props}/>;
  if (code >= 45 && code <= 48) return <CloudFog {...props}/>;
  if (code === 3) return <Cloud {...props}/>;
  if (code > 0 && code <= 2 && day) return <CloudSun {...props}/>;
  return day ? <Sun {...props}/> : <CrescentMoon size={size}/>;
};

const NavIcon = ({ icon, size = 18 }: { icon: ElementType; size?: number }) => (
  <span style={{ display: 'flex', width: size, height: size }}>{createElement(icon, { size })}</span>
);

const NavItem = ({ icon, label, active, onClick, badge }: { icon: ElementType; label: string; active: boolean; onClick: () => void; badge?: string }) => (
  <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
    <NavIcon icon={icon} />
    <span style={{ flex: 1 }}>{label}</span>
    {badge && <span className="badge badge-primary" style={{ fontSize: 10 }}>{badge}</span>}
  </button>
);

const ToolbarBtn = ({ icon, active, onClick, disabled, ariaLabel, size = 16 }: { icon: ElementType; active?: boolean; onClick: () => void; disabled?: boolean; ariaLabel: string; size?: number }) => (
  <button className={`toolbar-btn ${active ? 'active' : ''}`} onClick={onClick} disabled={disabled} aria-label={ariaLabel} aria-pressed={active}>
    <NavIcon icon={icon} size={size} />
  </button>
);

const MetricCard = ({ icon, label, value, unit }: { icon: ReactNode; label: string; value: string | number; unit?: string }) => (
  <article className="card metric-card">
    <div className="card-header">
      <span className="metric-label">{label}</span>
      <span className="metric-icon">{icon}</span>
    </div>
    <div>
      <span className="metric-value">{value}</span>
      {unit && <span className="metric-unit">{unit}</span>}
    </div>
  </article>
);

const EmptyState = ({ icon, title, description, actions }: { icon: ReactNode; title: string; description: string; actions?: ReactNode }) => (
  <section className="section" style={{ textAlign: 'center', padding: '64px 32px' }}>
    <div style={{ width: 64, height: 64, margin: '0 auto 16px', color: 'var(--fg-tertiary)' }}>{icon}</div>
    <h2 style={{ font: '600 20px var(--font-sans)', color: 'var(--fg-primary)', margin: '0 0 8px' }}>{title}</h2>
    <p style={{ font: '400 14px var(--font-sans)', color: 'var(--fg-secondary)', margin: '0 0 24px', maxWidth: 320, marginLeft: 'auto', marginRight: 'auto' }}>{description}</p>
    {actions && <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>{actions}</div>}
  </section>
);

const validPlace = (p: unknown): p is Place => Boolean(p && typeof p === 'object' && typeof (p as Place).id === 'string' && typeof (p as Place).name === 'string' && typeof (p as Place).country === 'string' && Number.isFinite((p as Place).latitude) && Math.abs((p as Place).latitude) <= 90 && Number.isFinite((p as Place).longitude) && Math.abs((p as Place).longitude) <= 180 && typeof (p as Place).timezone === 'string');

const cached = (): WeatherBundle|null => {
  try {
    const value = localStorage.getItem('atmosphere-cache'); if (!value) return null;
    const parsed = JSON.parse(value) as Partial<WeatherBundle>;
    const currentFields = ['temperature','apparent','code','humidity','wind','windDirection','gust','pressure','precipitation','cloud','uv','dewPoint'];
    const currentValid = parsed.current && currentFields.every(key => Number.isFinite((parsed.current as unknown as Record<string, unknown>)[key]));
    if (validPlace(parsed.place) && currentValid && typeof parsed.current?.time === 'string' && typeof parsed.current?.isDay === 'boolean' && Array.isArray(parsed.hourly) && parsed.hourly.every(h => h && typeof h.time === 'string' && Number.isFinite(h.temperature) && Number.isFinite(h.code)) && Array.isArray(parsed.daily) && parsed.daily.length > 0 && typeof parsed.fetchedAt === 'string') return parsed as WeatherBundle;
    localStorage.removeItem('atmosphere-cache'); return null;
  } catch { localStorage.removeItem('atmosphere-cache'); return null; }
};

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();
const niceDate = (s: string, opts: Intl.DateTimeFormatOptions, locale?: string) => {
  const key = `${locale ?? ''}|${opts.weekday ?? ''}|${opts.month ?? ''}|${opts.day ?? ''}|${opts.year ?? ''}|${opts.hour ?? ''}|${opts.minute ?? ''}`;
  let formatter = dateFormatterCache.get(key);
  if (!formatter) { formatter = new Intl.DateTimeFormat(locale || undefined, opts); dateFormatterCache.set(key, formatter); }
  return formatter.format(new Date(s));
};

const distanceKm = (a: Pick<GeolocationCoordinates, 'latitude'|'longitude'>, b: Pick<GeolocationCoordinates, 'latitude'|'longitude'>) => {
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

export default function App() {
  const isWidgetWindow = new URLSearchParams(window.location.search).get('widget') === '1';
  // macOS draws native traffic lights, so the in-app ones are only for Windows.
  const isMacPlatform = /Mac/i.test(navigator.userAgent);
  const [prefs, setPrefs] = useState<Preferences>(defaults);
  const isUrdu = isUrduLocale(prefs.locale === 'system' ? navigator.language : prefs.locale);
  const t = (text: string) => translate(text, isUrdu);
  const weatherText = (code: number) => weatherDescription(code, isUrdu) ?? description(code);
  const localize = (node: ReactNode): ReactNode => {
    if (typeof node === 'string') {
      const leading = node.match(/^\s*/)?.[0] ?? '', trailing = node.match(/\s*$/)?.[0] ?? '';
      const content = node.slice(leading.length, node.length - trailing.length);
      const localized = t(content);
      return `${leading}${isUrdu ? localized.replace(/[0-9]/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]) : localized}${trailing}`;
    }
    if (typeof node === 'number') return isUrdu ? new Intl.NumberFormat('ur-PK').format(node) : node;
    if (Array.isArray(node)) return node.map((child, index) => <Fragment key={index}>{localize(child)}</Fragment>);
    if (isValidElement<{ children?: ReactNode }>(node) && node.props.children != null) return cloneElement(node, undefined, localize(node.props.children));
    return node;
  };
  const [data, setData] = useState<WeatherBundle|null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [settings, setSettings] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [systemTheme, setSystemTheme] = useState<'dark'|'light'>('dark');
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [hydrated, setHydrated] = useState(false);
  const [selectedDay, setSelectedDay] = useState(0);
  const [demoScene, setDemoScene] = useState<WeatherScene|null>(null);
  const [windowHidden, setWindowHidden] = useState(false);
  const [trackingLocation, setTrackingLocation] = useState(false);
  const [locationUpdatedAt, setLocationUpdatedAt] = useState<string|null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [updateStatus, setUpdateStatus] = useState<{ state: string; message: string; version?: string; percent?: number }>({ state: 'idle', message: 'Update status has not been checked.' });
  const [officialAlertsState, setOfficialAlertsState] = useState<{ placeKey: string; result: OfficialAlertsResult }|null>(null);
  const [officialAlertsLoading, setOfficialAlertsLoading] = useState(false);
  const [officialAlertsError, setOfficialAlertsError] = useState('');
  const [officialAlertRefreshKey, setOfficialAlertRefreshKey] = useState(0);
  const [notificationMinute, setNotificationMinute] = useState(Date.now());
  const [chartDataVisible, setChartDataVisible] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [activeNav, setActiveNav] = useState('current');
  const requestRef = useRef<AbortController|null>(null);
  const geoWatchRef = useRef<number|null>(null);
  const lastGeoLookupRef = useRef<{ latitude: number; longitude: number; checkedAt: number }|null>(null);
  const geoResolveInFlightRef = useRef(false);
  const dataRef = useRef(data); dataRef.current = data;
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const activeAlertPlaceKey = prefs.active ? `${prefs.active.id}:${prefs.active.latitude.toFixed(4)},${prefs.active.longitude.toFixed(4)}` : '';
  const officialAlertsResult = officialAlertsState?.placeKey === activeAlertPlaceKey ? officialAlertsState.result : null;

  useEffect(() => () => {
    requestRef.current?.abort();
    if (geoWatchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(geoWatchRef.current);
  }, []);

  useEffect(() => {
    const updateVisibility = () => setWindowHidden(document.visibilityState !== 'visible');
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  useEffect(() => {
    if (!window.atmosphere) return;
    let active = true;
    void window.atmosphere.updateStatus().then(status => { if (active && status) setUpdateStatus(status); });
    const unsubscribe = window.atmosphere.onUpdateStatus(status => setUpdateStatus(status));
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!settings) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]') ?? [])].filter(el => el.tabIndex >= 0);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSettings(false); }
      if (event.key !== 'Tab') return;
      const elements = focusable(); if (!elements.length) return;
      if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0].focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [settings]);

  useEffect(() => { const timer = window.setInterval(() => setNotificationMinute(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);

  // The window has no in-app maximize button, and a frameless window does not
  // get the Windows system shortcuts for free. Bind them here so the keyboard
  // still controls the window the way it does in every other Windows app.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowUp') { event.preventDefault(); void window.atmosphere?.toggleMaximize?.(); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); void window.atmosphere?.restore?.(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true), onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  useEffect(() => {
    if (window.atmosphere) void window.atmosphere.systemTheme().then(setSystemTheme);
    else if (window.matchMedia('(prefers-color-scheme: light)').matches) setSystemTheme('light');
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onTheme = (event: MediaQueryListEvent) => { if (prefs.theme === 'system') setSystemTheme(event.matches ? 'light' : 'dark'); };
    media.addEventListener('change', onTheme);
    return () => media.removeEventListener('change', onTheme);
  }, [prefs.theme]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotionPreference = (event: MediaQueryListEvent) => setSystemReducedMotion(event.matches);
    setSystemReducedMotion(media.matches);
    media.addEventListener('change', onMotionPreference);
    return () => media.removeEventListener('change', onMotionPreference);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = window.atmosphere ? await window.atmosphere.readSettings() : (() => { try { return JSON.parse(localStorage.getItem('atmosphere-settings') || '{}'); } catch { return {}; } })();
      if (!alive) return;
      const source = stored && typeof stored === 'object' ? stored : {};
      const next = { ...defaults, ...source,
        unit: source.unit === 'F' ? 'F' : 'C', wind: source.wind === 'mph' ? 'mph' : 'km/h',
        theme: ['system','light','dark'].includes(String(source.theme)) ? source.theme : defaults.theme,
        locale: ['system','en-US','en-GB','ur-PK'].includes(String(source.locale)) ? source.locale : defaults.locale,
        geocoderEndpoint: typeof source.geocoderEndpoint === 'string' && /^https:\/\//i.test(source.geocoderEndpoint) ? source.geocoderEndpoint : defaults.geocoderEndpoint,
        animate: source.animate !== false,
        // Seed the switch from the operating system on a fresh install, then
        // let the explicit in-app choice govern from then on.
        reducedMotion: source.reducedMotion === undefined ? systemReducedMotion : source.reducedMotion === true,
        transparentPanels: source.transparentPanels === true,
        layout: source.layout === 'compact' ? 'compact' : 'detailed', backgroundMode: source.backgroundMode === true,
        dailyReminder: typeof source.dailyReminder === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(source.dailyReminder) ? source.dailyReminder : '',
        refresh: [0,10,15,30,60].includes(Number(source.refresh)) ? Number(source.refresh) : defaults.refresh,
        alerts: source.alerts === true,
        saved: Array.isArray(source.saved) ? source.saved.filter(validPlace) : [],
        active: validPlace(source.active) ? source.active : undefined,
        alertCategories: Array.isArray(source.alertCategories) ? source.alertCategories.filter((c: unknown) => ['thunderstorm','heavy-rain','high-wind','heat','cold'].includes(String(c))) : defaults.alertCategories,
        alertNotified: Array.isArray(source.alertNotified) ? source.alertNotified.filter((x: unknown) => typeof x === 'string').slice(-500) : [],
        officialAlertNotifications: source.officialAlertNotifications === true,
        officialAlertMinimumSeverity: ['extreme','severe','moderate','minor'].includes(String(source.officialAlertMinimumSeverity)) ? source.officialAlertMinimumSeverity : defaults.officialAlertMinimumSeverity,
        officialAlertNotified: Array.isArray(source.officialAlertNotified) ? source.officialAlertNotified.filter((x: unknown) => typeof x === 'string' && x.length <= 180).slice(-300) : [],
        defaultPlaceId: typeof source.defaultPlaceId === 'string' && source.defaultPlaceId.length <= 120 ? source.defaultPlaceId : '',
        quietHoursStart: typeof source.quietHoursStart === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(source.quietHoursStart) ? source.quietHoursStart : '',
        quietHoursEnd: typeof source.quietHoursEnd === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(source.quietHoursEnd) ? source.quietHoursEnd : '',
        highContrast: source.highContrast === true
      } as Preferences;
      setPrefs(next);
      const c = cached(); if (c) { setData(c); setStale(true); }
      const startupPlace = next.saved.find((savedPlace: Place) => savedPlace.id === next.defaultPlaceId) ?? next.active;
      if (startupPlace) void load(startupPlace, next.refresh);
      setHydrated(true);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const value = JSON.stringify(prefs); localStorage.setItem('atmosphere-settings', value);
    // The main window owns the settings file. The widget reads it and
    // receives changes, but it must never write to it: its copy of the
    // preferences can lag behind, and a write from the widget would overwrite
    // the newer settings the main window had just saved.
    if (isWidgetWindow) return;
    if (window.atmosphere) void window.atmosphere.writeSettings(prefs as unknown as Record<string, unknown>);
  }, [prefs, hydrated, isWidgetWindow]);

  // The widget keeps its own copy of the preferences. The main window pushes
  // them whenever they change, so a theme, unit or widget-appearance change
  // reaches the widget straight away instead of waiting for it to be closed
  // and reopened.
  useEffect(() => {
    if (!isWidgetWindow) return;
    const unsubscribe = window.atmosphere?.onSettingsChanged?.((next) => {
      if (!next || typeof next !== 'object') return;
      const source = next as Partial<Preferences>;
      setPrefs(previous => ({
        ...previous,
        unit: source.unit === 'F' ? 'F' : 'C',
        wind: source.wind === 'mph' ? 'mph' : 'km/h',
        theme: ['system', 'light', 'dark'].includes(String(source.theme)) ? (source.theme as Preferences['theme']) : previous.theme,
        widgetOpacity: [25, 50, 75, 100].includes(Number(source.widgetOpacity)) ? Number(source.widgetOpacity) : previous.widgetOpacity,
        widgetScale: [75, 100, 125, 150].includes(Number(source.widgetScale)) ? Number(source.widgetScale) : previous.widgetScale,
        animate: source.animate !== false,
        reducedMotion: source.reducedMotion === true,
        active: validPlace(source.active) ? source.active : previous.active,
      }));
    });
    return () => unsubscribe?.();
  }, [isWidgetWindow]);

  // The widget's window has to match its size preference, and only the main
  // process can resize a window. The main process ignores resize requests
  // while a drag is active so the drag keeps its starting dimensions.
  useEffect(() => {
    if (!isWidgetWindow || !hydrated) return;
    void window.atmosphere?.resizeWidget?.(prefs.widgetScale);
  }, [isWidgetWindow, hydrated, prefs.widgetScale]);

  // The widget refreshes on the same schedule as the app. The app's own
  // interval is keyed off the main window's state, so the widget needs its
  // own, or it would show a reading from whenever it was opened.
  useEffect(() => {
    if (!isWidgetWindow || !hydrated || !prefs.active || prefs.refresh === 0) return;
    const id = window.setInterval(() => void loadRef.current(prefs.active!), prefs.refresh * 60_000);
    return () => window.clearInterval(id);
  }, [isWidgetWindow, hydrated, prefs.active, prefs.refresh]);

  // When the main window refreshes, the widget refreshes too, so the two
  // never show readings from different moments.
  useEffect(() => {
    if (!isWidgetWindow) return;
    const unsubscribe = window.atmosphere?.onWidgetRefresh?.(() => {
      const place = prefsRef.current.active;
      if (place) void loadRef.current(place);
    });
    return () => unsubscribe?.();
  }, [isWidgetWindow]);

  useEffect(() => {
    const notifyForecast = window.atmosphere?.notifyForecast;
    if (isWidgetWindow || !hydrated || !prefs.dailyReminder || !data || !notifyForecast) return;
    const check = () => {
      const now = new Date();
      const dayKey = `atmosphere-reminder:${data.place.id}:${now.toLocaleDateString('en-CA',{timeZone:data.place.timezone})}`;
      const time = new Intl.DateTimeFormat('en-GB',{timeZone:data.place.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
      if (time !== prefs.dailyReminder || localStorage.getItem(dayKey)) return;
      const score = (hour: WeatherBundle['hourly'][number]) => hour.precipitationChance*1.2 + hour.wind*.55 + Math.max(0,16-hour.temperature)*1.1 + Math.max(0,hour.temperature-29)*1.3;
      const best = data.hourly.filter(hour=>hour.precipitationChance<35 && hour.wind<35 && hour.temperature>=10 && hour.temperature<=32).sort((a,b)=>score(a)-score(b))[0];
      const summary = best ? `Best outdoor window near ${localTime(best.time,data.place.timezone)}: ${temperatureFor(best.temperature,prefs.unit)}, ${best.precipitationChance}% rain chance, wind ${kmh(best.wind,prefs.wind)} ${prefs.wind}.` : `Check today's forecast before planning outdoor activities in ${data.place.name}.`;
      localStorage.setItem(dayKey,'sent');
      void notifyForecast({title:`${data.place.name} · daily weather plan`,body:summary});
    };
    check(); const timer=window.setInterval(check,30_000); return ()=>window.clearInterval(timer);
  },[hydrated,prefs.dailyReminder,prefs.unit,prefs.wind,data,isWidgetWindow]);

  const load = useCallback(async (place: Place, _interval?: number) => {
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    setLoading(true); setError('');
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const next = await fetchWeather(place, controller.signal);
      if (controller.signal.aborted) return;
      const alertPrefs = prefsRef.current;
      if (!isWidgetWindow && alertPrefs.alerts && window.atmosphere?.notifyForecast) {
        const sent = new Set(alertPrefs.alertNotified);
        const upcoming = forecastSignals(next).filter(signal => signal.time > new Date().toISOString() && alertPrefs.alertCategories.includes(signal.category) && !sent.has(signal.id));
        const newlyNotified = upcoming.map(signal => signal.id);
        if (newlyNotified.length) {
          setPrefs(p => ({ ...p, alertNotified: [...p.alertNotified, ...newlyNotified].slice(-500) }));
          for (const signal of upcoming) void window.atmosphere.notifyForecast({ title: signal.title, body: `${signal.description} · ${formatLocalTime(signal.time, next.place.timezone, { hour: 'numeric', minute: '2-digit' }, alertPrefs.locale === 'system' ? (isUrduLocale(navigator.language) ? 'ur-PK' : undefined) : alertPrefs.locale)}` });
        }
      }
      setData(next); setStale(false); setPrefs(p => ({ ...p, active: next.place, saved: p.saved.some(x => x.id === next.place.id) ? p.saved.map(x => x.id === next.place.id ? next.place : x) : [next.place, ...p.saved] }));
      localStorage.setItem('atmosphere-cache', JSON.stringify(next));
      // Let the widget know the forecast moved on, so it can fetch the same
      // reading instead of showing a stale one.
      if (!isWidgetWindow) void window.atmosphere?.refreshWidget?.();
    } catch (e) { if (!controller.signal.aborted && requestRef.current === controller) { setError(e instanceof Error ? e.message : 'Weather could not be updated.'); if (data || cached()) setStale(true); } }
    finally { window.clearTimeout(timeout); if (requestRef.current === controller) setLoading(false); }
  }, [data,isWidgetWindow]);
  const loadRef = useRef(load); loadRef.current = load;

  useEffect(() => {
    if (!prefs.active || prefs.refresh === 0) return;
    const id = window.setInterval(() => void load(prefs.active!), prefs.refresh * 60_000);
    return () => window.clearInterval(id);
  }, [prefs.active, prefs.refresh, load]);

  useEffect(() => {
    const active = prefs.active;
    if (isWidgetWindow) return;
    if (!active) { setOfficialAlertsState(null); setOfficialAlertsError(''); return; }
    let alive = true;
    const controller = new AbortController();
    const refreshOfficialAlerts = async () => {
      setOfficialAlertsLoading(true); setOfficialAlertsError('');
      try {
        const result = await fetchOfficialAlerts(active, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
        if (alive) setOfficialAlertsState({ placeKey: `${active.id}:${active.latitude.toFixed(4)},${active.longitude.toFixed(4)}`, result });
      } catch (cause) {
        if (alive && !controller.signal.aborted) setOfficialAlertsError(cause instanceof Error ? cause.message : 'Official alerts could not be checked.');
      } finally { if (alive) setOfficialAlertsLoading(false); }
    };
    void refreshOfficialAlerts();
    const timer = window.setInterval(() => void refreshOfficialAlerts(), 5 * 60_000);
    return () => { alive = false; controller.abort(); window.clearInterval(timer); };
  }, [prefs.active?.id, prefs.active?.latitude, prefs.active?.longitude, prefs.active?.name, prefs.active?.admin1, prefs.active?.country, officialAlertRefreshKey,isWidgetWindow]);

  useEffect(() => {
    const now = new Date(); const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    const parseMinute = (value: string) => value ? Number(value.slice(0,2)) * 60 + Number(value.slice(3)) : null;
    const quietStart = parseMinute(prefs.quietHoursStart), quietEnd = parseMinute(prefs.quietHoursEnd);
    const quiet = quietStart !== null && quietEnd !== null && quietStart !== quietEnd && (quietStart < quietEnd ? minuteOfDay >= quietStart && minuteOfDay < quietEnd : minuteOfDay >= quietStart || minuteOfDay < quietEnd);
    if (quiet || isWidgetWindow || !prefs.officialAlertNotifications || officialAlertsResult?.status !== 'available' || !window.atmosphere?.notifyForecast) return;
    const minimum = severityRank[prefs.officialAlertMinimumSeverity];
    const sent = new Set(prefs.officialAlertNotified);
    const fresh = officialAlertsResult.alerts
      .filter(alert => severityRank[alert.severity] >= minimum && alert.severity !== 'unknown' && !sent.has(alert.id.slice(0,180)))
      .sort((a,b) => severityRank[b.severity] - severityRank[a.severity])
      .slice(0, 3);
    if (!fresh.length) return;
    setPrefs(previous => ({ ...previous, officialAlertNotified: [...previous.officialAlertNotified, ...fresh.map(alert => alert.id.slice(0,180))].slice(-300) }));
    for (const alert of fresh) {
      const zone = data?.place.timezone && data.place.timezone !== 'auto' ? data.place.timezone : prefs.active?.timezone && prefs.active.timezone !== 'auto' ? prefs.active.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone;
      const timing = alert.expires ? ` · until ${formatLocalTime(alert.expires, zone, { hour: 'numeric', minute: '2-digit' }, prefs.locale === 'system' ? (isUrduLocale(navigator.language) ? 'ur-PK' : undefined) : prefs.locale)}` : '';
      void window.atmosphere.notifyForecast({ title: `${severityLabel(alert.severity)} · ${alert.event}`, body: `${alert.title} · ${alert.area}${timing}` });
    }
  }, [officialAlertsResult, prefs.officialAlertNotifications, prefs.officialAlertMinimumSeverity, prefs.quietHoursStart, prefs.quietHoursEnd, notificationMinute, isWidgetWindow]);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const abort = new AbortController(); const timer = window.setTimeout(async () => {
      setSearching(true); try { setResults(await searchPlaces(query, abort.signal, isUrdu ? 'ur' : 'en')); } catch { if (!abort.signal.aborted) setResults([]); } finally { if (!abort.signal.aborted) setSearching(false); }
    }, 300);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [query, isUrdu]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || ['INPUT','SELECT','TEXTAREA','BUTTON','A'].includes(event.target.tagName))) return;
      if (event.key.toLowerCase() === 's') setSettings(true);
      if (event.key.toLowerCase() === 'r' && prefs.active) void load(prefs.active);
      if (event.key === '?' || (event.shiftKey && event.key === '/')) { event.preventDefault(); setShowHelp(v => !v); setSettings(false); }
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && prefs.saved.length > 1) {
        const index = prefs.saved.findIndex(p => p.id === prefs.active?.id);
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        selectPlace(prefs.saved[(index + delta + prefs.saved.length) % prefs.saved.length]);
      }
      if (event.key === 'Escape') { if (showHelp) setShowHelp(false); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [prefs.saved, prefs.active, load, showHelp]);

  const stopLocationTracking = () => {
    if (geoWatchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(geoWatchRef.current);
    geoWatchRef.current = null;
    setTrackingLocation(false);
  };

  const detect = () => {
    if (!navigator.geolocation) { setPrefs(p => ({ ...p, locationStatus: 'Location is not available on this device. Search for a city instead.' })); return; }
    if (geoWatchRef.current !== null) {
      stopLocationTracking();
      setPrefs(p => ({ ...p, locationStatus: 'Live location paused.' }));
      return;
    }
    lastGeoLookupRef.current = null;
    geoResolveInFlightRef.current = false;
    setLocationUpdatedAt(null);
    setTrackingLocation(true);
    setPrefs(p => ({ ...p, locationStatus: 'Waiting for Windows location permission…' }));

    const onPosition = async (pos: GeolocationPosition) => {
      const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setLocationUpdatedAt(new Date(pos.timestamp || Date.now()).toISOString());
      const previousFix = lastGeoLookupRef.current;
      const distance = previousFix ? distanceKm(previousFix, coords) : Infinity;
      if (distance < 0.75 || geoResolveInFlightRef.current || previousFix && Date.now() - previousFix.checkedAt < 3500) return;
      geoResolveInFlightRef.current = true;
      let resolved: { name: string; admin1?: string; country: string } | null = null;
      try {
        if (window.atmosphere) resolved = await window.atmosphere.reverseGeocode(coords, prefsRef.current.geocoderEndpoint);
        else {
          const endpoint = new URL(prefsRef.current.geocoderEndpoint);
          const q = new URLSearchParams({ format: 'jsonv2', lat: String(coords.latitude), lon: String(coords.longitude), latitude: String(coords.latitude), longitude: String(coords.longitude), zoom: '10', addressdetails: '1' });
          const response = await fetch(`${endpoint.href}?${q}`, { signal: AbortSignal.timeout(7000) });
          if (response.ok) {
            const result = await response.json(), address = result.address;
            if (typeof result.name === 'string' && typeof result.country === 'string') resolved = result;
            const name = address?.city || address?.town || address?.village || address?.municipality || address?.hamlet || address?.suburb || address?.county;
            if (!resolved && name) resolved = { name, admin1: address.state || address.region || '', country: address.country || '' };
          }
        }
      } catch { /* Weather still works when the place-name lookup is unavailable. */ }
      finally { geoResolveInFlightRef.current = false; }

      const previousPlace = prefsRef.current.active;
      const p: Place = {
        id: 'geo-live-location', name: resolved?.name ?? (previousPlace?.id.startsWith('geo-') ? previousPlace.name : 'My location'),
        admin1: resolved?.admin1 ?? (previousPlace?.id.startsWith('geo-') ? previousPlace.admin1 : undefined),
        country: resolved?.country ?? (previousPlace?.id.startsWith('geo-') ? previousPlace.country : ''),
        latitude: coords.latitude, longitude: coords.longitude, timezone: previousPlace?.timezone ?? 'auto',
      };
      lastGeoLookupRef.current = { ...coords, checkedAt: Date.now() };
      const nameChanged = !previousPlace?.id.startsWith('geo-') || previousPlace.name !== p.name || previousPlace.admin1 !== p.admin1 || previousPlace.country !== p.country;
      setPrefs(prev => ({ ...prev, active: p, locationStatus: resolved ? 'Live location is active' : 'Live location is active · place-name lookup unavailable' }));
      if (!dataRef.current || nameChanged || distance >= 4) await loadRef.current(p);
    };

    const onError = (err: GeolocationPositionError) => {
      if (err.code === 1) stopLocationTracking();
      setPrefs(p => ({ ...p, locationStatus: err.code === 1 ? 'Location permission was denied. Search for a city to continue.' : 'Waiting for a location fix…' }));
    };
    geoWatchRef.current = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: false, timeout: 30000, maximumAge: 15000 });
  };

  const selectPlace = (place: Place) => {
    const wasTracking = geoWatchRef.current !== null;
    if (wasTracking) stopLocationTracking();
    setPrefs(p => ({ ...p, active: place, saved: p.saved.some(s => s.id === place.id) ? p.saved : [place, ...p.saved], locationStatus: wasTracking ? 'Live location paused · showing selected place' : p.locationStatus }));
    setQuery(''); setResults([]); void load(place);
  };
  const current = data?.current;
  const place = data?.place ?? prefs.active;
  useEffect(() => {
    const theme = prefs.theme === 'system' ? systemTheme : prefs.theme;
    document.body.classList.toggle('theme-light', theme === 'light');
    document.body.classList.toggle('theme-dark', theme === 'dark');
  }, [prefs.theme, systemTheme]);

  useEffect(() => {
    if (!hydrated || isWidgetWindow) return;
    let weather: Parameters<NonNullable<Window['atmosphere']>['updateTaskbarWeather']>[0] = null;
    if (current && data) {
      // Only the tray tooltip and window thumbnail carry the reading. The
      // taskbar button itself keeps the plain application icon.
      weather = { temperature: celsius(current.temperature, prefs.unit), unit: prefs.unit, placeName: data.place.name };
    }
    void window.atmosphere?.updateTaskbarWeather(weather);
  }, [current?.temperature, data?.place.name, hydrated, isWidgetWindow, prefs.unit]);
  const activeScene = demoScene ?? scene(current?.code ?? 0, current?.isDay ?? true, current?.wind ?? 0, current?.precipitation ?? 0);
  const day = data?.daily[selectedDay];
  // Sunrise and sunset for the day that is actually happening at the place,
  // so the scene stays correct when the app stays open past midnight. The
  // next day's sunrise is returned too so the canvas can size tonight's arc.
  const solar = useMemo(() => {
    const days = data?.daily ?? [];
    if (!days.length || !data) return { today: undefined, nextSunrise: undefined };
    try {
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: data.place.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const index = days.findIndex(d => d.date === key);
      // Fall back to the last day that has already started, so a forecast that
      // is a few days stale still resolves to the day in progress.
      const resolved = index >= 0 ? index : Math.max(0, days.findIndex(d => d.date > key) - 1);
      return { today: days[resolved], nextSunrise: days[resolved + 1]?.sunrise };
    } catch { return { today: days[0], nextSunrise: days[1]?.sunrise }; }
  }, [data]);
  const solarDay = solar.today;
  const displayLocale = prefs.locale === 'system' ? (isUrdu ? 'ur-PK' : undefined) : prefs.locale;
  const localTime = (iso: string, timezone: string, options: Intl.DateTimeFormatOptions = { hour: 'numeric' }) => formatLocalTime(iso, timezone, isUrdu ? { ...options, hourCycle: 'h23' } : options, displayLocale);
  const alertTimezone = data?.place.timezone && data.place.timezone !== 'auto' ? data.place.timezone : prefs.active?.timezone && prefs.active.timezone !== 'auto' ? prefs.active.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const alertTime = (iso?: string) => iso && Number.isFinite(Date.parse(iso)) ? localTime(iso, alertTimezone, { weekday: 'short', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }) : 'Time not provided';
  const dailyStats = useMemo(() => {
    const daily = data?.daily ?? [];
    let low = Infinity, high = -Infinity;
    for (const d of daily) { if (d.low < low) low = d.low; if (d.high > high) high = d.high; }
    return { low: Number.isFinite(low) ? low : 0, high: Number.isFinite(high) ? high : 0 };
  }, [data]);
  const chart = useMemo(() => data?.hourly.slice(0, 24).map(h => ({ ...h, label: localTime(h.time, data.place.timezone, { hour: 'numeric' }), fullLabel: localTime(h.time, data.place.timezone, { weekday: 'short', hour: 'numeric', minute: '2-digit' }), cond: weatherText(h.code) })) ?? [], [data, displayLocale, isUrdu]);
  const bestOutdoorHour = useMemo(() => data?.hourly.filter(hour=>hour.precipitationChance<35 && hour.wind<35 && hour.temperature>=10 && hour.temperature<=32).sort((a,b)=>{
    const score=(h:WeatherBundle['hourly'][number])=>h.precipitationChance*1.2+h.wind*.55+Math.max(0,16-h.temperature)*1.1+Math.max(0,h.temperature-29)*1.3;
    return score(a)-score(b);
  })[0] ?? null,[data]);
  const rainSoonHour = data?.hourly.find(hour=>hour.precipitationChance>=40) ?? null;
  const wind = (n: number) => `${new Intl.NumberFormat(displayLocale, { maximumFractionDigits: 0 }).format(kmh(n, prefs.wind))} ${prefs.wind}`;
  const compass = (degrees: number) => `${['N','NE','E','SE','S','SW','W','NW'][Math.round(degrees / 45) % 8]} · ${Math.round(degrees)}°`;
  const chooseDemo = (value: string) => { setDemoScene(value === 'live' ? null : value as WeatherScene); setSettings(false); };
  const temperature = (n: number) => `${new Intl.NumberFormat(displayLocale, { maximumFractionDigits: 0 }).format(celsius(n, prefs.unit))}°${prefs.unit}`;
  const clearLocalData = () => {
    localStorage.removeItem('atmosphere-cache');
    void window.atmosphere?.clearPlaceNameCache();
    setData(null); setStale(false); setError('');
    const cleared = { ...prefsRef.current, saved: [], active: undefined, defaultPlaceId: '', alertNotified: [], officialAlertNotified: [], locationStatus: 'Saved locations and local weather cache cleared' };
    prefsRef.current = cleared; setPrefs(cleared);
    localStorage.setItem('atmosphere-settings', JSON.stringify(cleared));
    void window.atmosphere?.writeSettings(cleared as unknown as Record<string, unknown>);
  };
  const removeSaved = (id: string) => setPrefs(p => ({ ...p, saved: p.saved.filter(x => x.id !== id), active: p.active?.id === id ? undefined : p.active, defaultPlaceId: p.defaultPlaceId === id ? '' : p.defaultPlaceId }));
  const alertOptions = [
    ['thunderstorm','Thunderstorms'], ['heavy-rain','Heavy rain'], ['high-wind','High winds'], ['heat','High heat'], ['cold','Extreme cold'],
  ];
  const primaryMetrics: Array<[string, string, ReactNode]> = current && data ? [
    ['Feels like', temperature(current!.apparent), <Activity/>], ['Humidity', `${current!.humidity}%`, <Droplets/>],
    ['Wind', `${compass(current!.windDirection)} · ${wind(current!.wind)}`, <Wind/>], ['Precipitation', `${current!.precipitation.toFixed(1)} mm`, <Cloud/>],
    ['Pressure', `${current!.pressure.toFixed(1)} hPa`, <Activity/>], ['Visibility', current!.visibility == null ? 'Unavailable' : `${current!.visibility.toFixed(1)} km`, <Cloud/>],
  ] : [];
  const additionalMetrics: Array<[string, string, ReactNode]> = current && data ? [
    ['Wind direction', compass(current!.windDirection), <Wind/>], ['Wind gusts', wind(current!.gust), <Wind/>],
    ['Cloud cover', `${current!.cloud}%`, <Cloud/>], ['UV index', current!.uv.toFixed(1), <Sun/>],
    ['Dew point', temperature(current!.dewPoint), <Droplets/>], ['Sunrise', localTime(data!.daily[0].sunrise,data!.place.timezone), <Sun/>],
    ['Sunset', localTime(data!.daily[0].sunset,data!.place.timezone), <CrescentMoon size={16}/>],
    ['Pressure trend', (()=>{const delta=(data!.hourly[5]?.pressure??current!.pressure)-current!.pressure;return `${delta>0?'Rising':delta<0?'Falling':'Steady'} ${Math.abs(delta).toFixed(1)} hPa / 6h`})(), <Activity/>],
  ] : [];
  const renderMetrics = (metrics: Array<[string, string, ReactNode]>) => metrics.map(([label,value,icon])=><MetricCard key={label} icon={icon} label={t(label)} value={value}/>);

  const showNightTexture = Boolean(current && !current.isDay && current.code <= 3 && current.cloud < 78);
  if (isWidgetWindow) {
    // The card fills its window exactly, so the "size" preference is applied
    // by resizing the window rather than by scaling the paint. Scaling left
    // the widget drawing into a corner of a larger window, with a dead
    // transparent margin around it.
    const widgetStyle = { opacity: prefs.widgetOpacity / 100 };
    const widgetTheme = prefs.theme === 'system' ? systemTheme : prefs.theme;
    // The widget's own header is the drag handle and the close button lives
    // in it. Both used to be a single absolutely-positioned button in the very
    // corner of the card, which looked misplaced and was hard to hit.
    return localize(<main lang={isUrdu?'ur-PK':'en'} dir={isUrdu?'rtl':'ltr'} className={`weather-widget has-weather-scene scene-${activeScene} theme-${widgetTheme} ${prefs.reducedMotion || systemReducedMotion?'motion-off':''}`} onDoubleClick={()=>void window.atmosphere?.openApp()} style={widgetStyle}>
      {data && current && <WeatherCanvas weather={{ code: current.code, isDay: current.isDay, wind: current.wind, windDirection: current.windDirection, precipitation: current.precipitation, cloud: current.cloud, temperature: current.temperature, sunrise: solarDay?.sunrise, sunset: solarDay?.sunset, nextSunrise: solar.nextSunrise }} enabled={prefs.animate && !prefs.reducedMotion && !systemReducedMotion} nightBackdrop={showNightTexture}/>}
      <div className="widget-header" onPointerDown={async (e) => {
        if ((e.target as HTMLElement).closest('.widget-close')) return;
        e.preventDefault();
        const bounds = await window.atmosphere?.startWidgetDrag?.();
        if (!bounds) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const onPointerMove = (me: PointerEvent) => {
          const dx = me.clientX - startX;
          const dy = me.clientY - startY;
          void window.atmosphere?.moveWidget?.(dx, dy);
        };
        const onPointerUp = () => {
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
        };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      }}>
        <span className="widget-place" title={isUrdu?'ویجیٹ کو گھسیٹ کر منتقل کریں':'Drag to move the widget'}>{data?.place.name ?? 'Atmosphere Weather'}</span>
        <button className="widget-close" onClick={()=>void window.atmosphere?.close()} aria-label={t('Close weather widget')}><X size={12}/></button>
      </div>
      <button className="widget-content" onClick={()=>void window.atmosphere?.openApp()} aria-label={t('Open full weather app')}>{data && current ? <><span className="widget-reading" dir="ltr">{temperature(current.temperature)}<span>{iconFor(current.code,current.isDay,34)}</span></span><strong>{weatherText(current.code)}</strong><span className="widget-summary">{t('Feels')} {temperature(current.apparent)} · H {temperature(data.daily[0].high)} · L {temperature(data.daily[0].low)}</span><span className="widget-summary">{t('Updated')} {localTime(data.fetchedAt,data.place.timezone,{hour:'numeric',minute:'2-digit'})}</span></> : <><span className="widget-summary">{loading?t('Updating forecast…'):t('Open the app to choose a location')}</span></>}</button>
    </main>);
  }
  const scrollToSection = (id: string) => {
    setActiveNav(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return localize(<main lang={isUrdu?'ur-PK':'en'} dir={isUrdu?'rtl':'ltr'} className={`app has-weather-scene scene-${activeScene} theme-${prefs.theme === 'system' ? systemTheme : prefs.theme} ${prefs.highContrast ? 'high-contrast' : ''} ${prefs.transparentPanels ? 'transparent-panels' : ''} ${prefs.pureBackground ? 'pure-background' : ''} ${settings ? 'settings-open' : ''} ${isMacPlatform ? 'mac-platform' : ''}`}>
    {data && current && <WeatherCanvas weather={{ code: current.code, isDay: current.isDay, wind: current.wind, windDirection: current.windDirection, precipitation: current.precipitation, cloud: current.cloud, temperature: current.temperature, sunrise: solarDay?.sunrise, sunset: solarDay?.sunset, nextSunrise: solar.nextSunrise }}       enabled={prefs.animate && !prefs.reducedMotion && !windowHidden && !settings} nightBackdrop={showNightTexture}/>}

    <header className="titlebar" onDoubleClick={e => {
      // The window has no maximize button, so a double-click on the title bar
      // takes its place. Clicks that land on a control are left alone.
      if ((e.target as HTMLElement).closest('.titlebar-actions')) return;
      void window.atmosphere?.toggleMaximize?.();
    }}>
      <div className="titlebar-spacer" />
      <div className="titlebar-center"><span className="titlebar-title">{place?.name ?? 'Atmosphere Weather'}</span></div>
      <div className="titlebar-actions window-no-drag">
        <div className="search-wrap">
          <Search size={13}/>
          <input dir={isUrdu?'rtl':'ltr'} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && results[0]) selectPlace(results[0]); if (e.key === 'Escape') { setQuery(''); setResults([]); } }} placeholder={t('Search city or country')} aria-label={t('Search city or country')}/>
          <button className={`search-locate ${trackingLocation ? 'tracking-location' : ''}`} title={t(trackingLocation ? 'Stop live location tracking' : 'Use my location')} aria-label={t(trackingLocation ? 'Stop live location tracking' : 'Use my location')} aria-pressed={trackingLocation} onClick={detect}><LocateFixed size={14}/></button>
          {query.length >= 2 && <div className="search-results scrollbar-thin">{searching ? <div className="search-empty">{t('Searching…')}</div> : results.length ? results.map(p => <button key={p.id} onClick={() => selectPlace(p)}><MapPin size={14}/><span>{p.name}<small>{[p.admin1,p.country].filter(Boolean).join(', ')}</small></span></button>) : <div className="search-empty">{t('No matching cities')}</div>}</div>}
        </div>
        <ToolbarBtn icon={RefreshCw} onClick={() => place && void load(place)} disabled={!place || loading} ariaLabel={t('Refresh weather')}/>
        <ToolbarBtn icon={MapPin} active={showMap} onClick={() => setShowMap(v => !v)} ariaLabel={t('Toggle radar map')}/>
      </div>
    </header>

    <div className="app-body">
      <aside className="sidebar">
        <div className="sidebar-header"><div className="sidebar-title">Atmosphere</div></div>
        <nav className="sidebar-nav scrollbar-thin" aria-label={t('Sections')}>
          <NavItem icon={Sun} label={t('Current')} active={activeNav === 'current'} onClick={() => scrollToSection('current')} />
          <NavItem icon={Clock3} label={t('Hourly')} active={activeNav === 'hourly'} onClick={() => scrollToSection('hourly')} />
          <NavItem icon={CloudSun} label={t('7-day forecast')} active={activeNav === 'daily'} onClick={() => scrollToSection('daily')} />
          <NavItem icon={MapPin} label={t('Rain radar')} active={activeNav === 'radar'} onClick={() => { setShowMap(true); scrollToSection('radar'); }} />
          <NavItem icon={Activity} label={t('Conditions')} active={activeNav === 'conditions'} onClick={() => scrollToSection('conditions')} />
          <NavItem icon={Droplets} label={t('Air quality')} active={activeNav === 'air'} onClick={() => scrollToSection('air')} />
          <div className="nav-divider" />
          <NavItem icon={AlertTriangle} label={t('Official warnings')} active={activeNav === 'warnings'} onClick={() => scrollToSection('warnings')} />
          <NavItem icon={Settings} label={t('Settings')} active={settings} onClick={() => setSettings(true)} />
        </nav>
      </aside>

      <div className="main-content">
        <div className="content scrollbar-thin">
          <div aria-live="polite" aria-atomic="true" className="sr-only">{data && !loading && !stale ? `Forecast updated for ${data.place.name} at ${localTime(data.fetchedAt,data.place.timezone,{hour:'numeric',minute:'2-digit'})}` : loading ? 'Updating forecast' : ''}</div>

          {error && <div className="notice" role="status"><span>{error}</span><button onClick={() => place && void load(place)}>Retry</button><button className="notice-dismiss" aria-label="Dismiss" onClick={() => setError('')}><X size={14}/></button></div>}
          {!online && <div className="stale" role="status"><span>Offline · showing the last saved forecast where available.</span><button onClick={() => place && void load(place)}>Retry</button></div>}
          {data && stale && <div className="stale" role="status"><span>Showing saved forecast · Last update {localTime(data.fetchedAt, data.place.timezone, {hour:'numeric',minute:'2-digit'})}</span><button onClick={() => place && void load(place)}>Try again</button></div>}

          {place && (
            <section className="section" id="warnings" aria-labelledby="official-alerts-title">
              <header className="section-header">
                <div>
                  <p className="eyebrow">Government sources</p>
                  <h2 className="section-title" id="official-alerts-title">Official weather warnings</h2>
                </div>
                <button className="btn btn-secondary" onClick={() => setOfficialAlertRefreshKey(value => value + 1)} disabled={officialAlertsLoading}><RefreshCw size={13} className={officialAlertsLoading ? 'spin' : ''}/>{officialAlertsLoading ? 'Checking' : 'Refresh'}</button>
              </header>
              {officialAlertsError ? (
                <div className="official-alert-status" role="status"><AlertTriangle size={15}/><span>{officialAlertsResult ? `Could not refresh · showing last successful check (${localTime(officialAlertsResult.checkedAt, alertTimezone, {hour:'numeric',minute:'2-digit'})}). ` : ''}{officialAlertsError}</span></div>
              ) : officialAlertsLoading && !officialAlertsResult ? (
                <div className="official-alert-status" role="status">Checking the official warning source for {place.name}…</div>
              ) : officialAlertsResult?.status === 'unsupported' ? (
                <div className="official-alert-status" role="status">An official alert feed is not configured for {place.country || 'this region'} yet. Forecast signals shown elsewhere are not government warnings.</div>
              ) : officialAlertsResult?.status === 'available' && officialAlertsResult.alerts.length === 0 ? (
                <div className="official-alert-status" role="status"><span>No active warnings were returned for {place.name} by {officialAlertsResult.provider} as of {localTime(officialAlertsResult.checkedAt, alertTimezone, {hour:'numeric',minute:'2-digit'})}. This does not guarantee conditions are safe. <a href={officialAlertsResult.sourceUrl} target="_blank" rel="noreferrer">Check the official source</a></span></div>
              ) : officialAlertsResult?.status === 'available' ? (
                <>
                  {officialAlertsResult.alerts.map(alert => (
                    <article className={`official-alert-card severity-${alert.severity}`} key={alert.id}>
                      <div className="official-alert-card-heading"><span className={`severity-pill severity-${alert.severity}`}>{severityLabel(alert.severity)}</span><strong>{alert.title}</strong></div>
                      <p className="official-alert-event">{alert.event} · {alert.area}</p>
                      <p className="official-alert-description">{alert.description}</p>
                      {alert.instruction && <details><summary>Official guidance</summary><p>{alert.instruction}</p></details>}
                      <div className="official-alert-timing"><Clock3 size={13}/><span>{alert.onset && Date.parse(alert.onset) > Date.now() ? `Starts ${alertTime(alert.onset)}` : `Active since ${alertTime(alert.onset)}`} · {alert.expires ? `Expires ${alertTime(alert.expires)}` : 'End time not provided'}</span></div>
                      <div className="official-alert-source">Source: {alert.source} · <a href={alert.sourceUrl} target="_blank" rel="noreferrer">View official notice</a></div>
                    </article>
                  ))}
                  <p className="official-alert-disclaimer">Warnings come from {officialAlertsResult.provider} and can change. Follow the linked official notice for current safety instructions; this app is not an emergency service.</p>
                </>
              ) : <div className="official-alert-status" role="status">Official warning status is not available yet.</div>}
            </section>
          )}

          {!data && <EmptyState
            icon={<Sun size={48}/>}
            title={t('Weather that moves with you')}
            description={t('Search for a city or allow location access to see current conditions and the forecast ahead.')}
            actions={<>
              <button className="btn btn-primary" onClick={detect}><LocateFixed size={15}/> {t('Detect my location')}</button>
              <button className="btn btn-secondary" onClick={() => setQuery('London')}>London</button>
              <button className="btn btn-secondary" onClick={() => setQuery('New York')}>New York</button>
              <button className="btn btn-secondary" onClick={() => setQuery('Tokyo')}>Tokyo</button>
            </>}
          />}

          {data && <>
            <section className="hero" id="current">
              <div className="hero-copy">
                <p className="eyebrow">{place?.name ?? ''}</p>
                <div className="temperature">{temperature(current!.temperature)}</div>
                <div className="live-condition"><span>{weatherText(current!.code)}</span><span className="live-dot"/><span className="live-label">{t(stale ? 'Saved' : 'Current')}</span></div>
                <div className="today-range" dir={isUrdu?'rtl':'ltr'}>{isUrdu ? <><span>زیادہ: <bdi dir="ltr">{temperature(data.daily[0].high)}</bdi></span><span aria-hidden="true">·</span><span>کم: <bdi dir="ltr">{temperature(data.daily[0].low)}</bdi></span><span aria-hidden="true">·</span><span>تازہ کاری: <bdi dir="ltr">{localTime(trackingLocation && locationUpdatedAt ? locationUpdatedAt : data.fetchedAt, data.place.timezone, {hour:'2-digit',minute:'2-digit'})}</bdi></span></> : <>H: {temperature(data.daily[0].high)} · L: {temperature(data.daily[0].low)} · Updated {localTime(trackingLocation && locationUpdatedAt ? locationUpdatedAt : data.fetchedAt, data.place.timezone, {hour:'numeric',minute:'2-digit'})}</>}</div>
              </div>
              <div className="hero-art" aria-hidden="true">{iconFor(current!.code,current!.isDay,64)}</div>
            </section>

            <section className="insight-strip">
              <div className="insight-icon"><Droplets size={15}/></div>
              <p>{current!.precipitation > 0 ? `Precipitation is occurring now (${current!.precipitation.toFixed(1)} mm).` : rainSoonHour ? `Rain may arrive around ${localTime(rainSoonHour.time,data.place.timezone)} (${rainSoonHour.precipitationChance}% chance${rainSoonHour.precipitation>0?`, about ${rainSoonHour.precipitation.toFixed(1)} mm`:''}).` : `No significant rain is indicated in the next 24 hours.`}</p>
              <span className="insight-tag">Model estimate</span>
            </section>

            <section className="section" id="hourly">
              <header className="section-header">
                <div><p className="eyebrow">{t('Next 24 hours')}</p><h2 className="section-title">{t('Hourly forecast')}</h2></div>
                <span className="section-note">{t('Local time')} · {prefs.unit} · {prefs.wind}</span>
              </header>
              <div className="hourly-scroll">{data.hourly.map((h,i)=><article className={`hour-item ${i===0?'hour-now':''}`} key={h.time} title={`Precipitation chance ${h.precipitationChance}%; expected amount ${h.precipitation.toFixed(1)} mm`}><span className="hour-time">{i===0?'Now':localTime(h.time,data.place.timezone)}</span><span className="hour-icon">{iconFor(h.code,true,20)}</span><strong>{temperature(h.temperature)}</strong><span className="hour-rain"><Droplets size={11}/>{h.precipitationChance}%</span><small className="hour-amount">{h.precipitation.toFixed(1)} mm</small></article>)}</div>
              <div className="chart-wrap" role="img" aria-label="Temperature trend for the next 24 hours">
                <ResponsiveContainer width="100%" height={150}>
                  <AreaChart data={chart} margin={{top:22,right:8,bottom:0,left:0}}><defs><linearGradient id="tempFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5ac8fa" stopOpacity={0.28}/><stop offset="100%" stopColor="#5ac8fa" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="rgba(255,255,255,.08)"/><XAxis dataKey="label" padding={{left:18,right:18}} tick={{fill:'currentColor',fontSize:10}} tickLine={false} axisLine={false} interval={3}/><YAxis hide domain={['dataMin - 3','dataMax + 3']}/><Tooltip contentStyle={{background:'rgba(28,28,30,.94)',border:'1px solid rgba(255,255,255,.12)',borderRadius:10,color:'#f5f5f7'}} formatter={(v, name, entry) => [typeof v === 'number' ? temperature(v) : String(v ?? 'Unavailable'), entry?.payload?.cond ? `${name} · ${entry.payload.cond}` : name]}/><Area type="monotone" dataKey="temperature" stroke="#5ac8fa" strokeWidth={2} fill="url(#tempFill)" dot={false} activeDot={{r:4,fill:'#5ac8fa',stroke:'#1c1c1e',strokeWidth:2}}/></AreaChart>
                </ResponsiveContainer>
              </div>
              {chartDataVisible && <div className="accessible-table-wrap scrollbar-thin"><table><caption>{t('Hourly temperature data')}</caption><thead><tr><th scope="col">{t('Time')}</th><th scope="col">{t('Temperature')}</th><th scope="col">{t('Condition')}</th><th scope="col">{t('Rain chance')}</th></tr></thead><tbody>{data.hourly.map(h=><tr key={h.time}><td dir="ltr">{localTime(h.time,data.place.timezone)}</td><td dir="ltr">{temperature(h.temperature)}</td><td>{weatherText(h.code)}</td><td dir="ltr">{h.precipitationChance}%</td></tr>)}</tbody></table></div>}
              <button className="btn btn-ghost" onClick={() => setChartDataVisible(v => !v)} aria-expanded={chartDataVisible}>{t(chartDataVisible ? 'Hide data table' : 'Show data table')}</button>
            </section>

            <section className="section" id="daily">
              <header className="section-header">
                <div><p className="eyebrow">{t('Plan ahead')}</p><h2 className="section-title">{t('7-day forecast')}</h2></div>
                <span className="section-note">{t('Forecast provider: Open-Meteo')}</span>
              </header>
              <div className="daily-list">{data.daily.map((d,i)=><button className={`daily-row ${selectedDay===i?'selected':''}`} key={d.date} onClick={() => setSelectedDay(i)}><span className="daily-day">{i===0?'Today':niceDate(`${d.date}T12:00:00`,{weekday:'short'},displayLocale)}</span><span className="daily-icon">{iconFor(d.code,true,19)}</span><span className="daily-rain"><Droplets size={11}/><span>{d.precipitationChance}%</span></span><span className="daily-low">{temperature(d.low)}</span><div className="temp-range"><i style={{left:`${Math.max(0,Math.min(85,(d.low-dailyStats.low)/(dailyStats.high-dailyStats.low)*85))}%`,width:`${Math.max(15,(d.high-d.low)/(dailyStats.high-dailyStats.low)*85)}%`}}/></div><span className="daily-high">{temperature(d.high)}</span></button>)}</div>
              {day && <div className="selected-day"><span>{niceDate(`${day.date}T12:00:00`,{weekday:'long',month:'long',day:'numeric'},displayLocale)}</span><span>{weatherText(day.code)}</span><span dir="ltr">{day.precipitation.toFixed(1)} mm {t('rain')}</span><span>{t('Wind')} {wind(day.wind)}</span><span>{t('Sunrise')} {localTime(day.sunrise,data.place.timezone)}</span><span>{t('Sunset')} {localTime(day.sunset,data.place.timezone)}</span></div>}
            </section>

            <section className="section" id="conditions">
              <header className="section-header"><div><p className="eyebrow">{t('Right now')}</p><h2 className="section-title">{t('Conditions')}</h2></div></header>
              <div className="metric-grid">{renderMetrics(primaryMetrics)}</div>
              <details className="additional-conditions" open={prefs.layout==='detailed'}><summary>{t('More current conditions')}</summary><div className="metric-grid">{renderMetrics(additionalMetrics)}</div></details>
            </section>

            <section className="section" id="plan">
              <header className="section-header"><div><p className="eyebrow">Make a plan</p><h2 className="section-title">Today outdoors</h2></div><span className="section-note">Next 24 hours · forecast estimate</span></header>
              <div className="plan-grid">
                <article className="plan-card"><span>Best time to go out</span><strong>{bestOutdoorHour ? localTime(bestOutdoorHour.time,data.place.timezone,{hour:'numeric',minute:'2-digit'}) : 'No low-risk window found'}</strong><p>{bestOutdoorHour ? `${temperature(bestOutdoorHour.temperature)} · ${bestOutdoorHour.precipitationChance}% rain chance · wind ${wind(bestOutdoorHour.wind)}` : 'Check the hourly forecast and local advisories before heading out.'}</p></article>
                <article className="plan-card"><span>Commute outlook · next 3 hours</span><strong>{data.hourly.slice(0,3).some(h=>h.precipitationChance>=50||h.wind>=40||h.visibility!=null&&h.visibility<2) ? 'Allow extra time' : 'Generally favorable'}</strong><p>{data.hourly.slice(0,3).map(h=>`${localTime(h.time,data.place.timezone)} ${h.precipitationChance}% rain`).join(' · ')}</p></article>
                <article className="plan-card"><span>Sunrise · Sunset</span><strong>{localTime(data.daily[0].sunrise,data.place.timezone)} · {localTime(data.daily[0].sunset,data.place.timezone)}</strong><p>Local time for {data.place.name}</p></article>
              </div>
              <p className="plan-note">Suggestions use forecast rain probability, wind, and temperature. They are planning hints, not safety guarantees.</p>
            </section>

            <div id="radar">{showMap && place && <Suspense fallback={<section className="section map-loading">Loading weather map…</section>}><WeatherMap place={place}/></Suspense>}</div>

            <section className="section" id="air">
              <header className="section-header">
                <div><p className="eyebrow">{t('Air quality & outdoor conditions')}</p><h2 className="section-title">{data.air?.aqi == null ? t('AQI unavailable') : <>{data.air.aqi} <span className="aqi-label">{(data.air.aqiScale ?? 'European') === 'US' ? usAqiLabel(data.air.aqi) : europeanAqiLabel(data.air.aqi)}</span></>}</h2></div>
                <span className="section-note">Model estimate · Open-Meteo</span>
              </header>
              <div className="air-grid">{[
                ['PM2.5',data.air?.pm25 == null ? null : `${data.air.pm25.toFixed(1)} μg/m³`],
                ['PM10',data.air?.pm10 == null ? null : `${data.air.pm10.toFixed(1)} μg/m³`],
                [data.air?.aqiScale === 'US' ? 'European AQI' : 'US AQI',data.air ? ((data.air.aqiScale === 'US' ? data.air.europeanAqi : data.air.usAqi) == null ? null : String(data.air.aqiScale === 'US' ? data.air.europeanAqi : data.air.usAqi)) : null],
                ['UV now',`${current!.uv.toFixed(1)}${data.air?.uvMaxNext24h != null ? ` · ${data.air.uvMaxNext24h.toFixed(1)} peak` : ''}`],
              ].map(([label,value])=><span key={String(label)}>{label}<b>{value ?? 'Unavailable'}</b></span>)}</div>
              <div className="outdoor-advice-grid"><article className="outdoor-advice"><strong>{t('Air')}</strong><p>{t(outdoorAirAdvice(data.air?.aqiScale ?? 'European',data.air?.aqi ?? null,data.air?.pm25 ?? null))}</p></article><article className="outdoor-advice"><strong>{t('UV protection')}</strong><p>{t(uvAdvice(current!.uv))}{data.air?.uvPeakTime ? ` ${t('Peak near')} ${localTime(data.air.uvPeakTime,data.place.timezone)}.` : ''}</p></article></div>
              <div className="pollen-panel"><div className="pollen-heading"><div><strong>Pollen forecast</strong><span>Next 24 hours · grains/m³</span></div><span className="section-note">Tree · grass · weed</span></div>{data.air?.pollen?.some(item=>item.current!=null||item.next24hMax!=null) ? <div className="pollen-grid">{data.air.pollen.filter(item=>item.current!=null||item.next24hMax!=null).map(item=><div className="pollen-item" key={item.type}><span>{item.type[0].toUpperCase()+item.type.slice(1)}</span><b>{item.next24hMax == null ? '—' : item.next24hMax.toFixed(1)}</b><small>{item.peakTime ? `Peak ${localTime(item.peakTime,data.place.timezone)}` : 'Forecast level'}</small></div>)}</div> : <p className="pollen-unavailable">Pollen readings are not provided for this location or season. Unavailable does not mean zero pollen.</p>}<p className="pollen-guidance">If pollen affects you, use your personal triggers to plan outdoor time; the provider does not supply a validated low-to-high pollen risk category here.</p></div>
              <p className="air-disclaimer">Air quality and pollen are model estimates for this area, not a nearby monitoring station. Check local public-health guidance when conditions are poor.</p>
            </section>

            <footer className="footer"><span>Weather · Open-Meteo · {prefs.geocoderEndpoint.includes("nominatim.openstreetmap.org") ? <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Place names © OpenStreetMap</a> : "Place-name service"}</span><a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">Data & forecast details ↗</a><span>{stale?'Cached data · may be out of date':'Updated '+localTime(data.fetchedAt,data.place.timezone,{hour:'numeric',minute:'2-digit'})}</span></footer>
          </>}
        </div>
      </div>
    </div>

    <div className={`modal-overlay ${settings ? 'open' : ''}`} onMouseDown={e => {if(e.target===e.currentTarget)setSettings(false)}}>
      <section className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-heading">
          <div><p className="eyebrow">{t('Personalize')}</p><h2 id="settings-title">{t('Settings')}</h2></div>
          <button className="modal-close" onClick={() => setSettings(false)} aria-label={t('Close settings')}><X size={16}/></button>
        </header>
        <div className="settings-body scrollbar-thin">
          <div className="settings-section">
            <h3 className="settings-section-title">{t('General')}</h3>
            <div className="setting-block">
              <span className="label">{t('Temperature')}</span>
              <div className="segmented"><button className={prefs.unit==='C'?'active':''} onClick={() => setPrefs(p=>({...p,unit:'C'}))}>{t('Celsius')}</button><button className={prefs.unit==='F'?'active':''} onClick={() => setPrefs(p=>({...p,unit:'F'}))}>{t('Fahrenheit')}</button></div>
            </div>
            <div className="setting-block">
              <span className="label">{t('Wind speed')}</span>
              <div className="segmented"><button className={prefs.wind==='km/h'?'active':''} onClick={() => setPrefs(p=>({...p,wind:'km/h'}))}>km/h</button><button className={prefs.wind==='mph'?'active':''} onClick={() => setPrefs(p=>({...p,wind:'mph'}))}>mph</button></div>
            </div>
            <div className="setting-block">
              <span className="label">{t('Time and date format')}</span>
              <select className="select" value={prefs.locale} onChange={e => setPrefs(p=>({...p,locale:e.target.value as Preferences['locale']}))}><option value="system">{t('Use system language')}</option><option value="en-US">{t('English (United States)')}</option><option value="en-GB">{t('English (United Kingdom)')}</option><option value="ur-PK">اردو (پاکستان)</option></select>
            </div>
            <div className="setting-block">
              <span className="label">Refresh interval</span>
              <select className="select" value={prefs.refresh} onChange={e => setPrefs(p=>({...p,refresh:Number(e.target.value)}))}><option value={0}>Manual</option><option value={10}>10 minutes</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option></select>
            </div>
            <div className="setting-block">
              <span className="label">Place-name service HTTPS endpoint</span>
              <input className="input" type="url" value={prefs.geocoderEndpoint} onChange={e=>setPrefs(p=>({...p,geocoderEndpoint:e.target.value}))} aria-describedby="geocoder-help" />
              <p id="geocoder-help" className="caption">Coordinates are sent only after you request device location. The default OpenStreetMap service requires attribution, caching, and low request volume; you can switch this endpoint to a compatible service.</p>
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">{t('Appearance')}</h3>
            <div className="setting-block">
              <span className="label">{t('Theme')}</span>
              <select className="select" value={prefs.theme} onChange={e => setPrefs(p=>({...p,theme:e.target.value as Preferences['theme']}))}><option value="system">{t('Follow system')}</option><option value="light">{t('Light')}</option><option value="dark">{t('Dark')}</option></select>
            </div>
            <div className="setting-block">
              <span className="label">{t('Layout')}</span>
              <select className="select" value={prefs.layout} onChange={e=>setPrefs(p=>({...p,layout:e.target.value as Preferences['layout']}))}><option value="detailed">{t('Detailed')}</option><option value="compact">{t('Compact')}</option></select>
            </div>
            <div className="setting-row"><span className="label">{t('High contrast')}</span><input className="switch" type="checkbox" role="switch" aria-label={t('High contrast')} checked={prefs.highContrast} onChange={e=>setPrefs(p=>({...p,highContrast:e.target.checked}))}/></div>
            <div className="setting-row"><span className="label">{t('Weather animation')}</span><input className="switch" type="checkbox" role="switch" aria-label={t('Weather animation')} checked={prefs.animate} onChange={e=>setPrefs(p=>({...p,animate:e.target.checked}))}/></div>
            <div className="setting-row"><span className="label">Pure background (hide tiles)</span><input className="switch" type="checkbox" role="switch" aria-label="Pure background" checked={prefs.pureBackground} onChange={e=>setPrefs(p=>({...p,pureBackground:e.target.checked}))}/></div>
            <p className="caption">Removes all panel tiles and floats all weather readings directly over the live weather background animation.</p>
            <div className="setting-row"><span className="label">{t('Reduce motion')}</span><input className="switch" type="checkbox" role="switch" aria-label={t('Reduce motion')} checked={prefs.reducedMotion} onChange={e=>setPrefs(p=>({...p,reducedMotion:e.target.checked}))}/></div>
            <div className="setting-block">
              <span className="label">Demo scene</span>
              <select className="select" value={demoScene ?? 'live'} onChange={e=>chooseDemo(e.target.value)}><option value="live">Live weather</option><option value="sunny">Sunny</option><option value="partly">Partly cloudy</option><option value="cloudy">Cloudy</option><option value="rain">Rain</option><option value="heavy-rain">Heavy rain</option><option value="storm">Thunderstorm</option><option value="snow">Snow</option><option value="fog">Fog</option><option value="windy">Windy</option><option value="night">Night</option></select>
              <p className="caption">Demo scene changes the background only. Weather readings always remain real forecast data.</p>
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">Desktop widget</h3>
            <div className="setting-block">
              <span className="label">Opacity</span>
              <div className="segmented"><button className={prefs.widgetOpacity===25?'active':''} onClick={()=>setPrefs(p=>({...p,widgetOpacity:25}))}>25%</button><button className={prefs.widgetOpacity===50?'active':''} onClick={()=>setPrefs(p=>({...p,widgetOpacity:50}))}>50%</button><button className={prefs.widgetOpacity===75?'active':''} onClick={()=>setPrefs(p=>({...p,widgetOpacity:75}))}>75%</button><button className={prefs.widgetOpacity===100?'active':''} onClick={()=>setPrefs(p=>({...p,widgetOpacity:100}))}>100%</button></div>
            </div>
            <div className="setting-block">
              <span className="label">Size</span>
              <div className="segmented"><button className={prefs.widgetScale===75?'active':''} onClick={()=>setPrefs(p=>({...p,widgetScale:75}))}>75%</button><button className={prefs.widgetScale===100?'active':''} onClick={()=>setPrefs(p=>({...p,widgetScale:100}))}>100%</button><button className={prefs.widgetScale===125?'active':''} onClick={()=>setPrefs(p=>({...p,widgetScale:125}))}>125%</button><button className={prefs.widgetScale===150?'active':''} onClick={()=>setPrefs(p=>({...p,widgetScale:150}))}>150%</button></div>
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">Notifications</h3>
            <div className="setting-block">
              <span className="label">Daily weather reminder</span>
              <select className="select" value={prefs.dailyReminder} onChange={e => setPrefs(p=>({...p,dailyReminder:e.target.value}))}><option value="">Off</option>{Array.from({length:24},(_,hour)=>`${String(hour).padStart(2,'0')}:00`).map(time=><option key={time} value={time}>{time}</option>)}</select>
              <p className="caption">The reminder is a Windows notification with today's best outdoor window. It runs while the app is open or in the notification area.</p>
            </div>
            <div className="setting-row"><span className="label">Forecast notifications</span><input className="switch" type="checkbox" role="switch" aria-label="Forecast notifications" checked={prefs.alerts} onChange={e=>setPrefs(p=>({...p,alerts:e.target.checked}))}/></div>
            <p className="caption">Windows notifications from model-based forecast signals while this app is open. They are not official government warnings.</p>
            {prefs.alerts && <fieldset className="alert-options"><legend>Forecast signals</legend>{alertOptions.map(([key,label])=><label key={key}><input type="checkbox" checked={prefs.alertCategories.includes(key)} onChange={e=>setPrefs(p=>({...p,alertCategories:e.target.checked?[...p.alertCategories,key]:p.alertCategories.filter(c=>c!==key)}))}/>{label}</label>)}</fieldset>}
            <div className="setting-row"><span className="label">Official warning notifications</span><input className="switch" type="checkbox" role="switch" aria-label="Official warning notifications" checked={prefs.officialAlertNotifications} onChange={e=>setPrefs(p=>({...p,officialAlertNotifications:e.target.checked}))}/></div>
            <p className="caption">Official notices appear in the weather panel. Windows notifications check for new warnings every 5 minutes while this app is open.</p>
            {prefs.officialAlertNotifications && <div className="setting-block"><span className="label">Notify for severity</span><select className="select" value={prefs.officialAlertMinimumSeverity} onChange={e=>setPrefs(p=>({...p,officialAlertMinimumSeverity:e.target.value as Preferences['officialAlertMinimumSeverity']}))}><option value="extreme">Extreme only</option><option value="severe">Severe or higher</option><option value="moderate">Moderate or higher</option><option value="minor">All rated warnings</option></select></div>}
            <div className="quiet-hours">
              <strong>Quiet hours</strong>
              <div><label>Start<input type="time" value={prefs.quietHoursStart} onChange={e=>setPrefs(p=>({...p,quietHoursStart:e.target.value}))}/></label><label>End<input type="time" value={prefs.quietHoursEnd} onChange={e=>setPrefs(p=>({...p,quietHoursEnd:e.target.value}))}/></label></div>
              <p className="caption">Official warning notifications are held during these local-time hours. Leave either time blank to disable quiet hours.</p>
            </div>
            <button className="btn btn-secondary" style={{marginTop:12}} onClick={()=>void window.atmosphere?.notifyForecast({title:'Atmosphere Weather notification test',body:'Notifications are working. This is a test, not an official weather warning.'})}>Send test notification</button>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">System</h3>
            <div className="setting-row"><span className="label">Keep running in notification area</span><input className="switch" type="checkbox" role="switch" aria-label="Keep running in notification area" checked={prefs.backgroundMode} onChange={e=>setPrefs(p=>({...p,backgroundMode:e.target.checked}))}/></div>
            <p className="caption">When enabled, closing the window hides the app to the Windows notification area so scheduled reminders can still run. Use the tray menu to quit.</p>
            <div className="update-card" style={{marginTop:12}}>
              <div><strong>App updates</strong><p role="status">{updateStatus.message}</p></div>
              <div>{updateStatus.state==='available'?<button className="btn btn-primary" onClick={()=>void window.atmosphere?.downloadUpdate()}>Download</button>:updateStatus.state==='ready'?<button className="btn btn-primary" onClick={()=>void window.atmosphere?.installUpdate()}>Restart to update</button>:<button className="btn btn-secondary" onClick={()=>void window.atmosphere?.checkForUpdates()} disabled={updateStatus.state==='checking'||updateStatus.state==='downloading'}>Check now</button>}</div>
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">Saved locations</h3>
            <div className="saved-heading"><h3>Your places</h3><button onClick={detect}><LocateFixed size={13}/> Use current location</button></div>
            {prefs.saved.map(p=><div className="saved-place" key={p.id}><MapPin size={14}/><span>{p.name}<small>{[p.admin1,p.country].filter(Boolean).join(', ')}</small></span><button onClick={()=>selectPlace(p)}>{prefs.active?.id===p.id?'Active':'Show'}</button><button onClick={()=>setPrefs(prev=>({...prev,defaultPlaceId:p.id}))} aria-pressed={prefs.defaultPlaceId===p.id}>{prefs.defaultPlaceId===p.id?'Default':'Set default'}</button><button aria-label={`Remove ${p.name}`} onClick={()=>removeSaved(p.id)}><X size={13}/></button></div>)}
            <p className="caption">Weather requests use the active place with Open-Meteo. Device coordinates are only shared after you press a location button. This action clears saved places, forecast cache, place-name cache, and alert de-duplication history.</p>
            <button className="clear-data-button" onClick={clearLocalData}>Clear saved locations and local weather cache</button>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">App status</h3>
            <div className="diagnostics-card">
              <dl>
                <dt>App version</dt><dd>v{appVersion}</dd>
                <dt>Connection</dt><dd>{online?'Online':'Offline'}</dd>
                <dt>Forecast source</dt><dd>Open-Meteo · {data?`updated ${localTime(data.fetchedAt,data.place.timezone,{hour:'numeric',minute:'2-digit'})}`:'waiting for data'}</dd>
                <dt>Official warnings</dt><dd>{officialAlertsLoading?'Checking':officialAlertsResult?`${officialAlertsResult.provider} · checked ${localTime(officialAlertsResult.checkedAt,alertTimezone,{hour:'numeric',minute:'2-digit'})}`:officialAlertsError?'Check failed':'Not checked yet'}</dd>
                <dt>Location</dt><dd>{prefs.locationStatus}</dd>
                <dt>Windows notifications</dt><dd>{window.atmosphere?'Available':'Unavailable in browser preview'}</dd>
              </dl>
            </div>
          </div>
        </div>
      </section>
    </div>

    {showHelp && <div className="modal-overlay open" onMouseDown={e => {if(e.target===e.currentTarget)setShowHelp(false)}}><section className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="help-title"><header className="modal-header"><h2 className="modal-title" id="help-title">Keyboard shortcuts</h2><button className="modal-close" onClick={() => setShowHelp(false)} aria-label="Close help"><X size={16}/></button></header><div className="diagnostics-card"><dl><dt>S</dt><dd>Open settings</dd><dt>R</dt><dd>Refresh weather</dd><dt>← / →</dt><dd>Switch saved places</dd><dt>Esc</dt><dd>Close dialogs</dd><dt>? / Shift+/</dt><dd>Toggle this help</dd></dl></div></section></div>}
  </main>);
}
