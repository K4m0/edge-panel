"use strict";

// Web URL and SimHub: an iframe of a URL, zoomed, optionally reloaded on a timer.
(() => {
  const { h, hint } = window.EdgeW;

  function frame(el, url, zoom, refreshMin, iconName) {
    const u = String(url ?? "").trim();
    if (!/^https?:\/\/.+/i.test(u)) {
      el.innerHTML = hint(iconName, "Set a URL in Settings");
      return {};
    }
    const z = Math.max(0.25, Math.min(3, Number(zoom) || 1));
    const f = h("iframe", "frame-fill zoomed");
    f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"); // no top-navigation: a framed site must never replace the panel
    f.allow = "autoplay; fullscreen";
    f.style.setProperty("--zoom", z);
    f.src = u;
    el.classList.add("bleed");
    el.appendChild(f);
    const mins = Number(refreshMin) || 0;
    const timer = mins > 0 ? setInterval(() => { f.src = u; }, mins * 60000) : 0;
    return { destroy() { clearInterval(timer); f.src = "about:blank"; } };
  }

  window.EDGE_WIDGETS.webUrl = { create: (el, s) => frame(el, s.url, s.zoom, s.refreshMin, "globe") };
  window.EDGE_WIDGETS.simhub = { create: (el, s) => frame(el, s.url, s.zoom ?? 1, s.refreshMin ?? 0, "car") };
})();
