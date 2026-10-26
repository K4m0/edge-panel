"use strict";

/* Edge Panel v0.3: pages, grid layout, theming, host bridge. Widgets live in widgets/*.js. */
(() => {
  const PREVIEW = new URLSearchParams(location.search).get("preview") === "1";
  const host = window.chrome?.webview;
  const send = (msg) => { if (!PREVIEW) host?.postMessage(msg); };

  const $ = (id) => document.getElementById(id);
  const viewport = $("viewport");
  const track = $("track");
  const dotsEl = $("dots");
  const emptyEl = $("empty");

  const IFRAME_TYPES = new Set(["youtube", "webUrl", "simhub", "iframe", "twitch"]);
  const DEFAULT_THEME = {
    background: "#000000", backgroundImage: "", textColor: "#e8edf3", accentColor: "#2bd4e0",
    widgetBackground: "#11151b", widgetOpacity: 0.85, radius: 18,
  };

  const state = { config: null, sensors: null, media: null, audio: null, appIcons: {} };
  let pages = [];        // [{ el, widgets: [{ inst, el }] }]
  let pageIndex = 0;

  // Shared with widgets (EdgeW.tap reads `swiping`).
  const api = (window.EdgePanel = { swiping: false, preview: PREVIEW });

  if (PREVIEW) document.body.classList.add("preview");

  /* ---------- Theme ---------- */
  function hexToRgb(c) {
    const m = /^#?([0-9a-f]{3,8})$/i.exec(String(c ?? "").trim());
    if (!m) return null;
    let s = m[1];
    if (s.length === 3 || s.length === 4) s = [...s].map((x) => x + x).join("");
    if (s.length !== 6 && s.length !== 8) return null;
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  }
  function withAlpha(color, alpha) {
    const rgb = hexToRgb(color);
    const a = Number.isFinite(+alpha) ? Math.min(1, Math.max(0, +alpha)) : 1;
    if (rgb) return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
    return color ? `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)` : "";
  }
  /** Dark or light ink for text drawn on the accent colour. */
  function inkFor(color) {
    const rgb = hexToRgb(color);
    if (!rgb) return "#0b0d10";
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? "#0b0d10" : "#ffffff";
  }
  function mediaUrl(file) {
    if (!file) return "";
    if (/^(https?:|data:|blob:)/i.test(file)) return file;
    const base = state.config?.mediaBase || "https://media.edge.panel/";
    return base.replace(/\/?$/, "/") + String(file).split("/").map(encodeURIComponent).join("/");
  }
  const cssUrl = (u) => `url("${u.replace(/["\\]/g, "\\$&")}")`;

  function applyTheme(el, t) {
    const s = el.style;
    if (t.background) s.setProperty("--bg", t.background);
    s.setProperty("--bg-image", t.backgroundImage ? cssUrl(mediaUrl(t.backgroundImage)) : "none");
    if (t.textColor) s.setProperty("--text", t.textColor);
    if (t.accentColor) {
      s.setProperty("--accent", t.accentColor);
      s.setProperty("--accent-ink", inkFor(t.accentColor));
    }
    if (t.widgetBackground) s.setProperty("--wbg", withAlpha(t.widgetBackground, t.widgetOpacity ?? 1));
    if (Number.isFinite(+t.radius) && t.radius !== null && t.radius !== "") s.setProperty("--radius", `${+t.radius}px`);
  }

  function applyWidgetStyle(el, style, theme) {
    if (!style?.custom) return;
    const s = el.style;
    if (style.textColor) s.setProperty("--text", style.textColor);
    if (style.accentColor) {
      s.setProperty("--accent", style.accentColor);
      s.setProperty("--accent-ink", inkFor(style.accentColor));
    }
    const hasOpacity = style.opacity !== null && style.opacity !== undefined && style.opacity !== "";
    if (style.background || hasOpacity) {
      s.setProperty("--wbg", withAlpha(style.background || theme.widgetBackground, hasOpacity ? style.opacity : theme.widgetOpacity));
    }
    if (style.backgroundImage) {
      el.classList.add("has-bg-image");
      s.setProperty("--w-image", cssUrl(mediaUrl(style.backgroundImage)));
    }
  }

  /* ---------- Rendering ---------- */
  function destroyAll() {
    for (const p of pages) {
      for (const w of p.widgets) {
        try { w.inst?.destroy?.(); } catch (err) { console.error(err); }
      }
    }
    pages = [];
    track.replaceChildren();
  }

  function render(config) {
    destroyAll();
    state.config = config ?? {};
    const globalTheme = { ...DEFAULT_THEME, ...(state.config.theme ?? {}) };
    applyTheme(document.documentElement, globalTheme);

    const pageCfgs = Array.isArray(state.config.pages) ? state.config.pages : [];
    let total = 0;
    pages = pageCfgs.map((p, i) => {
      const page = buildPage(p, i, globalTheme);
      total += page.widgets.length;
      return page;
    });

    const empty = pageCfgs.length === 0 || (total === 0 && !PREVIEW);
    emptyEl.hidden = !empty;
    pageIndex = Math.min(Math.max(0, pageIndex), Math.max(0, pages.length - 1));
    position(0, false);
    renderDots();
    for (let i = 0; i < pages.length; i++) setPageVisible(i, i === pageIndex, true);
  }

  function buildPage(p, index, globalTheme) {
    const el = document.createElement("section");
    el.className = "page";
    el.dataset.index = index;
    const theme = state.config.themePerPage && p?.theme ? { ...globalTheme, ...p.theme } : globalTheme;
    if (theme !== globalTheme) {
      applyTheme(el, theme);
      el.classList.add("own-theme");
    }
    track.appendChild(el);

    const { cols, rows } = window.EDGE_GRID ?? { cols: 4, rows: 2 };
    const used = Array.from({ length: rows }, () => new Array(cols).fill(false));
    const page = { el, widgets: [], visible: false };
    let hasIframe = false;

    for (const w of Array.isArray(p?.widgets) ? p.widgets : []) {
      const def = window.edgeCatalogItem?.(w.type);
      const size = window.EDGE_SIZES?.[w.size] ?? window.EDGE_SIZES?.[def?.defaultSize] ?? { cols: 1, rows: 1 };
      const c = Math.trunc(+w.col), r = Math.trunc(+w.row);
      if (!(c >= 0 && r >= 0 && c + size.cols <= cols && r + size.rows <= rows)) { console.warn("widget does not fit", w); continue; }
      let free = true;
      for (let y = r; y < r + size.rows; y++) for (let x = c; x < c + size.cols; x++) if (used[y][x]) free = false;
      if (!free) { console.warn("widget overlaps", w); continue; }
      for (let y = r; y < r + size.rows; y++) for (let x = c; x < c + size.cols; x++) used[y][x] = true;

      const box = document.createElement("div");
      box.className = `widget w-${w.type}`;
      box.dataset.id = w.id ?? "";
      box.dataset.size = w.size ?? def?.defaultSize ?? "S";
      box.style.setProperty("--gc", `${c + 1} / span ${size.cols}`);
      box.style.setProperty("--gr", `${r + 1} / span ${size.rows}`);
      box.style.setProperty("--pc", `${r + 1} / span ${size.rows}`);
      box.style.setProperty("--pr", `${c + 1} / span ${size.cols}`);
      applyWidgetStyle(box, w.style, theme);
      const body = document.createElement("div");
      body.className = "wbody";
      box.appendChild(body);
      el.appendChild(box);
      if (IFRAME_TYPES.has(w.type)) hasIframe = true;

      const entry = { inst: null, el: box };
      page.widgets.push(entry);
      const impl = window.EDGE_WIDGETS?.[w.type];
      if (!impl) {
        body.innerHTML = window.EdgeW.hint("app", `Unknown widget "${w.type}"`);
        continue;
      }
      try {
        const settings = window.edgeWidgetSettings ? window.edgeWidgetSettings(w) : (w.settings ?? {});
        entry.inst = impl.create(body, settings, makeCtx(w, page)) ?? {};
        for (const kind of ["sensors", "media", "audio", "appIcons"]) {
          if (state[kind]) entry.inst.update?.(kind, state[kind]);
        }
        entry.inst.update?.("tick", new Date());
      } catch (err) {
        console.error("widget failed", w, err);
        body.innerHTML = window.EdgeW.hint("app", "This widget failed to load");
      }
    }

    if (hasIframe && !PREVIEW) {
      // Iframes swallow pointer events, so give the page thin swipe zones at its edges.
      for (const side of ["left", "right"]) {
        const z = document.createElement("div");
        z.className = `swipe-edge ${side}`;
        el.appendChild(z);
      }
    }
    return page;
  }

  function makeCtx(widget, page) {
    return {
      widget,
      id: widget.id,
      preview: PREVIEW,
      get mediaBase() { return state.config?.mediaBase || "https://media.edge.panel/"; },
      send,
      icon: (n) => window.edgeIconSvg(n),
      mediaUrl,
      sensors: () => state.sensors,
      sensor: (id) => (id ? state.sensors?.[id] : undefined),
      media: () => state.media,
      audio: () => state.audio,
      appIcons: () => state.appIcons,
      visible: () => page.visible,
    };
  }

  function broadcast(kind, data) {
    for (const p of pages) {
      for (const w of p.widgets) {
        if (!w.inst?.update) continue;
        try { w.inst.update(kind, data); } catch (err) { console.error(err); }
      }
    }
  }

  function setPageVisible(i, visible, force) {
    const p = pages[i];
    if (!p || (p.visible === visible && !force)) return;
    p.visible = visible;
    p.el.classList.toggle("active", visible);
    for (const w of p.widgets) {
      try { w.inst?.update?.("visible", visible); } catch (err) { console.error(err); }
    }
  }

  /* ---------- Paging ---------- */
  function position(offsetPx, animate) {
    const w = viewport.clientWidth || window.innerWidth;
    track.style.transition = animate ? "transform 0.38s cubic-bezier(0.22, 0.8, 0.25, 1)" : "none";
    track.style.transform = `translate3d(${-pageIndex * w + offsetPx}px, 0, 0)`;
  }

  function go(index, { animate = true, report = true } = {}) {
    if (!pages.length) return;
    const next = Math.min(Math.max(0, index | 0), pages.length - 1);
    const changed = next !== pageIndex;
    const prev = pageIndex;
    pageIndex = next;
    position(0, animate && !PREVIEW);
    if (changed) {
      setPageVisible(prev, false);
      setPageVisible(next, true);
      updateDots();
      if (report) send({ type: "page", index: next });
    }
    showDots();
  }

  window.addEventListener("resize", () => position(0, false));

  /* Swipe: horizontal drag with threshold + velocity, rubber-band at the ends. */
  let drag = null;
  viewport.addEventListener("pointerdown", (e) => {
    if (PREVIEW) return;
    showDots();
    if (drag || pages.length === 0) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest?.("[data-noswipe]")) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, samples: [{ t: e.timeStamp, x: e.clientX }] };
  });

  window.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.active) {
      if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      drag.active = true;
      drag.x0 = e.clientX;  // start from here so the page does not jump
      api.swiping = true;
      try { viewport.setPointerCapture(e.pointerId); } catch { /* pointer gone */ }
      document.body.classList.add("swiping");
    }
    const d = e.clientX - drag.x0;
    drag.samples.push({ t: e.timeStamp, x: e.clientX });
    if (drag.samples.length > 8) drag.samples.shift();
    const atEdge = (pageIndex === 0 && d > 0) || (pageIndex === pages.length - 1 && d < 0);
    position(atEdge ? d * 0.3 / (1 + Math.abs(d) / 600) : d, false);
  });

  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.active) return;
    document.body.classList.remove("swiping");
    const dx = e.clientX - d.x0;
    const recent = d.samples.filter((s) => e.timeStamp - s.t < 120);
    const first = recent[0] ?? d.samples[0];
    const v = first && e.timeStamp > first.t ? (e.clientX - first.x) / (e.timeStamp - first.t) : 0; // px/ms
    const w = viewport.clientWidth || window.innerWidth;
    let target = pageIndex;
    if (!cancelled) {
      if (v < -0.35 || dx < -w * 0.22) target = pageIndex + 1;
      else if (v > 0.35 || dx > w * 0.22) target = pageIndex - 1;
    }
    if (target === pageIndex || target < 0 || target >= pages.length) position(0, true);
    else go(target);
    // Swallow the click that follows the drag.
    setTimeout(() => { api.swiping = false; }, 0);
  }
  window.addEventListener("pointerup", (e) => endDrag(e, false));
  window.addEventListener("pointercancel", (e) => endDrag(e, true));
  // Block clicks right after a swipe (capture phase, before widgets).
  window.addEventListener("click", (e) => { if (api.swiping) { e.stopPropagation(); e.preventDefault(); } }, true);

  /* Dots */
  let dotsTimer = 0;
  function renderDots() {
    dotsEl.replaceChildren();
    if (PREVIEW || pages.length < 2) return;
    pages.forEach((_, i) => {
      const b = document.createElement("button");
      b.className = "dot";
      b.setAttribute("aria-label", `Page ${i + 1}`);
      b.addEventListener("click", () => go(i));
      dotsEl.appendChild(b);
    });
    updateDots();
    showDots();
  }
  function updateDots() {
    [...dotsEl.children].forEach((d, i) => d.classList.toggle("on", i === pageIndex));
  }
  function showDots() {
    if (PREVIEW || pages.length < 2) return;
    dotsEl.classList.add("show");
    clearTimeout(dotsTimer);
    dotsTimer = setTimeout(() => dotsEl.classList.remove("show"), 3500);
  }

  /* ---------- Clock tick (aligned to the second) ---------- */
  function tick() {
    broadcast("tick", new Date());
    setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  }
  setTimeout(tick, 1000 - (Date.now() % 1000) + 5);

  /* ---------- Host bridge ---------- */
  function onMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    const { type, data } = msg;
    switch (type) {
      case "config": render(data); break;
      case "sensors": state.sensors = data ?? {}; broadcast("sensors", state.sensors); break;
      case "media": {
        const m = data ? { ...data } : null;
        if (m && m.art === undefined) m.art = state.media?.art ?? null;
        state.media = m;
        broadcast("media", m);
        break;
      }
      case "audio": state.audio = data ?? null; broadcast("audio", state.audio); break;
      case "appIcons": state.appIcons = data ?? {}; broadcast("appIcons", state.appIcons); break;
      case "goto": go(msg.index ?? data?.index ?? data, { report: false }); break;
      case "nav": go(pageIndex + (Number(msg.dir ?? data?.dir) < 0 ? -1 : 1)); break;
      case "dockState": broadcast("dockState", msg); break;
      default: break;
    }
  }

  host?.addEventListener("message", (e) => onMessage(e.data));
  if (PREVIEW || !host) {
    window.addEventListener("message", (e) => {
      if (e.source !== window.parent && e.source !== window) return;
      onMessage(e.data);
    });
  }

  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("dragstart", (e) => e.preventDefault());

  emptyEl.hidden = true;
  send({ type: "ready" });
})();
