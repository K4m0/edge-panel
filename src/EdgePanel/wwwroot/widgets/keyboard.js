"use strict";

(() => {
  const { h, esc } = window.EdgeW;

  // Key: [label, vk, widthUnits, extra]. extra: { s: shifted label, mod, rep, cls, icon }
  const K = (l, vk, w = 1, x = {}) => ({ l, vk, w, ...x });
  const letters = (str) => [...str].map((c) => K(c.toLowerCase(), c.charCodeAt(0), 1, { letter: true }));
  const ARROW = { rep: true, cls: "fn" };

  const QWERTY = [
    [K("Esc", 0x1b, 1, { cls: "fn" }), ...[..."1234567890"].map((d, i) => K(d, d.charCodeAt(0), 1, { s: "!@#$%^&*()"[i] })),
      K("-", 0xbd, 1, { s: "_" }), K("=", 0xbb, 1, { s: "+" }), K("⌫", 0x08, 2, { rep: true, cls: "fn", icon: "backspace" })],
    [K("Tab", 0x09, 1.5, { cls: "fn" }), ...letters("QWERTYUIOP"), K("[", 0xdb, 1, { s: "{" }), K("]", 0xdd, 1, { s: "}" }), K("\\", 0xdc, 1.5, { s: "|" })],
    [K("Caps", 0x14, 1.75, { cls: "fn", caps: true }), ...letters("ASDFGHJKL"), K(";", 0xba, 1, { s: ":" }), K("'", 0xde, 1, { s: "\"" }), K("Enter", 0x0d, 2.25, { cls: "fn accent" })],
    [K("Shift", 0x10, 2, { mod: "shift" }), ...letters("ZXCVBNM"), K(",", 0xbc, 1, { s: "<" }), K(".", 0xbe, 1, { s: ">" }), K("/", 0xbf, 1, { s: "?" }),
      K("↑", 0x26, 1, ARROW), K("Shift", 0x10, 2, { mod: "shift" })],
    [K("Ctrl", 0x11, 1.5, { mod: "ctrl" }), K("Win", 0x5b, 1.25, { mod: "win" }), K("Alt", 0x12, 1.25, { mod: "alt" }), K("", 0x20, 7, { cls: "space" }),
      K("←", 0x25, 1, ARROW), K("↓", 0x28, 1, ARROW), K("→", 0x27, 1, ARROW), K("Del", 0x2e, 1, { rep: true, cls: "fn" })],
  ];

  // Numpad: [label, vk, col, row, colSpan, rowSpan, extra]
  const P = (l, vk, c, r, cs = 1, rs = 1, x = {}) => ({ l, vk, c, r, cs, rs, ...x });
  const NUMPAD = [
    P("Esc", 0x1b, 1, 1, 1, 1, { cls: "fn" }), P("Tab", 0x09, 2, 1, 1, 1, { cls: "fn" }), P("⌫", 0x08, 3, 1, 1, 1, { rep: true, cls: "fn", icon: "backspace" }),
    P("Home", 0x24, 1, 2, 1, 1, { cls: "fn" }), P("PgUp", 0x21, 2, 2, 1, 1, { cls: "fn", rep: true }), P("Del", 0x2e, 3, 2, 1, 1, { cls: "fn", rep: true }),
    P("End", 0x23, 1, 3, 1, 1, { cls: "fn" }), P("PgDn", 0x22, 2, 3, 1, 1, { cls: "fn", rep: true }),
    P("↑", 0x26, 2, 4, 1, 1, ARROW),
    P("←", 0x25, 1, 5, 1, 1, ARROW), P("↓", 0x28, 2, 5, 1, 1, ARROW), P("→", 0x27, 3, 5, 1, 1, ARROW),
    P("=", 0xbb, 5, 1), P("/", 0x6f, 6, 1), P("*", 0x6a, 7, 1), P("−", 0x6d, 8, 1),
    P("7", 0x37, 5, 2), P("8", 0x38, 6, 2), P("9", 0x39, 7, 2), P("+", 0x6b, 8, 2, 1, 2),
    P("4", 0x34, 5, 3), P("5", 0x35, 6, 3), P("6", 0x36, 7, 3),
    P("1", 0x31, 5, 4), P("2", 0x32, 6, 4), P("3", 0x33, 7, 4), P("Enter", 0x0d, 8, 4, 1, 2, { cls: "fn accent" }),
    P("0", 0x30, 5, 5, 2, 1), P(".", 0xbe, 7, 5),
  ];

  const BACKSPACE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M8 5h13v14H8l-6-7zm3.4 3.6L10 10l2 2-2 2 1.4 1.4 2-2 2 2 1.4-1.4-2-2 2-2-1.4-1.4-2 2z"/></svg>`;
  const MODS = ["ctrl", "shift", "alt", "win"];

  window.EDGE_WIDGETS.keyboard = {
    create(el, s, ctx) {
      const numpad = s.layout === "numpad";
      const root = h("div", `kbd ${numpad ? "kbd-numpad" : "kbd-qwerty"}`);
      root.dataset.noswipe = "";
      el.appendChild(root);

      const mods = { ctrl: 0, shift: 0, alt: 0, win: 0 }; // 0 off, 1 next key, 2 locked
      const lastTap = {};
      let caps = false;
      const keyEls = [];

      const make = (k) => {
        const b = h("button", `key ${k.cls ?? ""}${k.mod ? " mod" : ""}${k.letter ? " letter" : ""}`);
        b.dataset.vk = k.vk;
        if (k.icon === "backspace") b.innerHTML = BACKSPACE;
        else b.innerHTML = k.s ? `<small>${esc(k.s)}</small><span>${esc(k.l)}</span>` : `<span>${esc(k.l)}</span>`;
        b.key = k;
        keyEls.push(b);
        return b;
      };

      // Keys are absolutely positioned in percent, so rows line up exactly (arrows, wide keys).
      const place = (b, x, y, w, hh) => {
        b.style.setProperty("--x", `${x}%`);
        b.style.setProperty("--y", `${y}%`);
        b.style.setProperty("--w", `${w}%`);
        b.style.setProperty("--h", `${hh}%`);
        root.appendChild(b);
      };
      if (numpad) {
        const colW = [1, 1, 1, 0.3, 1, 1, 1, 1];
        const total = colW.reduce((a, b) => a + b, 0);
        const colX = colW.map((_, i) => colW.slice(0, i).reduce((a, b) => a + b, 0));
        for (const k of NUMPAD) {
          const w = colW.slice(k.c - 1, k.c - 1 + k.cs).reduce((a, b) => a + b, 0);
          place(make(k), (colX[k.c - 1] / total) * 100, ((k.r - 1) / 5) * 100, (w / total) * 100, (k.rs / 5) * 100);
        }
      } else {
        QWERTY.forEach((row, r) => {
          let x = 0;
          for (const k of row) {
            place(make(k), (x / 15) * 100, (r / 5) * 100, (k.w / 15) * 100, 20);
            x += k.w;
          }
        });
      }

      const activeMods = () => MODS.filter((m) => mods[m]);
      const paintMods = () => {
        const shifted = !!mods.shift;
        root.classList.toggle("shifted", shifted);
        root.classList.toggle("upper", shifted !== caps);
        for (const b of keyEls) {
          const k = b.key;
          if (k.mod) { b.classList.toggle("on", mods[k.mod] === 1); b.classList.toggle("locked", mods[k.mod] === 2); }
          if (k.caps) b.classList.toggle("locked", caps);
          if (k.letter) b.querySelector("span").textContent = shifted !== caps ? k.l.toUpperCase() : k.l;
        }
      };

      const press = (k) => {
        ctx.send({ type: "key", vk: k.vk, mods: activeMods() });
      };
      const releaseOnce = () => {
        let changed = false;
        for (const m of MODS) if (mods[m] === 1) { mods[m] = 0; changed = true; }
        if (changed) paintMods();
      };

      let repeatT = 0, repeatI = 0, held = null;
      const stopRepeat = () => {
        clearTimeout(repeatT); clearInterval(repeatI); repeatT = repeatI = 0;
        if (held) { held.classList.remove("down"); held = null; }
      };

      root.addEventListener("pointerdown", (e) => {
        const b = e.target.closest(".key");
        if (!b || (e.pointerType === "mouse" && e.button !== 0)) return;
        e.preventDefault();
        const k = b.key;
        if (k.mod) {
          const now = performance.now();
          const quick = now - (lastTap[k.mod] ?? 0) < 400;
          lastTap[k.mod] = now;
          mods[k.mod] = mods[k.mod] === 0 ? 1 : mods[k.mod] === 1 && quick ? 2 : 0;
          paintMods();
          return;
        }
        if (k.caps) { caps = !caps; press(k); paintMods(); return; }
        stopRepeat();
        held = b;
        b.classList.add("down");
        press(k);
        if (k.rep) {
          const mSnapshot = activeMods();
          repeatT = setTimeout(() => {
            repeatI = setInterval(() => ctx.send({ type: "key", vk: k.vk, mods: mSnapshot }), 55);
          }, 420);
        }
        releaseOnce();
      });
      const up = () => stopRepeat();
      root.addEventListener("pointerup", up);
      root.addEventListener("pointercancel", up);
      root.addEventListener("pointerout", (e) => { if (held && e.target === held) stopRepeat(); });

      paintMods();
      return { destroy: stopRepeat };
    },
  };
})();
