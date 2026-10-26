"use strict";

(() => {
  const { h } = window.EdgeW;

  function validZone(tz) {
    if (!tz) return undefined;
    try { new Intl.DateTimeFormat(undefined, { timeZone: tz }); return tz; } catch { return undefined; }
  }

  window.EDGE_WIDGETS.clock = {
    create(el, s) {
      const tz = validZone(s.timeZone);
      const face = ["digital", "bigSeconds", "analog", "flip"].includes(s.face) ? s.face : "digital";
      const hourOpts = s.hour12 === "12" ? { hour12: true } : s.hour12 === "24" ? { hourCycle: "h23" } : {};
      const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: tz, ...hourOpts });
      const h24Fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23", timeZone: tz });
      const dateFmt = s.date === "none" ? null : new Intl.DateTimeFormat(undefined, s.date === "long"
        ? { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz }
        : { weekday: "short", day: "numeric", month: "short", timeZone: tz });

      const root = h("div", `clk face-${face}`);
      const main = h("div", "clk-main");
      const info = h("div", "clk-info");
      const dateEl = h("div", "clk-date");
      const textEl = h("div", "clk-text");
      textEl.textContent = s.customText ?? "";
      textEl.hidden = !s.customText;
      dateEl.hidden = !dateFmt;
      info.append(dateEl, textEl);
      root.append(main, info);
      el.appendChild(root);

      let render;
      if (face === "analog") {
        main.innerHTML = `<svg class="clk-analog" viewBox="0 0 100 100">
          <circle class="dial" cx="50" cy="50" r="48"/>
          ${Array.from({ length: 60 }, (_, i) => {
            const major = i % 5 === 0;
            return `<line class="${major ? "tick major" : "tick"}" x1="50" y1="${major ? 6 : 5}" x2="50" y2="${major ? 13 : 8.5}" transform="rotate(${i * 6} 50 50)"/>`;
          }).join("")}
          <line class="hand hour" x1="50" y1="54" x2="50" y2="27"/>
          <line class="hand min" x1="50" y1="56" x2="50" y2="14"/>
          ${s.seconds ? `<line class="hand sec" x1="50" y1="60" x2="50" y2="10"/>` : ""}
          <circle class="hub" cx="50" cy="50" r="2.6"/>
        </svg>`;
        const [hh, mm, ss] = ["hour", "min", "sec"].map((c) => main.querySelector(`.hand.${c}`));
        render = (now) => {
          const p = Object.fromEntries(h24Fmt.formatToParts(now).map((x) => [x.type, +x.value]));
          const sec = p.second, min = p.minute + sec / 60, hr = (p.hour % 12) + min / 60;
          hh.setAttribute("transform", `rotate(${hr * 30} 50 50)`);
          mm.setAttribute("transform", `rotate(${min * 6} 50 50)`);
          ss?.setAttribute("transform", `rotate(${sec * 6} 50 50)`);
        };
      } else if (face === "flip") {
        const cards = [];
        const make = (cls) => { const c = h("div", `flip-card ${cls}`, `<span></span>`); cards.push(c); return c; };
        const hc = make("fh"), mc = make("fm");
        main.append(hc, h("div", "flip-colon", ":"), mc);
        let sc = null;
        if (s.seconds) { sc = make("fs"); main.append(sc); }
        const ap = h("div", "flip-ap");
        main.append(ap);
        const setCard = (card, v) => {
          const span = card.firstChild;
          if (span.textContent === v) return;
          const first = span.textContent === "";
          span.textContent = v;
          if (!first) { card.classList.remove("flip"); void card.offsetWidth; card.classList.add("flip"); }
        };
        render = (now) => {
          const p = Object.fromEntries(timeFmt.formatToParts(now).map((x) => [x.type, x.value]));
          setCard(hc, p.hour.padStart(2, "0"));
          setCard(mc, p.minute);
          if (sc) setCard(sc, p.second);
          ap.textContent = p.dayPeriod ?? "";
          ap.hidden = !p.dayPeriod;
        };
      } else {
        main.innerHTML = `<span class="hm"></span><span class="side"><span class="ap"></span><span class="sec"></span></span>`;
        const hm = main.querySelector(".hm"), ap = main.querySelector(".ap"), sec = main.querySelector(".sec");
        sec.hidden = !s.seconds;
        render = (now) => {
          const parts = timeFmt.formatToParts(now);
          const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
          const hour = s.hour12 === "24" ? p.hour.padStart(2, "0") : p.hour;
          hm.textContent = `${hour}:${p.minute}`;
          ap.textContent = p.dayPeriod ?? "";
          ap.hidden = !p.dayPeriod;
          if (s.seconds) sec.textContent = p.second;
        };
      }

      let lastDate = "";
      const update = (kind, data) => {
        if (kind !== "tick") return;
        render(data);
        if (dateFmt) {
          const d = dateFmt.format(data);
          if (d !== lastDate) { lastDate = d; dateEl.textContent = d; }
        }
      };
      update("tick", new Date());
      return { update };
    },
  };

})();
