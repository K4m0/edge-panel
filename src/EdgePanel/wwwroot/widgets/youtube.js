"use strict";

(() => {
  const { h, hint } = window.EdgeW;

  /** Returns { video, list } from a YouTube link (watch?v=, youtu.be/, shorts/, embed/, live/, playlist?list=). */
  function parse(input) {
    const raw = String(input ?? "").trim();
    if (!raw) return null;
    if (/^[\w-]{11}$/.test(raw)) return { video: raw, list: "" };
    let u;
    try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    const list = u.searchParams.get("list") ?? "";
    let video = "";
    if (host === "youtu.be") video = u.pathname.slice(1).split("/")[0];
    else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
      video = u.searchParams.get("v") ?? "";
      const m = /^\/(shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname);
      if (m) video = m[2];
    } else return null;
    if (!/^[\w-]{11}$/.test(video)) video = "";
    if (!video && !list) return null;
    return { video, list };
  }

  window.EDGE_WIDGETS.youtube = {
    parse,
    create(el, s) {
      const p = parse(s.url);
      if (!p) {
        el.innerHTML = hint("youtube", s.url ? "That is not a YouTube link" : "Paste a YouTube link in Settings");
        return {};
      }
      const q = new URLSearchParams({ autoplay: "1", mute: s.mute ? "1" : "0", playsinline: "1", controls: "1", rel: "0" });
      let path;
      if (p.video) {
        path = p.video;
        if (p.list) q.set("list", p.list);
        if (s.loop) { q.set("loop", "1"); if (!p.list) q.set("playlist", p.video); }
      } else {
        path = "videoseries";
        q.set("list", p.list);
        if (s.loop) q.set("loop", "1");
      }
      const f = h("iframe", "frame-fill");
      f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"); // no top-navigation: a framed site must never replace the panel
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      f.referrerPolicy = "strict-origin-when-cross-origin";
      f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(path)}?${q}`;
      el.classList.add("bleed");
      el.appendChild(f);
      return { destroy() { f.src = "about:blank"; } };
    },
  };
})();
