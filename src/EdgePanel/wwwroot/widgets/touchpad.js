"use strict";

/*
 * Virtual touchpad. Sends {type:"pointer", ...}:
 *   dx, dy      relative move (screen px), sensitivity + acceleration applied
 *   click       "left" (tap) | "right" (two-finger tap or right button)
 *   down / up   "left" (left button held, so you can drag)
 *   scroll      wheel delta like a DOM wheel event, ~100 = one notch, positive = down (two-finger drag, natural direction)
 */
(() => {
  const { h, icon } = window.EdgeW;

  window.EDGE_WIDGETS.touchpad = {
    create(el, s, ctx) {
      const sens = Math.max(0.5, Math.min(5, Number(s.sensitivity) || 1.8));
      const root = h("div", `tpad${s.buttons ? " with-buttons" : ""}`);
      root.dataset.noswipe = "";
      root.innerHTML = `<div class="tpad-area"><span class="tpad-hint">${icon("touchpad")}</span></div>
        ${s.buttons ? `<div class="tpad-btns"><button class="tpad-btn" data-b="left">Left</button><button class="tpad-btn" data-b="right">Right</button></div>` : ""}`;
      el.appendChild(root);
      const area = root.querySelector(".tpad-area");

      const pts = new Map();
      let gesture = null; // { t0, max, moved }
      let accX = 0, accY = 0, accScroll = 0, raf = 0;

      const flush = () => {
        raf = 0;
        const dx = Math.trunc(accX), dy = Math.trunc(accY);
        if (dx || dy) { ctx.send({ type: "pointer", dx, dy }); accX -= dx; accY -= dy; }
        const sc = Math.trunc(accScroll);
        // The host follows the DOM wheel convention (positive = down), so flip the sign.
        if (Math.abs(sc) >= 10) { ctx.send({ type: "pointer", scroll: -sc }); accScroll -= sc; }
      };
      const schedule = () => { if (!raf) raf = requestAnimationFrame(flush); };

      area.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        try { area.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
        if (!gesture) gesture = { t0: e.timeStamp, max: 0, moved: 0 };
        gesture.max = Math.max(gesture.max, pts.size);
        area.classList.add("touching");
      });

      area.addEventListener("pointermove", (e) => {
        const p = pts.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        const dt = Math.max(1, e.timeStamp - p.t);
        p.x = e.clientX; p.y = e.clientY; p.t = e.timeStamp;
        gesture.moved += Math.hypot(dx, dy);
        if (pts.size === 1) {
          const speed = Math.hypot(dx, dy) / dt; // px per ms
          const gain = sens * (0.6 + Math.min(speed, 3) * 0.9);
          accX += dx * gain; accY += dy * gain;
        } else {
          // Two fingers: each finger reports, so halve.
          accScroll += (dy / pts.size) * 4 * (sens / 1.8);
        }
        schedule();
      });

      const end = (e) => {
        if (!pts.delete(e.pointerId)) return;
        if (pts.size > 0 || !gesture) return;
        area.classList.remove("touching");
        const g = gesture;
        gesture = null;
        const dur = e.timeStamp - g.t0;
        if (g.moved < 12 * g.max) {
          if (g.max >= 2 && dur < 350) ctx.send({ type: "pointer", click: "right" });
          else if (g.max === 1 && dur < 250 && s.tapToClick !== false) ctx.send({ type: "pointer", click: "left" });
        }
        accScroll = 0;
      };
      area.addEventListener("pointerup", end);
      area.addEventListener("pointercancel", end);

      const leftBtn = root.querySelector('[data-b="left"]'), rightBtn = root.querySelector('[data-b="right"]');
      let leftDown = false;
      leftBtn?.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        try { leftBtn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        leftDown = true;
        leftBtn.classList.add("down");
        ctx.send({ type: "pointer", down: "left" });
      });
      const leftUp = () => {
        if (!leftDown) return;
        leftDown = false;
        leftBtn.classList.remove("down");
        ctx.send({ type: "pointer", up: "left" });
      };
      leftBtn?.addEventListener("pointerup", leftUp);
      leftBtn?.addEventListener("pointercancel", leftUp);
      rightBtn?.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        rightBtn.classList.add("down");
        ctx.send({ type: "pointer", click: "right" });
      });
      rightBtn?.addEventListener("pointerup", () => rightBtn.classList.remove("down"));
      rightBtn?.addEventListener("pointercancel", () => rightBtn.classList.remove("down"));

      return {
        destroy() {
          cancelAnimationFrame(raf);
          leftUp();
        },
      };
    },
  };
})();
