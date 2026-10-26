"use strict";

// Settings editor: Pages Personalization, Screen Setup, Device Settings and App Settings views.

(() => {
  const { h } = EP;

  EP.effectiveTheme = (page) => ({ ...EP.DEFAULT_THEME, ...EP.config.theme, ...(EP.config.themePerPage && page?.theme ? page.theme : {}) });

  const card = (title, desc, ...children) => h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h3", null, title), desc && h("p", { class: "muted small" }, desc)), ...children);

  const settingRow = (title, desc, control, tip) => h("div", { class: "setting" },
    h("div", { class: "setting-text" }, h("strong", null, title, tip && EP.infoTip(tip)), desc && h("small", null, desc)),
    h("div", { class: "setting-control" }, control));

  /** Edit a config property (top level or dotted path). */
  const setCfg = (path, value, typing) => EP.edit(() => EP.setPath(EP.config, path, value), { coalesce: typing ? `cfg:${path}` : null, render: "light" });

  /* =================== Pages Personalization =================== */

  const THEME_FIELDS = [
    { key: "background", label: "Device background color", type: "color", clearable: false },
    { key: "backgroundImage", label: "Background image", type: "media", accept: "image" },
    { key: "textColor", label: "Widget text color", type: "color", clearable: false },
    { key: "accentColor", label: "Widget accent color", type: "color", clearable: false },
    { key: "widgetBackground", label: "Widget background", type: "color", clearable: false },
    { key: "widgetOpacity", label: "Widget transparency", type: "range", min: 0, max: 100, step: 1, scale: 100, format: (v) => `${Math.round(v)}% opaque` },
    { key: "radius", label: "Corner radius", type: "range", min: 0, max: 48, step: 1, format: (v) => `${v}px` },
  ];

  const renderPages = () => {
    const box = EP.$("view-pages");
    const cfg = EP.config;
    const page = EP.page();
    const perPage = !!cfg.themePerPage;
    const usesPageTheme = perPage && !!page.theme;
    const target = () => (perPage ? (page.theme ?? cfg.theme) : cfg.theme);

    const ctx = {
      get: (k) => ({ ...EP.DEFAULT_THEME, ...target() })[k],
      set: (k, v, typing) => {
        const firstPageEdit = perPage && !page.theme;
        EP.edit(() => {
          if (perPage && !page.theme) page.theme = structuredClone({ ...EP.DEFAULT_THEME, ...cfg.theme });
          (perPage ? page.theme : cfg.theme)[k] = v;
        }, { coalesce: typing ? `theme:${perPage ? page.id : "global"}:${k}` : null, render: "light" });
        if (firstPageEdit) renderScope();
      },
    };

    const form = h("div", { class: "theme-form" });
    THEME_FIELDS.forEach((f) => {
      const row = f.type === "color"
        ? EP.fieldRow({ ...f, type: "themeColor" }, ctx)
        : EP.fieldRow(f, ctx);
      form.append(row);
    });

    const scope = h("div", { class: "scope" });
    const renderScope = () => {
      if (!perPage) {
        scope.replaceChildren(h("p", { class: "muted small" }, "Editing the global theme, used by every page."));
        return;
      }
      scope.replaceChildren(
        h("p", { class: "small" }, "Editing ", h("strong", null, `page ${EP.pageIndex + 1}${page.name ? " · " + page.name : ""}`),
          page.theme ? "" : h("span", { class: "muted" }, " (still using the global theme)")),
        h("div", { class: "row" },
          h("button", { type: "button", class: "btn small", onclick: () => {
            EP.edit(() => { page.theme = structuredClone({ ...EP.DEFAULT_THEME, ...cfg.theme }); }, { render: "none" });
            renderPages(); EP.renderLight(); EP.toast("Copied the global theme to this page.");
          } }, "Copy from global"),
          page.theme && h("button", { type: "button", class: "btn small ghost", onclick: () => {
            EP.edit(() => { page.theme = null; }, { render: "none" });
            renderPages(); EP.renderLight();
          } }, "Use global theme")));
    };
    renderScope();

    box.replaceChildren(h("div", { class: "cards two" },
      card("Theme", "How widgets and the screen look. Widgets with Custom Style keep their own look.",
        settingRow("Theme per page", "Give each page its own colors and background. Use the page dots above to pick a page.",
          EP.toggle(perPage, (v) => { setCfg("themePerPage", v); renderPages(); }, "Theme per page")),
        scope, form),
      card("Preview tips", null,
        h("ul", { class: "tips" },
          h("li", null, "Changes show up right away in the preview above and on the Edge."),
          h("li", null, "Transparency lets the device background or image show through the widgets."),
          h("li", null, usesPageTheme ? "This page overrides the global theme." : "Pages without their own theme use the global one.")))));
  };

  // Theme colors are always set (no "default" state): a non-clearable color input.
  EP.FIELDS.themeColor = (f, ctx) => EP.colorInput(ctx.get(f.key) ?? "", (v, typing) => ctx.set(f.key, v, typing), { clearable: false, label: f.label });

  /* =================== Screen Setup =================== */

  const renderScreen = () => {
    const c = EP.config;
    const hk = (key, title, desc) => settingRow(title, desc, EP.keyRecorder({
      value: c.hotkeys?.[key] ?? "", label: title, placeholder: "Disabled",
      onChange: (v, typing) => setCfg(`hotkeys.${key}`, v, typing),
    }));
    const monitorName = h("input", { type: "text", value: c.monitor?.nameContains ?? "", spellcheck: "false", "aria-label": "Monitor name contains",
      oninput: () => setCfg("monitor.nameContains", monitorName.value, true) });

    EP.$("view-screen").replaceChildren(h("div", { class: "cards" },
      card("Display mode", "Use the Edge as a widget panel, or hand it back to Windows as a normal monitor.",
        EP.segmented([["panel", "Edge Panel widgets"], ["desktop", "Desktop"]], c.displayMode ?? "panel", (v) => setCfg("displayMode", v), { label: "Display mode" })),
      card("Hotkeys", "Work anywhere in Windows. Click Record and press the keys, or type a combination such as Ctrl+Alt+Right.",
        hk("toggleMode", "Switch display mode", "Toggle between widgets and desktop."),
        hk("prevPage", "Previous page", null),
        hk("nextPage", "Next page", null)),
      card("Behavior", null,
        settingRow("Block cursor access", "The mouse can't enter the Edge. Touch still works.",
          EP.toggle(c.mouseGuard, (v) => setCfg("mouseGuard", v), "Block cursor access"),
          "Stops the mouse pointer at the edge of your main screen so it can't wander onto the XENEON EDGE while you play. Touch input on the Edge is not affected."),
        settingRow("Keep other windows off the Edge", "Windows that land on the Edge move back to the main display.",
          EP.toggle(c.evictWindows, (v) => setCfg("evictWindows", v), "Keep other windows off the Edge")),
        settingRow("Don't take focus", "Touching the Edge doesn't pull focus away from your game or app.",
          EP.toggle(c.noActivate, (v) => setCfg("noActivate", v), "Don't take focus"))),
      card("Monitor", "Edge Panel finds the Edge by its monitor name.",
        settingRow("Monitor name contains", null, h("div", { class: "row" }, monitorName,
          h("button", { type: "button", class: "btn", html: `${EP.ui("refresh")}<span>Re-detect</span>`, onclick: () => { EP.send({ type: "redetect" }); EP.toast("Looking for the Edge…"); } }))))));
  };

  /* =================== Device Settings =================== */

  const DEVICE_KEYS = [["brightness", "Brightness", "sun"], ["contrast", "Contrast", "monitor"], ["red", "Red", null], ["green", "Green", null], ["blue", "Blue", null]];
  const throttles = {};
  const sendDevice = (key, value) => {
    const t = (throttles[key] ??= { last: 0, timer: 0, value: 0 });
    t.value = value;
    const now = Date.now();
    clearTimeout(t.timer);
    if (now - t.last >= 120) { t.last = now; EP.send({ type: "setDevice", key, value }); }
    else t.timer = setTimeout(() => { t.last = Date.now(); EP.send({ type: "setDevice", key, value: t.value }); }, 120 - (now - t.last));
  };

  const renderDevice = () => {
    const box = EP.$("view-device");
    const d = EP.device;
    if (!d) {
      box.replaceChildren(h("div", { class: "cards" }, card("Display", null, h("p", { class: "muted" }, EP.host ? "Reading the Edge's display settings…" : "Device settings need the Edge Panel app."))));
      return;
    }
    if (!d.supported) {
      box.replaceChildren(h("div", { class: "cards" }, card("Display", null,
        h("div", { class: "note" }, EP.uiEl("info"), h("p", null, "The Edge doesn't answer DDC/CI commands, so brightness and color can't be changed from here. Check that DDC/CI is enabled in the monitor's on-screen menu, then reopen this page.")),
        h("button", { type: "button", class: "btn", onclick: () => { EP.device = null; renderDevice(); EP.send({ type: "getDevice" }); } }, "Try again"))));
      return;
    }
    const sliders = DEVICE_KEYS.filter(([k]) => d[k]).map(([k, label, icon]) => {
      const v = d[k];
      const s = EP.slider({ value: v.value, min: v.min ?? 0, max: v.max ?? 100, step: 1, label, onInput: (x) => { v.value = x; sendDevice(k, x); } });
      s.classList.add(`dev-${k}`);
      return settingRow(label, null, s);
    });
    box.replaceChildren(h("div", { class: "cards" },
      card("Display", "Changes go straight to the Edge over DDC/CI.", ...sliders.slice(0, 2)),
      card("Color balance", "Red, green and blue gain.", ...sliders.slice(2),
        h("div", { class: "row end" }, h("button", { type: "button", class: "btn", onclick: async () => {
          if (!(await EP.confirm("Restore the Edge's factory color settings?", "Restore"))) return;
          EP.send({ type: "restoreDevice" });
          setTimeout(() => EP.send({ type: "getDevice" }), 700);
          EP.toast("Restoring defaults…");
        } }, "Restore to default")))));
  };

  /* =================== App Settings =================== */

  const renderApp = () => {
    const c = EP.config;
    const interval = h("input", { type: "number", min: 250, max: 10000, step: 250, value: c.sensorIntervalMs ?? 1000, "aria-label": "Sensor refresh in milliseconds" });
    interval.addEventListener("change", () => {
      const v = EP.clamp(Math.round(Number(interval.value) || 1000), 250, 10000);
      interval.value = v;
      setCfg("sensorIntervalMs", v);
    });
    EP.$("view-app").replaceChildren(h("div", { class: "cards" },
      card("Startup", null,
        settingRow("Start with Windows", "Launch Edge Panel when you sign in.",
          EP.toggle(EP.startWithWindows, (v) => EP.edit(() => { EP.startWithWindows = v; }, { render: "light" }), "Start with Windows"))),
      card("Advanced", null,
        settingRow("Sensor refresh", "How often hardware sensors are read (milliseconds).", h("div", { class: "num" }, interval, h("span", { class: "unit" }, "ms"))),
        settingRow("Developer tools", "F12 on the panel. Applies after restart.", EP.toggle(c.devTools, (v) => setCfg("devTools", v), "Developer tools"))),
      card("About", null,
        settingRow("Settings file", null, h("div", { class: "row" }, h("code", { class: "path", title: EP.configPath }, EP.configPath || "—"),
          h("button", { type: "button", class: "btn", html: `${EP.ui("folder")}<span>Open folder</span>`, onclick: () => EP.send({ type: "openConfigFolder" }) }))),
        settingRow("Version", null, h("span", { class: "version" }, EP.version || "—")))));
  };

  EP.otherViews = { pages: renderPages, screen: renderScreen, device: renderDevice, app: renderApp };
})();
