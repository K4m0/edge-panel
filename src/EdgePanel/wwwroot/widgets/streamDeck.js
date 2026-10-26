"use strict";

/*
 * Stream Deck: reserves a box on the panel for Elgato's Virtual Stream Deck window.
 * The host moves the real Stream Deck window over this box (see Display/StreamDeckDock.cs),
 * so the user's own Stream Deck profile, icons and actions run on the Edge.
 * Sends {type:"dock", widgetId, rect:{x,y,w,h,dpr}} while visible and {type:"dock", rect:null} when hidden.
 */
(() => {
  const { h, esc, onResize, icon } = window.EdgeW;
  let owner = null; // only one widget can host the deck at a time: the one on the visible page

  window.EDGE_WIDGETS.streamDeck = {
    create(el, s, ctx) {
      const root = h("div", "sdeck");
      root.innerHTML = `
        <div class="sdeck-slot">
          <div class="sdeck-hint">
            ${icon("deck")}
            <b>Virtual Stream Deck</b>
            <span>${ctx.preview
              ? "Your Stream Deck profile appears here on the Edge."
              : "Open Stream Deck → Devices → Add Virtual Device, then show it (eye icon)."}</span>
          </div>
        </div>
        ${s.label ? `<div class="sdeck-label">${esc(s.label)}</div>` : ""}`;
      el.appendChild(root);
      const slot = root.querySelector(".sdeck-slot");

      let timer = 0;
      const report = () => {
        if (ctx.preview) return;
        clearTimeout(timer);
        // Wait for page transitions to settle so the rect is final.
        timer = setTimeout(() => {
          if (!ctx.visible()) return;
          const r = slot.getBoundingClientRect();
          owner = ctx.id;
          ctx.send({ type: "dock", widgetId: ctx.id, rect: { x: r.left, y: r.top, w: r.width, h: r.height, dpr: window.devicePixelRatio } });
        }, 450);
      };
      const release = () => {
        clearTimeout(timer);
        if (ctx.preview || owner !== ctx.id) return;
        owner = null;
        ctx.send({ type: "dock", widgetId: ctx.id, rect: null });
      };

      const stopResize = onResize(slot, () => { if (ctx.visible()) report(); });
      if (ctx.visible()) report();

      return {
        update(kind, data) {
          if (kind === "visible") (data ? report : release)();
          // The real deck window now covers the slot; keep the hint only when it was not found.
          if (kind === "dockState" && data.widgetId === ctx.id) root.classList.toggle("docked", !!data.found);
        },
        destroy() {
          stopResize();
          release();
        },
      };
    },
  };
})();
