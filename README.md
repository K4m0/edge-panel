# Edge Panel

A lightweight, touch-first dashboard for the **Corsair XENEON EDGE** 14.5" touchscreen. It runs **without iCUE** and is built to work like iCUE's widget screen: pages you swipe between, a widget catalog, per-widget settings and personalization.

![Main page](docs/page-main.png)
![Apps page](docs/page-apps.png)
![Tools page](docs/page-tools.png)

## Why

With iCUE, the Edge sometimes loses its widgets when the main monitor is turned off and never gets them back. Edge Panel fixes that and keeps the Edge as a dedicated touch panel:

- **Finds the Edge by its EDID name** (`XENEON EDGE`), not by display index, and re-pins itself whenever the display topology changes.
- **Keeps the physical mouse out of the Edge** (block cursor access). Touch and pen still work, because Windows tags them with `MI_WP_SIGNATURE`.
- **Keeps other windows off the Edge.** App windows that land there move back to the main display.
- **Never steals focus.** Touching the panel, including the virtual keyboard and touchpad, leaves your game or app in the foreground.
- **Desktop mode** turns the Edge back into a normal monitor with one hotkey. If the Edge is the only display left, the mouse guard turns itself off.

## Widgets

Each page is a 4 × 2 grid. Widgets come in sizes **S** (1×1), **Wide** (2×1), **M** (1×2), **L** (2×2) and **XL** (the full page).

| Category | Widgets |
| --- | --- |
| Time | Clock Face (digital, big seconds, analog, flip; 12/24h; time zone), Calendar, Chronograph (stopwatch and timer) |
| System | 2 Sensors, Sensor (gauge or value), Sensor Chart, Sensor List. These can use any sensor LibreHardwareMonitor sees: CPU, GPU, RAM, motherboard, drives, network, fans and AIO coolers |
| Media | Media (album art, playback controls), Volume (output device switcher, mic, per-app volume mixer), Image / Video, Slideshow, YouTube Video |
| Web | Web URL, iFrame (custom HTML), Twitch Chat, SimHub, Weather, AQI (Weather and AQI use [Open-Meteo](https://open-meteo.com), no API key) |
| Control | Launch App (real app icons), Button Deck (keystrokes, apps, media keys, URLs, typed text, page switching), Virtual Keyboard, Virtual Touchpad |
| Fun | Decision Coin |

## Settings

Open the settings window by left-clicking the tray icon, or right-click it and choose **Settings…**. Changes apply to the Edge right away.

![Settings](docs/settings.png)

- **Widgets**: a live preview of the Edge, page tabs (add, rename, duplicate, reorder, delete), a searchable widget catalog, the selected widget's settings, and per-widget personalization (colors, background image, transparency). Drag a widget from the catalog onto an empty cell. Drag widgets around the preview to move them.
- **Pages Personalization**: background color or image, text, accent and widget colors, transparency, and corner radius. You can set these globally or per page.
- **Screen Setup**: display mode (widgets or desktop), hotkeys for switching mode and changing pages (default `Ctrl+Alt+E`, `Ctrl+Alt+Left/Right`), block cursor access, keep windows off the Edge, and re-detect the Edge.
- **Device Settings**: brightness, contrast and RGB gains through DDC/CI, plus restore to default.
- **App Settings**: start with Windows, sensor refresh rate and developer tools.

The tray menu also has quick toggles: block mouse, keep windows off, desktop mode, start with Windows, re-detect, open log and exit.

## Not supported

These iCUE features need a vendor SDK or Windows features that are unavailable to apps like this one:

- **Stream Deck integration** needs the Elgato SDK. Use **Button Deck** instead.
- **FPS counter** needs PresentMon or RTSS.
- **Windows notifications** require package identity.
- **Auto rotation**: rotate the Edge in Windows display settings. The panel switches to a portrait layout by itself.

## Install

Download `EdgePanel.exe` from [Releases](https://github.com/K4m0/edge-panel/releases) and run it. It is a single self-contained file, so .NET doesn't need to be installed. Put it somewhere permanent before you turn on **Start with Windows**, because that setting remembers the exe's location.

Before you start:

- **Close iCUE, or switch its Edge screen to Desktop mode,** so the two don't fight over the display.
- Map touch to the Edge once, so touches land on the right screen: go to *Control Panel → Tablet PC Settings → Setup → Touch input* and tap the Edge.
- Install the WebView2 Runtime if you're on Windows 10. Windows 11 already includes it.
- **CPU temperature** only shows when Edge Panel runs as administrator, because LibreHardwareMonitor requires it. To get CPU temperature at startup, use Task Scheduler: an "At log on" trigger with "Run with highest privileges".

Your settings are stored in `%LOCALAPPDATA%\EdgePanel\config.json`. Images and videos you add are copied to `%LOCALAPPDATA%\EdgePanel\media`. The log is `%LOCALAPPDATA%\EdgePanel\edge-panel.log`.

## Build

You need the [.NET 10 SDK](https://dotnet.microsoft.com/download).

```bash
dotnet build src/EdgePanel/EdgePanel.csproj -c Debug
```

To build the single-file exe into `publish/`:

```bash
dotnet publish src/EdgePanel/EdgePanel.csproj -c Release -o publish
```

## How it works

The app is a WPF host with two WebView2 pages: the panel (`wwwroot/index.html`) and the settings editor (`wwwroot/settings.html`). Widgets are plain JavaScript modules in `wwwroot/widgets/`, and `widgets/catalog.js` defines each widget's sizes, defaults and settings form. To add a widget, add a catalog entry and a module. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes the layout model, the config schema and every message between the host and the pages.

```
src/EdgePanel/
  App.xaml.cs               tray, single instance, settings window
  MainWindow.xaml.cs        panel window, display changes, message routing
  AppConfig.cs              config v3 (pages, theme, hotkeys) + migration
  Audio/                    Core Audio: volume, devices, per-app mixer (NAudio)
  Display/                  monitor detection, window evictor, DDC/CI
  Input/                    mouse guard, hotkeys, SendInput (keys, text, pointer)
  Shell/                    app icon extraction
  Telemetry/                LibreHardwareMonitor sensors, Windows media session
  wwwroot/                  panel, settings editor, widgets
```

## Credits

Built with [Claude Code](https://claude.com/claude-code).
