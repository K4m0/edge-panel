"use strict";

(() => {
  const { h, hint } = window.EdgeW;

  /** Accepts "name", "@name", "twitch.tv/name" or a full link (also popout/embed chat links). */
  function channelOf(input) {
    let v = String(input ?? "").trim();
    if (!v) return "";
    if (/twitch\.tv/i.test(v)) {
      try {
        const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
        const parts = u.pathname.split("/").filter(Boolean);
        v = (parts[0] === "popout" || parts[0] === "embed") ? parts[1] ?? "" : parts[0] ?? "";
      } catch { return ""; }
    }
    v = v.replace(/^@/, "").toLowerCase();
    return /^[a-z0-9_]{2,25}$/.test(v) ? v : "";
  }

  window.EDGE_WIDGETS.twitch = {
    channelOf,
    create(el, s) {
      const ch = channelOf(s.channel);
      if (!ch) {
        el.innerHTML = hint("twitch", s.channel ? "That is not a Twitch channel" : "Set a Twitch channel in Settings");
        return {};
      }
      const f = h("iframe", "frame-fill");
      f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"); // no top-navigation: a framed site must never replace the panel
      f.src = `https://www.twitch.tv/embed/${ch}/chat?parent=edge.panel${s.dark !== false ? "&darkpopout" : ""}`;
      el.classList.add("bleed");
      el.appendChild(f);
      return { destroy() { f.src = "about:blank"; } };
    },
  };
})();
