import { useEffect, useState, useCallback, useMemo } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import { CloudRain, MapPin, Pause, Play, RefreshCw } from 'lucide-react';
import type { Place } from './weather';
import 'leaflet/dist/leaflet.css';

type RadarFrame = { time: number; path: string; forecast?: boolean };
type Manifest = { host: string; radar?: { past?: RadarFrame[]; nowcast?: RadarFrame[] } };

function Recenter({ place }: { place: Place }) {
  const map = useMap();
  useEffect(() => { map.setView([place.latitude, place.longitude], Math.min(map.getZoom(), 7), { animate: true }); }, [map, place.latitude, place.longitude]);
  return null;
}

const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes

export default function WeatherMap({ place }: { place: Place }) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [frameIndex, setFrameIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const frames = useMemo(() => [...(manifest?.radar?.past ?? []), ...(manifest?.radar?.nowcast ?? [])], [manifest]);
  const active = frames[frameIndex];

  const fetchManifest = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (!response.ok) throw new Error(`Radar service returned ${response.status}.`);
      const payload = await response.text();
      if (payload.length > 250_000) throw new Error('Radar metadata is larger than expected.');
      const value = JSON.parse(payload) as Manifest;
      const host = new URL(value.host);
      const valid = (frame: RadarFrame) => Number.isSafeInteger(frame.time) && frame.time > 0 && typeof frame.path === 'string' && /^\/v2\/radar\/[a-zA-Z0-9_./-]+$/.test(frame.path) && !frame.path.includes('..');
      const past = value.radar?.past?.filter(valid).slice(-12);
      const nowcast = value.radar?.nowcast?.filter(valid).slice(0, 6).map(frame => ({ ...frame, forecast: true }));
      if (host.origin !== 'https://tilecache.rainviewer.com' || host.pathname !== '/' || host.search || host.hash || !past?.length) throw new Error('Radar frames are not available for the current period.');
      const safeManifest: Manifest = { host: host.origin, radar: { past, nowcast } };
      setManifest(safeManifest); setFrameIndex(past.length - 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Radar is temporarily unavailable.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchManifest(); }, [fetchManifest]);

  useEffect(() => {
    const timer = window.setInterval(fetchManifest, REFRESH_INTERVAL);
    return () => window.clearInterval(timer);
  }, [fetchManifest]);

  useEffect(() => {
    if (!playing || !frames.length) return;
    const timer = window.setInterval(() => setFrameIndex(index => index >= frames.length - 1 ? 0 : index + 1), 850);
    return () => window.clearInterval(timer);
  }, [playing, frames.length]);

  // Stop decoding radar tiles while the window is hidden.
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return <section className="section map-section">
    <header className="section-header">
      <div><p className="eyebrow">Live radar & short nowcast</p><h2 className="section-title">Rain radar</h2></div>
      <button className="btn btn-secondary" onClick={() => void fetchManifest()} disabled={loading}><RefreshCw size={13} className={loading?'spin':''}/> Update radar</button>
    </header>
    <div className="map-wrap"><MapContainer center={[place.latitude,place.longitude]} zoom={4} minZoom={2} maxZoom={7} scrollWheelZoom className="weather-map">
      <Recenter place={place}/>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={7}/>
      {active && manifest && <TileLayer key={active.time} url={`${manifest.host}${active.path}/256/{z}/{x}/{y}/2/1_1.png`} opacity={0.67} zIndex={400} maxZoom={7} attribution='<a href="https://www.rainviewer.com/">Weather data by RainViewer</a>'/>}
      <CircleMarker center={[place.latitude,place.longitude]} radius={7} pathOptions={{color:'#f3c991',fillColor:'#f3c991',fillOpacity:1,weight:2}}><Popup>{place.name}</Popup></CircleMarker>
    </MapContainer><div className="map-location"><MapPin size={13}/>{place.name}</div></div>
    <div className="radar-controls"><div className="radar-source"><CloudRain size={15}/><span>{active ? `${active.forecast?'Nowcast estimate':'Observed radar'} · ${new Date(active.time*1000).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}` : 'Radar frame unavailable'}</span></div><div className="radar-timeline"><button aria-label={playing?'Pause radar':'Play radar animation'} onClick={() => setPlaying(value=>!value)} disabled={!frames.length}>{playing?<Pause size={15}/>:<Play size={15}/>}</button><input aria-label="Radar frame time" type="range" min={0} max={Math.max(0,frames.length-1)} value={Math.max(0,frameIndex)} onChange={e=>{setPlaying(false);setFrameIndex(Number(e.target.value))}} disabled={!frames.length}/><span>{frames.length ? `${Math.min(24,frames.filter(f=>!f.forecast).length)} observed · ${frames.filter(f=>f.forecast).length} forecast frames` : 'No recent frames'}</span></div></div>
    <p className="map-disclaimer">Radar by <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a> · Map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>. Past frames show radar observations; future frames are a short-range estimate, not an official warning.{error && <span className="map-error"> {error}</span>}</p>
  </section>;
}
