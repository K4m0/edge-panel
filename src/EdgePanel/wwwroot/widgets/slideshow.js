"use strict";

(() => {
  const { h, hint, isVideo } = window.EdgeW;

  window.EDGE_WIDGETS.slideshow = {
    create(el, s, ctx) {
      const files = (Array.isArray(s.files) ? s.files : []).filter((f) => f && !isVideo(f));
      if (!files.length) {
        el.innerHTML = hint("slides", "Add images in Settings");
        return {};
      }
      el.classList.add("bleed");
      const fit = s.fit === "contain" ? "contain" : "cover";
      const layers = [0, 1].map(() => {
        const img = h("img", "media-fill slide");
        img.alt = "";
        img.decoding = "async";
        img.style.objectFit = fit;
        // Hide the broken-image glyph when a file is missing.
        img.addEventListener("error", () => { img.style.visibility = "hidden"; });
        img.addEventListener("load", () => { img.style.visibility = ""; });
        el.appendChild(img);
        return img;
      });
      const order = files.map((_, i) => i);
      const shuffle = () => {
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
      };
      if (s.shuffle) shuffle();
      let pos = 0, front = 0;
      const urlAt = (p) => ctx.mediaUrl(files[order[p % order.length]]);
      layers[0].src = urlAt(0);
      layers[0].classList.add("on");

      const next = () => {
        pos++;
        if (pos >= order.length) { pos = 0; if (s.shuffle) shuffle(); }
        const back = layers[1 - front];
        const show = () => {
          back.onload = back.onerror = null;
          back.classList.add("on");
          layers[front].classList.remove("on");
          front = 1 - front;
        };
        back.onload = show;
        back.onerror = show;
        back.src = urlAt(pos);
      };
      const ms = Math.max(2, Number(s.intervalSec) || 8) * 1000;
      let timer = 0;
      const run = (on) => { clearInterval(timer); timer = on && files.length > 1 ? setInterval(next, ms) : 0; };
      run(ctx.visible());
      return {
        update(kind, data) { if (kind === "visible") run(data); },
        destroy() { clearInterval(timer); },
      };
    },
  };
})();
