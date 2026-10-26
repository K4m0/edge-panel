"use strict";

// Settings editor: shared state and UI helpers. Loaded first; settings.js wires everything up last.

const EP = (window.EP = {
  host: window.chrome?.webview ?? null,
  config: null,
  startWithWindows: false,
  configPath: "",
  version: "",
  sensorCatalog: [],
  mediaBase: "https://media.edge.panel/",
  live: { sensors: {}, media: null, audio: null, appIcons: {} },
  device: null,
  view: "widgets",
  pageIndex: 0,
  selectedId: null,
  GRID: window.EDGE_GRID ?? { cols: 4, rows: 2 },
  SIZES: window.EDGE_SIZES ?? {
    S: { cols: 1, rows: 1, label: "S" }, W: { cols: 2, rows: 1, label: "Wide" }, M: { cols: 1, rows: 2, label: "M" },
    L: { cols: 2, rows: 2, label: "L" }, XL: { cols: 4, rows: 2, label: "XL" },
  },
  CATALOG: window.EDGE_CATALOG ?? [],
});

EP.send = (msg) => { try { EP.host?.postMessage(msg); } catch (err) { console.warn("postMessage failed", err); } };

/* ---------- DOM ---------- */

const PROPS = new Set(["value", "checked", "disabled", "hidden", "selected", "indeterminate", "tabIndex", "draggable", "type"]);

EP.h = function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") {
        for (const [p, pv] of Object.entries(v)) {
          if (p.startsWith("--")) el.style.setProperty(p, pv);
          else el.style[p] = pv;
        }
      }
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
};
const h = EP.h;

EP.$ = (id) => document.getElementById(id);
EP.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---------- Icons ---------- */

const UI = {
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z",
  trash: "M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z",
  left: "m14.6 6 1.4 1.4-4.6 4.6 4.6 4.6-1.4 1.4-6-6z",
  right: "m9.4 6 6 6-6 6L8 16.6l4.6-4.6L8 7.4z",
  up: "m12 7.6 6 6-1.4 1.4-4.6-4.6L7.4 15 6 13.6z",
  down: "m12 16.4-6-6L7.4 9l4.6 4.6L16.6 9l1.4 1.4z",
  copy: "M8 3h11v13h-2V5H8zM4 7h11v14H4zm2 2v10h7V9z",
  edit: "M4 17.2V20h2.8l9.6-9.6-2.8-2.8zM19.7 7.1a1 1 0 0 0 0-1.4L18.3 4.3a1 1 0 0 0-1.4 0l-1.6 1.6 2.8 2.8z",
  close: "M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z",
  search: "M10 3a7 7 0 0 1 5.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
  folder: "M3 5h7l2 2h9v12H3z",
  check: "m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6 11-11-1.4-1.4z",
  info: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 8v7h2v-7zm0-4v2h2V6z",
  undo: "M7.8 8H15a6 6 0 0 1 0 12H8v-2h7a4 4 0 0 0 0-8H7.8l3 3-1.4 1.4L4 9l5.4-5.4L10.8 5z",
  redo: "M16.2 8H9a6 6 0 0 0 0 12h7v-2H9a4 4 0 0 1 0-8h7.2l-3 3 1.4 1.4L20 9l-5.4-5.4L13.2 5z",
  grid: "M3 3h8v8H3zm2 2v4h4V5zm8-2h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zm8-2h8v8h-8zm2 2v4h4v-4z",
  palette: "M12 3a9 9 0 0 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2zM6.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z",
  monitor: "M2 5h20v12H13v2h3v2H8v-2h3v-2H2zm2 2v8h16V7z",
  sun: "M11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1zM12 6a6 6 0 1 1 0 12 6 6 0 0 1 0-12z",
  gear: "M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.5 7.5 0 0 0-1.7-1L15 3h-4l-.3 2.9a7.5 7.5 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.5 7.5 0 0 0 1.7 1L11 21h4l.3-2.9a7.5 7.5 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z",
  refresh: "M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4z",
  keyboard: "M2 6h20v12H2zm2 2v2h2V8zm3 0v2h2V8zm3 0v2h2V8zm3 0v2h2V8zm3 0v2h2V8zM4 11v2h2v-2zm3 0v2h2v-2zm3 0v2h2v-2zm3 0v2h2v-2zm3 0v2h2v-2zM7 14v2h10v-2z",
  image: "M3 4h18v16H3zm2 2v9.6l3.5-3.6 3 3L16 10l3 3V6zm4 1.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z",
  pin: "M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  chevron: "m12 15.4-6-6L7.4 8l4.6 4.6L16.6 8 18 9.4z",
  widget: "M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z",
  record: "M12 6a6 6 0 1 1 0 12 6 6 0 0 1 0-12z",
  app: "M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z",
  drag: "M8 5h3v3H8zm5 0h3v3h-3zM8 10.5h3v3H8zm5 0h3v3h-3zM8 16h3v3H8zm5 0h3v3h-3z",
};

EP.ui = (name, cls = "") => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${UI[name] ?? UI.widget}"/></svg>`;
EP.uiEl = (name, cls) => h("span", { class: "ico-wrap", html: EP.ui(name, cls) });

/** SVG markup for an EDGE_ICONS key, with a graceful fallback when the icon does not exist (yet). */
EP.edgeIcon = (name) => {
  const v = name && window.EDGE_ICONS?.[name];
  if (!v) return EP.ui("widget", "edge-ico fallback");
  try {
    if (typeof window.edgeIconSvg === "function") {
      const svg = window.edgeIconSvg(name);
      if (typeof svg === "string" && svg.includes("<svg")) return svg.replace("<svg", '<svg class="ico edge-ico" aria-hidden="true" focusable="false"');
    }
  } catch { /* fall through */ }
  return typeof v === "string" && v.trim().startsWith("<")
    ? `<svg class="ico edge-ico" viewBox="0 0 24 24" aria-hidden="true">${v}</svg>`
    : `<svg class="ico edge-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${v}"/></svg>`;
};

/** Icon button. */
EP.iconBtn = (icon, label, onclick, extra = {}) =>
  h("button", { type: "button", class: `icon-btn ${extra.class ?? ""}`, title: label, "aria-label": label, html: EP.ui(icon), onclick, disabled: extra.disabled });

/* ---------- Object paths ---------- */

EP.getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
EP.setPath = (obj, path, value) => {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  o[keys.at(-1)] = value;
};

/* ---------- Ids ---------- */

EP.allIds = () => {
  const ids = new Set();
  for (const p of EP.config?.pages ?? []) {
    ids.add(p.id);
    for (const w of p.widgets ?? []) ids.add(w.id);
  }
  return ids;
};
EP.newId = (prefix, taken = EP.allIds()) => {
  let id;
  do id = prefix + Math.random().toString(36).slice(2, 8); while (taken.has(id));
  taken.add(id);
  return id;
};

/* ---------- Catalog / grid ---------- */

EP.cat = (type) => EP.CATALOG.find((c) => c.type === type);
EP.widgetName = (w) => EP.cat(w.type)?.name ?? w.type;
EP.sizeOf = (s) => EP.SIZES[s] ?? { cols: 1, rows: 1, label: s };
EP.widgetSettings = (w) => (typeof window.edgeWidgetSettings === "function" ? window.edgeWidgetSettings(w) : structuredClone(w.settings ?? {}));
EP.page = () => EP.config?.pages[EP.pageIndex];
EP.selected = () => EP.page()?.widgets.find((w) => w.id === EP.selectedId) ?? null;

EP.inGrid = (col, row, size) => {
  const s = EP.sizeOf(size);
  return col >= 0 && row >= 0 && col + s.cols <= EP.GRID.cols && row + s.rows <= EP.GRID.rows;
};
EP.overlaps = (a, b) => {
  const sa = EP.sizeOf(a.size), sb = EP.sizeOf(b.size);
  return a.col < b.col + sb.cols && b.col < a.col + sa.cols && a.row < b.row + sb.rows && b.row < a.row + sa.rows;
};
/** True when a widget of `size` can sit at col,row on `page` (ignoring the widget `exceptId`). */
EP.fits = (page, col, row, size, exceptId = null) => {
  if (!EP.inGrid(col, row, size)) return false;
  const probe = { col, row, size };
  return !page.widgets.some((w) => w.id !== exceptId && EP.inGrid(w.col, w.row, w.size) && EP.overlaps(probe, w));
};
EP.findSlot = (page, size, exceptId = null) => {
  for (let row = 0; row < EP.GRID.rows; row++)
    for (let col = 0; col < EP.GRID.cols; col++)
      if (EP.fits(page, col, row, size, exceptId)) return { col, row };
  return null;
};
EP.occupantAt = (page, col, row) => page.widgets.find((w) => EP.inGrid(w.col, w.row, w.size) && EP.overlaps({ col, row, size: "S" }, w));
/** Sizes ordered from smallest to largest area. */
EP.sizesBySmallest = (sizes) => [...sizes].sort((a, b) => {
  const sa = EP.sizeOf(a), sb = EP.sizeOf(b);
  return sa.cols * sa.rows - sb.cols * sb.rows;
});

EP.DEFAULT_STYLE = { custom: false, textColor: "", accentColor: "", background: "", opacity: null, backgroundImage: "" };
EP.DEFAULT_THEME = {
  background: "#000000", backgroundImage: "", textColor: "#e8edf3", accentColor: "#2bd4e0",
  widgetBackground: "#11151b", widgetOpacity: 0.85, radius: 18,
};

EP.makeWidget = (type, col, row, size, taken) => {
  const c = EP.cat(type);
  return {
    id: EP.newId("w", taken),
    type, col, row, size,
    settings: structuredClone(c?.defaults ?? {}),
    style: { ...EP.DEFAULT_STYLE },
  };
};

/* ---------- Sensors ---------- */

const ALIAS_NAMES = {
  "cpu.load": ["CPU Load", "Load", "%"], "cpu.temp": ["CPU Temperature", "Temperature", "°C"], "cpu.power": ["CPU Power", "Power", "W"],
  "cpu.clock": ["CPU Clock", "Clock", "MHz"], "gpu.load": ["GPU Load", "Load", "%"], "gpu.temp": ["GPU Temperature", "Temperature", "°C"],
  "gpu.hotspot": ["GPU Hotspot", "Temperature", "°C"], "gpu.power": ["GPU Power", "Power", "W"], "gpu.vramUsed": ["GPU Memory Used", "SmallData", "MB"],
  "gpu.vramTotal": ["GPU Memory Total", "SmallData", "MB"], "ram.load": ["Memory Load", "Load", "%"], "ram.used": ["Memory Used", "Data", "GB"],
  "ram.total": ["Memory Total", "Data", "GB"],
};
/** The sensor catalog from the host, or the stable aliases when the host has not sent one. */
EP.sensors = () => EP.sensorCatalog.length
  ? EP.sensorCatalog
  : Object.entries(ALIAS_NAMES).map(([id, [name, type, unit]]) => ({ id, name, hardware: "Alias (any PC)", type, unit }));
EP.sensorInfo = (id) => EP.sensors().find((s) => s.id === id) ?? null;
EP.fmtSensor = (id) => {
  const s = EP.live.sensors?.[id];
  if (!s || s.value == null || !Number.isFinite(s.value)) return "–";
  const v = Math.abs(s.value) >= 100 ? Math.round(s.value) : Math.round(s.value * 10) / 10;
  return `${v}${s.unit ? (s.unit === "%" || s.unit === "°C" ? "" : " ") + s.unit : ""}`;
};
EP.updateLiveValues = (root = document) => {
  root.querySelectorAll("[data-live-sensor]").forEach((el) => { el.textContent = EP.fmtSensor(el.dataset.liveSensor); });
};

/* ---------- Media ---------- */

EP.isVideo = (name) => /\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/i.test(name ?? "");
EP.mediaUrl = (name) => (name ? EP.mediaBase + encodeURIComponent(name) : "");
EP.mediaThumb = (name, cls = "thumb") => {
  if (!name) return h("div", { class: `${cls} empty`, html: EP.ui("image") });
  const box = h("div", { class: cls, title: name });
  const fallback = () => { box.classList.add("empty"); box.innerHTML = EP.ui("image"); };
  const media = EP.isVideo(name)
    ? h("video", { src: EP.mediaUrl(name), muted: true, preload: "metadata", playsinline: true })
    : h("img", { src: EP.mediaUrl(name), alt: "", loading: "lazy" });
  if (media.tagName === "VIDEO") media.muted = true;
  media.addEventListener("error", fallback, { once: true });
  box.append(media);
  return box;
};

/* ---------- Browse (host file dialog) ---------- */

const pendingPicks = new Map();
let pickSeq = 0;
EP.browse = (kind) => {
  if (!EP.host) {
    EP.toast("The file picker needs the Edge Panel app.");
    return Promise.resolve(null);
  }
  const requestId = `r${++pickSeq}`;
  EP.send({ type: "browse", requestId, kind });
  return new Promise((resolve) => pendingPicks.set(requestId, resolve));
};
EP.resolvePick = (msg) => {
  const done = pendingPicks.get(msg.requestId);
  if (!done) return;
  pendingPicks.delete(msg.requestId);
  done(msg.path || msg.media ? msg : null);
};

/* ---------- Toast ---------- */

let toastTimer;
EP.toast = (text, kind = "") => {
  const el = EP.$("toast");
  if (!el) return;
  el.textContent = text;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), 3200);
};

/* ---------- Popover ---------- */

let openPop = null;
EP.closePopover = () => { openPop?.close(); };
EP.popover = (anchor, content, opts = {}) => {
  EP.closePopover();
  const pop = h("div", { class: `popover ${opts.class ?? ""}`, role: opts.role ?? "dialog" }, content);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const width = Math.min(innerWidth - 16, opts.width ?? Math.max(r.width, 280));
  pop.style.width = `${width}px`;
  const left = EP.clamp(r.left, 8, innerWidth - width - 8);
  const ph = pop.offsetHeight;
  let top = r.bottom + 6;
  if (top + ph > innerHeight - 8) top = r.top - ph - 6 >= 8 ? r.top - ph - 6 : Math.max(8, innerHeight - 8 - ph);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  anchor.setAttribute("aria-expanded", "true");

  const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); anchor.focus(); } };
  const onScroll = (e) => { if (!pop.contains(e.target)) close(); };
  const close = () => {
    if (openPop !== api) return;
    openPop = null;
    pop.remove();
    anchor.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", close);
    opts.onClose?.();
  };
  setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("scroll", onScroll, true);
  });
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", close);
  const api = { el: pop, close };
  openPop = api;
  return api;
};

/** Listbox keyboard navigation for a popover: `input` filters, `list` holds [role=option] children. */
EP.listNav = (input, list, onPick) => {
  input.addEventListener("keydown", (e) => {
    const opts = [...list.querySelectorAll("[role=option]")];
    if (!opts.length) return;
    let i = opts.findIndex((o) => o.classList.contains("active"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      i = e.key === "ArrowDown" ? Math.min(opts.length - 1, i + 1) : Math.max(0, i - 1);
      opts.forEach((o, j) => o.classList.toggle("active", j === i));
      opts[i].scrollIntoView({ block: "nearest" });
      input.setAttribute("aria-activedescendant", opts[i].id);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onPick(opts[Math.max(0, i)]);
    }
  });
};

/* ---------- Confirm dialog ---------- */

EP.confirm = (message, okLabel = "OK", danger = false) => new Promise((resolve) => {
  const dlg = h("dialog", { class: "dialog" },
    h("p", null, message),
    h("div", { class: "dialog-actions" },
      h("button", { type: "button", class: "btn", value: "no", onclick: () => dlg.close("no") }, "Cancel"),
      h("button", { type: "button", class: `btn ${danger ? "danger" : "primary"}`, onclick: () => dlg.close("yes") }, okLabel)));
  dlg.addEventListener("close", () => { resolve(dlg.returnValue === "yes"); dlg.remove(); });
  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector(".btn:last-child").focus();
});

/* ---------- Key combos ---------- */

const KEY_NAMES = {
  ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", Space: "Space", Enter: "Enter", NumpadEnter: "Enter",
  Tab: "Tab", Escape: "Esc", Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Home: "Home", End: "End",
  PageUp: "PageUp", PageDown: "PageDown", Minus: "Minus", Equal: "Equal", BracketLeft: "LBracket", BracketRight: "RBracket",
  Backslash: "Backslash", Semicolon: "Semicolon", Quote: "Quote", Comma: "Comma", Period: "Period", Slash: "Slash",
  Backquote: "Backtick", PrintScreen: "PrintScreen", Pause: "Pause", ScrollLock: "ScrollLock", CapsLock: "CapsLock",
  NumpadAdd: "NumAdd", NumpadSubtract: "NumSubtract", NumpadMultiply: "NumMultiply", NumpadDivide: "NumDivide", NumpadDecimal: "NumDecimal",
  MediaPlayPause: "MediaPlayPause", MediaTrackNext: "MediaNext", MediaTrackPrevious: "MediaPrev", MediaStop: "MediaStop",
  AudioVolumeMute: "VolumeMute", AudioVolumeDown: "VolumeDown", AudioVolumeUp: "VolumeUp", ContextMenu: "Menu",
};
const MOD_CODES = new Set(["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight", "OSLeft", "OSRight"]);

EP.comboFromEvent = (e) => {
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Win"].filter(Boolean);
  if (MOD_CODES.has(e.code) || ["Control", "Alt", "Shift", "Meta", "OS"].includes(e.key)) return { partial: true, text: mods.join("+") };
  let key = KEY_NAMES[e.code];
  if (!key) {
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else if (/^Numpad\d$/.test(e.code)) key = "Num" + e.code.slice(6);
    else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
    else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  }
  return { partial: false, text: [...mods, key].join("+"), mods: mods.length, key };
};

/**
 * Key combination input: free text (so Win+... combos the browser can't see can still be typed)
 * plus a Record button that captures the next key combination, and a clear button.
 */
EP.keyRecorder = ({ value, onChange, label = "Key combination", placeholder = "Not set" }) => {
  let recording = false;
  let before = value ?? "";
  const input = h("input", { type: "text", class: "key-input", value: value ?? "", placeholder, spellcheck: "false", "aria-label": label });
  const rec = h("button", { type: "button", class: "btn small rec", title: "Record a key combination", html: `${EP.ui("record")}<span>Record</span>` });
  const clear = EP.iconBtn("close", `Clear ${label.toLowerCase()}`, () => { stop(false); input.value = ""; onChange(""); });
  const wrap = h("div", { class: "key-rec" }, input, rec, clear);

  const start = () => {
    recording = true;
    before = input.value;
    wrap.classList.add("recording");
    rec.querySelector("span").textContent = "Stop";
    input.value = "";
    input.placeholder = "Press a key combination…";
    input.focus();
  };
  const stop = (restore) => {
    if (!recording) return;
    recording = false;
    wrap.classList.remove("recording");
    rec.querySelector("span").textContent = "Record";
    input.placeholder = placeholder;
    if (restore) input.value = before;
  };
  rec.addEventListener("click", () => (recording ? stop(true) : start()));
  input.addEventListener("keydown", (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    const c = EP.comboFromEvent(e);
    if (c.partial) { input.value = c.text ? c.text + "+…" : ""; return; }
    if (!c.mods && c.key === "Esc") { stop(true); return; }
    if (!c.mods && (c.key === "Backspace" || c.key === "Delete")) { stop(false); input.value = ""; onChange(""); return; }
    input.value = c.text;
    stop(false);
    onChange(c.text);
  });
  input.addEventListener("keyup", (e) => { if (recording) e.preventDefault(); });
  input.addEventListener("blur", () => stop(true));
  input.addEventListener("input", () => { if (!recording) onChange(input.value.trim(), true); });
  return wrap;
};

/* ---------- Small inputs ---------- */

EP.toggle = (checked, onChange, label) => {
  const input = h("input", { type: "checkbox", class: "switch", checked: !!checked, role: "switch", "aria-label": label });
  input.addEventListener("change", () => onChange(input.checked));
  return input;
};

EP.segmented = (options, value, onChange, { label = "", disabled = () => false, titles = {} } = {}) => {
  const box = h("div", { class: "seg", role: "radiogroup", "aria-label": label });
  options.forEach(([v, text, hint]) => {
    const on = String(v) === String(value);
    const off = disabled(v);
    const b = h("button", {
      type: "button", role: "radio", "aria-checked": String(on), class: on ? "on" : "",
      // An optional third option item explains the choice on hover.
      tabIndex: on ? 0 : -1, disabled: off, title: (off ? titles[v] : "") || hint || text,
      onclick: () => {
        if (String(v) === String(value)) return;
        value = v;
        box.querySelectorAll("button").forEach((x, j) => {
          const sel = String(options[j][0]) === String(v);
          x.classList.toggle("on", sel);
          x.setAttribute("aria-checked", String(sel));
          x.tabIndex = sel ? 0 : -1;
        });
        onChange(v);
      },
    }, text);
    box.append(b);
  });
  if (!box.querySelector("[tabindex='0']")) box.querySelector("button:not(:disabled)")?.setAttribute("tabindex", "0");
  box.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const btns = [...box.querySelectorAll("button:not(:disabled)")];
    const i = btns.indexOf(document.activeElement);
    const next = btns[(i + (e.key === "ArrowRight" ? 1 : -1) + btns.length) % btns.length];
    if (next) { e.preventDefault(); next.focus(); next.click(); }
  });
  return box;
};

const normHex = (v) => {
  v = String(v ?? "").trim();
  if (/^#?[0-9a-f]{3}$/i.test(v)) v = "#" + v.replace("#", "").split("").map((c) => c + c).join("");
  if (/^[0-9a-f]{6}$/i.test(v)) v = "#" + v;
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
};
EP.normHex = normHex;

/** Color: swatch (native picker), hex text, optional clear (empty value = inherit/default). */
EP.colorInput = (value, onChange, { clearable = true, fallback = "#888888", label = "Color" } = {}) => {
  const picker = h("input", { type: "color", value: normHex(value) ?? normHex(fallback) ?? "#888888", "aria-label": `${label} picker` });
  const swatch = h("label", { class: "swatch", title: "Pick a color" }, picker);
  const hex = h("input", { type: "text", class: "hex", value: value ?? "", placeholder: clearable ? "Default" : "#rrggbb", spellcheck: "false", maxlength: "7", "aria-label": `${label} hex value` });
  const paint = (v) => { swatch.classList.toggle("none", !v); swatch.style.setProperty("--c", v || "transparent"); };
  paint(normHex(value));
  picker.addEventListener("input", () => { hex.value = picker.value; paint(picker.value); onChange(picker.value, true); });
  hex.addEventListener("change", () => {
    const v = normHex(hex.value);
    if (v) { hex.value = v; picker.value = v; paint(v); onChange(v); }
    else if (!hex.value.trim() && clearable) { paint(""); onChange(""); }
    else hex.value = normHex(value) ?? "";
  });
  const wrap = h("div", { class: "color-input" }, swatch, hex);
  if (clearable) wrap.append(EP.iconBtn("close", `Reset ${label.toLowerCase()} to default`, () => { hex.value = ""; paint(""); onChange(""); }));
  return wrap;
};

/** Slider with a live readout. */
EP.slider = ({ value, min, max, step = 1, format = (v) => v, onInput, onChange, label }) => {
  const input = h("input", { type: "range", min, max, step, value, "aria-label": label });
  const out = h("output", { class: "range-out" }, format(Number(value)));
  const setFill = () => input.style.setProperty("--fill", `${((input.value - min) / (max - min)) * 100}%`);
  setFill();
  input.addEventListener("input", () => { out.textContent = format(Number(input.value)); setFill(); onInput?.(Number(input.value)); });
  input.addEventListener("change", () => onChange?.(Number(input.value)));
  const wrap = h("div", { class: "range" }, input, out);
  wrap.set = (v) => { input.value = v; out.textContent = format(Number(v)); setFill(); };
  wrap.input = input;
  return wrap;
};

EP.infoTip = (text) => h("span", { class: "info-tip", tabindex: "0", role: "note", "aria-label": text, "data-tip": text, html: EP.ui("info") });
