# Atmosphere Weather

A Windows desktop weather app built with Electron, React, and TypeScript. Forecasts use the public Open‑Meteo weather, geocoding, and air quality APIs; no API key is required. The interface requests device location only after the user presses the location button. City search works as a location-permission fallback.

## Recent improvements (v1.0.49)

### A cleaner title bar
- **The minimize, maximize and close buttons are gone from the title bar.** They sat immediately to the right of the city search box, competing with the app's own controls and cluttering the one strip of the window that was otherwise just a place name and a search field
- On Windows the window is frameless, so the title bar was the *only* in-app route to those actions. They are now reachable in the ways the operating system already provides: **Alt+F4** closes the app, the **taskbar button and its jump list** minimize and restore it, and the title bar's own **double-click** toggles maximize — the same gesture every other frameless Windows app uses
- The keyboard works too: **Win+↑** maximizes and **Win+↓** restores. A frameless window does not get these for free, so they are bound explicitly
- The macOS build is unchanged: it keeps the native frame and the system's own traffic lights
- The weather widget's own close button is unaffected — that is a separate small always-on-top window, not the main app

Verified by driving the running app. The window buttons are confirmed absent from the DOM and the last control in the title bar now sits 12px from the right edge with no hole left behind. A double-click on the title bar maximizes and restores the window, a double-click on the search box does not, Win+↑ and Win+↓ toggle correctly, and Alt+F4 — sent as a real keystroke through the operating system, since it is a window message rather than a DOM event — closes the app outright.

### Optional transparent panels

### Optional transparent panels
- **The live scene is now visible behind the whole app.** Every piece of content sat in its own opaque tile, so the animated weather could only be seen in the gaps between panels. A new **Transparent panels** switch in Settings → Appearance lifts the tiles so the live background shows through them
- The panels keep their borders, rounded corners and blur, so they still read as panels — they are made of glass rather than painted card. The sidebar and title bar are transparent too, so the sky runs edge to edge
- A soft scrim sits between the sky and the text, so readings stay readable over a bright clear-day sky
- The setting is off by default, so the existing look is unchanged until it is switched on
- The text colours were re-tuned for the transparent theme, because they had been chosen against a panel of a known lightness and the panel's lightness is now whatever the weather happens to be. The system blue is unreadable on a dark panel, and the green status badge is unreadable on a light one, so each has its own value in this theme
- The small "Current" badge gets a solid backing chip in the transparent theme, so its colour always has something to sit on
- Overlays — the settings sheet, other modals, dropdowns and the map popup — deliberately keep their solid fill. They float above the scene and need to be readable on their own terms
- The setting is persisted through the main process's settings allowlist, so it survives a restart

Verified by driving the running app with Playwright. With the setting on, the sky's brightness profile shows through a panel (correlation with the bare sky rises from 0.10 to 0.57 in dark theme and 0.38 to 0.60 in light theme), switching the scene from day to night changes 98% of the pixels *inside* the panel against 3% with the setting off, the worst contrast ratio among the hero's text elements is 4.65:1, and the canvas is still animating behind the content. Turning the setting on and off again across a restart was confirmed to persist, and the setting-off appearance was confirmed pixel-identical to before the change.

The packaged build was checked too. Its `EnableNodeCliInspectArguments` fuse stops Playwright's Electron support from attaching, so it is driven over the DevTools protocol instead — which also confirms the fuse is doing its job. `npm run verify:panels`, `verify:persistence`, `verify:off-unchanged` and `verify:packaged` each run one of these checks.

Every harness now runs against its own scratch `--user-data-dir`, so a verification run can no longer change the real settings — toggling a switch in a test no longer leaves it changed in the app, and a test city no longer ends up in the saved places list.

## Recent improvements (v1.0.48)

### The animated scene was never actually showing the weather
- **The background canvas was painted behind the app's own background.** The canvas is a child of `.app`, and a child with `z-index: -1` is painted behind its parent's background whenever that background is opaque. The scene was therefore invisible in every condition, and the app looked like a static dark card. The scene colour now lives on a separate backdrop layer beneath the canvas, so the animation is actually on screen
- **The solar clock was being fed the wrong kind of timestamp.** The render loop passed the `requestAnimationFrame` timestamp — milliseconds since the page loaded — into the sunrise/sunset and moon-phase calculations, which compare against real epoch timestamps. A small timestamp is always "before sunrise", so every scene rendered as night, the sun never appeared, and the moon was pinned to the corner. The loop now keeps two clocks: a wall clock for the solar and lunar maths and an animation clock for drift and twinkle
- **A thunderstorm was drawn as a bright blue sky.** A thunderstorm code is also a rain code, and the rain branch was tested first, so the storm was shaded with the mild overcast palette. The storm is now checked first
- **Cloud, snow and fog were drawn on a clear blue sky.** A sky that is 85% covered in cloud, or that is dropping snow, is not blue. Cloud cover now drives the overcast palette, and the sun is hidden behind fog or a solid overcast
- **The moon phase was drawn as a full disc with a thin slit.** The phase was cut by erasing an ellipse whose width collapsed to nothing near a full moon. The lit region is now a single closed path between the sunward limb and the terminator, which renders all eight phases correctly
- **A hard horizontal line ran across the sky.** The horizon glow band was a rectangle filled with a vertical gradient, so its top edge showed as a seam. It now fades in as well as out
- **Fog was drawn as solid horizontal bars.** The fog banks were rectangles filled with a horizontal gradient, which still leaves hard top and bottom edges. They are now soft ellipses whose gradient and shape are built in the same space, so the falloff reaches zero exactly at the edge
- **The sun was drawn in the middle of a rain shower.** The sun was only hidden behind fog or a cloud cover above 72%, so a shower at 70% cover still showed a bright glowing disc with lens-flare streaks. Precipitation now hides the sun whatever the cloud cover says
- **The lens-flare streaks read as scratches.** They were flat 1px lines at constant opacity. Each streak is now drawn with a gradient that fades away from the disc, so it reads as light rather than as a mark on the sky

Verified by driving the running app with Playwright: all nine conditions (clear day, cloudy day, rain, heavy rain, showers, storm, snow, fog, clear night) were confirmed to be animating, and each was checked to show the sun only when the sky is genuinely clear. Screenshots are in `shots/`.

## Recent improvements (v1.0.47)

### Corrected the current day
- **Daily forecast dates were off by one west of the UTC meridian.** The daily timestamps returned by Open-Meteo are already in the requested timezone, but the app added the UTC offset a second time before formatting them. For any place behind UTC — the Americas, most of Europe outside the eastern edge, Pakistan — every daily row was labelled with the previous day, and the "Today" row was actually tomorrow
- This also broke the live scene: sunrise and sunset were resolved against a day that had not started yet, so the travelling sun and moon were drawn against the wrong solar day, and the hero's high/low came from the wrong day
- The fix formats the raw Unix timestamps against the forecast timezone directly, matching the approach already used for hourly times. Verified against the live Open-Meteo API for New York, Tokyo and Berlin

### Live weather animation
- **The animation now runs at a single speed.** The canvas was starting two independent render loops, so every element — cloud drift, rain, snow, the sun and moon — moved at double the intended rate. The loop is now guarded so only one chain can be in flight
- **The scene re-renders when the window is resized.** The canvas bitmap kept its original dimensions and was stretched by CSS when the window changed size. It is now rebuilt at the new size
- **Tonight's moon arc follows the real length of the night.** The night arc assumed a fixed 24 hours, which drifts out of place near the solstices. The next day's sunrise is now used to size the arc, so the moon rises and sets in the right part of the sky
- **Rain showers are no longer drawn as snow.** WMO codes 80–82 are rain showers; the scene and the condition icon both treated them as snowfall. Snow is now limited to codes 71–77 and 85–86, and the scene, the icon and the canvas all share one set of weather-code helpers
- **A clear night no longer shows a flat colour.** The night backdrop was supposed to reveal a sky texture that was never wired into the stylesheet, so clear nights fell back to a solid fill. The canvas now paints its own deep-sky gradient and faint star band
- The unused 1.7 MB background image was removed from the build, shaving that much off the installer

## Recent improvements (v1.0.45)

### Motion preference fix
- The in-app **Reduce motion** switch now actually controls the animation. Previously the operating system's `prefers-reduced-motion` flag blocked the scene even after the switch was turned off, so the background could never animate on a machine with Windows "Animation effects" disabled
- A fresh install seeds the switch from the operating system value, but an explicit choice in Settings → Appearance always wins from then on
- A 10-minute refresh option is now accepted by the settings file as well as the UI

## Recent improvements (v1.0.44)

### Real-time animated scene
The background animation is now driven by the actual clock instead of a coarse day/night flag:
- **Solar time**: sunrise and sunset for the *current local day* at the saved place drive a continuous day/night curve with a 38-minute twilight blend, so the sky is genuinely dark at night, warm at dawn and dusk, and bright at midday
- **Traveling sun**: the sun moves along a real arc from sunrise to sunset, and its glow, colour, and shadow follow it
- **Moon phases**: the night moon is carved by the real synodic phase, so a crescent appears at the right time of the month
- **Stars** fade in as the sun sets and fade out at dawn
- **Cloud light follows the sky**: clouds are white at noon, warm at golden hour, and dim blue-grey after dark, then are re-tinted as the light changes
- **Real-time clouds**: cloud count and opacity follow the observed cloud-cover percentage, and the drift speed and direction follow the observed wind
- **Slower, natural drift**: cloud motion was roughly 150× too fast before and is now a calm, realistic crawl
- Temperature still tints the daylight palette warm or cold
- A 10-minute refresh option was added in Settings → General for a more live observation feed

## Recent improvements (v1.0.43)

### Window chrome cleanup
- The macOS traffic lights (close / minimize / maximize) were removed from the title bar
- A compact conventional control group now sits at the far right of the title bar so the frameless window can still be minimized, maximized, and closed
- The default application menu was removed with `Menu.setApplicationMenu(null)`, so the File / Edit / View / Window bar no longer appears on any platform. Navigation lives in the left sidebar and settings live in the sidebar sheet

## Recent improvements (v1.0.42)

### Navigation cleanup
- The settings gear was removed from the top bar. Settings now live only in the left sidebar, next to the other sections
- The sidebar entry highlights while the settings sheet is open so the single access point stays obvious
- The title bar keeps only the refresh and radar toggles; the `S` shortcut still opens settings

## Recent improvements (v1.0.41)

### Icon fixes
- The night condition no longer uses Lucide's moon. That icon is a thin stroked path, and the solid icon treatment (fill plus a 2 px stroke) turned it into a lumpy blob with a detached hook
- Replaced with a dedicated filled crescent component that renders a clean, smooth moon in the hero, hourly strip, daily list, and desktop widget
- The Sunset condition metric now uses the same crescent

## Recent improvements (v1.0.40)

### Taskbar cleanup
- The live temperature badge was removed from the Windows taskbar button. The taskbar icon now always shows the plain application icon
- The "Show current temperature on taskbar" setting was removed along with the overlay icon rendering
- The reading is still available where it is useful: hovering the taskbar button or the notification-area icon shows "Place · 22°C · Atmosphere Weather"

## Recent improvements (v1.0.39)

### App icon
- New macOS-style app icon: a squircle (superellipse) with a blue gradient, a warm sun with rays, and a white cloud, matching the Apple Weather visual language
- Multi-resolution `assets/icon.ico` (16/24/32/48/64/128/256/512) written as DIB entries for maximum Windows shell compatibility, plus a 512×512 `assets/icon.png`
- The icon is applied to the app window, the desktop widget window, the taskbar, and the installer

### Toolbar
- The desktop widget button was removed from the title bar. The widget is still available from the system tray menu ("Show desktop widget") and the widget opacity/size controls remain in Settings

## Recent improvements (v1.0.38)

### macOS-inspired interface
The whole UI was rebuilt on a macOS-style design system that also runs on Windows:
- **Unified title bar** with traffic-light window controls (left) and a centered window title; macOS builds use the native traffic lights over the custom bar
- **Sidebar navigation** (Current, Hourly, 7-day, Rain radar, Conditions, Air quality, Warnings) with smooth scroll-to-section
- **Vibrancy materials**: translucent, backdrop-blurred surfaces with layered shadows
- **Native controls**: macOS switches, segmented pickers, rounded search field, inline icons
- **Design tokens** for color, spacing, radius, elevation, blur, motion curves, and SF-style typography
- **Sidebar sheet settings**: the dialog is now a right-hand sheet grouped into General, Appearance, Desktop widget, Notifications, System, Saved locations, and App status
- **Light/dark** follow the in-app preference and fall back to the system setting

### Previous improvements (v1.0.37)

### UI/UX
- **Settings panel**: slide-in/out animation, scroll-fade mask, focus-visible on all toggles, keyboard shortcut help overlay (? key)
- **Empty state**: quick-start city buttons (London, New York, Tokyo) and recent places list
- **Chart tooltips**: show full timestamp and weather condition
- **Toolbar icons**: solid-filled weather icons (clouds, rain, lightning, snow, fog, sun/moon) and heavier stroke weights for all Lucide icons
- **Micro-interactions**: button press scale (0.98), card hover lift, transition polish
- **Widget controls**: opacity (25/50/75/100%) and size (75/100/125/150%) sliders in Settings
- **Widget edges**: border/radius removed for clean transparent-window look
- **Accessibility**: live-region forecast update announcements, high-contrast/forced-colors support

### Memory & performance
- **WeatherCanvas**: reduced particle counts (60→90 max), smaller cloud sprites (300×150 vs 460×220), fewer clouds (1–4 vs 2–7), DPR cap lowered (1.25 vs 1.5)
- **Intl.DateTimeFormat caching**: `localTime`, `niceDate`, and daily date formatting reuse formatters instead of recreating per call
- **WeatherMap**: radar frames halved (12 past / 6 nowcast), `useMemo`/`useCallback`, pauses animation when tab hidden
- **Taskbar badge**: single reused 32×32 canvas, PNG re-encoded only when value changes
- **Daily stats**: memoized min/max temps to avoid O(n) per-row computation
- **Installer size**: limited Electron locales to en-US/en-GB/ur (~8.5 MB smaller, ~119 MB vs ~128 MB)

### Bug fixes
- Fixed settings scrim "blue half-screen" exposure when toggling notification-area mode (modal-scrim now `position: fixed`)
- Fixed canvas RAF overlap when settings dialog opens

## Capabilities

- Current conditions, feels-like temperature, daily highs/lows, and local sunrise/sunset.
- Scrollable 24-hour forecast with temperature chart and precipitation probability.
- Seven-day forecast with selectable-day details.
- An animated RainViewer radar timeline with recent observations and short-range nowcast frames where the provider returns them. Forecast frames are labeled as estimates, not warnings.
- Humidity, wind, gust, pressure, visibility, cloud cover, precipitation, UV, dew point, and European AQI when returned by the provider.
- City search, saved locations, geolocation, Celsius/Fahrenheit, km/h/mph, system/light/dark appearance, compact/detailed layouts, reduced motion, and configurable refresh.
- A live Windows taskbar temperature badge with a day/night cue; hovering the app button shows the location and exact temperature.
- Daily planning with a heuristic best outdoor window, a three-hour commute outlook, local sunrise/sunset, and pressure trend. Planning suggestions use forecast data and are not safety guarantees.
- Condition-based local scenes, with a demo storm scene that changes the background only.
- Last-successful-response cache, stale-data labeling, offline state, and bounded retries for transient provider/network failures.
- Opt-in Windows notifications for app-generated thunderstorm, heavy-rain, high-wind, heat, and cold forecast signals, plus a configurable daily weather-plan reminder. The optional notification-area mode keeps the app running after its main window is closed so these schedules can run. These are not official government warnings.
- Optional always-on-top desktop weather widget, opened from the app or the notification-area menu.
- User-selected date/time locale formatting, explicit temperature units, high-contrast and forced-colors support, visible keyboard focus, and a keyboard-trapped settings dialog.
- Privacy controls to remove saved places and clear the local forecast cache; location permission is requested only after an explicit user action.
- Configurable generic update feed with manual download/install, automatic update checks for packaged builds, and signed-release preflight.
- Electron context isolation, sandboxed renderer, narrow preload bridge, navigation restrictions, and Content Security Policy.
- Per-user Windows NSIS installer configuration.

Open‑Meteo does not provide official government severe-weather alerts. The app does not fabricate official warnings. Scheduled forecast reminders run while the app is open or kept in the notification area; they do not run after the app is quit or while Windows is asleep. Air quality, pollen, and radar nowcasts may be absent for a location; unavailable values are shown as unavailable rather than zero. Radar tiles are supplied by RainViewer and are available only for personal/educational use; coverage, update cadence, and availability are not guaranteed. A public/commercial distribution must replace or license any provider whose terms do not cover that use.

The no-key [Open‑Meteo Free API](https://open-meteo.com/en/terms) is for non-commercial use and has no service availability guarantee. Commercial distribution requires an appropriate Open‑Meteo customer plan and endpoint or a different licensed provider. The upstream weather data uses CC BY 4.0 attribution; the app links users to Open‑Meteo’s source and forecast documentation. Weather can be stale or unavailable when the upstream service is unreachable. Reverse place names use [OpenStreetMap Nominatim](https://operations.osmfoundation.org/policies/nominatim/); requests are user-triggered, throttled to at most one per second, cached in memory, and attributed in the UI. Review this policy and arrange a suitable service before large-scale distribution.

## Prerequisites

- Windows 10/11 x64 for native packaging (Windows 11 is the target).
- Node.js 20 or later and npm 10 or later.
- Network access to the Open‑Meteo forecast, geocoding, and air-quality endpoints for live data.

## Commands

```powershell
npm install
npm run dev
npm test
npm run build
npm run dist:win
```

The NSIS x64 installer is written to `release/`. `npm run dist:win` is a development packaging command and can produce an unsigned installer. It installs per-user and offers Start menu and desktop shortcuts.

For a signed production release, run on Windows with a trusted code-signing certificate, HTTPS update host, and provider-rights review recorded in the secure build environment:

```powershell
$env:CSC_LINK = 'path-or-secure-url-to-pfx'
$env:CSC_KEY_PASSWORD = 'retrieve-from-secret-store'
$env:ATMOSPHERE_UPDATE_URL = 'https://your-host.example/atmosphere-weather/'
$env:ATMOSPHERE_PROVIDER_RIGHTS_CONFIRMED = '1'
npm run dist:win:release
```

The build fails closed if signing, the update feed, or provider-rights confirmation is missing. Bump the app version in `package.json` for each release. Publish the generated installer and `latest.yml` (plus blockmap files) to the configured generic feed after verifying the signed artifacts. Keep signing credentials out of source control and logs. Windows update packages are Authenticode-verified by `electron-updater`. The repository does not contain a signing certificate or an update hosting account, so it cannot produce or publish a signed release by itself.

The place-name service endpoint can be changed in Settings without a new app build. A compatible endpoint accepts latitude/longitude query parameters and returns either Nominatim JSON or `{ "name": "…", "admin1": "…", "country": "…" }`. The app caches successful lookups locally and spaces requests. For a public release, operate a proxy or choose a provider suitable for your combined user traffic; do not rely on the public Nominatim instance beyond its published policy.

## Memory and performance notes

- **Renderer heap** is the primary optimization target; Chromium/GPU working set is largely fixed. The changes above reduce JS allocations and canvas GPU memory.
- To cap V8 heap, add `--js-flags="--max-old-space-size=128"` to the `BrowserWindow` webPreferences or via `app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128')` in `main.cjs` before `app.whenReady()`.
- The dev server (`npm run dev`) runs without the locale restriction and with a higher DPR; packaged builds apply the smaller locale set and production DPR.

## Storage and privacy

The most recent forecast and preferences are cached locally. Electron stores settings under its per-user application data directory. The cache and active/saved place settings include coordinates so the app can refresh the last selected place. When the user requests location, coordinates are sent to Open‑Meteo for weather and to Nominatim for a readable place name. The app has no application-owned location server. Browser geolocation depends on Windows location services and the user's permission. It does not assume GPS hardware. Use **Clear saved locations and local weather cache** in Settings to remove saved coordinates and cached forecast data. Alert deduplication identifiers are stored locally and cleared by that control.

## Troubleshooting

- **No forecast yet:** Search for a city or press the location button. Check connectivity to Open‑Meteo if updates fail.
- **Location denied/unavailable:** Search manually; permission can be managed in Windows privacy and location settings.
- **Old values shown:** A network error can leave the last cached forecast visible; the amber stale-data label shows when it is not current.
- **Installer build fails:** Ensure dependencies install successfully and run packaging on Windows x64. This project does not claim an installer has been produced until `npm run dist:win` completes.
- **Updates are unavailable:** Update checks are only configured for packaged release builds made with `ATMOSPHERE_UPDATE_URL`; the development installer has no feed.
- **Signed release preflight fails:** Configure `CSC_LINK`, `CSC_KEY_PASSWORD`, and an HTTPS `ATMOSPHERE_UPDATE_URL` in the secure Windows release environment.

## Development checks

The `npm test` suite covers weather-code labels, scene choice, unit conversion, weather parsing, and forecast signal thresholds. Production sign-off should additionally exercise Windows permission behavior, offline recovery, notification delivery, installer upgrade/uninstall, certificate verification, and an update-feed staging deployment on a clean Windows 11 VM.
