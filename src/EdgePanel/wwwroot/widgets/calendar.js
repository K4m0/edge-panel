"use strict";

(() => {
  const { h } = window.EdgeW;

  window.EDGE_WIDGETS.calendar = {
    create(el, s) {
      const firstDay = Number(s.firstDay) === 0 ? 0 : 1;
      const root = h("div", "cal");
      el.appendChild(root);
      const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
      const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
      let shown = "";

      function render(now) {
        const key = now.toDateString();
        if (key === shown) return;
        shown = key;
        const y = now.getFullYear(), m = now.getMonth(), today = now.getDate();
        const start = new Date(y, m, 1);
        const lead = (start.getDay() - firstDay + 7) % 7;
        const days = new Date(y, m + 1, 0).getDate();
        const weeks = Math.ceil((lead + days) / 7);
        root.style.setProperty("--weeks", weeks);

        const head = `<div class="cal-head">${monthFmt.format(now)}</div>`;
        let names = "";
        for (let i = 0; i < 7; i++) {
          const d = new Date(2024, 0, 7 + ((firstDay + i) % 7)); // 7 Jan 2024 is a Sunday
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          names += `<span class="cal-wd${weekend ? " we" : ""}">${dayFmt.format(d)}</span>`;
        }
        let cells = "";
        const prevDays = new Date(y, m, 0).getDate();
        for (let i = 0; i < weeks * 7; i++) {
          const n = i - lead + 1;
          if (n < 1) cells += `<span class="cal-d out">${prevDays + n}</span>`;
          else if (n > days) cells += `<span class="cal-d out">${n - days}</span>`;
          else cells += `<span class="cal-d${n === today ? " today" : ""}">${n}</span>`;
        }
        root.innerHTML = `${head}<div class="cal-grid">${names}${cells}</div>`;
      }

      render(new Date());
      return { update(kind, data) { if (kind === "tick") render(data); } };
    },
  };
})();
