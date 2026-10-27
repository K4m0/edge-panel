"use strict";

(() => {
  const { h, hint, tap, onResize, esc, hue, launchState } = window.EdgeW;

  /** Picks the column count that gives the biggest square tiles for n items in a w x h box. */
  function bestColumns(n, w, hgt) {
    let best = 1, size = 0;
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const s = Math.min(w / c, hgt / r);
      if (s > size + 0.5) { size = s; best = c; }
    }
    return best;
  }

  window.EDGE_WIDGETS.launcher = {
    bestColumns,
    create(el, s, ctx) {
      const apps = Array.isArray(s.apps) ? s.apps : [];
      if (!apps.length) {
        el.innerHTML = hint("apps", "Add apps in Settings");
        return {};
      }
      const root = h("div", `tiles launcher${s.showLabels ? " labels" : ""}`);
      el.appendChild(root);
      const states = [];
      const tiles = apps.map((app, i) => {
        const b = h("button", "tile");
        const label = app.label || app.target || "App";
        b.setAttribute("aria-label", label);
        b.innerHTML = `<span class="tile-icon"><span class="letter" style="--h:${hue(label)}">${esc(label.trim().charAt(0).toUpperCase())}</span></span>
          ${s.showLabels ? `<span class="tile-label">${esc(label)}</span>` : ""}`;
        const state = launchState(b);
        states[i] = state;
        tap(b, () => {
          if (state.busy) return; // already opening: don't launch twice
          b.classList.remove("fired"); void b.offsetWidth; b.classList.add("fired");
          state.start();
          ctx.send({ type: "launch", widgetId: ctx.id, index: i });
        });
        root.appendChild(b);
        return b;
      });

      let iconsSeen = null;
      const paintIcons = (icons) => {
        if (icons === iconsSeen) return;
        iconsSeen = icons;
        tiles.forEach((b, i) => {
          const url = icons?.[`${ctx.id}:${i}`];
          const box = b.querySelector(".tile-icon");
          const img = box.querySelector("img");
          if (url && img?.getAttribute("src") !== url) box.innerHTML = `<img src="${esc(url)}" alt="">`;
        });
      };

      const fixed = Math.max(0, Math.trunc(Number(s.columns) || 0));
      const stop = onResize(root, (w, hgt) => {
        const cols = fixed || bestColumns(apps.length, w, hgt);
        root.style.setProperty("--cols", Math.min(cols, apps.length));
        root.style.setProperty("--rows", Math.ceil(apps.length / Math.min(cols, apps.length)));
      });
      paintIcons(ctx.appIcons());
      return {
        update(kind, data) {
          if (kind === "appIcons") paintIcons(data);
          else if (kind === "launchState" && data.widgetId === ctx.id) states[data.index]?.set(data.state);
        },
        destroy: stop,
      };
    },
  };
})();
