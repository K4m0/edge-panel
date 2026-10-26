# Edge Panel

A lightweight, touch-first dashboard for the **Corsair XENEON EDGE** 14.5" touchscreen that runs **without iCUE**.

![Edge Panel running on a XENEON EDGE](docs/screenshot.png)

## Why

With iCUE, the Edge sometimes loses its widgets when the main monitor is turned off and never gets them back. Edge Panel fixes that and keeps the Edge as a dedicated touch panel instead of an extra desktop:

- **Finds the Edge by its EDID name** (`XENEON EDGE`), not by display index, and re-pins itself whenever the display topology changes, such as when the main monitor turns off or on, or after sleep or resolution changes.
- **Keeps the physical mouse out of the Edge.** A low-level mouse hook blocks mouse movement and clicks inside the Edge's area. Touch and pen input still work, because Windows tags them with the `MI_WP_SIGNATURE` marker. After you touch the Edge, the next real mouse movement sends the cursor back to where it was.
- **Keeps other windows off the Edge.** Any app window that lands there (Win+Shift+Arrow, an app restoring its last position) is moved back to the main display.
- **Does not steal focus.** Touching the panel leaves your game or app in the foreground (`WS_EX_NOACTIVATE`).
- **If the Edge is the only display left,** the mouse guard switches off so you are never locked out.

## Widgets (prototype)

- Clock and date
- CPU, GPU and RAM load gauges with temperatures (via [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor))
- Now playing (title and artist) with previous, play/pause and next. It uses Windows media sessions, so it works with Spotify, browsers and most players.
- Volume down, mute and up
- App/URL launcher buttons, configured in `config.json`

The UI is plain HTML/CSS/JS in `src/EdgePanel/wwwroot`, hosted in WebView2. Edit it like any web page.

## Requirements

- Windows 10 2004+ / Windows 11
- [.NET 10 SDK](https://dotnet.microsoft.com/download) to build it
- WebView2 Runtime (preinstalled on Windows 11)
- **Close iCUE, or disable its Edge dashboard,** so the two don't fight over the screen.
- For touch on the right screen, map the touch digitizer to the Edge once: *Control Panel → Tablet PC Settings → Setup → Touch input*, then tap the Edge when asked.

## Build and run

```bash
dotnet build EdgePanel.sln -c Release
```

```bash
src/EdgePanel/bin/Release/net10.0-windows10.0.19041.0/EdgePanel.exe
```

Edge Panel runs as a tray icon. Right-click the icon to:

- turn the mouse guard on or off
- turn window eviction on or off
- re-detect the Edge
- open the log
- exit

**CPU temperature** only shows when Edge Panel runs as administrator, because that is a LibreHardwareMonitor requirement. Load values, GPU and RAM work without it.

### Start with Windows

Press `Win+R`, type `shell:startup`, and put a shortcut to `EdgePanel.exe` in that folder. If you want CPU temperatures at startup, use Task Scheduler instead, with "Run with highest privileges" and an "At log on" trigger.

## Configuration

`config.json` sits next to the executable and allows comments:

| Key | Default | Description |
| --- | --- | --- |
| `monitor.nameContains` | `XENEON EDGE` | Substring of the monitor's friendly name. Check the log if detection fails. |
| `monitor.fallbackWidth/Height` | `2560` × `720` | Resolution match used when no name matches. Either orientation works. |
| `mouseGuard` | `true` | Block the physical mouse on the Edge. |
| `evictWindows` | `true` | Move other windows off the Edge. |
| `noActivate` | `true` | Don't take focus when the panel is touched. |
| `sensorIntervalMs` | `1000` | Telemetry refresh rate. |
| `devTools` | `false` | Enable WebView2 DevTools (F12) to work on the UI. |
| `shortcuts` | Spotify, Discord, ... | `{ label, icon, target, arguments? }`. `target` is anything Windows can open: an exe, a URL or a URI scheme. Icons: `music`, `chat`, `game`, `calc`, `chart`, `globe`, `app`. |

Logs are written to `%LOCALAPPDATA%\EdgePanel\edge-panel.log`.

## Project layout

```
src/EdgePanel/
  App.xaml.cs              tray icon, single instance
  MainWindow.xaml.cs       panel window, display-change handling, WebView2 bridge
  Display/MonitorLocator   monitor enumeration + EDID friendly names (DisplayConfig API)
  Display/WindowEvictor    keeps other windows off the Edge
  Input/MouseGuard         WH_MOUSE_LL hook, mouse blocked / touch allowed
  Telemetry/               LibreHardwareMonitor sensors, Windows media session
  wwwroot/                 the UI (HTML/CSS/JS)
  config.json
```

### Page ↔ host messages

| Direction | Message |
| --- | --- |
| page → host | `{type:"ready"}`, `{type:"media", action:"toggle"\|"next"\|"prev"}`, `{type:"volume", action:"up"\|"down"\|"mute"}`, `{type:"launch", id}` |
| host → page | `{type:"config", data:{shortcuts}}`, `{type:"sensors", data:{cpuLoad, cpuTemp, gpuLoad, ...}}`, `{type:"media", data:{title, artist, isPlaying}}` |

The page can only launch shortcuts by their index in `config.json`. It never sends paths or commands.

## Known limitations

- This is a prototype, tested on a single XENEON EDGE placed below a 2560×1440 main monitor.
- Windows ignores the mouse guard while an elevated (admin) window has focus, unless Edge Panel also runs elevated.
- Windows can't move elevated app windows from a non-elevated process, so the window evictor skips them.

## Credits

Built with [Claude Code](https://claude.com/claude-code).
