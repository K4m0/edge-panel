# Edge Panel architecture (v0.3)

Edge Panel is a WPF host with two WebView2 pages:

- `wwwroot/index.html`: the **panel**, full screen on the XENEON EDGE
- `wwwroot/settings.html`: the **settings editor**, a normal window on the main display

The host serves `wwwroot` at `https://edge.panel/`. It serves the user media folder (`%LOCALAPPDATA%\EdgePanel\media`) at `https://media.edge.panel/`.

## Layout model

The panel has one or more **pages**, and you swipe between them. Each page is a **4 × 2 grid**. On a 2560×720 Edge, one cell is about 640×360.

| Size | Columns × rows |
| --- | --- |
| `S` | 1 × 1 |
| `W` | 2 × 1 (wide) |
| `M` | 1 × 2 (tall) |
| `L` | 2 × 2 |
| `XL` | 4 × 2 (whole page) |

A widget has a top-left cell (`col` 0–3, `row` 0–1) and a size. Widgets must not overlap and must fit inside the grid. The settings editor enforces this, and the panel skips any widget that does not fit. When the Edge is mounted in portrait, the panel swaps columns and rows, giving a 2 × 4 grid.

## Config (`%LOCALAPPDATA%\EdgePanel\config.json`)

```jsonc
{
  "version": 3,
  "monitor": { "nameContains": "XENEON EDGE", "fallbackWidth": 2560, "fallbackHeight": 720 },
  "mouseGuard": true,
  "evictWindows": true,
  "noActivate": true,
  "sensorIntervalMs": 1000,
  "devTools": false,

  "displayMode": "panel",            // "panel" | "desktop" (desktop = panel hidden, Edge is a normal monitor)
  "hotkeys": {                       // "" = disabled. Format: "Ctrl+Alt+Right", "Win+Shift+F9"...
    "nextPage": "Ctrl+Alt+Right",
    "prevPage": "Ctrl+Alt+Left",
    "toggleMode": "Ctrl+Alt+E"
  },

  "theme": {                         // global look
    "background": "#000000",
    "backgroundImage": "",           // file name inside the media folder, "" = none
    "textColor": "#e8edf3",
    "accentColor": "#2bd4e0",
    "widgetBackground": "#11151b",
    "widgetOpacity": 0.85,           // 0..1
    "radius": 18                     // px corner radius of widgets
  },
  "themePerPage": false,             // when true, page.theme overrides the global theme

  "pages": [
    {
      "id": "p1",
      "name": "Main",
      "theme": null,                 // same shape as "theme", only used when themePerPage
      "widgets": [
        {
          "id": "w1",                // unique across all pages
          "type": "clock",           // see wwwroot/widgets/catalog.js
          "col": 0, "row": 0, "size": "W",
          "settings": { },           // type-specific, defaults come from the catalog
          "style": { "custom": false, "textColor": "", "accentColor": "", "background": "", "opacity": null, "backgroundImage": "" }
        }
      ]
    }
  ]
}
```

On the host, `settings` and `style` are kept as raw JSON (`JsonObject`) so new widget fields need no C# change. The host only reads the fields it needs for host-side actions: `launcher.settings.apps` and `deck.settings.buttons`.

A config without `pages`, such as a v0.2 config with `widgets`/`shortcuts`, migrates to the default pages.

## Widget catalog

`wwwroot/widgets/catalog.js` defines `window.EDGE_CATALOG`, an array of widget definitions:

```js
{
  type: "clock",
  name: "Clock Face",
  icon: "clock",                // key of window.EDGE_ICONS
  category: "Time",
  sizes: ["S", "W", "M", "L"],  // allowed sizes
  defaultSize: "S",
  defaults: { face: "digital", hour12: "auto", seconds: true, timeZone: "", date: "short", customText: "" },
  fields: [                     // settings form schema, rendered by the settings editor
    { key: "face", label: "Face", type: "select", options: [["digital","Digital"], ...] },
    ...
  ]
}
```

Field types the settings editor must support are `text`, `textarea`, `url`, `number` (`min`, `max`, `step`), `toggle`, `select` (`options: [[value, label]]`), `segmented` (same as `select`, shown as buttons), `color`, `sensor` (a single sensor id), `sensors` (a list of `{ sensor, name }`), `apps` (a list of `{ label, target, args }` with Browse), `buttons` (deck buttons), `media` (one media file name, with a picker), `mediaList` (several media file names), and `city` (geocoding search that stores `{ name, lat, lon }`).

## Sensors

The host enumerates **every** LibreHardwareMonitor sensor. A sensor id is LHM's `Identifier`, for example `/amdcpu/0/load/0`. The host also adds stable aliases so defaults work on any PC:

`cpu.load`, `cpu.temp`, `cpu.power`, `cpu.clock`, `gpu.load`, `gpu.temp`, `gpu.hotspot`, `gpu.power`, `gpu.vramUsed`, `gpu.vramTotal`, `ram.load`, `ram.used`, `ram.total`

A sensor value looks like this. `value` is `null` when unavailable, and a CPU temperature of 0 means no admin rights, so it is sent as `null`:

```json
{ "value": 63.0, "name": "GPU Core", "hardware": "AMD Radeon RX 7900 XT", "type": "Load", "unit": "%" }
```

Units by type:

| Type | Unit |
| --- | --- |
| Load, Control, Level | `%` |
| Temperature | `°C` |
| Clock | `MHz` |
| Power | `W` |
| Voltage | `V` |
| Fan | `RPM` |
| Data | `GB` |
| SmallData | `MB` |
| Throughput | `B/s` |
| Frequency | `Hz` |
| Flow | `L/h` |
| other | `""` |

## Messages

Every message is JSON `{ type, ... }`. Pages send with `chrome.webview.postMessage(obj)`, and the host sends with `PostWebMessageAsJson`.

### Host → panel (`index.html`)

| type | payload |
| --- | --- |
| `config` | `data: { pages, theme, themePerPage, mediaBase: "https://media.edge.panel/" }` |
| `sensors` | `data: { [idOrAlias]: SensorValue }`, every `sensorIntervalMs` |
| `media` | `data: { title, artist, album, isPlaying, app, art }`. `art` is a data URL, `null` when there is none, or `undefined` (omitted) when unchanged since the last message |
| `audio` | `data: { volume, muted, device: {id,name}, devices: [{id,name,isDefault}], micVolume, micMuted, mic: {id,name}, mics: [...], sessions: [{pid,name,icon,volume,muted}] }`. Volumes are 0..1, `icon` is a data URL or null. Sent about every second |
| `appIcons` | `data: { "<widgetId>:<index>": dataUrl }`, icons for launcher apps and deck buttons whose action is `launch`. Sent after each `config` |
| `goto` | `index`: show this page |
| `nav` | `dir`: +1 or -1 (from hotkeys) |

### Panel → host

| type | payload | host action |
| --- | --- | --- |
| `ready` | | send `config`, `appIcons`, `media`, `audio`, `sensors` |
| `media` | `action: toggle\|next\|prev` | media session, falling back to media keys |
| `volume` | `action: set` + `value`, `mute`, `setMic` + `value`, `muteMic`, `setApp` + `pid, value`, `muteApp` + `pid`, `setDefault` + `deviceId, flow: render\|capture` | Core Audio |
| `launch` | `widgetId, index` | look up `launcher.settings.apps[index]` in config and ShellExecute it |
| `deck` | `widgetId, index` | look up `deck.settings.buttons[index].action` and run it (see below) |
| `key` | `keys: "Ctrl+Shift+Esc"` or `vk: number, mods: ["ctrl","shift","alt","win"]` | SendInput key press |
| `text` | `text: "hello"` | SendInput unicode typing |
| `pointer` | `dx, dy` (relative move), or `click: left\|right\|middle`, or `down/up: left`, or `scroll: dy` | SendInput mouse (virtual touchpad) |
| `page` | `index` | host remembers the current page, so hotkeys stay in sync |

Deck button actions (`buttons[i].action`) take one of these forms:

- `{kind: "launch", target, args}`
- `{kind: "keys", value: "Ctrl+Shift+M"}`
- `{kind: "media", value: "toggle"|"next"|"prev"|"volup"|"voldown"|"mute"}`
- `{kind: "url", value}`
- `{kind: "text", value}`
- `{kind: "page", value: <index>}`, which the host turns into `goto`

### Host → settings (`settings.html`)

| type | payload |
| --- | --- |
| `state` | `config, startWithWindows, configPath, version, sensorCatalog: [{id, name, hardware, type, unit}]` (aliases first), `mediaBase` |
| `sensors`, `media`, `audio`, `appIcons` | same as for the panel, used by the live preview |
| `saved` | after a successful `save` |
| `picked` | `requestId`, `path` (absolute path, for apps), `media` (file name copied into the media folder, for images and videos), `name` |
| `device` | `data: { supported, brightness: {value,min,max}, contrast: {...}, red: {...}, green: {...}, blue: {...} }` (DDC/CI on the Edge) |
| `error` | `message` |

### Settings → host

| type | payload | host action |
| --- | --- | --- |
| `ready` | | send `state` |
| `save` | `config, startWithWindows` | normalize, save, apply to the panel, update the Run key, re-register hotkeys, reply `saved` |
| `browse` | `requestId, kind: app\|image\|video\|media\|any` | open a file dialog. For `image`/`video`/`media` the file is copied into the media folder (unique name) and returned as `media`; otherwise the path is returned as `path` |
| `previewPage` | `index` | show that page on the Edge while editing |
| `getDevice` | | reply `device` |
| `setDevice` | `key: brightness\|contrast\|red\|green\|blue, value` | DDC/CI set VCP |
| `restoreDevice` | | DDC/CI restore factory color defaults (VCP 0x08) |
| `redetect` | | re-detect the Edge |
| `openConfigFolder` | | open the AppData folder |
| `close` | | close the window |

### Live preview

`settings.html` embeds `index.html?preview=1` in an iframe, rendered at 2560×720 and scaled down. The settings page forwards `config` (the unsaved, in-editor version), `sensors`, `media`, `audio` and `appIcons` with `iframe.contentWindow.postMessage({type, data})`, plus `goto`. In preview mode the panel:

- listens to `window` `message` events, in addition to `chrome.webview`
- sends nothing to the host
- does not swipe and hides page dots
- turns off `pointer-events` (the settings page draws its own editing overlay on top)

## Not supported (needs vendor SDKs or OS features unavailable to unpackaged apps)

- **Stream Deck integration**: the Elgato SDK is needed. The **Button Deck** widget (keys, apps, media, URLs, text, page switching) replaces it.
- **FPS counter**: this needs PresentMon/ETW or RTSS. As a workaround, show RTSS/SimHub data through the Web URL widget.
- **Windows notifications**: `UserNotificationListener` requires package identity.
- **Auto rotation**: rotate the Edge in Windows display settings. The panel switches to a portrait layout by itself.
