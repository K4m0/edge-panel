"use strict";

const host = window.chrome?.webview;
const send = (msg) => host?.postMessage(msg);

const ICONS = {
  music: "M12 3v10.6A4 4 0 1 0 14 17V7h4V3z",
  chat: "M4 4h16v12H7l-3 3z",
  game: "M7 8h10a5 5 0 0 1 0 10c-1.6 0-2.6-1-3.4-2h-3.2C9.6 17 8.6 18 7 18A5 5 0 0 1 7 8zm0 3v2H5v2h2v2h2v-2h2v-2H9v-2zm9 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  calc: "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm1 3v4h10V5zm0 7v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2zm-8 4v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2z",
  chart: "M4 20V10h3v10zm6 0V4h3v16zm6 0v-7h3v7z",
  globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15 15 0 0 0-1.3-4A8 8 0 0 1 18.9 8zM12 4c.8 1.1 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.9 1.9-4zM4.3 14a8 8 0 0 1 0-4h3.4a17 17 0 0 0 0 4zm.8 2h3a15 15 0 0 0 1.3 4A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.3-4A15 15 0 0 0 8.1 8zM12 20c-.8-1.1-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.9-1.9 4zm2.3-6H9.7a15 15 0 0 1 0-4h4.6a15 15 0 0 1 0 4zm.3 6a15 15 0 0 0 1.3-4h3a8 8 0 0 1-4.3 4zm1.7-6a17 17 0 0 0 0-4h3.4a8 8 0 0 1 0 4z",
  app: "M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z",
};

const svgIcon = (name) =>
  `<svg viewBox="0 0 24 24"><path d="${ICONS[name] ?? ICONS.app}"/></svg>`;

/* Clock — rendered locally, no host round-trip */
const timeEl = document.getElementById("time");
const secEl = document.getElementById("seconds");
const dateEl = document.getElementById("date");
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });

function tick() {
  const now = new Date();
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
  secEl.textContent = String(now.getSeconds()).padStart(2, "0");
  dateEl.textContent = dateFmt.format(now);
}
tick();
setInterval(tick, 1000);

/* Gauges */
const CIRCUMFERENCE = 2 * Math.PI * 50;

function setGauge(name, load, subText) {
  const card = document.querySelector(`[data-sensor="${name}"]`);
  const ring = card.querySelector(".value");
  const pct = Number.isFinite(load) ? Math.max(0, Math.min(100, load)) : 0;
  ring.style.strokeDashoffset = CIRCUMFERENCE * (1 - pct / 100);
  ring.style.stroke = pct >= 90 ? "var(--hot)" : pct >= 70 ? "var(--warn)" : "var(--ok)";
  card.querySelector(".load").textContent = Number.isFinite(load) ? Math.round(load) : "--";
  card.querySelector(".temp").textContent = subText;
}

const fmtTemp = (t) => (Number.isFinite(t) ? `${Math.round(t)} °C` : "-- °C");
const fmtGb = (v) => (Number.isFinite(v) ? v.toFixed(1) : "--");

function onSensors(s) {
  if (!s) return;
  setGauge("cpu", s.cpuLoad, fmtTemp(s.cpuTemp));
  setGauge("gpu", s.gpuLoad, fmtTemp(s.gpuTemp));
  setGauge("ram", s.ramLoad, `${fmtGb(s.ramUsedGb)} / ${fmtGb(s.ramTotalGb)} GB`);
}

/* Media */
const titleEl = document.getElementById("media-title");
const artistEl = document.getElementById("media-artist");
const playIcon = document.getElementById("icon-play");
const pauseIcon = document.getElementById("icon-pause");

function onMedia(m) {
  titleEl.textContent = m?.title || "Nothing playing";
  artistEl.textContent = m?.artist || " ";
  const playing = !!m?.isPlaying;
  playIcon.hidden = playing;
  pauseIcon.hidden = !playing;
}

document.querySelectorAll("[data-media]").forEach((b) =>
  b.addEventListener("click", () => send({ type: "media", action: b.dataset.media })));

document.querySelectorAll("[data-volume]").forEach((b) =>
  b.addEventListener("click", () => send({ type: "volume", action: b.dataset.volume })));

/* Shortcuts */
const shortcutsEl = document.getElementById("shortcuts");

function onConfig(cfg) {
  shortcutsEl.innerHTML = "";
  for (const s of cfg?.shortcuts ?? []) {
    const b = document.createElement("button");
    b.innerHTML = svgIcon(s.icon);
    const label = document.createElement("span");
    label.textContent = s.label;
    b.appendChild(label);
    b.addEventListener("click", () => send({ type: "launch", id: s.id }));
    shortcutsEl.appendChild(b);
  }
}

/* Host bridge */
host?.addEventListener("message", (e) => {
  const { type, data } = e.data ?? {};
  if (type === "sensors") onSensors(data);
  else if (type === "media") onMedia(data);
  else if (type === "config") onConfig(data);
});

send({ type: "ready" });
