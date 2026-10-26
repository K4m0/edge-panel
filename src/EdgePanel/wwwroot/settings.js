"use strict";

// Settings editor entry point: host messages, live preview, auto-save, undo, navigation.
// Loaded after settings-core.js, settings-fields.js, settings-widgets.js and settings-views.js.

(() => {
  const { h } = EP;

  /* =================== Config normalization =================== */

  const normalize = (raw) => {
    const c = structuredClone(raw ?? {});
    c.version = 3;
    c.monitor = { nameContains: "XENEON EDGE", fallbackWidth: 2560, fallbackHeight: 720, ...c.monitor };
    c.mouseGuard ??= true;
    c.evictWindows ??= true;
    c.noActivate ??= true;
    c.sensorIntervalMs ??= 1000;
    c.devTools ??= false;
    c.displayMode = c.displayMode === "desktop" ? "desktop" : "panel";
    c.hotkeys = { nextPage: "", prevPage: "", toggleMode: "", ...c.hotkeys };
    c.theme = { ...EP.DEFAULT_THEME, ...c.theme };
    c.themePerPage = !!c.themePerPage;
    if (!Array.isArray(c.pages) || !c.pages.length) c.pages = [{ id: "p1", name: "Main", theme: null, widgets: [] }];
    const taken = new Set();
    for (const p of c.pages) {
      if (!p.id || taken.has(p.id)) p.id = EP.newId("p", taken);
      taken.add(p.id);
      p.name ??= "";
      p.theme ??= null;
      p.widgets = Array.isArray(p.widgets) ? p.widgets : [];
    }
    for (const p of c.pages) {
      const placed = { widgets: [] };
      for (const w of p.widgets) {
        if (!w.id || taken.has(w.id)) w.id = EP.newId("w", taken);
        taken.add(w.id);
        w.settings ??= {};
        w.style = { ...EP.DEFAULT_STYLE, ...w.style };
        w.size = EP.SIZES[w.size] ? w.size : (EP.cat(w.type)?.defaultSize ?? "S");
        w.col = Number(w.col) || 0;
        w.row = Number(w.row) || 0;
        // Widgets that overlap or overflow get the first free slot (the panel would skip them).
        if (!EP.fits(placed, w.col, w.row, w.size)) {
          const slot = EP.findSlot(placed, w.size);
          if (slot) Object.assign(w, slot);
        }
        placed.widgets.push(w);
      }
    }
    return c;
  };

  /* =================== Preview iframe =================== */

  let previewReady = false;
  const frame = () => EP.$("preview");
  EP.toPreview = (msg) => {
    if (!previewReady) return;
    try { frame().contentWindow?.postMessage(msg, location.origin === "null" ? "*" : location.origin); } catch { /* preview not ready */ }
  };
  const previewConfig = () => ({
    type: "config",
    data: { pages: EP.config.pages, theme: EP.config.theme, themePerPage: EP.config.themePerPage, mediaBase: EP.mediaBase },
  });
  EP.pushPreview = () => { if (EP.config) EP.toPreview(previewConfig()); };
  const replayPreview = () => {
    if (!EP.config) return;
    EP.pushPreview();
    const L = EP.live;
    if (L.appIcons) EP.toPreview({ type: "appIcons", data: L.appIcons });
    if (L.media) EP.toPreview({ type: "media", data: L.media });
    if (L.audio) EP.toPreview({ type: "audio", data: L.audio });
    if (L.sensors) EP.toPreview({ type: "sensors", data: L.sensors });
    EP.toPreview({ type: "goto", index: EP.pageIndex });
  };

  /* =================== Edits, undo, auto-save =================== */

  const undoStack = [], redoStack = [];
  let lastCoalesce = null, lastEditAt = 0;
  const snapshot = () => JSON.stringify({ config: EP.config, startWithWindows: EP.startWithWindows, pageIndex: EP.pageIndex, selectedId: EP.selectedId });

  /**
   * Every change goes through here: records undo, pushes the preview, schedules the save.
   * opts.coalesce: edits with the same key within 1.5 s share one undo step (typing, dragging sliders).
   * opts.render: "light" (overlay + page bar), "full", or "none" (caller renders).
   */
  EP.edit = (fn, { coalesce = null, render = "light" } = {}) => {
    const now = Date.now();
    if (!(coalesce && coalesce === lastCoalesce && now - lastEditAt < 1500)) {
      undoStack.push(snapshot());
      if (undoStack.length > 30) undoStack.shift();
      redoStack.length = 0;
    }
    lastCoalesce = coalesce;
    lastEditAt = now;
    fn();
    EP.pushPreview();
    scheduleSave();
    updateUndoButtons();
    if (render === "full") EP.render();
    else if (render === "light") EP.renderLight();
  };

  const restore = (from, to) => {
    if (!from.length) return;
    to.push(snapshot());
    const s = JSON.parse(from.pop());
    EP.config = s.config;
    EP.startWithWindows = s.startWithWindows;
    EP.pageIndex = EP.clamp(s.pageIndex ?? 0, 0, EP.config.pages.length - 1);
    EP.selectedId = s.selectedId ?? null;
    lastCoalesce = null;
    EP.closePopover();
    EP.pushPreview();
    EP.toPreview({ type: "goto", index: EP.pageIndex });
    EP.send({ type: "previewPage", index: EP.pageIndex });
    scheduleSave();
    EP.render();
    updateUndoButtons();
  };
  EP.undo = () => { restore(undoStack, redoStack); };
  EP.redo = () => { restore(redoStack, undoStack); };
  const updateUndoButtons = () => {
    EP.$("undo").disabled = !undoStack.length;
    EP.$("redo").disabled = !redoStack.length;
  };

  let saveTimer = 0;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    setSaveStatus("pending");
    saveTimer = setTimeout(saveNow, 400);
  };
  const saveNow = () => {
    clearTimeout(saveTimer);
    saveTimer = 0;
    EP.send({ type: "save", config: EP.config, startWithWindows: EP.startWithWindows });
    setSaveStatus(EP.host ? "saving" : "saved");
  };
  const setSaveStatus = (state, text) => {
    const el = EP.$("save-status");
    el.className = `save-status ${state}`;
    el.innerHTML = {
      pending: `<span class="spin"></span>Saving…`,
      saving: `<span class="spin"></span>Saving…`,
      saved: `${EP.ui("check")}All changes saved`,
      error: `${EP.ui("info")}${text ?? "Couldn't save"}`,
      idle: "",
    }[state] ?? "";
  };
  // Flush a pending save when the window is closed or hidden.
  window.addEventListener("pagehide", () => { if (saveTimer) saveNow(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && saveTimer) saveNow(); });

  /* =================== Rendering / navigation =================== */

  const VIEWS = {
    widgets: ["Widgets", "Drag widgets onto the screen, then select one to change its settings."],
    pages: ["Pages Personalization", "Background, colors and transparency for your pages."],
    screen: ["Screen Setup", "Display mode, hotkeys and how the Edge behaves with Windows."],
    device: ["Device Settings", "Brightness, contrast and color of the XENEON EDGE."],
    app: ["App Settings", "Startup and app information."],
  };

  EP.showView = (view) => {
    if (!VIEWS[view]) view = "widgets";
    EP.view = view;
    EP.closePopover();
    EP.disarm?.();
    document.querySelectorAll(".nav-item").forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle("on", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${view}`));
    EP.$("main").dataset.view = view;
    EP.$("stage").hidden = !(view === "widgets" || view === "pages");
    EP.$("view-title").textContent = VIEWS[view][0];
    EP.$("view-sub").textContent = VIEWS[view][1];
    if (view === "device") { EP.device = null; EP.send({ type: "getDevice" }); }
    try { localStorage.setItem("edge.settings.view", view); } catch { /* storage unavailable */ }
    EP.render();
  };

  EP.renderLight = () => {
    if (!EP.config) return;
    EP.renderOverlay();
    EP.renderPagebar();
  };

  EP.render = () => {
    if (!EP.config) return;
    EP.layoutStage();
    EP.renderLight();
    if (EP.view === "widgets") EP.widgetsView.render();
    else EP.otherViews[EP.view]?.();
  };

  /* =================== Host messages =================== */

  const receive = (msg) => {
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "state": {
        EP.config = normalize(msg.config);
        EP.startWithWindows = !!msg.startWithWindows;
        EP.configPath = msg.configPath ?? "";
        EP.version = msg.version ?? "";
        EP.sensorCatalog = Array.isArray(msg.sensorCatalog) ? msg.sensorCatalog : [];
        if (msg.mediaBase) EP.mediaBase = msg.mediaBase.endsWith("/") ? msg.mediaBase : msg.mediaBase + "/";
        EP.pageIndex = EP.clamp(EP.pageIndex, 0, EP.config.pages.length - 1);
        if (!EP.page().widgets.some((w) => w.id === EP.selectedId)) EP.selectedId = null;
        undoStack.length = redoStack.length = 0;
        updateUndoButtons();
        EP.$("app-version").textContent = EP.version ? `v${EP.version.replace(/^v/i, "")}` : "";
        document.body.classList.remove("loading");
        setSaveStatus("idle");
        EP.render();
        EP.pushPreview();
        EP.toPreview({ type: "goto", index: EP.pageIndex });
        EP.send({ type: "previewPage", index: EP.pageIndex });
        break;
      }
      case "sensors":
        EP.live.sensors = msg.data ?? {};
        EP.toPreview({ type: "sensors", data: msg.data });
        EP.updateLiveValues();
        break;
      case "media": {
        const d = { ...(msg.data ?? {}) };
        if (d.art === undefined && EP.live.media) d.art = EP.live.media.art;
        EP.live.media = d;
        EP.toPreview({ type: "media", data: msg.data });
        break;
      }
      case "audio":
        EP.live.audio = msg.data;
        EP.toPreview({ type: "audio", data: msg.data });
        break;
      case "appIcons":
        EP.live.appIcons = msg.data ?? {};
        EP.toPreview({ type: "appIcons", data: msg.data });
        document.querySelectorAll("[data-appicon]").forEach(EP.paintAppIcon);
        break;
      case "saved":
        if (!saveTimer) setSaveStatus("saved");
        break;
      case "picked":
        EP.resolvePick(msg);
        break;
      case "panelPage": {
        // The page was changed on the Edge itself; follow it without sending it back.
        const i = EP.clamp(Number(msg.index) || 0, 0, EP.config.pages.length - 1);
        if (i === EP.pageIndex) break;
        EP.pageIndex = i;
        if (!EP.page().widgets.some((w) => w.id === EP.selectedId)) EP.selectedId = null;
        EP.toPreview({ type: "goto", index: i });
        EP.render();
        break;
      }
      case "streamDeckStatus":
        EP.streamDeck = msg.data ?? null;
        EP.onStreamDeckStatus?.();
        break;
      case "device":
        EP.device = msg.data ?? { supported: false };
        if (EP.view === "device") EP.otherViews.device();
        break;
      case "error":
        setSaveStatus("error", msg.message);
        EP.toast(msg.message ?? "Something went wrong.", "error");
        break;
    }
  };
  window.__edgeReceive = receive;
  EP.host?.addEventListener("message", (e) => receive(e.data));

  /* =================== Startup =================== */

  const start = () => {
    document.querySelectorAll(".nav-item").forEach((b) => {
      b.title = b.textContent.trim();
      b.addEventListener("click", () => EP.showView(b.dataset.view));
    });
    EP.$("nav").addEventListener("keydown", (e) => {
      const items = [...document.querySelectorAll(".nav-item")];
      const i = items.indexOf(document.activeElement);
      const d = { ArrowDown: 1, ArrowUp: -1 }[e.key];
      if (i >= 0 && d) { e.preventDefault(); items[(i + d + items.length) % items.length].focus(); }
    });
    EP.$("undo").addEventListener("click", EP.undo);
    EP.$("redo").addEventListener("click", EP.redo);

    const iframe = frame();
    iframe.addEventListener("load", () => { previewReady = true; replayPreview(); });
    // The preview may already be loaded when this runs.
    try { if (iframe.contentDocument?.readyState === "complete" && iframe.contentWindow.location.href !== "about:blank") { previewReady = true; } } catch { /* cross-origin */ }

    EP.widgetsView.mount();
    new ResizeObserver(() => EP.layoutStage()).observe(EP.$("main"));

    document.addEventListener("keydown", (e) => {
      const t = e.target;
      const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && !(t.type === "checkbox" || t.type === "range");
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); e.shiftKey ? EP.redo() : EP.undo(); }
      else if (mod && !e.altKey && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); EP.redo(); }
      else if (e.key === "Escape" && EP.disarm?.()) e.preventDefault();
    });

    let view = "widgets";
    try { view = localStorage.getItem("edge.settings.view") || view; } catch { /* storage unavailable */ }
    if (view === "device") view = "widgets";
    EP.showView(view);
    EP.send({ type: "ready" });
  };

  start();
})();
