"use strict";

// Widget definitions shared by the panel (rendering, defaults) and the settings editor (forms).
// See docs/ARCHITECTURE.md for the field types.

const MEDIA_ACTIONS = [["toggle", "Play / pause"], ["next", "Next track"], ["prev", "Previous track"], ["volup", "Volume up"], ["voldown", "Volume down"], ["mute", "Mute"]];

window.EDGE_SIZES = {
  S: { cols: 1, rows: 1, label: "S" },
  W: { cols: 2, rows: 1, label: "Wide" },
  M: { cols: 1, rows: 2, label: "M" },
  L: { cols: 2, rows: 2, label: "L" },
  XL: { cols: 4, rows: 2, label: "XL" },
};

window.EDGE_GRID = { cols: 4, rows: 2 };

window.EDGE_CATALOG = [
  // Time
  {
    type: "clock", name: "Clock Face", icon: "clock", category: "Time",
    sizes: ["S", "W", "M", "L", "XL"], defaultSize: "S",
    defaults: { face: "digital", hour12: "auto", seconds: true, timeZone: "", date: "short", customText: "" },
    fields: [
      { key: "face", label: "Face", type: "select", options: [["digital", "Digital"], ["bigSeconds", "Digital + big seconds"], ["analog", "Analog"], ["flip", "Flip"]] },
      { key: "hour12", label: "Time format", type: "segmented", options: [["auto", "Auto"], ["12", "12h"], ["24", "24h"]] },
      { key: "seconds", label: "Seconds", type: "toggle" },
      { key: "timeZone", label: "Time zone", type: "select", options: "timeZones" },
      { key: "date", label: "Date", type: "select", options: [["none", "None"], ["short", "Short"], ["long", "Long"]] },
      { key: "customText", label: "Custom text", type: "text" },
    ],
  },
  {
    type: "calendar", name: "Calendar", icon: "calendar", category: "Time",
    sizes: ["S", "M", "L"], defaultSize: "S",
    defaults: { firstDay: 1 },
    fields: [{ key: "firstDay", label: "Week starts on", type: "segmented", options: [[1, "Monday"], [0, "Sunday"]] }],
  },
  {
    type: "chronograph", name: "Chronograph", icon: "timer", category: "Time",
    sizes: ["S", "W", "M"], defaultSize: "S",
    defaults: { mode: "stopwatch", timerMinutes: 5 },
    fields: [
      { key: "mode", label: "Mode", type: "segmented", options: [["stopwatch", "Stopwatch"], ["timer", "Timer"]] },
      { key: "timerMinutes", label: "Timer minutes", type: "number", min: 1, max: 600, step: 1 },
    ],
  },

  // System
  {
    type: "sensorPair", name: "2 Sensors", icon: "gauge2", category: "System",
    sizes: ["S", "W"], defaultSize: "S",
    defaults: {
      left: { sensor: "cpu.load", mode: "gauge", name: "CPU Load" },
      right: { sensor: "gpu.load", mode: "gauge", name: "GPU Load" },
    },
    fields: [
      { key: "left.sensor", label: "Left sensor", type: "sensor" },
      { key: "left.mode", label: "Type", type: "segmented", options: [["gauge", "Gauge"], ["value", "Value"]] },
      { key: "left.name", label: "Name", type: "text" },
      { key: "right.sensor", label: "Right sensor", type: "sensor" },
      { key: "right.mode", label: "Type", type: "segmented", options: [["gauge", "Gauge"], ["value", "Value"]] },
      { key: "right.name", label: "Name", type: "text" },
    ],
  },
  {
    type: "gauge", name: "Sensor", icon: "gauge", category: "System",
    sizes: ["S", "M"], defaultSize: "S",
    defaults: { sensor: "cpu.temp", name: "CPU Temp", mode: "gauge", min: 0, max: 100 },
    fields: [
      { key: "sensor", label: "Sensor", type: "sensor" },
      { key: "name", label: "Name", type: "text" },
      { key: "mode", label: "Type", type: "segmented", options: [["gauge", "Gauge"], ["value", "Value"]] },
      { key: "min", label: "Gauge min", type: "number", step: 1 },
      { key: "max", label: "Gauge max", type: "number", step: 1 },
    ],
  },
  {
    type: "sensorChart", name: "Sensor Chart", icon: "chart", category: "System",
    sizes: ["S", "W", "L", "XL"], defaultSize: "W",
    defaults: { sensor: "cpu.load", name: "CPU Load", minutes: 2, color: "" },
    fields: [
      { key: "sensor", label: "Sensor", type: "sensor" },
      { key: "name", label: "Name", type: "text" },
      { key: "minutes", label: "History (minutes)", type: "number", min: 1, max: 30, step: 1 },
      { key: "color", label: "Line color", type: "color" },
    ],
  },
  {
    type: "sensorList", name: "Sensor List", icon: "list", category: "System",
    sizes: ["S", "M", "W", "L"], defaultSize: "M",
    defaults: {
      sensors: [
        { sensor: "cpu.load", name: "CPU Load" },
        { sensor: "cpu.temp", name: "CPU Temp" },
        { sensor: "gpu.load", name: "GPU Load" },
        { sensor: "gpu.temp", name: "GPU Temp" },
        { sensor: "gpu.hotspot", name: "GPU Hotspot" },
        { sensor: "ram.load", name: "Memory Load" },
      ],
    },
    fields: [{ key: "sensors", label: "Sensors", type: "sensors" }],
  },

  // Media & audio
  {
    type: "media", name: "Media", icon: "play", category: "Media",
    sizes: ["S", "W", "M", "L"], defaultSize: "M",
    defaults: { showArt: true, showVolume: true },
    fields: [
      { key: "showArt", label: "Album art", type: "toggle" },
      { key: "showVolume", label: "Volume buttons", type: "toggle" },
    ],
  },
  {
    type: "volume", name: "Volume", icon: "volume", category: "Media",
    sizes: ["S", "M", "L"], defaultSize: "M",
    defaults: { showInput: true, showMixer: true },
    fields: [
      { key: "showInput", label: "Microphone", type: "toggle" },
      { key: "showMixer", label: "Volume mixer", type: "toggle" },
    ],
  },
  {
    type: "image", name: "Image / Video", icon: "image", category: "Media",
    sizes: ["S", "W", "M", "L", "XL"], defaultSize: "S",
    defaults: { source: "file", file: "", url: "", fit: "cover" },
    fields: [
      { key: "source", label: "Source", type: "segmented", options: [["file", "File"], ["url", "URL"]] },
      { key: "file", label: "File", type: "media", accept: "media", showIf: { source: "file" } },
      { key: "url", label: "URL", type: "url", showIf: { source: "url" } },
      { key: "fit", label: "Fit", type: "segmented", options: [["cover", "Fill"], ["contain", "Fit"]] },
    ],
  },
  {
    type: "slideshow", name: "Slideshow", icon: "slides", category: "Media",
    sizes: ["S", "W", "M", "L", "XL"], defaultSize: "W",
    defaults: { files: [], intervalSec: 8, fit: "cover", shuffle: false },
    fields: [
      { key: "files", label: "Images", type: "mediaList", accept: "image" },
      { key: "intervalSec", label: "Seconds per image", type: "number", min: 2, max: 600, step: 1 },
      { key: "fit", label: "Fit", type: "segmented", options: [["cover", "Fill"], ["contain", "Fit"]] },
      { key: "shuffle", label: "Shuffle", type: "toggle" },
    ],
  },
  {
    type: "youtube", name: "YouTube Video", icon: "youtube", category: "Media",
    sizes: ["S", "W", "M", "L", "XL"], defaultSize: "L",
    defaults: { url: "", mute: true, loop: true },
    fields: [
      { key: "url", label: "Video or playlist URL", type: "url" },
      { key: "mute", label: "Start muted", type: "toggle" },
      { key: "loop", label: "Loop", type: "toggle" },
    ],
  },

  // Web
  {
    type: "webUrl", name: "Web URL", icon: "globe", category: "Web",
    sizes: ["S", "W", "M", "L", "XL"], defaultSize: "L",
    defaults: { url: "https://", zoom: 1, refreshMin: 0 },
    fields: [
      { key: "url", label: "URL", type: "url" },
      { key: "zoom", label: "Zoom", type: "number", min: 0.25, max: 3, step: 0.05 },
      { key: "refreshMin", label: "Reload every (min, 0 = never)", type: "number", min: 0, max: 1440, step: 1 },
    ],
  },
  {
    type: "iframe", name: "iFrame", icon: "code", category: "Web",
    sizes: ["S", "W", "M", "L", "XL"], defaultSize: "S",
    defaults: { html: "<div style=\"color:#fff;font:24px sans-serif;display:grid;place-items:center;height:100%\">Hello</div>" },
    fields: [{ key: "html", label: "HTML", type: "textarea" }],
  },
  {
    type: "twitch", name: "Twitch Chat", icon: "twitch", category: "Web",
    sizes: ["M", "L", "XL"], defaultSize: "M",
    defaults: { channel: "", dark: true },
    fields: [
      { key: "channel", label: "Channel name or link", type: "text" },
      { key: "dark", label: "Dark mode", type: "toggle" },
    ],
  },
  {
    type: "simhub", name: "SimHub", icon: "car", category: "Web",
    sizes: ["W", "L", "XL"], defaultSize: "XL",
    defaults: { url: "http://localhost:8888/" },
    fields: [{ key: "url", label: "SimHub dash URL", type: "url" }],
  },
  {
    type: "weather", name: "Weather", icon: "weather", category: "Web",
    sizes: ["S", "W", "L"], defaultSize: "W",
    defaults: { location: null, units: "metric", showAqi: true },
    fields: [
      { key: "location", label: "City", type: "city" },
      { key: "units", label: "Units", type: "segmented", options: [["metric", "°C"], ["imperial", "°F"]] },
      { key: "showAqi", label: "Air quality", type: "toggle" },
    ],
  },
  {
    type: "aqi", name: "AQI", icon: "aqi", category: "Web",
    sizes: ["S"], defaultSize: "S",
    defaults: { location: null, scale: "us" },
    fields: [
      { key: "location", label: "City", type: "city" },
      { key: "scale", label: "Scale", type: "segmented", options: [["us", "US AQI"], ["eu", "European AQI"]] },
    ],
  },

  // Control
  {
    type: "launcher", name: "Launch App", icon: "apps", category: "Control",
    sizes: ["S", "W", "M", "L", "XL"], defaultSize: "M",
    defaults: {
      columns: 0,
      showLabels: false,
      apps: [
        { label: "Spotify", target: "spotify:", args: "" },
        { label: "Discord", target: "discord:", args: "" },
        { label: "Steam", target: "steam://open/main", args: "" },
        { label: "Task Manager", target: "taskmgr.exe", args: "" },
      ],
    },
    fields: [
      { key: "apps", label: "Apps", type: "apps" },
      { key: "columns", label: "Columns (0 = auto)", type: "number", min: 0, max: 8, step: 1 },
      { key: "showLabels", label: "Show labels", type: "toggle" },
    ],
  },
  {
    type: "deck", name: "Button Deck", icon: "deck", category: "Control",
    sizes: ["S", "W", "M", "L", "XL"], defaultSize: "L",
    defaults: {
      columns: 4,
      buttons: [
        { label: "Mute", icon: "volumeMute", color: "#e0457b", action: { kind: "media", value: "mute" } },
        { label: "Vol -", icon: "volumeDown", color: "#f2994a", action: { kind: "media", value: "voldown" } },
        { label: "Vol +", icon: "volume", color: "#2bd4e0", action: { kind: "media", value: "volup" } },
        { label: "Screenshot", icon: "camera", color: "#7b61ff", action: { kind: "keys", value: "Win+Shift+S" } },
        { label: "Desktop", icon: "desktop", color: "#4c8df2", action: { kind: "keys", value: "Win+D" } },
        { label: "Task Mgr", icon: "chart", color: "#4cd18a", action: { kind: "keys", value: "Ctrl+Shift+Esc" } },
        { label: "Lock", icon: "lock", color: "#8a94a3", action: { kind: "keys", value: "Win+L" } },
        { label: "Next page", icon: "next", color: "#3a4352", action: { kind: "page", value: 1 } },
      ],
    },
    fields: [
      { key: "buttons", label: "Buttons", type: "buttons", mediaActions: MEDIA_ACTIONS },
      { key: "columns", label: "Columns", type: "number", min: 1, max: 8, step: 1 },
    ],
  },
  {
    type: "streamDeck", name: "Stream Deck", icon: "deck", category: "Control",
    sizes: ["S", "W", "M", "L", "XL"], defaultSize: "W",
    defaults: { label: "", fit: true, showEmptyKeys: true },
    fields: [
      { key: "_link", label: "Virtual device", type: "streamDeckLink" },
      { key: "showEmptyKeys", label: "Show empty keys", type: "toggle", help: "Shows the whole key grid, including keys with no action." },
      {
        key: "fit", label: "Fill the widget", type: "toggle",
        help: "Changes the Virtual Stream Deck key size so it fills this widget. Stream Deck restarts once when the size changes.",
      },
      {
        key: "label", label: "Label", type: "text", placeholder: "Optional",
        help: "Shows your Elgato Virtual Stream Deck here. In Stream Deck: Devices → Add Virtual Device, then show it with the eye icon.",
      },
    ],
  },
  {
    type: "keyboard", name: "Virtual Keyboard", icon: "keyboard", category: "Control",
    sizes: ["L", "XL"], defaultSize: "XL",
    defaults: { layout: "qwerty", sound: false },
    fields: [{ key: "layout", label: "Layout", type: "segmented", options: [["qwerty", "QWERTY"], ["numpad", "Numpad"]] }],
  },
  {
    type: "touchpad", name: "Virtual Touchpad", icon: "touchpad", category: "Control",
    sizes: ["S", "W", "M", "L", "XL"], defaultSize: "L",
    defaults: { sensitivity: 1.8, tapToClick: true, buttons: true },
    fields: [
      { key: "sensitivity", label: "Sensitivity", type: "number", min: 0.5, max: 5, step: 0.1 },
      { key: "tapToClick", label: "Tap to click", type: "toggle" },
      { key: "buttons", label: "Show buttons", type: "toggle" },
    ],
  },

  // Fun
  {
    type: "coin", name: "Decision Coin", icon: "coin", category: "Fun",
    sizes: ["S", "M"], defaultSize: "S",
    defaults: { heads: "Yes", tails: "No" },
    fields: [
      { key: "heads", label: "Heads", type: "text" },
      { key: "tails", label: "Tails", type: "text" },
    ],
  },
];

window.edgeCatalogItem = (type) => window.EDGE_CATALOG.find((c) => c.type === type);

/** Deep-merges saved settings over the catalog defaults, so new fields always have a value. */
window.edgeWidgetSettings = (widget) => {
  const def = window.edgeCatalogItem(widget.type)?.defaults ?? {};
  const merge = (a, b) => {
    if (Array.isArray(b)) return b;
    if (b && typeof b === "object" && a && typeof a === "object" && !Array.isArray(a)) {
      const out = { ...a };
      for (const k of Object.keys(b)) out[k] = merge(a[k], b[k]);
      return out;
    }
    return b === undefined ? a : b;
  };
  return merge(structuredClone(def), widget.settings ?? {});
};
