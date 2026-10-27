const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('atmosphere', Object.freeze({
  readSettings: () => ipcRenderer.invoke('settings:read'),
  writeSettings: (settings) => ipcRenderer.invoke('settings:write', settings),
  systemTheme: () => ipcRenderer.invoke('theme:system'),
  updateStatus: () => ipcRenderer.invoke('updates:status'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('updates:status', listener);
    return () => ipcRenderer.removeListener('updates:status', listener);
  },
  // The widget window listens to this so a preference change in the main
  // window reaches it without the widget having to be reopened.
  onSettingsChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },
  resizeWidget: (scale) => ipcRenderer.invoke('widget:resize', scale),
  startWidgetDrag: () => ipcRenderer.invoke('widget:start-drag'),
  moveWidget: (dx, dy) => ipcRenderer.invoke('widget:move', dx, dy),
  // The widget subscribes to this so it re-fetches when the main window does.
  onWidgetRefresh: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('widget:refresh', listener);
    return () => ipcRenderer.removeListener('widget:refresh', listener);
  },
  refreshWidget: () => ipcRenderer.invoke('widget:refresh'),
  reverseGeocode: (coords, endpoint) => ipcRenderer.invoke('location:reverse', coords, endpoint),
  clearPlaceNameCache: () => ipcRenderer.invoke('location:clear-cache'),
  close: () => ipcRenderer.invoke('window:close'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  restore: () => ipcRenderer.invoke('window:restore'),
  showWidget: () => ipcRenderer.invoke('window:show-widget'),
  openApp: () => ipcRenderer.invoke('window:open-app'),
  notifyForecast: (message) => ipcRenderer.invoke('weather:notify', message),
  updateTaskbarWeather: (weather) => ipcRenderer.invoke('taskbar:update-weather', weather),
  isDesktop: true,
}));
