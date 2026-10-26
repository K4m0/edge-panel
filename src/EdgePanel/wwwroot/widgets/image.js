"use strict";

(() => {
  const { h, hint, isVideo } = window.EdgeW;

  window.EDGE_WIDGETS.image = {
    create(el, s, ctx) {
      const src = s.source === "url" ? String(s.url ?? "").trim() : ctx.mediaUrl(s.file);
      if (!src || src === "https://" || src === "http://") {
        el.innerHTML = hint("image", "Choose an image or video in Settings");
        return {};
      }
      const fit = s.fit === "contain" ? "contain" : "cover";
      let media;
      if (isVideo(src)) {
        media = h("video", "media-fill");
        media.muted = true;
        media.loop = true;
        media.autoplay = true;
        media.playsInline = true;
        media.setAttribute("muted", "");
        media.setAttribute("playsinline", "");
        media.src = src;
      } else {
        media = h("img", "media-fill");
        media.alt = "";
        media.decoding = "async";
        media.src = src;
      }
      media.style.objectFit = fit;
      media.addEventListener("error", () => { el.innerHTML = hint("image", "Could not load this file"); });
      el.classList.add("bleed");
      el.appendChild(media);
      const isVid = media.tagName === "VIDEO";
      return {
        update(kind, data) {
          if (kind !== "visible" || !isVid) return;
          if (data) media.play().catch(() => {}); else media.pause();
        },
        destroy() {
          if (isVid) { media.pause(); media.removeAttribute("src"); media.load(); }
        },
      };
    },
  };
})();
