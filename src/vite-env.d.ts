/// <reference types="vite/client" />
interface Window {
  atmosphere?: {
    updateStatus: () => Promise<{ state: string; message: string; version?: string; percent?: number } | null>;
    checkForUpdates: () => Promise<{ state: string; message: string; version?: string; percent?: number } | null>;
    downloadUpdate: () => Promise<boolean>;
    installUpdate: () => Promise<boolean>;
    onUpdateStatus: (callback: (status: { state: string; message: string; version?: string; percent?: number }) => void) => () => void;
    onSettingsChanged: (callback: (settings: Record<string, unknown>) => void) => () => void;
    resizeWidget: (scale: number) => Promise<boolean>;
    startWidgetDrag: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
    moveWidget: (dx: number, dy: number) => Promise<boolean>;
    onWidgetRefresh: (callback: () => void) => () => void;
    refreshWidget: () => Promise<boolean>;
    reverseGeocode: (coords: { latitude: number; longitude: number }, endpoint?: string) => Promise<{ name: string; admin1?: string; country: string } | null>;
    clearPlaceNameCache: () => Promise<boolean>;
    readSettings: () => Promise<Record<string, unknown>>;
    writeSettings: (settings: Record<string, unknown>) => Promise<boolean>;
    systemTheme: () => Promise<'dark' | 'light'>;
    close: () => Promise<void>;
    toggleMaximize: () => Promise<boolean>;
    restore: () => Promise<boolean>;
    showWidget: () => Promise<boolean>;
    openApp: () => Promise<boolean>;
    notifyForecast: (message: { title: string; body: string }) => Promise<boolean>;
    updateTaskbarWeather: (weather: { temperature: number; unit: 'C'|'F'; placeName: string } | null) => Promise<boolean>;
    isDesktop: boolean;
  };
}
