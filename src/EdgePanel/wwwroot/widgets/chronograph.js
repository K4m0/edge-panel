"use strict";

(() => {
  const { h, icon, tap } = window.EdgeW;
  // State survives config re-renders (keyed by widget id), so saving settings does not reset a running timer.
  const STORE = new Map();

  const pad = (n) => String(n).padStart(2, "0");
  function fmtMs(ms, tenths) {
    ms = Math.max(0, ms);
    const t = Math.floor(ms / 100) % 10;
    const total = Math.floor(ms / 1000);
    const hh = Math.floor(total / 3600), mm = Math.floor(total / 60) % 60, ss = total % 60;
    const base = hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
    return tenths ? `${base}<small>.${t}</small>` : base;
  }

  window.EDGE_WIDGETS.chronograph = {
    create(el, s, ctx) {
      const mode = s.mode === "timer" ? "timer" : "stopwatch";
      const minutes = Math.max(1, Math.min(600, Number(s.timerMinutes) || 5));
      let st = STORE.get(ctx.id);
      if (!st || st.mode !== mode || (mode === "timer" && st.defaultMin !== minutes && !st.running && !st.touched)) {
        st = mode === "stopwatch"
          ? { mode, running: false, start: 0, acc: 0, laps: [] }
          : { mode, defaultMin: minutes, running: false, end: 0, remaining: minutes * 60000, total: minutes * 60000, alarm: false, touched: false };
        STORE.set(ctx.id, st);
      }

      const root = h("div", `chrono ${mode}`);
      const label = h("div", "chrono-label", mode === "timer" ? "Timer" : "Stopwatch");
      const disp = h("div", "chrono-time");
      const btns = h("div", "chrono-btns");
      const laps = h("ol", "chrono-laps");
      root.append(label, disp, btns, laps);
      el.appendChild(root);

      const button = (cls, html, fn) => {
        const b = h("button", `btn ${cls}`, html);
        tap(b, fn);
        btns.appendChild(b);
        return b;
      };

      let timer = 0;
      let paint, paintButtons;
      const loop = (on, ms) => {
        clearInterval(timer);
        timer = on ? setInterval(paint, ms) : 0;
      };

      if (mode === "stopwatch") {
        const elapsed = () => st.acc + (st.running ? Date.now() - st.start : 0);
        const lapBtn = button("ghost", "", () => {
          if (st.running) {
            st.laps.unshift(elapsed());
            if (st.laps.length > 99) st.laps.pop();
          } else { st.acc = 0; st.laps = []; }
          paint(); paintButtons();
        });
        const goBtn = button("primary", "", () => {
          if (st.running) { st.acc += Date.now() - st.start; st.running = false; }
          else { st.start = Date.now(); st.running = true; }
          paintButtons(); paint();
        });
        paintButtons = () => {
          goBtn.innerHTML = st.running ? `${icon("pause")}<span>Stop</span>` : `${icon("play")}<span>${st.acc ? "Resume" : "Start"}</span>`;
          goBtn.classList.toggle("stop", st.running);
          lapBtn.innerHTML = st.running ? `${icon("flag")}<span>Lap</span>` : `${icon("reset")}<span>Reset</span>`;
          lapBtn.disabled = !st.running && !st.acc;
          loop(st.running, 100);
        };
        paint = () => {
          disp.innerHTML = fmtMs(elapsed(), true);
          const n = st.laps.length;
          laps.innerHTML = st.laps.slice(0, 20).map((t, i) => {
            const prev = st.laps[i + 1] ?? 0;
            return `<li><span>Lap ${n - i}</span><span>+${fmtMs(t - prev, true)}</span><span>${fmtMs(t, true)}</span></li>`;
          }).join("");
        };
      } else {
        const remaining = () => (st.running ? st.end - Date.now() : st.remaining);
        button("ghost small", icon("minus"), () => adjust(-60000));
        const goBtn = button("primary", "", () => {
          if (st.alarm) return stopAlarm();
          st.touched = true;
          if (st.running) { st.remaining = Math.max(0, st.end - Date.now()); st.running = false; }
          else {
            if (st.remaining <= 0) st.remaining = st.total;
            st.end = Date.now() + st.remaining; st.running = true;
          }
          paintButtons(); paint();
        });
        button("ghost small", icon("plus"), () => adjust(60000));
        button("ghost small", icon("reset"), () => {
          st.running = false; st.alarm = false; st.remaining = st.total; st.touched = false;
          paintButtons(); paint();
        });
        const adjust = (d) => {
          st.touched = true;
          if (st.alarm) stopAlarm();
          if (st.running) st.end = Math.max(Date.now() + 1000, st.end + d);
          else { st.remaining = Math.max(60000, Math.ceil(st.remaining / 60000) * 60000 + d); st.total = st.remaining; }
          paint();
        };
        const stopAlarm = () => {
          st.alarm = false; st.running = false; st.remaining = st.total;
          paintButtons(); paint();
        };
        root.addEventListener("click", () => { if (st.alarm && !window.EdgePanel?.swiping) stopAlarm(); });
        paintButtons = () => {
          goBtn.innerHTML = st.alarm ? `<span>Dismiss</span>` : st.running ? `${icon("pause")}<span>Pause</span>` : `${icon("play")}<span>Start</span>`;
          goBtn.classList.toggle("stop", st.running);
          root.classList.toggle("alarm", st.alarm);
          loop(st.running || st.alarm, 250);
        };
        paint = () => {
          let left = remaining();
          if (st.running && left <= 0) {
            st.running = false; st.remaining = 0; st.alarm = true; left = 0;
            paintButtons();
          }
          disp.innerHTML = fmtMs(Math.ceil(left / 1000) * 1000, false);
          const f = st.total ? Math.max(0, Math.min(1, left / st.total)) : 0;
          root.style.setProperty("--progress", f);
        };
      }

      paintButtons();
      paint();
      return { destroy() { clearInterval(timer); } };
    },
  };
})();
