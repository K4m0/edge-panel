"use strict";

(() => {
  const { h, icon, tap, clamp } = window.EdgeW;

  window.EDGE_WIDGETS.media = {
    create(el, s, ctx) {
      const root = h("div", "media");
      root.innerHTML = `
        ${s.showArt ? `<div class="m-bg"></div><div class="m-art"><img alt=""><div class="m-noart">${icon("music")}</div></div>` : ""}
        <div class="m-main">
          <div class="m-meta">
            <div class="m-title">Nothing playing</div>
            <div class="m-artist"></div>
            <div class="m-app"></div>
          </div>
          <div class="m-ctrl">
            <button class="btn ghost" data-a="prev" aria-label="Previous">${icon("skipPrev")}</button>
            <button class="btn primary" data-a="toggle" aria-label="Play or pause">${icon("play")}</button>
            <button class="btn ghost" data-a="next" aria-label="Next">${icon("skipNext")}</button>
          </div>
          ${s.showVolume ? `<div class="m-vol">
            <button class="btn ghost" data-v="down" aria-label="Volume down">${icon("volumeDown")}</button>
            <button class="btn ghost" data-v="mute" aria-label="Mute">${icon("volume")}</button>
            <button class="btn ghost" data-v="up" aria-label="Volume up">${icon("volumeUp")}</button>
          </div>` : ""}
        </div>`;
      root.classList.toggle("no-art", !s.showArt);
      el.appendChild(root);

      const $ = (q) => root.querySelector(q);
      const title = $(".m-title"), artist = $(".m-artist"), app = $(".m-app");
      const play = $('[data-a="toggle"]'), img = $(".m-art img"), bg = $(".m-bg");
      const muteBtn = $('[data-v="mute"]');

      root.querySelectorAll("[data-a]").forEach((b) => tap(b, () => ctx.send({ type: "media", action: b.dataset.a })));
      root.querySelectorAll("[data-v]").forEach((b) => tap(b, () => {
        const a = ctx.audio();
        if (b.dataset.v === "mute") return ctx.send({ type: "volume", action: "mute" });
        const cur = typeof a?.volume === "number" ? a.volume : 0.5;
        const step = b.dataset.v === "up" ? 0.05 : -0.05;
        ctx.send({ type: "volume", action: "set", value: Math.round(clamp(cur + step, 0, 1) * 100) / 100 });
      }));

      let lastArt, lastPlaying, lastMuted;
      const paint = (m) => {
        title.textContent = m?.title || "Nothing playing";
        artist.textContent = [m?.artist, m?.album && m.album !== m.title ? m.album : ""].filter(Boolean).join(" · ");
        app.textContent = m?.app || "";
        const playing = !!m?.isPlaying;
        if (playing !== lastPlaying) {
          lastPlaying = playing;
          play.innerHTML = icon(playing ? "pause" : "play");
        }
        root.classList.toggle("idle", !m?.title);
        if (img && m?.art !== lastArt) {
          lastArt = m?.art;
          if (lastArt) { img.src = lastArt; bg.style.backgroundImage = `url("${lastArt}")`; }
          else { img.removeAttribute("src"); bg.style.backgroundImage = ""; }
          root.classList.toggle("has-art", !!lastArt);
        }
      };
      const paintAudio = (a) => {
        if (!muteBtn || !!a?.muted === lastMuted) return;
        lastMuted = !!a?.muted;
        muteBtn.innerHTML = icon(a?.muted ? "volumeMute" : "volume");
        muteBtn.classList.toggle("on", !!a?.muted);
      };
      paint(ctx.media());
      return {
        update(kind, data) {
          if (kind === "media") paint(data);
          else if (kind === "audio") paintAudio(data);
        },
      };
    },
  };
})();
