import type { Place } from './weather';

export type OfficialSeverity = 'extreme'|'severe'|'moderate'|'minor'|'unknown';
export type OfficialAlert = {
  id: string; title: string; event: string; severity: OfficialSeverity; urgency: string;
  certainty: string; area: string; description: string; instruction: string;
  onset?: string; expires?: string; source: string; sourceUrl: string;
};
export type OfficialAlertsResult = {
  status: 'available'|'unsupported'; provider: string; sourceUrl: string;
  checkedAt: string; alerts: OfficialAlert[];
};

const PMD_FEED = 'https://cap-sources.s3.amazonaws.com/pk-pmd-en/rss.xml';
const NWS_API = 'https://api.weather.gov/alerts/active';
const severity = (value: unknown): OfficialSeverity => {
  const v = String(value ?? '').trim().toLowerCase();
  return (['extreme','severe','moderate','minor'].includes(v) ? v : 'unknown') as OfficialSeverity;
};
const cappedText = (value: string | null | undefined, max = 1200) => (value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const xmlDoc = (text: string) => {
  if (text.length > 250_000 || /<!DOCTYPE/i.test(text)) throw new Error('The official alert feed contained invalid or oversized XML.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('The official alert feed could not be read.');
  return doc;
};
const pointInRing = (latitude: number, longitude: number, ring: Array<[number, number]>) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > latitude) !== (yj > latitude) && longitude < (xj - xi) * (latitude - yi) / ((yj - yi) || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
};
const pointInPolygon = (lat: number, lon: number, polygonText: string) => {
  const ring = polygonText.trim().split(/\s+/).map(pair => pair.split(',').map(Number)).filter(pair => pair.length === 2 && pair.every(Number.isFinite)) as Array<[number,number]>;
  return ring.length >= 4 && pointInRing(lat, lon, ring);
};
const matchesPlace = (place: Place, areas: string[], descriptions: string[]) => {
  const candidates = [place.name, place.admin1].filter((part): part is string => Boolean(part && part.trim().length >= 3));
  if (!candidates.length) return false;
  const text = [...areas, ...descriptions].join(' ').normalize('NFKD').toLocaleLowerCase();
  const namedMatch = candidates.some(name => {
    const escaped = name.normalize('NFKD').toLocaleLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'u').test(text);
  });
  return namedMatch;
};
const fetchText = async (url: string, maxBytes: number, signal?: AbortSignal) => {
  const response = await fetch(url, { signal: signal ?? AbortSignal.timeout(9000), redirect: 'error', headers: { Accept: 'application/rss+xml, application/xml, application/geo+json, application/ld+json, application/json' } });
  if (!response.ok) throw new Error(`Official alert provider returned HTTP ${response.status}.`);
  const advertised = Number(response.headers.get('content-length'));
  if (advertised > maxBytes) throw new Error('The official alert response exceeded its size limit.');
  const body = await response.text();
  if (body.length > maxBytes) throw new Error('The official alert response exceeded its size limit.');
  return body;
};
const withinActiveWindow = (onset?: string, expires?: string, fallback?: string) => {
  const now = Date.now(), start = Date.parse(onset || fallback || '');
  const end = Date.parse(expires || '');
  return (!Number.isFinite(start) || start <= now + 14 * 86400_000) && (!Number.isFinite(end) || end > now);
};
const country = (place: Place) => place.country.normalize('NFKD').toLocaleLowerCase();
const countryIs = (place: Place, ...names: string[]) => names.some(name => country(place) === name);

async function fetchPmdAlerts(place: Place, signal?: AbortSignal): Promise<OfficialAlertsResult> {
  const rss = xmlDoc(await fetchText(PMD_FEED, 200_000, signal));
  const items = [...rss.getElementsByTagName('item')].slice(0, 12);
  let unreadableItems = 0;
  const snapshots = await Promise.all(items.map(async item => {
    const text = (name: string) => cappedText(item.getElementsByTagName(name)[0]?.textContent, 6000);
    const title = text('title'), summary = text('description'), published = text('pubDate'), link = text('link');
    if (!title || !/^https:\/\/cap-sources\.s3\.amazonaws\.com\/pk-pmd-en\/[a-z0-9-]+\.xml$/i.test(link)) return null;
    try {
      const doc = xmlDoc(await fetchText(link, 250_000, signal));
      const alert = doc.getElementsByTagNameNS('urn:oasis:names:tc:emergency:cap:1.2', 'alert')[0] ?? doc.documentElement;
      const info = alert.getElementsByTagNameNS('urn:oasis:names:tc:emergency:cap:1.2', 'info')[0];
      const references = [...alert.getElementsByTagNameNS('urn:oasis:names:tc:emergency:cap:1.2', 'references')].flatMap(node => (node.textContent ?? '').trim().split(/\s+/).filter(Boolean));
      const field = (name: string) => alert.getElementsByTagNameNS('urn:oasis:names:tc:emergency:cap:1.2', name)[0]?.textContent?.trim() ?? '';
      const status = field('status'), scope = field('scope'), msgType = field('msgType');
      if (status !== 'Actual' || scope !== 'Public' || !['Alert','Update','Cancel'].includes(msgType)) return null;
      if (msgType === 'Cancel') return { alert: undefined, references, msgType };
      if (!info) return null;
      const infoField = (name: string) => info.getElementsByTagNameNS('urn:oasis:names:tc:emergency:cap:1.2', name)[0]?.textContent?.trim() ?? '';
      const onset = infoField('onset') || infoField('effective') || undefined;
      const expires = infoField('expires') || undefined;
      if (!withinActiveWindow(onset, expires, published)) return null;
      const areaNodes = [...info.getElementsByTagNameNS('urn:oasis:names:tc:emergency:cap:1.2', 'area')];
      const areas = areaNodes.map(area => area.getElementsByTagNameNS('urn:oasis:names:tc:emergency:cap:1.2', 'areaDesc')[0]?.textContent ?? '');
      const polygons = areaNodes.flatMap(area => [...area.getElementsByTagNameNS('urn:oasis:names:tc:emergency:cap:1.2', 'polygon')].map(node => node.textContent ?? '').filter(Boolean));
      const isInside = polygons.some(poly => pointInPolygon(place.latitude, place.longitude, poly));
      const textualMatch = matchesPlace(place, areas, [infoField('description'), summary]);
      if (polygons.length ? !isInside : !textualMatch) return null;
      const id = field('identifier');
      if (!id) return null;
      return {
        alert: {
          id, title: cappedText(infoField('headline') || title, 180), event: cappedText(infoField('event') || 'Weather warning', 100),
          severity: severity(infoField('severity')), urgency: cappedText(infoField('urgency') || 'Unknown', 30), certainty: cappedText(infoField('certainty') || 'Unknown', 30),
          area: cappedText(areas.join(' · ') || place.name, 250), description: cappedText(infoField('description') || summary, 1200),
          instruction: cappedText(infoField('instruction'), 1000), onset, expires,
          source: cappedText(infoField('senderName') || 'Pakistan Meteorological Department', 120), sourceUrl: 'https://weather.gov.pk/',
        } satisfies OfficialAlert,
        references,
        msgType,
      };
    } catch { unreadableItems++; return null; }
  }));
  if (unreadableItems) throw new Error('Some PMD warning records could not be checked. The warning list may be incomplete; try again or open the official source.');
  const valid = snapshots.filter((value): value is NonNullable<typeof value> => value !== null);
  const replaced = new Set(valid.flatMap(item => item.references.map(ref => ref.split(',')[1]).filter(Boolean)));
  const alerts = valid.filter(item => item.alert && !replaced.has(item.alert.id)).map(item => item.alert!).slice(0, 20);
  return { status: 'available', provider: 'Pakistan Meteorological Department', sourceUrl: 'https://weather.gov.pk/', checkedAt: new Date().toISOString(), alerts };
}

async function fetchNwsAlerts(place: Place, signal?: AbortSignal): Promise<OfficialAlertsResult> {
  const params = new URLSearchParams({ point: `${place.latitude},${place.longitude}` });
  const raw = await fetchText(`${NWS_API}?${params}`, 1_500_000, signal);
  let result: any;
  try { result = JSON.parse(raw); } catch { throw new Error('The National Weather Service returned unreadable alert data.'); }
  if (!Array.isArray(result.features)) throw new Error('The National Weather Service returned an invalid alert list.');
  const now = Date.now();
  const alerts: OfficialAlert[] = result.features.slice(0, 50).flatMap((feature: any) => {
    const p = feature?.properties;
    if (!p || p.status !== 'Actual' || p.messageType === 'Cancel' || p.messageType === 'Ack' || !p.id) return [];
    const onset = typeof p.onset === 'string' ? p.onset : typeof p.effective === 'string' ? p.effective : undefined;
    const expires = typeof p.expires === 'string' ? p.expires : undefined;
    if (!withinActiveWindow(onset, expires, p.sent) || Number.isFinite(Date.parse(expires || '')) && Date.parse(expires!) <= now) return [];
    return [{ id: String(p.id).slice(0, 300), title: cappedText(p.headline || p.event || 'Weather alert', 180), event: cappedText(p.event || 'Weather alert', 100),
      severity: severity(p.severity), urgency: cappedText(p.urgency || 'Unknown', 30), certainty: cappedText(p.certainty || 'Unknown', 30),
      area: cappedText(p.areaDesc || place.name, 250), description: cappedText(p.description, 1200), instruction: cappedText(p.instruction, 1000),
      onset, expires, source: cappedText(p.senderName || 'National Weather Service', 120), sourceUrl: typeof p.web === 'string' && /^https:\/\/(?:www\.)?weather\.gov\//.test(p.web) ? p.web : 'https://www.weather.gov/alerts',
    } satisfies OfficialAlert];
  });
  return { status: 'available', provider: 'US National Weather Service', sourceUrl: 'https://www.weather.gov/alerts', checkedAt: new Date().toISOString(), alerts };
}

export async function fetchOfficialAlerts(place: Place, signal?: AbortSignal): Promise<OfficialAlertsResult> {
  if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) || Math.abs(place.latitude) > 90 || Math.abs(place.longitude) > 180) throw new Error('This location has invalid coordinates.');
  // Geocoding results can use the localized country label selected by the
  // user's locale. Pakistan may be returned in Urdu as پاکستان.
  if (countryIs(place, 'pakistan', 'پاکستان')) return fetchPmdAlerts(place, signal);
  if (countryIs(place, 'united states', 'united states of america', 'usa')) return fetchNwsAlerts(place, signal);
  return { status: 'unsupported', provider: 'Official weather authority', sourceUrl: '', checkedAt: new Date().toISOString(), alerts: [] };
}

export const severityRank: Record<OfficialSeverity, number> = { unknown: 0, minor: 1, moderate: 2, severe: 3, extreme: 4 };
