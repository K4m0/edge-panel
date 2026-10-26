"use strict";

(() => {
  const { h, fmt, num, onResize } = window.EdgeW;
  const MAX_MS = 30 * 60 * 1000;
  // History per sensor id, kept for the life of the page (survives config re-renders).
  const HISTORY = new Map();

  function record(id, sensors) {
    let hst = HISTORY.get(id);
    if (!hst) { hst = { pts: [], last: null }; HISTORY.set(id, hst); }
    if (hst.last === sensors) return hst; // already recorded this message (another chart, same sensor)
    hst.last = sensors;
    const now = Date.now();
    hst.pts.push({ t: now, v: num(sensors?.[id]?.value) });
    while (hst.pts.length && now - hst.pts[0].t > MAX_MS) hst.pts.shift();
    return hst;
  }

  window.EDGE_WIDGETS.sensorChart = {
    create(el, s, ctx) {
      const minutes = Math.max(1, Math.min(30, Number(s.minutes) || 2));
      const windowMs = minutes * 60000;
      const root = h("div", "schart");
      root.innerHTML = `<div class="schart-head">
          <div class="schart-name"></div>
          <div class="schart-cur"><b>--</b><small></small></div>
        </div>
        <div class="schart-plot"><canvas></canvas></div>
        <div class="schart-foot"><span class="mn"></span><span class="span">${minutes} min</span><span class="mx"></span></div>`;
      el.appendChild(root);
      const nameEl = root.querySelector(".schart-name");
      const curB = root.querySelector(".schart-cur b"), curU = root.querySelector(".schart-cur small");
      const mnEl = root.querySelector(".mn"), mxEl = root.querySelector(".mx");
      const plot = root.querySelector(".schart-plot");
      const canvas = root.querySelector("canvas");
      const g = canvas.getContext("2d");
      nameEl.textContent = s.name || s.sensor || "";
      let W = 0, H = 0, dirty = true;

      function draw() {
        const sv = ctx.sensor(s.sensor);
        const f = fmt(sv);
        curB.textContent = f.text;
        curU.textContent = f.unit;
        if (!s.name && sv?.name) nameEl.textContent = sv.name;
        if (!ctx.visible() || !W || !H) { dirty = true; return; }
        dirty = false;

        const now = Date.now();
        const pts = (HISTORY.get(s.sensor)?.pts ?? []).filter((p) => now - p.t <= windowMs);
        const vals = pts.map((p) => p.v).filter((v) => v !== null);
        const unit = sv?.unit ?? "";
        const show = (v) => fmt({ value: v, unit }).text;
        mnEl.textContent = vals.length ? `min ${show(Math.min(...vals))}` : "";
        mxEl.textContent = vals.length ? `max ${show(Math.max(...vals))}` : "";

        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
          canvas.width = Math.round(W * dpr);
          canvas.height = Math.round(H * dpr);
        }
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, H);

        const cs = getComputedStyle(el);
        const color = s.color || cs.getPropertyValue("--accent").trim() || "#2bd4e0";
        const lineCol = cs.getPropertyValue("--line").trim() || "rgba(255,255,255,0.1)";

        let lo, hi;
        if (unit === "%") { lo = 0; hi = 100; }
        else if (vals.length) {
          lo = Math.min(...vals); hi = Math.max(...vals);
          const pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.02, 1);
          lo = Math.max(lo >= 0 ? 0 : -Infinity, lo - pad); hi += pad;
        } else { lo = 0; hi = 100; }

        // Grid lines
        g.strokeStyle = lineCol;
        g.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
          const y = Math.round((H * i) / 4) + 0.5;
          g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
        }
        if (pts.length < 2) return;

        const lw = Math.max(2, Math.min(W, H) * 0.012);
        const x = (t) => W - ((now - t) / windowMs) * W;
        const y = (v) => lw + (1 - (v - lo) / (hi - lo || 1)) * (H - lw * 2);
        // Split into runs without gaps (null values).
        const runs = [];
        let cur = [];
        for (const p of pts) {
          if (p.v === null) { if (cur.length) runs.push(cur); cur = []; }
          else cur.push([x(p.t), y(p.v)]);
        }
        if (cur.length) runs.push(cur);

        const grad = g.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, withAlpha(color, 0.35));
        grad.addColorStop(1, withAlpha(color, 0));
        for (const run of runs) {
          if (run.length < 2) continue;
          const path = new Path2D();
          path.moveTo(run[0][0], run[0][1]);
          for (let i = 1; i < run.length - 1; i++) {
            const mx = (run[i][0] + run[i + 1][0]) / 2, my = (run[i][1] + run[i + 1][1]) / 2;
            path.quadraticCurveTo(run[i][0], run[i][1], mx, my);
          }
          const last = run[run.length - 1];
          path.lineTo(last[0], last[1]);
          const fill = new Path2D(path);
          fill.lineTo(last[0], H);
          fill.lineTo(run[0][0], H);
          fill.closePath();
          g.fillStyle = grad;
          g.fill(fill);
          g.strokeStyle = color;
          g.lineWidth = lw;
          g.lineJoin = "round";
          g.lineCap = "round";
          g.stroke(path);
        }
        const lastRun = runs[runs.length - 1];
        if (lastRun?.length) {
          const [lx, ly] = lastRun[lastRun.length - 1];
          g.fillStyle = color;
          g.beginPath(); g.arc(lx - lw, ly, lw * 1.6, 0, Math.PI * 2); g.fill();
        }
      }

      function withAlpha(c, a) {
        const m = /^#([0-9a-f]{6})/i.exec(c);
        if (m) {
          const n = parseInt(m[1], 16);
          return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
        }
        return `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`;
      }

      const stopResize = onResize(plot, (w, hh) => { W = w; H = hh; draw(); });
      if (ctx.sensors()) record(s.sensor, ctx.sensors());
      return {
        update(kind, data) {
          if (kind === "sensors") { record(s.sensor, data); draw(); }
          else if (kind === "visible" && data && dirty) draw();
        },
        destroy() { stopResize(); },
      };
    },
  };
})();
