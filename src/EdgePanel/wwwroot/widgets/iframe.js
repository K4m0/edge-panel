"use strict";

(() => {
  const { h, hint } = window.EdgeW;

  window.EDGE_WIDGETS.iframe = {
    create(el, s) {
      if (!String(s.html ?? "").trim()) {
        el.innerHTML = hint("code", "Write some HTML in Settings");
        return {};
      }
      const f = h("iframe", "frame-fill");
      f.setAttribute("sandbox", "allow-scripts");
      f.srcdoc = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}</style>${s.html}`;
      el.classList.add("bleed");
      el.appendChild(f);
      return { destroy() { f.srcdoc = ""; } };
    },
  };
})();
