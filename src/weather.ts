export type Place = { id: string; name: string; admin1?: string; country: string; latitude: number; longitude: number; timezone: string };
export type WeatherScene = 'sunny'|'partly'|'cloudy'|'cloudy-night'|'partly-night'|'rain'|'heavy-rain'|'storm'|'snow'|'fog'|'windy'|'night';
export type ForecastSignal = { id: string; category: string; title: string; description: string; severity: 'attention'|'high'; time: string };
export type PollenType = 'alder'|'birch'|'grass'|'mugwort'|'olive'|'ragweed';
export type PollenReading = { type: PollenType; current: number|null; next24hMax: number|null; peakTime: string|null };
export type WeatherBundle = {
  place: Place; current: { time: string; temperature: number; apparent: number; code: number; isDay: boolean; humidity: number; wind: number; windDirection: number; gust: number; pressure: number; precipitation: number; cloud: number; visibility: number|null; uv: number; dewPoint: number };
  hourly: Array<{ time: string; temperature: number; code: number; precipitationChance: number; precipitation: number; wind: number; gust: number; pressure: number; visibility: number|null; dewPoint: number; uv: number }>;
  daily: Array<{ date: string; code: number; high: number; low: number; precipitationChance: number; precipitation: number; wind: number; sunrise: string; sunset: string }>;
  air?: { aqi: number|null; aqiScale: 'European'|'US'; europeanAqi: number|null; usAqi: number|null; pm25: number|null; pm10: number|null; ozone: number|null; no2: number|null; uvMaxNext24h: number|null; uvPeakTime: string|null; pollen: PollenReading[] };
  fetchedAt: string;
};
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
export const description = (code: number) => code === 0 ? 'Clear sky' : code <= 2 ? 'Partly cloudy' : code === 3 ? 'Overcast' : code <= 48 ? 'Foggy' : code <= 57 ? 'Drizzle' : code <= 67 ? 'Rain' : code <= 77 ? 'Snow' : code <= 82 ? 'Showers' : code <= 86 ? 'Snow showers' : code <= 99 ? 'Thunderstorms' : 'Weather';
// WMO 4677 code groups. Showers of rain (80-82) are rain, not snow; only
// 71-77 and 85-86 are snowfall. Keeping these in one place stops the scene,
// the condition icon, and the canvas from disagreeing about the weather.
export const isSnowCode = (code: number) => (code >= 71 && code <= 77) || (code >= 85 && code <= 86);
export const isRainCode = (code: number) => (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
export const scene = (code: number, isDay: boolean, windKmh = 0, precipitationMm = 0): WeatherScene => code >= 95 ? 'storm' : isSnowCode(code) ? 'snow' : isRainCode(code) ? ((code === 65 || code === 67 || precipitationMm >= 5) ? 'heavy-rain' : 'rain') : code >= 45 && code <= 48 ? 'fog' : !isDay && code === 3 ? 'cloudy-night' : !isDay && code > 0 && code <= 2 ? 'partly-night' : (windKmh >= 45 ? 'windy' : code === 3 ? 'cloudy' : code === 0 ? (isDay ? 'sunny' : 'night') : code <= 2 ? 'partly' : isDay ? 'sunny' : 'night');
export const europeanAqiLabel = (aqi: number) => aqi <= 20 ? 'Good' : aqi <= 40 ? 'Fair' : aqi <= 60 ? 'Moderate' : aqi <= 80 ? 'Poor' : aqi <= 100 ? 'Very poor' : 'Extremely poor';
export const usAqiLabel = (aqi: number) => aqi <= 50 ? 'Good' : aqi <= 100 ? 'Moderate' : aqi <= 150 ? 'Unhealthy for sensitive groups' : aqi <= 200 ? 'Unhealthy' : aqi <= 300 ? 'Very unhealthy' : 'Hazardous';
export function outdoorAirAdvice(scale: 'European'|'US', aqi: number|null, pm25: number|null): string {
  if (aqi != null) {
    if (scale === 'US') {
      if (aqi <= 50) return 'Air quality is good. Enjoy your usual outdoor activities.';
      if (aqi <= 100) return 'Air quality is acceptable. People unusually sensitive to pollution may want to take it easier.';
      if (aqi <= 150) return 'Sensitive groups should reduce prolonged or intense outdoor activity; others can continue usual activities.';
      if (aqi <= 200) return 'Reduce prolonged outdoor exertion. Sensitive groups should avoid it and choose cleaner indoor air.';
      if (aqi <= 300) return 'Avoid prolonged outdoor exertion and move activities indoors if possible.';
      return 'Avoid outdoor activity and follow local public-health guidance.';
    }
    if (aqi <= 20) return 'Air quality is good. Enjoy your usual outdoor activities.';
    if (aqi <= 40) return 'Air quality is generally acceptable. If you are sensitive to pollution, consider lighter exertion.';
    if (aqi <= 60) return 'Consider reducing prolonged or intense outdoor exertion, especially if you are sensitive to pollution.';
    return 'Limit prolonged outdoor exertion and consider moving strenuous activities indoors.';
  }
  if (pm25 != null && pm25 >= 55.5) return 'Fine-particle pollution is elevated. Reduce prolonged outdoor exertion, especially if you are sensitive.';
  if (pm25 != null && pm25 >= 35.5) return 'Fine-particle pollution is raised. Sensitive people may prefer shorter, lighter outdoor activity.';
  return 'Air-quality guidance is unavailable because the provider did not return an AQI or PM2.5 reading.';
}
export function uvAdvice(uv: number): string {
  if (uv < 3) return 'Low UV: usual outdoor plans are fine; use sun protection for extended exposure.';
  if (uv < 8) return 'Moderate to high UV: seek shade, wear protective clothing, and use sunscreen during midday.';
  return 'Very high UV: limit midday sun and use shade, protective clothing, and sunscreen.';
}
export function forecastSignals(weather: WeatherBundle): ForecastSignal[] {
  const found = new Map<string, ForecastSignal>();
  for (const hour of weather.hourly) {
    const signal = (category: string, title: string, detail: string, severity: ForecastSignal['severity'] = 'attention') => {
      if (!found.has(category)) found.set(category, { id: `${weather.place.id}:${hour.time}:${category}`, category, title, description: `${detail} · ${weather.place.name}`, severity, time: hour.time });
    };
    if (hour.code >= 95) signal('thunderstorm','Thunderstorms forecast','Thunderstorms may develop', 'high');
    else if (hour.precipitation >= 5) signal('heavy-rain','Heavy rain forecast',`${hour.precipitation.toFixed(1)} mm expected in one hour`,'high');
    if (hour.wind >= 65) signal('high-wind','Strong wind forecast',`${Math.round(hour.wind)} km/h sustained wind`,'high');
    if (hour.temperature >= 35) signal('heat','High temperature forecast',`${Math.round(hour.temperature)}°C expected`);
    if (hour.temperature <= -10) signal('cold','Very low temperature forecast',`${Math.round(hour.temperature)}°C expected`);
  }
  return [...found.values()].sort((a,b) => a.time.localeCompare(b.time));
}
const request = async <T,>(url: string, signal?: AbortSignal): Promise<T> => {
  const activeSignal = signal ?? AbortSignal.timeout(12000);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: activeSignal });
      if (response.ok) {
        const advertisedSize = Number(response.headers.get('content-length'));
        if (advertisedSize > 2_000_000) throw new RangeError('Weather service response is larger than expected.');
        const body = await response.text();
        if (body.length > 2_000_000) throw new RangeError('Weather service response is larger than expected.');
        return JSON.parse(body) as T;
      }
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
        throw new Error(response.status === 429 ? 'Weather service is busy. Try again shortly.' : `Weather service returned ${response.status}.`);
      }
      const retryAfter = Number(response.headers.get('Retry-After'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 8000) : 500 * (2 ** attempt) + Math.random() * 250;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        activeSignal.addEventListener('abort', () => { clearTimeout(timer); reject(activeSignal.reason); }, { once: true });
      });
    } catch (error) {
      if (activeSignal.aborted) throw error;
      lastError = error;
      if (error instanceof RangeError) throw error;
      if (error instanceof Error && /^Weather service returned|^Weather service is busy/.test(error.message)) throw error;
      if (attempt < 2) await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 400 * (2 ** attempt) + Math.random() * 250);
        activeSignal.addEventListener('abort', () => { clearTimeout(timer); reject(activeSignal.reason); }, { once: true });
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Weather service could not be reached. Check your connection and try again.');
};
export async function searchPlaces(query: string, signal?: AbortSignal, language = 'en'): Promise<Place[]> {
  if (query.trim().length < 2) return [];
  const data = await request<{ results?: Array<{ id: number; name: string; admin1?: string; country: string; latitude: number; longitude: number; timezone?: string }> }>(`${GEO_URL}?name=${encodeURIComponent(query.trim())}&count=8&language=${encodeURIComponent(language)}&format=json`, signal);
  return (data.results ?? []).map(p => ({ ...p, id: String(p.id), timezone: p.timezone ?? 'auto' }));
}
export async function fetchWeather(place: Place, signal?: AbortSignal): Promise<WeatherBundle> {
  const params = new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude), timezone: 'auto', timeformat: 'unixtime', forecast_days: '7', current: 'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,uv_index,dew_point_2m', hourly: 'temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,pressure_msl,visibility,dew_point_2m,uv_index', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,sunrise,sunset', wind_speed_unit: 'kmh' });
  const [raw, airRaw] = await Promise.all([
    request<any>(`${WEATHER_URL}?${params}`, signal),
    request<any>(`${AIR_URL}?latitude=${place.latitude}&longitude=${place.longitude}&timezone=auto&forecast_hours=24&current=european_aqi,us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,uv_index,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen&hourly=uv_index,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen`, signal).catch(() => null),
  ]);
  return parseWeatherPayload(raw, airRaw, place);
}
export function parseWeatherPayload(raw: any, airRaw: any, place: Place): WeatherBundle {
  if (!raw?.current || !Array.isArray(raw.hourly?.time) || raw.hourly.time.length > 1000 || !Array.isArray(raw.daily?.time) || raw.daily.time.length < 1 || raw.daily.time.length > 14) throw new Error('The provider returned incomplete forecast data.');
  const c = raw.current, h = raw.hourly, d = raw.daily;
  if (![c.time, c.temperature_2m, c.apparent_temperature, c.weather_code, c.is_day, c.relative_humidity_2m, c.wind_speed_10m, c.wind_direction_10m, c.wind_gusts_10m, c.pressure_msl, c.precipitation, c.cloud_cover, c.visibility, c.uv_index, c.dew_point_2m].every(Number.isFinite)) throw new Error('The provider returned invalid current weather values.');
  if (!h.time.every(Number.isSafeInteger) || !Array.isArray(h.temperature_2m) || !Array.isArray(h.weather_code) || h.temperature_2m.length !== h.time.length || h.weather_code.length !== h.time.length || !h.temperature_2m.every(Number.isFinite) || !h.weather_code.every(Number.isFinite) || !Array.isArray(d.temperature_2m_max) || !Array.isArray(d.temperature_2m_min) || !Array.isArray(d.weather_code) || !Array.isArray(d.sunrise) || !Array.isArray(d.sunset) || [d.time,d.temperature_2m_max,d.temperature_2m_min,d.weather_code,d.sunrise,d.sunset].some((values: unknown[]) => values.length !== d.time.length || !values.every(Number.isFinite))) throw new Error('The provider returned incomplete forecast fields.');
  const toIso = (seconds: number) => new Date(seconds * 1000).toISOString();
  const hourlyTimes = h.time.map((seconds: number) => toIso(seconds));
  const currentTime = toIso(c.time);
  const ix = Math.max(0, hourlyTimes.findIndex((t: string) => t >= currentTime));
  const airCurrent = airRaw?.current;
  const nullableAirValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const europeanAqi = nullableAirValue(airCurrent?.european_aqi), usAqi = nullableAirValue(airCurrent?.us_aqi);
  const aqiScale: 'European'|'US' = /united states|usa/i.test(place.country) && usAqi != null ? 'US' : europeanAqi != null ? 'European' : 'US';
  const aqi = aqiScale === 'US' ? usAqi : europeanAqi;
  const pollenTypes: PollenType[] = ['alder','birch','grass','mugwort','olive','ragweed'];
  const airHourly = airRaw?.hourly;
  const airTimes: unknown[] = Array.isArray(airHourly?.time) ? airHourly.time : [];
  const futureAirHours = airTimes.map((value, index) => ({ value: nullableAirValue(value), index })).filter(item => item.value != null && item.value * 1000 >= c.time * 1000 && item.value * 1000 <= (c.time + 86400) * 1000);
  const pollen: PollenReading[] = pollenTypes.map(type => {
    const field = `${type}_pollen`;
    const series: unknown[] = Array.isArray(airHourly?.[field]) ? airHourly[field] : [];
    const values = futureAirHours.map(hour => ({ time: hour.value!, concentration: nullableAirValue(series[hour.index]) })).filter(point => point.concentration != null);
    const peak = values.reduce<{time:number; concentration:number}|null>((best, point) => best == null || point.concentration! > best.concentration ? { time: point.time, concentration: point.concentration! } : best, null);
    return { type, current: nullableAirValue(airCurrent?.[field]), next24hMax: values.length ? Math.max(...values.map(point => point.concentration!)) : null, peakTime: peak ? toIso(peak.time) : null };
  });
  const uvSeries: unknown[] = Array.isArray(airHourly?.uv_index) ? airHourly.uv_index : [];
  const uvValues = futureAirHours.map(hour => ({ time: hour.value!, value: nullableAirValue(uvSeries[hour.index]) })).filter(point => point.value != null);
  const uvPeak = uvValues.reduce<{time:number; value:number}|null>((best, point) => best == null || point.value! > best.value ? {time:point.time,value:point.value!} : best, null);
  return {
    place: { ...place, timezone: raw.timezone ?? place.timezone },
    current: { time: currentTime, temperature: c.temperature_2m, apparent: c.apparent_temperature, code: c.weather_code, isDay: c.is_day === 1, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m, windDirection: c.wind_direction_10m, gust: c.wind_gusts_10m, pressure: c.pressure_msl, precipitation: c.precipitation, cloud: c.cloud_cover, visibility: c.visibility / 1000, uv: c.uv_index, dewPoint: c.dew_point_2m },
    hourly: hourlyTimes.slice(ix, ix + 24).map((time: string, j: number) => ({ time, temperature: h.temperature_2m[ix + j], code: h.weather_code[ix + j], precipitationChance: h.precipitation_probability?.[ix + j] ?? 0, precipitation: h.precipitation?.[ix + j] ?? 0, wind: h.wind_speed_10m?.[ix + j] ?? 0, gust: h.wind_gusts_10m?.[ix+j] ?? h.wind_speed_10m?.[ix+j] ?? 0, pressure: h.pressure_msl?.[ix+j] ?? c.pressure_msl, visibility: Number.isFinite(h.visibility?.[ix+j]) ? h.visibility[ix+j]/1000 : null, dewPoint: h.dew_point_2m?.[ix+j] ?? c.dew_point_2m, uv: h.uv_index?.[ix+j] ?? 0 })),
    daily: (() => {
      // Open-Meteo daily timestamps already sit in the requested timezone. Forming
      // a Date from the raw Unix seconds and formatting against `raw.timezone` is
      // the timezone-correct path; adding `utc_offset_seconds` afterwards would
      // shift the label by a day for any place behind the UTC meridian.
      const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: raw.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
      return d.time.map((date: number, j: number) => ({ date: dayFormatter.format(new Date(date * 1000)), code: d.weather_code[j], high: d.temperature_2m_max[j], low: d.temperature_2m_min[j], precipitationChance: d.precipitation_probability_max?.[j] ?? 0, precipitation: d.precipitation_sum?.[j] ?? 0, wind: d.wind_speed_10m_max?.[j] ?? 0, sunrise: toIso(d.sunrise[j]), sunset: toIso(d.sunset[j]) }));
    })(),
    air: airCurrent ? { aqi, aqiScale, europeanAqi, usAqi, pm25: nullableAirValue(airCurrent.pm2_5), pm10: nullableAirValue(airCurrent.pm10), ozone: nullableAirValue(airCurrent.ozone), no2: nullableAirValue(airCurrent.nitrogen_dioxide), uvMaxNext24h: uvPeak?.value ?? null, uvPeakTime: uvPeak ? toIso(uvPeak.time) : null, pollen } : undefined,
    fetchedAt: new Date().toISOString(),
  };
}
export const celsius = (n: number, unit: string) => unit === 'F' ? Math.round(n * 9 / 5 + 32) : Math.round(n);
export const kmh = (n: number, unit: string) => unit === 'mph' ? Math.round(n * 0.621371) : Math.round(n);
// Intl formatters are expensive to construct and are rebuilt on every render call,
// so cache them by locale + options + time zone. The map is bounded because callers
// only use a small fixed set of option shapes.
const formatterCache = new Map<string, Intl.DateTimeFormat>();
export const localTime = (iso: string, timezone: string, options: Intl.DateTimeFormatOptions = { hour: 'numeric' }, locale?: string) => {
  const key = `${locale ?? ''}|${timezone}|${options.weekday ?? ''}|${options.month ?? ''}|${options.day ?? ''}|${options.hour ?? ''}|${options.minute ?? ''}|${options.hourCycle ?? ''}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    if (formatterCache.size > 80) formatterCache.clear();
    formatter = new Intl.DateTimeFormat(locale || undefined, { ...options, timeZone: timezone });
    formatterCache.set(key, formatter);
  }
  return formatter.format(new Date(iso));
};
