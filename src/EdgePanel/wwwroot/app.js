"use strict";

const host = window.chrome?.webview;
const send = (msg) => host?.postMessage(msg);

const grid = document.getElementById("grid");
const template = (id) => document.getElementById(id).content.firstElementChild.cloneNode(true);

/* Widget builders: each returns the element plus optional update hooks. */
const GAUGES = { cpu: "CPU", gpu: "GPU", ram: "RAM" };
const CIRCUMFERENCE = 2 * Math.PI * 50;

const builders = {
  clock() {
    const el = template("tpl-clock");
    return { el, onTick: (now) => renderClock(el, now) };
  },
  cpu: () => gaugeWidget("cpu"),
  gpu: () => gaugeWidget("gpu"),
  ram: () => gaugeWidget("ram"),
  media() {
    const el = template("tpl-media");
    el.querySelectorAll("[data-media]").forEach((b) =>
      b.addEventListener("click", () => send({ type: "media", action: b.dataset.media })));
    el.querySelectorAll("[data-volume]").forEach((b) =>
      b.addEventListener("click", () => send({ type: "volume", action: b.dataset.volume })));
    return { el, onMedia: (m) => renderMedia(el, m) };
  },
  shortcuts(layout) {
    const el = template("tpl-shortcuts");
    const box = el.querySelector(".shortcut-grid");
    box.style.gridTemplateColumns = `repeat(${layout.shortcutColumns || 3}, 1fr)`;
    for (const s of layout.shortcuts ?? []) {
      const b = document.createElement("button");
      b.innerHTML = window.edgeIconSvg(s.icon);
      const label = document.createElement("span");
      label.textContent = s.label;
      b.appendChild(label);
      b.addEventListener("click", () => send({ type: "launch", id: s.id }));
      box.appendChild(b);
    }
    return { el };
  },
};

function gaugeWidget(kind) {
  const el = template("tpl-gauge");
  el.dataset.sensor = kind;
  el.querySelector("h2").textContent = GAUGES[kind];
  return { el, onSensors: (s) => renderGauge(el, kind, s) };
}

/* Layout */
let widgets = [];
let lastSensors = null;
let lastMedia = null;

function applyLayout(layout) {
  const items = (layout?.widgets ?? []).filter((w) => builders[w.type]);
  grid.innerHTML = "";
  widgets = items.map((w) => builders[w.type](layout));
  widgets.forEach((w) => grid.appendChild(w.el));
  grid.style.setProperty("--tracks", items.map((w) => `${w.size}fr`).join(" ") || "1fr");

  if (widgets.length === 0) {
    grid.innerHTML = `<section class="card empty">No widgets enabled. Open Settings from the tray icon.</section>`;
  }

  // Paint immediately instead of waiting for the next host update.
  tick();
  if (lastSensors) onSensors(lastSensors);
  onMedia(lastMedia);
}

/* Clock — rendered locally, no host round-trip */
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });

function renderClock(el, now) {
  const timeEl = el.querySelector(".time");
  // Render AM/PM (when the locale uses it) small, so the time stays on one line.
  const parts = timeFmt.formatToParts(now);
  const main = parts.filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim();
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  timeEl.textContent = main;
  if (period) {
    const span = document.createElement("span");
    span.className = "period";
    span.textContent = period;
    timeEl.appendChild(span);
  }
  el.querySelector(".seconds").textContent = String(now.getSeconds()).padStart(2, "0");
  el.querySelector(".date").textContent = dateFmt.format(now);
}

function tick() {
  const now = new Date();
  widgets.forEach((w) => w.onTick?.(now));
}
setInterval(tick, 1000);

/* Gauges */
const fmtTemp = (t) => (Number.isFinite(t) ? `${Math.round(t)} °C` : "-- °C");
const fmtGb = (v) => (Number.isFinite(v) ? v.toFixed(1) : "--");

function renderGauge(el, kind, s) {
  const load = s[`${kind}Load`];
  const sub = kind === "ram" ? `${fmtGb(s.ramUsedGb)} / ${fmtGb(s.ramTotalGb)} GB` : fmtTemp(s[`${kind}Temp`]);
  const ring = el.querySelector(".value");
  const pct = Number.isFinite(load) ? Math.max(0, Math.min(100, load)) : 0;
  ring.style.strokeDashoffset = CIRCUMFERENCE * (1 - pct / 100);
  ring.style.stroke = pct >= 90 ? "var(--hot)" : pct >= 70 ? "var(--warn)" : "var(--ok)";
  el.querySelector(".load").textContent = Number.isFinite(load) ? Math.round(load) : "--";
  el.querySelector(".sub").textContent = sub;
}

function onSensors(s) {
  if (!s) return;
  lastSensors = s;
  widgets.forEach((w) => w.onSensors?.(s));
}

/* Media */
function renderMedia(el, m) {
  el.querySelector(".title").textContent = m?.title || "Nothing playing";
  el.querySelector(".artist").textContent = m?.artist || " ";
  const playing = !!m?.isPlaying;
  el.querySelector(".icon-play").hidden = playing;
  el.querySelector(".icon-pause").hidden = !playing;
}

function onMedia(m) {
  lastMedia = m ?? null;
  widgets.forEach((w) => w.onMedia?.(m));
}

/* Host bridge */
host?.addEventListener("message", (e) => {
  const { type, data } = e.data ?? {};
  if (type === "sensors") onSensors(data);
  else if (type === "media") onMedia(data);
  else if (type === "config") applyLayout(data);
});

send({ type: "ready" });
