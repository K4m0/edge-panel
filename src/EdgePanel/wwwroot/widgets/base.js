"use strict";

/*
 * Widget registry + shared helpers for the panel.
 *
 *   window.EDGE_WIDGETS[type] = { create(el, settings, ctx) -> instance }
 *   instance = { update?(kind, data), destroy?() }
 *
 * `el` is the widget body (a size container, so cq* units refer to the widget box).
 * `settings` is edgeWidgetSettings(widget) (catalog defaults merged with saved values).
 * `ctx` (built by app.js):
 *   widget, id, preview, mediaBase, send(msg), icon(name), mediaUrl(file),
 *   sensors(), media(), audio(), appIcons()   // latest host state (may be null)
 *   sensor(id)                                 // SensorValue for an id/alias or undefined
 *   visible()                                  // true when the widget's page is shown
 * update kinds: "sensors", "media", "audio", "appIcons" (data = latest host state),
 *               "tick" (data = Date, every second), "visible" (data = boolean).
 * Right after create(), app.js calls update() once for each host state already known.
 */
window.EDGE_WIDGETS = {};

window.EdgeW = (() => {
  const h = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  const icon = (name) => window.edgeIconSvg(name);

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  /** Formats a sensor value for display: returns { text, unit }. */
  function fmt(sv) {
    const v = num(sv?.value);
    let unit = sv?.unit ?? "";
    if (v === null) return { text: "--", unit };
    let text;
    if (unit === "B/s") {
      const steps = ["B/s", "KB/s", "MB/s", "GB/s"];
      let x = v, i = 0;
      while (Math.abs(x) >= 1000 && i < steps.length - 1) { x /= 1024; i++; }
      unit = steps[i];
      text = x >= 100 || i === 0 ? Math.round(x).toString() : x.toFixed(1);
    } else if (unit === "V") text = v.toFixed(v >= 10 ? 1 : 3);
    else if (unit === "GB") text = v.toFixed(1);
    else if (unit === "%" || unit === "°C" || unit === "MHz" || unit === "RPM" || unit === "MB" || unit === "Hz") text = Math.round(v).toString();
    else if (unit === "W") text = v >= 10 ? Math.round(v).toString() : v.toFixed(1);
    else text = Math.abs(v) >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString();
    return { text, unit };
  }

  /** 0..1 fill for a gauge. Uses min/max when given, otherwise a guess by unit (with a running peak). */
  function fraction(sv, min, max, peak) {
    const v = num(sv?.value);
    if (v === null) return null;
    if (num(min) !== null && num(max) !== null && max > min) return clamp((v - min) / (max - min), 0, 1);
    const unit = sv?.unit ?? "";
    if (unit === "%") return clamp(v / 100, 0, 1);
    if (unit === "°C") return clamp(v / 100, 0, 1);
    const p = Math.max(peak ?? 0, v, 1e-9);
    return clamp(v / p, 0, 1);
  }

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /** Gauge colour: accent, then warn, then hot. */
  const levelColor = (f) => (f == null ? "var(--muted)" : f >= 0.9 ? "var(--hot)" : f >= 0.75 ? "var(--warn)" : "var(--accent)");

  /** Ring gauge (270° arc). Returns { el, set(fraction|null) }. */
  function ring() {
    const R = 42, C = 2 * Math.PI * R, ARC = 0.75;
    const el = h("div", "ring");
    el.innerHTML = `<svg viewBox="0 0 100 100">
      <circle class="ring-track" cx="50" cy="50" r="${R}" stroke-dasharray="${C * ARC} ${C}" transform="rotate(135 50 50)"/>
      <circle class="ring-value" cx="50" cy="50" r="${R}" stroke-dasharray="0 ${C}" transform="rotate(135 50 50)"/>
    </svg>`;
    const val = el.querySelector(".ring-value");
    return {
      el,
      set(f) {
        const len = f == null ? 0 : C * ARC * f;
        val.setAttribute("stroke-dasharray", `${len} ${C}`);
        val.style.stroke = levelColor(f);
      },
    };
  }

  const isVideo = (name) => /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(name ?? "");

  /** Calls fn on every resize of el; returns a disposer. */
  function onResize(el, fn) {
    const ro = new ResizeObserver(() => fn(el.clientWidth, el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }

  /** Placeholder shown when a widget is not configured yet. */
  const hint = (iconName, text) => `<div class="hint">${icon(iconName)}<span>${esc(text)}</span></div>`;

  /** Pointer press feedback + tap handler that ignores page swipes. */
  function tap(el, fn) {
    el.addEventListener("click", (e) => { if (!window.EdgePanel?.swiping) fn(e); });
  }

  /** Stable colour from a string, for letter tiles. */
  function hue(str) {
    let x = 0;
    for (const ch of String(str)) x = (x * 31 + ch.charCodeAt(0)) | 0;
    return Math.abs(x) % 360;
  }

  /**
   * One sensor readout: ring gauge with the value inside, or a big value.
   * cfg = { sensor, name, mode: "gauge"|"value", min?, max? }. Returns { el, set(sensorValue) }.
   */
  function sensorCell(cfg) {
    const gauge = cfg.mode !== "value";
    const el = h("div", `sc ${gauge ? "sc-gauge" : "sc-value"}`);
    const name = h("div", "sc-name");
    const vis = h("div", "sc-vis");
    const val = h("div", "sc-val", `<b>--</b><small></small>`);
    const sub = h("div", "sc-sub");
    const r = gauge ? ring() : null;
    if (r) vis.appendChild(r.el);
    vis.appendChild(val);
    el.append(name, vis, sub);
    const b = val.firstChild, u = val.lastChild;
    let peak = 0, lastText = null;
    name.textContent = cfg.name || cfg.sensor || "";
    return {
      el,
      set(sv) {
        const v = num(sv?.value);
        if (v !== null) peak = Math.max(peak, v);
        const f = fmt(sv);
        if (f.text !== lastText) { b.textContent = f.text; lastText = f.text; }
        if (u.textContent !== f.unit) u.textContent = f.unit;
        if (!cfg.name && sv?.name) name.textContent = sv.name;
        const hw = sv?.hardware ?? "";
        if (sub.textContent !== hw) sub.textContent = hw;
        const fr = fraction(sv, cfg.min, cfg.max, peak);
        r?.set(fr);
        if (!r) val.style.color = fr == null ? "" : fr >= 0.9 ? "var(--hot)" : fr >= 0.75 && sv?.unit !== "%" ? "var(--warn)" : "";
      },
    };
  }

  /**
   * Loading state for a button that opens an app. start() shows a spinner and blocks the button;
   * set(state) follows the host's launchState: "opened" flashes a check, "failed"/"timeout" shakes.
   * A safety timer unblocks the button if the host never answers.
   */
  function launchState(button) {
    const ov = h("span", "launch-ov", `<span class="launch-spin"></span><span class="launch-done">${icon("check")}</span>`);
    button.appendChild(ov);
    let timer = 0;
    const clear = (after) => {
      clearTimeout(timer);
      timer = setTimeout(() => button.classList.remove("launching", "launched", "launch-failed"), after);
    };
    return {
      get busy() { return button.classList.contains("launching"); },
      start() {
        button.classList.remove("launched", "launch-failed");
        button.classList.add("launching");
        button.setAttribute("aria-busy", "true");
        clearTimeout(timer);
        timer = setTimeout(() => this.set("timeout"), 30000);
      },
      set(state) {
        if (state === "opening") { if (!this.busy) this.start(); return; }
        button.removeAttribute("aria-busy");
        button.classList.remove("launching");
        button.classList.add(state === "opened" ? "launched" : "launch-failed");
        clear(state === "opened" ? 900 : 1400);
      },
    };
  }

  return { h, icon, esc, num, fmt, fraction, clamp, levelColor, ring, isVideo, onResize, hint, tap, hue, sensorCell, launchState };
})();
