"use strict";

(() => {
  const { h, hint, tap, esc } = window.EdgeW;

  window.EDGE_WIDGETS.deck = {
    create(el, s, ctx) {
      const buttons = Array.isArray(s.buttons) ? s.buttons : [];
      if (!buttons.length) {
        el.innerHTML = hint("deck", "Add buttons in Settings");
        return {};
      }
      const cols = Math.max(1, Math.min(8, Math.trunc(Number(s.columns) || 4), buttons.length));
      const root = h("div", "deck");
      root.style.setProperty("--cols", cols);
      root.style.setProperty("--rows", Math.ceil(buttons.length / cols));
      el.appendChild(root);

      const els = buttons.map((btn, i) => {
        const b = h("button", "deck-btn");
        if (btn.color) b.style.setProperty("--c", btn.color);
        const label = btn.label ?? "";
        b.setAttribute("aria-label", label || `Button ${i + 1}`);
        b.innerHTML = `<span class="deck-icon">${btn.icon ? window.edgeIconSvg(btn.icon) : ""}</span>${label ? `<span class="deck-label">${esc(label)}</span>` : ""}`;
        if (!btn.icon && !(btn.action?.kind === "launch")) b.classList.add("no-icon");
        tap(b, () => {
          b.classList.remove("fired"); void b.offsetWidth; b.classList.add("fired");
          ctx.send({ type: "deck", widgetId: ctx.id, index: i });
        });
        root.appendChild(b);
        return b;
      });

      let seen = null;
      const paintIcons = (icons) => {
        if (icons === seen) return;
        seen = icons;
        buttons.forEach((btn, i) => {
          if (btn.action?.kind !== "launch") return;
          const url = icons?.[`${ctx.id}:${i}`];
          if (!url) return;
          els[i].classList.remove("no-icon");
          els[i].querySelector(".deck-icon").innerHTML = `<img src="${esc(url)}" alt="">`;
        });
      };
      paintIcons(ctx.appIcons());
      return { update(kind, data) { if (kind === "appIcons") paintIcons(data); } };
    },
  };
})();
