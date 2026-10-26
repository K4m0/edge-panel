"use strict";

// Settings editor: form generated from catalog `fields` (see docs/ARCHITECTURE.md, "Widget catalog").
// A form context is { get(key), set(key, value, typing), widgetId?, onChange?() }.

(() => {
  const { h } = EP;
  let uid = 0;
  const nextId = (p = "f") => `${p}${++uid}`;

  /* ---------- Time zones ---------- */

  let zoneOptions = null;
  const offsetLabel = (zone, now) => {
    try {
      const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
        .formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
      const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
      const mins = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
      const abs = Math.abs(mins);
      return { mins, label: `UTC${mins < 0 ? "−" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}` };
    } catch {
      return { mins: 0, label: "UTC" };
    }
  };
  EP.timeZoneOptions = () => {
    if (zoneOptions) return zoneOptions;
    const now = new Date();
    let zones = [];
    try { zones = Intl.supportedValuesOf("timeZone"); } catch { zones = ["UTC"]; }
    if (!zones.includes("UTC")) zones.push("UTC");
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    zoneOptions = [["", `Local (${local ?? "this PC"})`], ...zones
      .map((z) => ({ z, ...offsetLabel(z, now) }))
      .sort((a, b) => a.mins - b.mins || a.z.localeCompare(b.z))
      .map(({ z, label }) => [z, `(${label}) ${z.replaceAll("_", " ")}`])];
    return zoneOptions;
  };

  /* ---------- Field rows ---------- */

  const STACKED = new Set(["textarea", "sensors", "apps", "buttons", "mediaList", "city", "media"]);

  const showIfOk = (field, ctx) => !field.showIf || Object.entries(field.showIf).every(([k, v]) => {
    const cur = ctx.get(k);
    return Array.isArray(v) ? v.some((x) => String(x) === String(cur)) : String(cur) === String(v);
  });

  /** Renders the fields; returns a container that re-evaluates `showIf` after each change. */
  EP.renderForm = (fields, ctx) => {
    const box = h("div", { class: "form" });
    const rows = [];
    const refresh = () => rows.forEach(([f, row]) => (row.hidden = !showIfOk(f, ctx)));
    const inner = { ...ctx, set: (k, v, typing) => { ctx.set(k, v, typing); refresh(); ctx.onChange?.(k); } };
    for (const f of fields) {
      const row = EP.fieldRow(f, inner);
      rows.push([f, row]);
      box.append(row);
    }
    refresh();
    return box;
  };

  EP.fieldRow = (f, ctx) => {
    const id = nextId();
    const render = FIELDS[f.type] ?? FIELDS.text;
    const control = render(f, ctx, id);
    const kind = f.type === "toggle" ? "inline" : STACKED.has(f.type) ? "stacked" : "normal";
    const labelEl = ["sensors", "apps", "buttons", "mediaList", "segmented", "color", "media", "city", "sensor"].includes(f.type)
      ? h("span", { class: "field-label", id: `${id}-l` }, f.label, f.help && EP.infoTip(f.help))
      : h("label", { class: "field-label", for: id, id: `${id}-l` }, f.label, f.help && EP.infoTip(f.help));
    control.setAttribute?.("aria-labelledby", `${id}-l`);
    return h("div", { class: `field ${kind} t-${f.type}` }, labelEl, h("div", { class: "field-control" }, control));
  };

  /* ---------- Field types ---------- */

  const textLike = (type) => (f, ctx, id) => {
    const input = h(type === "textarea" ? "textarea" : "input", {
      id, type: type === "textarea" ? null : type === "url" ? "url" : "text", value: ctx.get(f.key) ?? "",
      placeholder: f.placeholder ?? (type === "url" ? "https://" : ""), spellcheck: type === "text" ? "true" : "false",
      rows: type === "textarea" ? 6 : null, class: type === "textarea" ? "code" : null,
    });
    if (type === "textarea") input.value = ctx.get(f.key) ?? "";
    input.addEventListener("input", () => ctx.set(f.key, input.value, true));
    return input;
  };

  const FIELDS = {
    text: textLike("text"),
    url: textLike("url"),
    textarea: textLike("textarea"),

    number(f, ctx, id) {
      const input = h("input", { id, type: "number", min: f.min, max: f.max, step: f.step ?? "any", value: ctx.get(f.key) ?? "" });
      input.addEventListener("input", () => {
        const v = Number(input.value);
        if (input.value !== "" && Number.isFinite(v)) ctx.set(f.key, v, true);
      });
      input.addEventListener("change", () => {
        let v = Number(input.value);
        if (input.value === "" || !Number.isFinite(v)) v = Number(ctx.get(f.key) ?? f.min ?? 0);
        if (f.min != null) v = Math.max(f.min, v);
        if (f.max != null) v = Math.min(f.max, v);
        input.value = v;
        ctx.set(f.key, v, true);
      });
      return h("div", { class: "num" }, input, f.unit && h("span", { class: "unit" }, f.unit));
    },

    toggle(f, ctx, id) {
      const t = EP.toggle(ctx.get(f.key), (v) => ctx.set(f.key, v), f.label);
      t.id = id;
      return t;
    },

    select(f, ctx, id) {
      const options = f.options === "timeZones" ? EP.timeZoneOptions() : f.options ?? [];
      const cur = ctx.get(f.key) ?? "";
      const sel = h("select", { id }, options.map(([v, label]) => h("option", { value: String(v), selected: String(v) === String(cur) }, label)));
      if (!options.some(([v]) => String(v) === String(cur))) sel.prepend(h("option", { value: String(cur), selected: true }, String(cur) || "—"));
      sel.addEventListener("change", () => {
        const opt = options.find(([v]) => String(v) === sel.value);
        ctx.set(f.key, opt ? opt[0] : sel.value);
      });
      return sel;
    },

    segmented(f, ctx) {
      return EP.segmented(f.options ?? [], ctx.get(f.key), (v) => ctx.set(f.key, v), { label: f.label });
    },

    color(f, ctx) {
      return EP.colorInput(ctx.get(f.key) ?? "", (v, typing) => ctx.set(f.key, v, typing), { label: f.label, fallback: f.fallback ?? "#2bd4e0" });
    },

    range(f, ctx, id) {
      const r = EP.slider({
        value: ctx.get(f.key) ?? f.fallback ?? f.min, min: f.min, max: f.max, step: f.step ?? 1, format: f.format ?? ((v) => v), label: f.label,
        onInput: (v) => ctx.set(f.key, f.scale ? v / f.scale : v, true),
      });
      r.input.id = id;
      if (f.scale) r.set(Math.round((ctx.get(f.key) ?? f.fallback ?? 1) * f.scale));
      return r;
    },

    sensor(f, ctx) {
      return EP.sensorPicker(ctx.get(f.key) ?? "", (v) => ctx.set(f.key, v), f.label);
    },

    media(f, ctx) {
      return EP.mediaPicker(ctx.get(f.key) ?? "", (v) => ctx.set(f.key, v), f.accept ?? "media");
    },

    city(f, ctx) {
      return cityField(f, ctx);
    },

    sensors(f, ctx) {
      return listField(f, ctx, {
        addLabel: "Add sensor",
        empty: "No sensors yet.",
        make: () => ({ sensor: "cpu.load", name: "" }),
        row: (item, i, commit) => {
          const nameInput = h("input", { type: "text", value: item.name ?? "", placeholder: "Display name", "aria-label": `Sensor ${i + 1} name`,
            oninput: () => { item.name = nameInput.value; commit(`name${i}`); } });
          const picker = EP.sensorPicker(item.sensor ?? "", (v) => {
            const prevName = EP.sensorInfo(item.sensor)?.name;
            item.sensor = v;
            if (!item.name || item.name === prevName) { item.name = EP.sensorInfo(v)?.name ?? item.name; nameInput.value = item.name; }
            commit();
          }, `Sensor ${i + 1}`);
          return h("div", { class: "row two" }, picker, nameInput);
        },
      });
    },

    apps(f, ctx) {
      return listField(f, ctx, {
        addLabel: "Add app",
        empty: "No apps yet. Add one, then Browse… for a program or type a URL such as spotify:",
        make: () => ({ label: "", target: "", args: "" }),
        row: (item, i, commit) => {
          const label = h("input", { type: "text", value: item.label ?? "", placeholder: "Label", "aria-label": `App ${i + 1} label`,
            oninput: () => { item.label = label.value; commit(`label${i}`); } });
          const target = h("input", { type: "text", value: item.target ?? "", placeholder: "Program, file, URL or app link", spellcheck: "false", "aria-label": `App ${i + 1} target`,
            oninput: () => { item.target = target.value; commit(`target${i}`); } });
          const args = h("input", { type: "text", value: item.args ?? "", placeholder: "Arguments (optional)", spellcheck: "false", "aria-label": `App ${i + 1} arguments`,
            oninput: () => { item.args = args.value; commit(`args${i}`); } });
          const browse = h("button", { type: "button", class: "btn small", onclick: async () => {
            const r = await EP.browse("app");
            if (!r?.path) return;
            item.target = r.path;
            target.value = r.path;
            if (!item.label) { item.label = (r.name ?? r.path.split(/[\\/]/).pop()).replace(/\.(exe|lnk|url|bat|cmd)$/i, ""); label.value = item.label; }
            commit();
          } }, "Browse…");
          return [
            appIcon(`${ctx.widgetId}:${i}`),
            h("div", { class: "stack" }, label, h("div", { class: "row" }, target, browse), args),
          ];
        },
      });
    },

    buttons(f, ctx) {
      return buttonsField(f, ctx);
    },

    mediaList(f, ctx) {
      return mediaListField(f, ctx);
    },
  };
  EP.FIELDS = FIELDS;

  /* ---------- Shared pieces ---------- */

  function appIcon(key) {
    const box = h("div", { class: "app-icon", "data-appicon": key });
    EP.paintAppIcon(box);
    return box;
  }
  EP.paintAppIcon = (box) => {
    const url = EP.live.appIcons?.[box.dataset.appicon];
    box.innerHTML = url ? `<img alt="" src="${url}">` : EP.ui("app");
  };

  /** Generic list editor with reorder / remove / add. `row` returns the row's controls. */
  function listField(f, ctx, { row, make, addLabel, empty }) {
    const box = h("div", { class: "list-ed" });
    let items = structuredClone(ctx.get(f.key) ?? []);
    const commit = (typing) => ctx.set(f.key, structuredClone(items), typing ? `${f.key}:${typing}` : false);
    const render = (focus) => {
      const ul = h("ul", { class: "list-rows" });
      items.forEach((item, i) => {
        ul.append(h("li", { class: "list-row", dataset: { row: i } },
          h("span", { class: "row-num" }, i + 1),
          h("div", { class: "row-body" }, row(item, i, commit)),
          h("div", { class: "row-ctl" },
            ctl("up", `Move up`, i, i === 0, () => move(i, -1)),
            ctl("down", `Move down`, i, i === items.length - 1, () => move(i, 1)),
            ctl("trash", `Remove`, i, false, () => { items.splice(i, 1); commit(); render({ i: Math.min(i, items.length - 1), c: "trash" }); }, "danger"))));
      });
      box.replaceChildren(
        items.length ? ul : h("p", { class: "muted small" }, empty),
        h("button", { type: "button", class: "btn small add", html: `${EP.ui("plus")}<span>${addLabel}</span>`,
          onclick: () => { items.push(make()); commit(); render({ i: items.length - 1, c: "first" }); } }));
      if (focus) {
        const li = box.querySelector(`[data-row="${focus.i}"]`);
        (focus.c === "first" ? li?.querySelector("input, button") : li?.querySelector(`[data-ctl="${focus.c}"]`) ?? li?.querySelector("button"))?.focus();
      }
    };
    const move = (i, d) => {
      const [it] = items.splice(i, 1);
      items.splice(i + d, 0, it);
      commit();
      render({ i: i + d, c: d < 0 ? "up" : "down" });
    };
    const ctl = (icon, label, i, disabled, onclick, cls = "") => {
      const b = EP.iconBtn(icon, `${label} (item ${i + 1})`, onclick, { disabled, class: cls });
      b.dataset.ctl = icon;
      return b;
    };
    render();
    return box;
  }

  /* ---------- Sensor picker ---------- */

  EP.sensorPicker = (value, onChange, label = "Sensor") => {
    const btn = h("button", { type: "button", class: "picker sensor-pick", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": label });
    const paint = () => {
      const s = EP.sensorInfo(value);
      btn.replaceChildren(
        h("span", { class: "pick-main" },
          h("span", { class: "pick-name" }, s?.name ?? (value || "Choose a sensor")),
          h("span", { class: "pick-sub" }, s ? `${s.hardware ?? ""}${s.type ? " · " + s.type : ""}` : value ? "Not available on this PC" : "")),
        h("span", { class: "live", "data-live-sensor": value }, value ? EP.fmtSensor(value) : ""),
        EP.uiEl("chevron", "chev"));
      btn.title = value || "";
    };
    paint();
    btn.addEventListener("click", () => {
      const search = h("input", { type: "search", placeholder: "Search sensors (name, hardware, type)", "aria-label": "Search sensors", role: "combobox", "aria-autocomplete": "list" });
      const list = h("div", { class: "pick-list", role: "listbox", "aria-label": "Sensors" });
      search.setAttribute("aria-controls", (list.id = nextId("lb")));
      const pick = (id) => { value = id; paint(); pop.close(); btn.focus(); onChange(id); };
      const fill = () => {
        const q = search.value.trim().toLowerCase();
        const all = EP.sensors();
        const hits = all.filter((s) => !q || `${s.name} ${s.hardware} ${s.type} ${s.id}`.toLowerCase().includes(q)).slice(0, 250);
        list.replaceChildren();
        let lastHw = null;
        for (const s of hits) {
          const hw = s.hardware || "Other";
          if (hw !== lastHw) { list.append(h("div", { class: "pick-group", role: "presentation" }, hw)); lastHw = hw; }
          const opt = h("div", {
            role: "option", id: nextId("o"), class: `pick-opt ${s.id === value ? "current" : ""}`, "aria-selected": String(s.id === value), title: s.id,
            onclick: () => pick(s.id),
          },
          h("span", { class: "pick-main" }, h("span", { class: "pick-name" }, s.name), h("span", { class: "pick-sub" }, `${s.type ?? ""}${s.unit ? " (" + s.unit + ")" : ""}`)),
          h("span", { class: "live", "data-live-sensor": s.id }, EP.fmtSensor(s.id)));
          opt.dataset.id = s.id;
          list.append(opt);
        }
        if (!hits.length) {
          list.append(h("div", { class: "pick-empty" }, q ? "No sensor matches." : "No sensors reported yet."));
          if (q.length > 2 && /[./]/.test(q)) {
            const raw = search.value.trim();
            const opt = h("div", { role: "option", id: nextId("o"), class: "pick-opt", onclick: () => pick(raw) }, `Use “${raw}” as sensor id`);
            opt.dataset.id = raw;
            list.append(opt);
          }
        }
        list.querySelector(".pick-opt")?.classList.add("active");
      };
      search.addEventListener("input", fill);
      EP.listNav(search, list, (o) => pick(o.dataset.id));
      fill();
      const pop = EP.popover(btn, [search, list], { class: "sensor-pop", width: Math.max(btn.offsetWidth, 360) });
      list.querySelector(".current")?.scrollIntoView({ block: "center" });
      search.focus();
    });
    return btn;
  };

  /* ---------- Media ---------- */

  EP.mediaPicker = (value, onChange, accept = "media") => {
    const box = h("div", { class: "media-pick" });
    const render = () => {
      box.replaceChildren(
        EP.mediaThumb(value),
        h("div", { class: "media-meta" },
          h("span", { class: "media-name", title: value || "" }, value || "No file"),
          h("div", { class: "row" },
            h("button", { type: "button", class: "btn small", onclick: async () => {
              const r = await EP.browse(accept);
              if (r?.media) { value = r.media; render(); onChange(value); }
            } }, value ? "Change…" : "Choose…"),
            value && h("button", { type: "button", class: "btn small ghost", onclick: () => { value = ""; render(); onChange(""); } }, "Clear"))));
    };
    render();
    return box;
  };

  function mediaListField(f, ctx) {
    const box = h("div", { class: "media-list" });
    let items = [...(ctx.get(f.key) ?? [])];
    const commit = () => ctx.set(f.key, [...items]);
    const render = (focusIdx) => {
      const grid = h("ul", { class: "thumb-grid" });
      items.forEach((name, i) => {
        grid.append(h("li", { class: "thumb-item", dataset: { row: i } },
          EP.mediaThumb(name),
          h("div", { class: "thumb-ctl" },
            EP.iconBtn("left", `Move image ${i + 1} earlier`, () => mv(i, -1), { disabled: i === 0 }),
            EP.iconBtn("right", `Move image ${i + 1} later`, () => mv(i, 1), { disabled: i === items.length - 1 }),
            EP.iconBtn("trash", `Remove image ${i + 1}`, () => { items.splice(i, 1); commit(); render(Math.min(i, items.length - 1)); }, { class: "danger" }))));
      });
      grid.append(h("li", { class: "thumb-item add" },
        h("button", { type: "button", class: "thumb-add", "aria-label": "Add images", html: `${EP.ui("plus")}<span>Add</span>`, onclick: async () => {
          const r = await EP.browse(f.accept ?? "image");
          if (r?.media) { items.push(r.media); commit(); render(); }
        } })));
      box.replaceChildren(grid, h("p", { class: "muted small" }, `${items.length} file${items.length === 1 ? "" : "s"}`));
      if (focusIdx != null) box.querySelector(`[data-row="${focusIdx}"] button:not(:disabled)`)?.focus();
    };
    const mv = (i, d) => { const [x] = items.splice(i, 1); items.splice(i + d, 0, x); commit(); render(i + d); };
    render();
    return box;
  }

  /* ---------- City (Open-Meteo geocoding) ---------- */

  function cityField(f, ctx) {
    const box = h("div", { class: "city" });
    let value = ctx.get(f.key);
    const current = h("div", { class: "city-current" });
    const paintCurrent = () => {
      current.replaceChildren(EP.uiEl("pin"),
        h("span", { class: "city-name" }, value?.name ?? "No city selected",
          value && h("small", null, `${Number(value.lat).toFixed(2)}, ${Number(value.lon).toFixed(2)}`)),
        value && EP.iconBtn("close", "Clear city", () => { value = null; paintCurrent(); ctx.set(f.key, null); }));
    };
    paintCurrent();
    const input = h("input", { type: "search", placeholder: "Search a city…", "aria-label": "Search a city" });
    const results = h("ul", { class: "city-results", role: "listbox", "aria-label": "City results" });
    let timer, seq = 0;
    const search = async () => {
      const q = input.value.trim();
      if (q.length < 2) { results.replaceChildren(); return; }
      const my = ++seq;
      results.replaceChildren(h("li", { class: "muted small" }, "Searching…"));
      try {
        const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`);
        const data = await r.json();
        if (my !== seq) return;
        const list = data.results ?? [];
        results.replaceChildren(...(list.length ? list.map((c) => h("li", {
          role: "option", tabindex: "0", class: "city-opt",
          onclick: () => choose(c), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(c); } },
        }, h("span", null, c.name), h("small", null, [c.admin1, c.country].filter(Boolean).join(", ")))) : [h("li", { class: "muted small" }, "No city found.")]));
      } catch {
        if (my === seq) results.replaceChildren(h("li", { class: "muted small error" }, "Could not reach the geocoding service."));
      }
    };
    const choose = (c) => {
      value = { name: `${c.name}, ${c.country ?? c.country_code ?? ""}`.replace(/, $/, ""), lat: Math.round(c.latitude * 1e4) / 1e4, lon: Math.round(c.longitude * 1e4) / 1e4 };
      input.value = "";
      results.replaceChildren();
      paintCurrent();
      ctx.set(f.key, value);
    };
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 450); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); search(); }
      if (e.key === "ArrowDown") { e.preventDefault(); results.querySelector(".city-opt")?.focus(); }
    });
    results.addEventListener("keydown", (e) => {
      if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
      e.preventDefault();
      const opts = [...results.querySelectorAll(".city-opt")];
      const i = opts.indexOf(document.activeElement) + (e.key === "ArrowDown" ? 1 : -1);
      (i < 0 ? input : opts[Math.min(i, opts.length - 1)]).focus();
    });
    box.append(current, h("div", { class: "row" }, input, h("button", { type: "button", class: "btn small", onclick: search }, "Search")), results);
    return box;
  }

  /* ---------- Deck buttons ---------- */

  const ACTION_KINDS = [["launch", "Launch app"], ["keys", "Key combination"], ["media", "Media key"], ["url", "Open URL"], ["text", "Type text"], ["page", "Go to page"]];
  const expanded = new Map(); // widgetId -> open button index

  const actionSummary = (a, mediaActions) => {
    switch (a?.kind) {
      case "launch": return a.target ? `Launch ${a.target.split(/[\\/]/).pop()}` : "Launch (no target)";
      case "keys": return a.value ? `Keys ${a.value}` : "Keys (not set)";
      case "media": return (mediaActions.find(([v]) => v === a.value)?.[1]) ?? "Media";
      case "url": return a.value || "URL";
      case "text": return a.value ? `Type “${a.value.slice(0, 18)}${a.value.length > 18 ? "…" : ""}”` : "Type text";
      case "page": {
        const p = EP.config.pages[Number(a.value)];
        return `Go to page ${Number(a.value) + 1}${p?.name ? " · " + p.name : ""}`;
      }
      default: return "No action";
    }
  };

  EP.iconPicker = (value, onChange, label = "Icon") => {
    const btn = h("button", { type: "button", class: "picker icon-pick", "aria-haspopup": "listbox", "aria-label": label });
    const paint = () => btn.replaceChildren(h("span", { class: "icon-prev", html: value ? EP.edgeIcon(value) : "" }), h("span", { class: "pick-name" }, value || "None"), EP.uiEl("chevron", "chev"));
    paint();
    btn.addEventListener("click", () => {
      const search = h("input", { type: "search", placeholder: "Search icons", "aria-label": "Search icons" });
      const grid = h("div", { class: "icon-grid", role: "listbox", "aria-label": "Icons" });
      const pick = (name) => { value = name; paint(); pop.close(); btn.focus(); onChange(name); };
      const fill = () => {
        const q = search.value.trim().toLowerCase();
        grid.replaceChildren(h("button", { type: "button", role: "option", class: `icon-opt ${!value ? "current" : ""}`, title: "No icon", onclick: () => pick("") }, "∅"),
          ...Object.keys(window.EDGE_ICONS ?? {}).filter((k) => !q || k.toLowerCase().includes(q)).map((k) =>
            h("button", { type: "button", role: "option", class: `icon-opt ${k === value ? "current" : ""}`, title: k, "aria-label": k, html: EP.edgeIcon(k), onclick: () => pick(k) })));
      };
      search.addEventListener("input", fill);
      search.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); grid.querySelector("button")?.focus(); } });
      grid.addEventListener("keydown", (e) => {
        const all = [...grid.querySelectorAll("button")];
        const i = all.indexOf(document.activeElement);
        const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 }[e.key];
        if (step && i >= 0) { e.preventDefault(); all[EP.clamp(i + step, 0, all.length - 1)].focus(); }
      });
      fill();
      const pop = EP.popover(btn, [search, grid], { class: "icon-pop", width: 340 });
      search.focus();
    });
    return btn;
  };

  function buttonsField(f, ctx) {
    const mediaActions = f.mediaActions ?? [["toggle", "Play / pause"], ["next", "Next track"], ["prev", "Previous track"], ["volup", "Volume up"], ["voldown", "Volume down"], ["mute", "Mute"]];
    const wid = ctx.widgetId;
    const box = h("div", { class: "deck-ed" });
    let items = structuredClone(ctx.get(f.key) ?? []);
    const commit = (typing) => ctx.set(f.key, structuredClone(items), typing ? `${f.key}:${typing}` : false);

    const render = (focus) => {
      const open = expanded.get(wid) ?? -1;
      const ul = h("ul", { class: "deck-list" });
      items.forEach((b, i) => {
        const isOpen = i === open;
        const tile = h("span", { class: "deck-tile", style: { "--c": b.color || "#3a4352" }, html: b.icon ? EP.edgeIcon(b.icon) : "" },
          b.action?.kind === "launch" ? h("img", { class: "deck-app-icon", alt: "", src: EP.live.appIcons?.[`${wid}:${i}`] ?? "", hidden: !EP.live.appIcons?.[`${wid}:${i}`] }) : null);
        const summary = h("span", { class: "deck-sum" }, h("span", { class: "deck-label" }, b.label || `Button ${i + 1}`), h("small", null, actionSummary(b.action, mediaActions)));
        const head = h("div", { class: "deck-head" },
          h("button", { type: "button", class: "deck-toggle", "aria-expanded": String(isOpen), dataset: { ctl: "open" },
            onclick: () => { expanded.set(wid, isOpen ? -1 : i); render({ i, c: "open" }); } }, tile, summary, EP.uiEl("chevron", `chev ${isOpen ? "open" : ""}`)),
          h("div", { class: "row-ctl" },
            ctlBtn("up", `Move button ${i + 1} up`, i === 0, () => move(i, -1)),
            ctlBtn("down", `Move button ${i + 1} down`, i === items.length - 1, () => move(i, 1)),
            ctlBtn("trash", `Remove button ${i + 1}`, false, () => {
              items.splice(i, 1);
              if (open >= i) expanded.set(wid, open === i ? -1 : open - 1);
              commit();
              render({ i: Math.min(i, items.length - 1), c: "open" });
            }, "danger")));
        ul.append(h("li", { class: `deck-item ${isOpen ? "open" : ""}`, dataset: { row: i } }, head, isOpen && editor(b, i, tile, summary)));
      });
      box.replaceChildren(
        items.length ? ul : h("p", { class: "muted small" }, "No buttons yet."),
        h("button", { type: "button", class: "btn small add", html: `${EP.ui("plus")}<span>Add button</span>`, onclick: () => {
          items.push({ label: "New", icon: "app", color: "#4c8df2", action: { kind: "keys", value: "" } });
          expanded.set(wid, items.length - 1);
          commit();
          render({ i: items.length - 1, c: "first" });
        } }));
      if (focus) {
        const li = box.querySelector(`[data-row="${focus.i}"]`);
        (focus.c === "first" ? li?.querySelector(".deck-body input") : li?.querySelector(`[data-ctl="${focus.c}"]`))?.focus();
      }
    };

    const ctlBtn = (icon, label, disabled, onclick, cls = "") => {
      const b = EP.iconBtn(icon, label, onclick, { disabled, class: cls });
      b.dataset.ctl = icon;
      return b;
    };
    const move = (i, d) => {
      const [b] = items.splice(i, 1);
      items.splice(i + d, 0, b);
      const open = expanded.get(wid);
      if (open === i) expanded.set(wid, i + d);
      else if (open === i + d) expanded.set(wid, i);
      commit();
      render({ i: i + d, c: d < 0 ? "up" : "down" });
    };

    const editor = (b, i, tile, summary) => {
      const refreshHead = () => {
        tile.style.setProperty("--c", b.color || "#3a4352");
        tile.querySelector("svg")?.remove();
        if (b.icon) tile.insertAdjacentHTML("afterbegin", EP.edgeIcon(b.icon));
        summary.querySelector(".deck-label").textContent = b.label || `Button ${i + 1}`;
        summary.querySelector("small").textContent = actionSummary(b.action, mediaActions);
      };
      const set = (typing) => { refreshHead(); commit(typing); };
      b.action ??= { kind: "keys", value: "" };
      const valueBox = h("div", { class: "action-value" });

      const paintValue = () => {
        const a = b.action;
        const lbl = (t, ...c) => h("div", { class: "sub-field" }, h("span", { class: "sub-label" }, t), ...c);
        let content;
        switch (a.kind) {
          case "launch": {
            const target = h("input", { type: "text", value: a.target ?? "", placeholder: "Program, file, URL or app link", spellcheck: "false", "aria-label": "Target",
              oninput: () => { a.target = target.value; set(`t${i}`); } });
            const args = h("input", { type: "text", value: a.args ?? "", placeholder: "Arguments (optional)", spellcheck: "false", "aria-label": "Arguments",
              oninput: () => { a.args = args.value; set(`a${i}`); } });
            content = [lbl("Target", h("div", { class: "row" }, target, h("button", { type: "button", class: "btn small", onclick: async () => {
              const r = await EP.browse("app");
              if (!r?.path) return;
              a.target = r.path;
              target.value = r.path;
              if (!b.label || b.label === "New") { b.label = (r.name ?? r.path.split(/[\\/]/).pop()).replace(/\.(exe|lnk|url)$/i, ""); labelInput.value = b.label; }
              set();
            } }, "Browse…"))), lbl("Arguments", args)];
            break;
          }
          case "keys":
            content = [lbl("Keys", EP.keyRecorder({ value: a.value ?? "", label: "Key combination", onChange: (v, typing) => { a.value = v; set(typing ? `k${i}` : false); } }))];
            break;
          case "media": {
            const sel = h("select", { "aria-label": "Media key" }, mediaActions.map(([v, t]) => h("option", { value: v, selected: v === a.value }, t)));
            sel.addEventListener("change", () => { a.value = sel.value; set(); });
            content = [lbl("Media key", sel)];
            break;
          }
          case "url": {
            const input = h("input", { type: "url", value: a.value ?? "", placeholder: "https://", spellcheck: "false", "aria-label": "URL", oninput: () => { a.value = input.value; set(`u${i}`); } });
            content = [lbl("URL", input)];
            break;
          }
          case "text": {
            const input = h("textarea", { rows: 2, "aria-label": "Text to type", oninput: () => { a.value = input.value; set(`x${i}`); } });
            input.value = a.value ?? "";
            content = [lbl("Text", input)];
            break;
          }
          case "page": {
            const sel = h("select", { "aria-label": "Page" }, EP.config.pages.map((p, pi) => h("option", { value: pi, selected: pi === Number(a.value) }, `${pi + 1} · ${p.name || "Page " + (pi + 1)}`)));
            sel.addEventListener("change", () => { a.value = Number(sel.value); set(); });
            content = [lbl("Page", sel)];
            break;
          }
        }
        valueBox.replaceChildren(...(content ?? []));
      };

      const kindSel = h("select", { "aria-label": "Action" }, ACTION_KINDS.map(([v, t]) => h("option", { value: v, selected: v === b.action.kind }, t)));
      kindSel.addEventListener("change", () => {
        const k = kindSel.value;
        b.action = k === "launch" ? { kind: k, target: "", args: "" }
          : k === "media" ? { kind: k, value: mediaActions[0][0] }
            : k === "page" ? { kind: k, value: 0 }
              : k === "url" ? { kind: k, value: "https://" } : { kind: k, value: "" };
        paintValue();
        set();
      });
      const labelInput = h("input", { type: "text", value: b.label ?? "", placeholder: "Label", "aria-label": "Label", oninput: () => { b.label = labelInput.value; set(`l${i}`); } });
      paintValue();
      return h("div", { class: "deck-body" },
        h("div", { class: "sub-field" }, h("span", { class: "sub-label" }, "Label"), labelInput),
        h("div", { class: "sub-grid" },
          h("div", { class: "sub-field" }, h("span", { class: "sub-label" }, "Icon"), EP.iconPicker(b.icon ?? "", (v) => { b.icon = v; set(); })),
          h("div", { class: "sub-field" }, h("span", { class: "sub-label" }, "Color"), EP.colorInput(b.color ?? "", (v, typing) => { b.color = v; set(typing ? `c${i}` : false); }, { label: "Button color", fallback: "#3a4352" }))),
        h("div", { class: "sub-field" }, h("span", { class: "sub-label" }, "Action"), kindSel),
        valueBox);
    };

    render();
    return box;
  }
})();
