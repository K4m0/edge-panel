"use strict";

const host = window.chrome?.webview;
const send = (msg) => host?.postMessage(msg);
const $ = (id) => document.getElementById(id);

const WIDGET_INFO = {
  clock: ["Clock", "Time and date"],
  cpu: ["CPU", "Load and temperature"],
  gpu: ["GPU", "Load and temperature"],
  ram: ["RAM", "Memory in use"],
  media: ["Media", "Now playing, playback and volume"],
  shortcuts: ["Shortcuts", "Launcher buttons"],
};

const SVG = {
  grip: '<svg viewBox="0 0 24 24"><path d="M8 5h3v3H8zm5 0h3v3h-3zM8 10.5h3v3H8zm5 0h3v3h-3zM8 16h3v3H8zm5 0h3v3h-3z"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m12 7 7 7-1.4 1.4-5.6-5.6-5.6 5.6L5 14z"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m12 17-7-7 1.4-1.4 5.6 5.6 5.6-5.6L19 10z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z"/></svg>',
};

let config = null;
let startWithWindows = false;
let dirty = false;

/* Tabs */
document.querySelectorAll("[role=tab]").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll("[role=tab]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    document.querySelectorAll(".tab").forEach((s) => (s.hidden = s.id !== `tab-${tab.dataset.tab}`));
  }));

function markDirty() {
  dirty = true;
  setStatus("Unsaved changes", false, true);
}

function setStatus(text, isError = false, quiet = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", isError);
  el.style.color = quiet ? "var(--muted)" : "";
}

function move(list, from, to) {
  if (to < 0 || to >= list.length || from === to) return;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
}

/* Drag to reorder (mouse); arrow buttons cover touch and keyboard. */
function makeDraggable(li, index, list, render) {
  li.draggable = true;
  li.addEventListener("dragstart", (e) => {
    li.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  });
  li.addEventListener("dragend", () => li.classList.remove("dragging"));
  li.addEventListener("dragover", (e) => { e.preventDefault(); li.classList.add("drop-target"); });
  li.addEventListener("dragleave", () => li.classList.remove("drop-target"));
  li.addEventListener("drop", (e) => {
    e.preventDefault();
    move(list, Number(e.dataTransfer.getData("text/plain")), index);
    markDirty();
    render();
  });
  // Inputs inside a draggable row must stay usable.
  li.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("mousedown", () => (li.draggable = false));
    el.addEventListener("mouseup", () => (li.draggable = true));
    el.addEventListener("blur", () => (li.draggable = true));
  });
}

function arrowButtons(list, index, render) {
  const box = document.createElement("div");
  box.className = "arrows";
  for (const [dir, label, delta] of [["up", "Move up", -1], ["down", "Move down", 1]]) {
    const b = document.createElement("button");
    b.className = "icon";
    b.innerHTML = SVG[dir];
    b.title = label;
    b.setAttribute("aria-label", label);
    b.disabled = index + delta < 0 || index + delta >= list.length;
    b.addEventListener("click", () => { move(list, index, index + delta); markDirty(); render(); });
    box.appendChild(b);
  }
  return box;
}

/* Layout tab */
function renderPreview() {
  const box = $("preview");
  const enabled = config.widgets.filter((w) => w.enabled);
  box.style.gridTemplateColumns = enabled.map((w) => `${w.size}fr`).join(" ") || "1fr";
  box.innerHTML = "";
  if (enabled.length === 0) {
    box.innerHTML = '<div class="empty">No widgets enabled</div>';
    return;
  }
  for (const w of enabled) {
    const cell = document.createElement("div");
    cell.textContent = WIDGET_INFO[w.type]?.[0] ?? w.type;
    box.appendChild(cell);
  }
}

function renderWidgets() {
  const list = $("widget-list");
  list.innerHTML = "";
  config.widgets.forEach((w, i) => {
    const [title, desc] = WIDGET_INFO[w.type] ?? [w.type, ""];
    const li = document.createElement("li");
    li.className = `item widget-item${w.enabled ? "" : " off"}`;
    li.innerHTML = `
      <span class="handle" title="Drag to reorder">${SVG.grip}</span>
      <span class="name">${title}<small>${desc}</small></span>
      <label class="size">Size <input type="range" min="0.4" max="3" step="0.1"><output></output></label>
      <span class="arrows-slot"></span>
      <input type="checkbox" class="switch" aria-label="Show ${title}">`;

    const range = li.querySelector("input[type=range]");
    const out = li.querySelector("output");
    range.value = w.size;
    out.textContent = Number(w.size).toFixed(1);
    range.addEventListener("input", () => {
      w.size = Number(range.value);
      out.textContent = w.size.toFixed(1);
      markDirty();
      renderPreview();
    });

    const toggle = li.querySelector(".switch");
    toggle.checked = w.enabled;
    toggle.addEventListener("change", () => {
      w.enabled = toggle.checked;
      li.classList.toggle("off", !w.enabled);
      markDirty();
      renderPreview();
    });

    li.querySelector(".arrows-slot").replaceWith(arrowButtons(config.widgets, i, renderLayout));
    makeDraggable(li, i, config.widgets, renderLayout);
    list.appendChild(li);
  });
}

function renderLayout() {
  renderPreview();
  renderWidgets();
}

/* Shortcuts tab */
function renderShortcuts() {
  const list = $("shortcut-list");
  list.innerHTML = "";
  config.shortcuts.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "item shortcut-item";
    li.innerHTML = `
      <span class="icon-pick"><span class="icon-preview"></span><select aria-label="Icon"></select></span>
      <input type="text" class="label" placeholder="Label" aria-label="Label" spellcheck="false">
      <span class="target">
        <input type="text" class="target-input" placeholder="Program, URL or app link" aria-label="Target" spellcheck="false">
        <button class="ghost browse">Browse…</button>
      </span>
      <span class="actions"></span>`;

    const select = li.querySelector("select");
    const preview = li.querySelector(".icon-preview");
    for (const name of Object.keys(window.EDGE_ICONS)) {
      const opt = document.createElement("option");
      opt.value = opt.textContent = name;
      select.appendChild(opt);
    }
    select.value = window.EDGE_ICONS[s.icon] ? s.icon : "app";
    preview.innerHTML = window.edgeIconSvg(select.value);
    select.addEventListener("change", () => {
      s.icon = select.value;
      preview.innerHTML = window.edgeIconSvg(s.icon);
      markDirty();
    });

    const label = li.querySelector(".label");
    label.value = s.label ?? "";
    label.addEventListener("input", () => { s.label = label.value; markDirty(); });

    const target = li.querySelector(".target-input");
    target.value = s.target ?? "";
    target.dataset.index = i;
    target.addEventListener("input", () => { s.target = target.value; markDirty(); });

    li.querySelector(".browse").addEventListener("click", () => send({ type: "browse", index: i }));

    const actions = li.querySelector(".actions");
    actions.appendChild(arrowButtons(config.shortcuts, i, renderShortcuts));
    const del = document.createElement("button");
    del.className = "icon danger";
    del.innerHTML = SVG.trash;
    del.title = "Remove";
    del.setAttribute("aria-label", "Remove shortcut");
    del.addEventListener("click", () => { config.shortcuts.splice(i, 1); markDirty(); renderShortcuts(); });
    actions.appendChild(del);

    makeDraggable(li, i, config.shortcuts, renderShortcuts);
    list.appendChild(li);
  });
}

$("add-shortcut").addEventListener("click", () => {
  config.shortcuts.push({ label: "New", icon: "app", target: "" });
  markDirty();
  renderShortcuts();
  const inputs = document.querySelectorAll("#shortcut-list .target-input");
  inputs[inputs.length - 1]?.focus();
});

$("shortcut-columns").addEventListener("input", (e) => {
  config.shortcutColumns = Number(e.target.value) || 3;
  markDirty();
});

/* General tab */
const SWITCHES = ["mouseGuard", "evictWindows", "noActivate", "devTools"];

function renderGeneral() {
  for (const key of SWITCHES) $(key).checked = !!config[key];
  $("startWithWindows").checked = startWithWindows;
  $("monitorName").value = config.monitor?.nameContains ?? "";
  $("sensorIntervalMs").value = config.sensorIntervalMs;
  $("shortcut-columns").value = config.shortcutColumns;
}

for (const key of SWITCHES) $(key).addEventListener("change", (e) => { config[key] = e.target.checked; markDirty(); });
$("startWithWindows").addEventListener("change", (e) => { startWithWindows = e.target.checked; markDirty(); });
$("monitorName").addEventListener("input", (e) => { config.monitor.nameContains = e.target.value; markDirty(); });
$("sensorIntervalMs").addEventListener("input", (e) => { config.sensorIntervalMs = Number(e.target.value) || 1000; markDirty(); });
$("open-folder").addEventListener("click", () => send({ type: "openConfigFolder" }));

/* Footer */
$("save").addEventListener("click", () => {
  const empty = config.shortcuts.filter((s) => !s.target?.trim()).length;
  send({ type: "save", config, startWithWindows });
  setStatus(empty ? `Saving… (${empty} shortcut(s) without a target were dropped)` : "Saving…", false, true);
});

$("close").addEventListener("click", () => {
  if (dirty && !confirm("Discard unsaved changes?")) return;
  send({ type: "close" });
});

/* Host bridge */
host?.addEventListener("message", (e) => {
  const msg = e.data ?? {};
  switch (msg.type) {
    case "state":
      config = msg.config;
      startWithWindows = msg.startWithWindows;
      $("version").textContent = `Version ${msg.version ?? ""}`;
      $("config-path").textContent = msg.configPath;
      renderLayout();
      renderShortcuts();
      renderGeneral();
      dirty = false;
      break;
    case "saved":
      setStatus("Saved and applied");
      setTimeout(() => { if (!dirty) setStatus(""); }, 2500);
      break;
    case "picked": {
      const s = config.shortcuts[msg.index];
      if (!s) break;
      s.target = msg.path;
      if (!s.label || s.label === "New") s.label = msg.path.split(/[\\/]/).pop().replace(/\.(exe|lnk|bat|cmd)$/i, "");
      markDirty();
      renderShortcuts();
      break;
    }
    case "error":
      setStatus(msg.message, true);
      break;
  }
});

send({ type: "ready" });
