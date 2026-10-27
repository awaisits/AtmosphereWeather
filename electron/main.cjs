const { app, BrowserWindow, ipcMain, nativeTheme, shell, session, Notification, Tray, Menu, nativeImage, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { lookup } = require('node:dns/promises');
const { isIP, BlockList } = require('node:net');
const { autoUpdater } = require('electron-updater');

app.setAppUserModelId('com.atmosphere.weather');
let win;
let widgetWin;
let tray;
let backgroundMode = false;
let isQuitting = false;
let latestTaskbarWeather = null;
let lastReverseLookup = 0;
const reverseCache = new Map();
const privateIPv4Networks = new BlockList();
const privateIPv6Networks = new BlockList();
for (const [network, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) privateIPv4Networks.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],['::ffff:0:0',96],['64:ff9b::',96],['100::',64],['2001:db8::',32]]) privateIPv6Networks.addSubnet(network, prefix, 'ipv6');
let updateStatus = { state: 'idle', message: 'Update status has not been checked.', version: '', percent: 0 };
let updateCheckPromise = null;
let updateDownloadPromise = null;
const setUpdateStatus = (status) => {
  updateStatus = { ...updateStatus, ...status };
  if (win && !win.isDestroyed()) win.webContents.send('updates:status', updateStatus);
};
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;
autoUpdater.on('checking-for-update', () => setUpdateStatus({ state: 'checking', message: 'Checking for updates…', percent: 0 }));
autoUpdater.on('update-available', info => setUpdateStatus({ state: 'available', version: info.version, message: `Version ${info.version} is available.`, percent: 0 }));
autoUpdater.on('update-not-available', () => setUpdateStatus({ state: 'current', message: 'You are using the latest version.', percent: 0 }));
autoUpdater.on('download-progress', progress => setUpdateStatus({ state: 'downloading', message: `Downloading update · ${Math.round(progress.percent)}%`, percent: progress.percent }));
autoUpdater.on('update-downloaded', info => setUpdateStatus({ state: 'ready', version: info.version, message: `Version ${info.version} is ready to install.`, percent: 100 }));
autoUpdater.on('error', error => setUpdateStatus({ state: 'error', message: `Update check failed: ${String(error.message || 'Unknown error').slice(0, 160)}`, percent: 0 }));
async function checkForUpdates() {
  if (!app.isPackaged || !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
    setUpdateStatus({ state: 'unconfigured', message: 'Updates are not configured for this build.' });
    return updateStatus;
  }
  if (updateCheckPromise) return updateCheckPromise;
  if (updateStatus.state === 'downloading' || updateStatus.state === 'ready') return updateStatus;
  updateCheckPromise = (async () => {
    try { await autoUpdater.checkForUpdates(); }
    catch (error) { setUpdateStatus({ state: 'error', message: `Update check failed: ${String(error.message || 'Unknown error').slice(0, 160)}` }); }
    finally { updateCheckPromise = null; }
    return updateStatus;
  })();
  return updateCheckPromise;
}
async function downloadUpdate() {
  if (updateDownloadPromise) return updateDownloadPromise;
  if (updateStatus.state !== 'available') return false;
  setUpdateStatus({ state: 'downloading', message: 'Downloading update…', percent: 0 });
  updateDownloadPromise = (async () => {
    try { await autoUpdater.downloadUpdate(); return true; }
    catch (error) { setUpdateStatus({ state: 'error', message: `Download failed: ${String(error.message || 'Unknown error').slice(0, 160)}`, percent: 0 }); return false; }
    finally { updateDownloadPromise = null; }
  })();
  return updateDownloadPromise;
}
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const geocodeCachePath = () => path.join(app.getPath('userData'), 'place-name-cache.json');
protocol.registerSchemesAsPrivileged([{scheme:'atmosphere',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
function isTrustedAppUrl(value) {
  try {
    const parsed = new URL(value);
    if (app.isPackaged) return parsed.protocol === 'atmosphere:' && parsed.hostname === 'app' && parsed.pathname === '/index.html' && ['', '?widget=1'].includes(parsed.search);
    return parsed.origin === 'http://127.0.0.1:5173' && parsed.pathname === '/';
  } catch { return false; }
}
function isTrustedMainFrame(event) {
  const owner = [win,widgetWin].find(candidate => candidate && !candidate.isDestroyed() && candidate.webContents === event.sender);
  return Boolean(owner && event.senderFrame === owner.webContents.mainFrame && isTrustedAppUrl(event.senderFrame.url));
}
function isValidPlace(value) {
  let validTimezone = false;
  if (value && typeof value.timezone === 'string' && value.timezone.length <= 100) {
    if (value.timezone === 'auto') validTimezone = true;
    else try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }); validTimezone = true; } catch {}
  }
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.id === 'string' && value.id.length <= 120 && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 120 &&
    typeof value.country === 'string' && value.country.length <= 120 && (value.admin1 === undefined || typeof value.admin1 === 'string' && value.admin1.length <= 120) &&
    Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180 &&
    validTimezone);
}
function sanitizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowedCategories = ['thunderstorm','heavy-rain','high-wind','heat','cold'];
  return {
    unit: value.unit === 'F' ? 'F' : 'C', wind: value.wind === 'mph' ? 'mph' : 'km/h',
    theme: ['system','light','dark'].includes(value.theme) ? value.theme : 'system',
    locale: ['system','en-US','en-GB','ur-PK'].includes(value.locale) ? value.locale : 'system',
    geocoderEndpoint: typeof value.geocoderEndpoint === 'string' && value.geocoderEndpoint.length <= 300 && /^https:\/\//i.test(value.geocoderEndpoint) ? value.geocoderEndpoint : 'https://nominatim.openstreetmap.org/reverse',
    animate: value.animate !== false, reducedMotion: value.reducedMotion === true,
    transparentPanels: value.transparentPanels === true,
    refresh: [0,10,15,30,60].includes(Number(value.refresh)) ? Number(value.refresh) : 30,
    saved: Array.isArray(value.saved) ? value.saved.filter(isValidPlace).slice(0,60) : [],
    active: isValidPlace(value.active) ? value.active : undefined,
    locationStatus: typeof value.locationStatus === 'string' ? value.locationStatus.slice(0,200) : 'Location access has not been requested',
    alerts: value.alerts === true,
    alertCategories: Array.isArray(value.alertCategories) ? value.alertCategories.filter(x => allowedCategories.includes(x)).slice(0,allowedCategories.length) : ['thunderstorm','heavy-rain','high-wind'],
    alertNotified: Array.isArray(value.alertNotified) ? value.alertNotified.filter(x => typeof x === 'string' && x.length <= 240).slice(-500) : [],
    officialAlertNotifications: value.officialAlertNotifications === true,
    officialAlertMinimumSeverity: ['extreme','severe','moderate','minor'].includes(value.officialAlertMinimumSeverity) ? value.officialAlertMinimumSeverity : 'moderate',
    officialAlertNotified: Array.isArray(value.officialAlertNotified) ? value.officialAlertNotified.filter(x => typeof x === 'string' && x.length <= 180).slice(-300) : [],
    layout: value.layout === 'compact' ? 'compact' : 'detailed', backgroundMode: value.backgroundMode === true,
    dailyReminder: typeof value.dailyReminder === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.dailyReminder) ? value.dailyReminder : '',
    defaultPlaceId: typeof value.defaultPlaceId === 'string' && value.defaultPlaceId.length <= 120 ? value.defaultPlaceId : '',
    quietHoursStart: typeof value.quietHoursStart === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.quietHoursStart) ? value.quietHoursStart : '',
    quietHoursEnd: typeof value.quietHoursEnd === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.quietHoursEnd) ? value.quietHoursEnd : '',
    highContrast: value.highContrast === true,
    pureBackground: value.pureBackground === true,
    widgetOpacity: [25,50,75,100].includes(Number(value.widgetOpacity)) ? Number(value.widgetOpacity) : 100,
    widgetScale: [75,100,125,150].includes(Number(value.widgetScale)) ? Number(value.widgetScale) : 100,
  };
}
function writeJsonAtomically(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } finally { try { fs.rmSync(temporaryPath, { force: true }); } catch {} }
}
function isPrivateAddress(address, family) {
  try { return family === 6 ? privateIPv6Networks.check(address, 'ipv6') : privateIPv4Networks.check(address, 'ipv4'); } catch { return true; }
}
function loadGeocodeCache() {
  try {
    if (fs.statSync(geocodeCachePath()).size > 250_000) return;
    const entries = JSON.parse(fs.readFileSync(geocodeCachePath(), 'utf8'));
    if (Array.isArray(entries)) for (const [key, value] of entries.slice(-100)) if (typeof key === 'string' && value && typeof value.name === 'string' && value.name.length <= 120 && typeof value.country === 'string' && value.country.length <= 120 && (value.admin1 === undefined || typeof value.admin1 === 'string' && value.admin1.length <= 120)) reverseCache.set(key, value);
  } catch {}
}
function readSettings() {
  try {
    if (fs.statSync(settingsPath()).size > 250_000) return {};
    return sanitizeSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')));
  } catch { return {}; }
}
function trayTooltipText() {
  if (!latestTaskbarWeather) return 'Atmosphere Weather';
  return `${latestTaskbarWeather.placeName} · ${latestTaskbarWeather.display} · Atmosphere Weather`;
}
function updateTaskbarWeather(value) {
  if (!win || win.isDestroyed()) return false;
  if (value === null) latestTaskbarWeather = null;
  else {
    if (!value || typeof value !== 'object' ||
        !Number.isFinite(value.temperature) || value.temperature < -200 || value.temperature > 150 ||
        !['C','F'].includes(value.unit) || typeof value.placeName !== 'string' || !value.placeName.trim() || value.placeName.length > 120) return false;
    const placeName = value.placeName.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!placeName) return false;
    const rounded = Math.round(value.temperature);
    latestTaskbarWeather = { placeName, display: `${rounded}°${value.unit}` };
  }
  // The taskbar button always shows the plain application icon. A live
  // temperature badge used to be drawn as a Windows overlay icon here, but it
  // made the pinned button look cluttered, so the reading is now only exposed
  // through the tray tooltip.
  win.setTitle('Atmosphere Weather');
  if (process.platform === 'win32') {
    win.setThumbnailToolTip(trayTooltipText());
    win.setOverlayIcon(null, '');
    const appIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.ico'));
    if (!appIcon.isEmpty()) win.setIcon(appIcon);
  }
  if (tray && !tray.isDestroyed()) tray.setToolTip(trayTooltipText());
  return true;
}
function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1280, height: 900, minWidth: 900, minHeight: 680,
    title: 'Atmosphere Weather', backgroundColor: '#101923', show: false, skipTaskbar: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false, devTools: !app.isPackaged },
    // Windows uses a frameless window with the custom in-app title bar.
    // macOS keeps the native frame but hides the title bar so the app can
    // draw behind the native traffic lights.
    frame: !isMac,
    titleBarStyle: isMac ? 'hidden' : undefined,
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
  });
  if (process.platform === 'win32') { try { win.setBackgroundMaterial('none'); } catch {} }
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      const allowedHosts = ['open-meteo.com','www.open-meteo.com','openstreetmap.org','www.openstreetmap.org','rainviewer.com','www.rainviewer.com','weather.gov','www.weather.gov','weather.gov.pk'];
      if (target.protocol === 'https:' && !target.username && !target.password && !target.port && allowedHosts.includes(target.hostname)) {
        setImmediate(() => { void shell.openExternal(target.href).catch(() => {}); });
      }
    } catch {}
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedAppUrl(url)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  if (app.isPackaged) win.loadURL('atmosphere://app/index.html');
  else win.loadURL('http://127.0.0.1:5173');
  // Keep the main app button in the Windows taskbar while minimized. Tray mode
  // is only for a window that has been closed/hidden by the user's preference.
  win.on('minimize', () => { if (win && !win.isDestroyed()) win.setSkipTaskbar(false); });
  win.on('close', event => { if (backgroundMode && !isQuitting) { event.preventDefault(); win?.hide(); } });
  win.on('closed', () => { win = null; });
}
function showMainWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
// The widget's base size, before the user's size preference is applied.
const WIDGET_BASE_WIDTH = 330;
const WIDGET_BASE_HEIGHT = 190;
// The window's own limits, from the BrowserWindow options below.
const WIDGET_MIN_WIDTH = 280;
const WIDGET_MIN_HEIGHT = 150;
const WIDGET_MAX_WIDTH = 500;
const WIDGET_MAX_HEIGHT = 340;

// Sends the current preferences to the widget window, so it does not keep a
// stale copy of the theme, the unit or its own appearance settings.
function pushSettingsToWidget(settings) {
  if (!widgetWin || widgetWin.isDestroyed()) return false;
  // The widget may still be loading its page; sending before it is ready
  // would be lost, so wait for it.
  const send = () => {
    if (widgetWin && !widgetWin.isDestroyed()) {
      try { widgetWin.webContents.send('settings:changed', settings); } catch {}
    }
  };
  if (widgetWin.webContents.isLoading()) widgetWin.webContents.once('did-finish-load', send);
  else send();
  return true;
}

// Resizes the widget window to match its size preference. The card fills its
// window exactly, so the window has to change - scaling the paint instead
// left the widget drawn into a corner of a larger window.
function resizeWidget(scale) {
  if (!widgetWin || widgetWin.isDestroyed()) return false;
  const factor = [75, 100, 125, 150].includes(Number(scale)) ? Number(scale) / 100 : 1;
  const width = Math.round(Math.min(Math.max(WIDGET_BASE_WIDTH * factor, WIDGET_MIN_WIDTH), WIDGET_MAX_WIDTH));
  const height = Math.round(Math.min(Math.max(WIDGET_BASE_HEIGHT * factor, WIDGET_MIN_HEIGHT), WIDGET_MAX_HEIGHT));
  widgetWin.setSize(width, height);
  return true;
}

// Tells the widget to reload the forecast. The widget fetches its own data,
// so the main window cannot hand it a reading directly - it can only say
// "the weather moved on, fetch again".
function refreshWidget() {
  if (!widgetWin || widgetWin.isDestroyed()) return false;
  const send = () => {
    if (widgetWin && !widgetWin.isDestroyed()) {
      try { widgetWin.webContents.send('widget:refresh'); } catch {}
    }
  };
  if (widgetWin.webContents.isLoading()) widgetWin.webContents.once('did-finish-load', send);
  else send();
  return true;
}
function openWidget() {
  if (widgetWin && !widgetWin.isDestroyed()) { widgetWin.show(); widgetWin.focus(); return; }
  widgetWin = new BrowserWindow({ width: WIDGET_BASE_WIDTH, height: WIDGET_BASE_HEIGHT, minWidth: WIDGET_MIN_WIDTH, minHeight: WIDGET_MIN_HEIGHT, maxWidth: WIDGET_MAX_WIDTH, maxHeight: WIDGET_MAX_HEIGHT, title: 'Weather widget', frame: false, transparent: true, resizable: false, alwaysOnTop: false, skipTaskbar: true, backgroundColor: '#00000000', icon: path.join(__dirname, '..', 'assets', 'icon.png'), webPreferences: { preload: path.join(__dirname,'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: !app.isPackaged } });
  widgetWin.webContents.setWindowOpenHandler(({url})=>{
    try { const target=new URL(url); const allowedHosts=['open-meteo.com','www.open-meteo.com','openstreetmap.org','www.openstreetmap.org','rainviewer.com','www.rainviewer.com','weather.gov','www.weather.gov','weather.gov.pk']; if(target.protocol==='https:'&&!target.username&&!target.password&&!target.port&&allowedHosts.includes(target.hostname)) setImmediate(()=>{void shell.openExternal(target.href).catch(()=>{});}); } catch {}
    return {action:'deny'};
  });
  widgetWin.webContents.on('will-navigate',(event,url)=>{if(!isTrustedAppUrl(url))event.preventDefault();});
  widgetWin.webContents.on('will-attach-webview',event=>event.preventDefault());
  if (app.isPackaged) widgetWin.loadURL('atmosphere://app/index.html?widget=1'); else widgetWin.loadURL('http://127.0.0.1:5173/?widget=1');
  widgetWin.on('closed',()=>{widgetWin=null;});
}
function enableTray() {
  if (tray) return;
  const iconPath = path.join(__dirname,'..','assets','icon.ico');
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('Atmosphere Weather');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Open Atmosphere Weather',click:showMainWindow},
    {label:'Show desktop widget',click:openWidget},
    {type:'separator'},
    {label:'Quit',click:()=>{isQuitting=true;app.quit();}},
  ]));
  tray.on('click',showMainWindow);
}
app.whenReady().then(() => {
  // Remove the default application menu (File / Edit / View / Window / Help).
  // The app provides its own title bar and in-app navigation instead.
  Menu.setApplicationMenu(null);
  const distRoot=path.resolve(__dirname,'..','dist');
  const mimeTypes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.json':'application/json; charset=utf-8'};
  protocol.handle('atmosphere',request=>{
    try {
      const url=new URL(request.url);
      if(url.hostname!=='app'||!['GET','HEAD'].includes(request.method))return new Response('Not found',{status:404});
      const relative=decodeURIComponent(url.pathname.replace(/^\/+/,''))||'index.html';
      const target=path.resolve(distRoot,relative);
      if(target!==distRoot&&!target.startsWith(`${distRoot}${path.sep}`))return new Response('Not found',{status:404});
      const contents=fs.readFileSync(target);
      return new Response(request.method==='HEAD'?null:contents,{status:200,headers:{'Content-Type':mimeTypes[path.extname(target).toLowerCase()]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':path.basename(target)==='index.html'?'no-cache':'public, max-age=31536000, immutable'}});
    } catch { return new Response('Not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff'}}); }
  });
  const isAllowedLocationRequest = (webContents, permission, requestingUrl, isMainFrame = false) =>
    permission === 'geolocation' && isMainFrame && webContents === win?.webContents && isTrustedAppUrl(requestingUrl);
  const fromMainWindow = event => isTrustedMainFrame(event);
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _requestingOrigin, details) =>
    isAllowedLocationRequest(webContents, permission, details?.requestingUrl || webContents?.getURL(), details?.isMainFrame === true));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isAllowedLocationRequest(webContents, permission, details?.requestingUrl || webContents?.getURL(), details?.isMainFrame === true));
  });
  ipcMain.handle('settings:read', (event) => fromMainWindow(event) ? readSettings() : {});
  ipcMain.handle('taskbar:update-weather', (event, weather) => fromMainWindow(event) && event.sender === win?.webContents ? updateTaskbarWeather(weather) : false);
  ipcMain.handle('settings:write', (event, settings) => {
    if (!fromMainWindow(event)) return false;
    try {
      const safeSettings = sanitizeSettings(settings);
      if (JSON.stringify(safeSettings).length > 100_000) return false;
      writeJsonAtomically(settingsPath(), safeSettings);
      backgroundMode = safeSettings.backgroundMode;
      if (backgroundMode) { enableTray(); if (tray) tray.setToolTip(trayTooltipText()); }
      else if (tray) { tray.destroy(); tray=null; }
      // The widget keeps its own copy of the preferences, and it used to keep
      // the copy it had when it was opened. Push the new ones so a change to
      // the theme, the unit or the widget's own appearance takes effect at
      // once, without the widget having to be closed and reopened.
      pushSettingsToWidget(safeSettings);
      return true;
    } catch { return false; }
  });
  // The widget asks the main process to resize its window, because only the
  // main process can resize a window.
  ipcMain.handle('widget:resize', (event, scale) => {
    if (!fromMainWindow(event) || event.sender !== widgetWin?.webContents) return false;
    return resizeWidget(scale);
  });
  // The main window asks the widget to re-fetch after a refresh, so the two
  // windows never show readings from different moments.
  ipcMain.handle('widget:refresh', (event) => {
    if (!fromMainWindow(event)) return false;
    return refreshWidget();
  });
  let widgetDragStartBounds = null;
  ipcMain.handle('widget:start-drag', (event) => {
    if (!fromMainWindow(event) || event.sender !== widgetWin?.webContents || !widgetWin || widgetWin.isDestroyed()) return null;
    widgetDragStartBounds = widgetWin.getBounds();
    return widgetDragStartBounds;
  });
  ipcMain.handle('widget:move', (event, dx, dy) => {
    if (!fromMainWindow(event) || event.sender !== widgetWin?.webContents || !widgetWin || widgetWin.isDestroyed() || !widgetDragStartBounds) return false;
    if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    widgetWin.setBounds({
      x: Math.round(widgetDragStartBounds.x + dx),
      y: Math.round(widgetDragStartBounds.y + dy),
      width: widgetDragStartBounds.width,
      height: widgetDragStartBounds.height,
    });
    return true;
  });
  ipcMain.handle('theme:system', (event) => fromMainWindow(event) && nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  ipcMain.handle('updates:status', event => fromMainWindow(event) ? updateStatus : null);
  ipcMain.handle('updates:check', event => {
    if (!fromMainWindow(event)) return null;
    return checkForUpdates();
  });
  ipcMain.handle('updates:download', event => {
    if (!fromMainWindow(event) || updateStatus.state !== 'available') return false;
    return downloadUpdate();
  });
  ipcMain.handle('updates:install', event => {
    if (!fromMainWindow(event) || updateStatus.state !== 'ready') return false;
    setImmediate(() => autoUpdater.quitAndInstall()); return true;
  });
  loadGeocodeCache();
  ipcMain.handle('location:reverse', async (event, coords, endpoint = 'https://nominatim.openstreetmap.org/reverse') => {
    if (!fromMainWindow(event) || !coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude) || Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180) return null;
    try {
      if (typeof endpoint !== 'string' || endpoint.length > 300) return null;
      const target = new URL(endpoint);
      if (target.protocol !== 'https:' || target.username || target.password || target.hash || target.port && target.port !== '443' || isIP(target.hostname) || /(^|\.)(localhost|local|internal|home|test|invalid)$/.test(target.hostname)) return null;
      const resolvedHosts = await lookup(target.hostname, { all: true, verbatim: true });
      if (!resolvedHosts.length || resolvedHosts.some(record => isPrivateAddress(record.address, record.family))) return null;
      const cacheKey = `${target.origin}${target.pathname}${target.search}:${coords.latitude.toFixed(3)},${coords.longitude.toFixed(3)}`;
      if (reverseCache.has(cacheKey)) return reverseCache.get(cacheKey);
      const wait = Math.max(0, 1100 - (Date.now() - lastReverseLookup));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      lastReverseLookup = Date.now();
      target.searchParams.set('format', 'jsonv2'); target.searchParams.set('lat', String(coords.latitude)); target.searchParams.set('lon', String(coords.longitude)); target.searchParams.set('latitude', String(coords.latitude)); target.searchParams.set('longitude', String(coords.longitude)); target.searchParams.set('zoom', '10'); target.searchParams.set('addressdetails', '1');
      const response = await fetch(target, { redirect: 'error', headers: { 'User-Agent': 'AtmosphereWeather/1.0 (Windows weather desktop app)', Accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
      if (!response.ok) return null;
      const payload = await response.text();
      if (payload.length > 100_000) return null;
      const result = JSON.parse(payload);
      const address = result?.address;
      const boundedText = (value) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) : '';
      if (result && typeof result.name === 'string' && typeof result.country === 'string') {
        const custom = { name: boundedText(result.name), admin1: boundedText(result.admin1), country: boundedText(result.country) };
        if (!custom.name || !custom.country) return null;
        if (reverseCache.size >= 100) reverseCache.delete(reverseCache.keys().next().value);
        reverseCache.set(cacheKey, custom); writeJsonAtomically(geocodeCachePath(), [...reverseCache.entries()].slice(-100)); return custom;
      }
      if (!address || typeof address !== 'object') return null;
      const name = address.city || address.town || address.village || address.municipality || address.hamlet || address.suburb || address.county;
      if (!name) return null;
      const resolved = { name: boundedText(String(name)), admin1: boundedText([address.state, address.region].find(x => x && x !== name) || ''), country: boundedText(String(address.country || '')) };
      if (!resolved.name || !resolved.country) return null;
      if (reverseCache.size >= 100) reverseCache.delete(reverseCache.keys().next().value);
      reverseCache.set(cacheKey, resolved);
      writeJsonAtomically(geocodeCachePath(), [...reverseCache.entries()].slice(-100));
      return resolved;
    } catch { return null; }
  });
  ipcMain.handle('location:clear-cache', event => {
    if (!fromMainWindow(event)) return false;
    reverseCache.clear(); try { fs.rmSync(geocodeCachePath(), { force: true }); } catch { return false; }
    return true;
  });
  // Only the weather widget still closes itself from the renderer. The main
  // window has no in-app window buttons any more - it is closed with
  // Alt+F4 or from the taskbar's jump list.
  ipcMain.handle('window:close', (event) => fromMainWindow(event) && (event.sender === widgetWin?.webContents ? widgetWin?.close() : win?.close()));
  // The main window's maximize button is gone too, so the title bar handles
  // the standard double-click gesture. This is what every other frameless
  // Windows app does, and it keeps the capability the button used to offer.
  ipcMain.handle('window:toggle-maximize', (event) => {
    if (!fromMainWindow(event) || !win || win.isDestroyed()) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return true;
  });
  // Win+Down always restores rather than toggling, matching Windows.
  ipcMain.handle('window:restore', (event) => {
    if (!fromMainWindow(event) || !win || win.isDestroyed()) return false;
    if (win.isMinimized()) win.restore();
    else if (win.isMaximized()) win.unmaximize();
    return true;
  });
  ipcMain.handle('window:show-widget', event => { if (!fromMainWindow(event)) return false; openWidget(); return true; });
  ipcMain.handle('window:open-app', event => { if (!fromMainWindow(event)) return false; showMainWindow(); return true; });
  ipcMain.handle('weather:notify', (event, message) => {
    if (!fromMainWindow(event) || !message || typeof message.title !== 'string' || typeof message.body !== 'string') return false;
    if (!Notification.isSupported()) return false;
    new Notification({ title: message.title.slice(0, 80), body: message.body.slice(0, 200) }).show();
    return true;
  });
  backgroundMode = readSettings().backgroundMode === true;
  createWindow();
  if (backgroundMode) enableTray();
  if (app.isPackaged) setTimeout(() => { void checkForUpdates(); }, 15000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit',()=>{isQuitting=true;});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !backgroundMode && !tray) app.quit(); });
