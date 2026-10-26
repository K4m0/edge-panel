"use strict";

(() => {
  const { h, fmt, num, clamp, levelColor } = window.EdgeW;

  window.EDGE_WIDGETS.sensorList = {
    create(el, s, ctx) {
      const list = Array.isArray(s.sensors) ? s.sensors.filter((x) => x && x.sensor) : [];
      const root = h("div", "slist");
      root.style.setProperty("--n", Math.max(1, list.length));
      root.style.setProperty("--half", Math.max(1, Math.ceil(list.length / 2)));
      el.appendChild(root);
      if (!list.length) {
        root.innerHTML = window.EdgeW.hint("list", "Add sensors in Settings");
        return {};
      }
      const rows = list.map((item) => {
        const row = h("div", "slist-row");
        row.innerHTML = `<div class="slist-name"><span></span><small></small></div>
          <div class="slist-val"><b>--</b><small></small></div>
          <div class="slist-bar"><i></i></div>`;
        row.querySelector(".slist-name span").textContent = item.name || item.sensor;
        root.appendChild(row);
        return {
          item,
          hw: row.querySelector(".slist-name small"),
          name: row.querySelector(".slist-name span"),
          b: row.querySelector(".slist-val b"),
          u: row.querySelector(".slist-val small"),
          bar: row.querySelector(".slist-bar"),
          fill: row.querySelector(".slist-bar i"),
        };
      });
      const paint = () => {
        for (const r of rows) {
          const sv = ctx.sensor(r.item.sensor);
          const f = fmt(sv);
          r.b.textContent = f.text;
          r.u.textContent = f.unit;
          if (!r.item.name && sv?.name) r.name.textContent = sv.name;
          r.hw.textContent = sv?.hardware ?? "";
          const pct = sv?.unit === "%" ? num(sv?.value) : null;
          r.bar.hidden = pct === null;
          if (pct !== null) {
            const fr = clamp(pct / 100, 0, 1);
            r.fill.style.width = `${fr * 100}%`;
            r.fill.style.background = levelColor(fr);
          }
        }
      };
      paint();
      return { update(kind) { if (kind === "sensors") paint(); } };
    },
  };
})();
