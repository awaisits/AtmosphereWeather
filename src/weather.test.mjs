import test from 'node:test';
import assert from 'node:assert/strict';
import { celsius, description, europeanAqiLabel, forecastSignals, isRainCode, isSnowCode, kmh, parseWeatherPayload, scene } from './weather.ts';

test('weather codes map to readable condition names', () => {
  assert.equal(description(0), 'Clear sky');
  assert.equal(description(61), 'Rain');
  assert.equal(description(71), 'Snow');
  assert.equal(description(95), 'Thunderstorms');
});
test('weather condition and daylight select the intended animation scene', () => {
  assert.equal(scene(0, true), 'sunny');
  assert.equal(scene(3, true), 'cloudy');
  assert.equal(scene(63, true), 'rain');
  assert.equal(scene(0, false), 'night');
  assert.equal(scene(2, true), 'partly');
  assert.equal(scene(96, false), 'storm');
  assert.equal(scene(0, true, 48), 'windy');
  assert.equal(scene(65, true), 'heavy-rain');
  assert.equal(scene(3, false), 'cloudy-night');
});
test('showers of rain are rain, not snow', () => {
  // WMO 80-82 are rain showers. Only 71-77 and 85-86 are snowfall.
  for (const code of [80, 81, 82]) {
    assert.equal(scene(code, true), 'rain', `code ${code} should be a rain scene`);
    assert.equal(isRainCode(code), true);
    assert.equal(isSnowCode(code), false);
  }
  for (const code of [71, 73, 75, 77, 85, 86]) {
    assert.equal(scene(code, true), 'snow', `code ${code} should be a snow scene`);
    assert.equal(isSnowCode(code), true);
    assert.equal(isRainCode(code), false);
  }
  // Heavy rain thresholds still apply to showers.
  assert.equal(scene(82, true, 0, 5), 'heavy-rain');
});
test('temperature and wind conversions are correct', () => {
  assert.equal(celsius(0, 'F'), 32);
  assert.equal(celsius(100, 'C'), 100);
  assert.equal(kmh(100, 'mph'), 62);
  assert.equal(kmh(25, 'km/h'), 25);
  assert.equal(europeanAqiLabel(20), 'Good');
  assert.equal(europeanAqiLabel(87), 'Very poor');
  assert.equal(europeanAqiLabel(104), 'Extremely poor');
});
test('provider payload becomes timezone-safe hourly and daily weather', () => {
  const place = { id: 'x', name: 'Test', country: 'XX', latitude: 0, longitude: 0, timezone: 'UTC' };
  const raw = {
    timezone: 'UTC', utc_offset_seconds: 3600, current: { time: 1791633600, temperature_2m: 20, apparent_temperature: 19, weather_code: 0, is_day: 1, relative_humidity_2m: 50, wind_speed_10m: 10, wind_direction_10m: 180, wind_gusts_10m: 14, pressure_msl: 1014, precipitation: 0, cloud_cover: 0, visibility: 10000, uv_index: 2, dew_point_2m: 9 },
    hourly: { time: [1791633600,1791637200], temperature_2m: [20,21], weather_code: [0,1], precipitation_probability: [0,10], precipitation: [0,0], wind_speed_10m: [10,11], visibility: [10000,10000], uv_index: [1,2], dew_point_2m: [9,10] },
    daily: { time: [1791590400], weather_code: [0], temperature_2m_max: [24], temperature_2m_min: [13], precipitation_probability_max: [10], precipitation_sum: [0.2], wind_speed_10m_max: [16], sunrise: [1791612000], sunset: [1791651600] },
  };
  const result = parseWeatherPayload(raw, null, place);
  assert.equal(result.hourly.length, 2);
  assert.equal(result.daily[0].high, 24);
  assert.equal(result.current.visibility, 10);
  assert.equal(result.daily[0].date, '2026-10-10');
});
test('daily dates stay on the correct local day west of the UTC meridian', () => {
  // Open-Meteo returns daily timestamps already in the requested timezone.
  // Formatting them must not shift the label by a day for negative UTC
  // offsets, which is where the previous implementation broke.
  const place = { id: 'ny', name: 'New York', country: 'United States', latitude: 40.71, longitude: -74.01, timezone: 'America/New_York' };
  const dailyTime = [1792555200, 1792641600, 1792728000];
  const raw = {
    timezone: 'America/New_York', utc_offset_seconds: -14400,
    current: { time: 1792560000, temperature_2m: 20, apparent_temperature: 19, weather_code: 0, is_day: 1, relative_humidity_2m: 50, wind_speed_10m: 10, wind_direction_10m: 180, wind_gusts_10m: 14, pressure_msl: 1014, precipitation: 0, cloud_cover: 0, visibility: 10000, uv_index: 2, dew_point_2m: 9 },
    hourly: { time: [1792560000], temperature_2m: [20], weather_code: [0], precipitation_probability: [0], precipitation: [0], wind_speed_10m: [10], visibility: [10000], uv_index: [2], dew_point_2m: [9] },
    daily: { time: dailyTime, weather_code: [0, 0, 0], temperature_2m_max: [24, 25, 26], temperature_2m_min: [13, 14, 15], precipitation_probability_max: [10, 10, 10], precipitation_sum: [0.2, 0.2, 0.2], wind_speed_10m_max: [16, 16, 16], sunrise: [1792581231, 1792667698, 1792754165], sunset: [1792600000, 1792680000, 1792760000] },
  };
  const result = parseWeatherPayload(raw, null, place);
  assert.deepEqual(result.daily.map(day => day.date), ['2026-10-21', '2026-10-22', '2026-10-23']);
  // The current day must be resolvable against the local calendar, otherwise
  // the scene picks the wrong day's sunrise and sunset.
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(1792560000 * 1000));
  assert.equal(todayKey, '2026-10-21');
  assert.ok(result.daily.some(day => day.date === todayKey), 'today must appear in the daily list');
});
test('daily dates stay on the correct local day east of the UTC meridian', () => {
  const place = { id: 'tk', name: 'Tokyo', country: 'Japan', latitude: 35.68, longitude: 139.69, timezone: 'Asia/Tokyo' };
  const raw = {
    timezone: 'Asia/Tokyo', utc_offset_seconds: 32400,
    current: { time: 1792560000, temperature_2m: 20, apparent_temperature: 19, weather_code: 0, is_day: 1, relative_humidity_2m: 50, wind_speed_10m: 10, wind_direction_10m: 180, wind_gusts_10m: 14, pressure_msl: 1014, precipitation: 0, cloud_cover: 0, visibility: 10000, uv_index: 2, dew_point_2m: 9 },
    hourly: { time: [1792560000], temperature_2m: [20], weather_code: [0], precipitation_probability: [0], precipitation: [0], wind_speed_10m: [10], visibility: [10000], uv_index: [2], dew_point_2m: [9] },
    daily: { time: [1792508400, 1792594800], weather_code: [0, 0], temperature_2m_max: [24, 25], temperature_2m_min: [13, 14], precipitation_probability_max: [10, 10], precipitation_sum: [0.2, 0.2], wind_speed_10m_max: [16, 16], sunrise: [1792524000, 1792610400], sunset: [1792570000, 1792656000] },
  };
  const result = parseWeatherPayload(raw, null, place);
  assert.deepEqual(result.daily.map(day => day.date), ['2026-10-21', '2026-10-22']);
});
test('provider parser rejects incomplete responses instead of fabricating values', () => {
  const place = { id: 'x', name: 'Test', country: 'XX', latitude: 0, longitude: 0, timezone: 'UTC' };
  assert.throws(() => parseWeatherPayload({}, null, place), /incomplete forecast data/);
  assert.throws(() => parseWeatherPayload({ current: { time: NaN }, hourly: { time: [] }, daily: { time: [1] } }, null, place), /invalid current weather values/);
});
test('forecast signals use explicit app-generated thresholds and deduplicate categories', () => {
  const place = { id: 'x', name: 'Test city', country: 'XX', latitude: 0, longitude: 0, timezone: 'UTC' };
  const weather = { place, hourly: [
    { time: '2026-10-10T12:00:00.000Z', code: 95, temperature: 36, precipitationChance: 0, precipitation: 0, wind: 70 },
    { time: '2026-10-10T13:00:00.000Z', code: 95, temperature: 37, precipitationChance: 0, precipitation: 6, wind: 72 },
  ] };
  const signals = forecastSignals(weather);
  assert.deepEqual(signals.map(item => item.category), ['thunderstorm','high-wind','heat']);
  assert.ok(signals.every(item => item.description.includes('Test city')));
  assert.equal(signals.find(item => item.category === 'thunderstorm')?.severity, 'high');
});
