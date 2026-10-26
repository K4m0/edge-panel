"use strict";

(() => {
  const { h, esc, tap } = window.EdgeW;

  window.EDGE_WIDGETS.coin = {
    create(el, s) {
      const heads = s.heads || "Heads", tails = s.tails || "Tails";
      const root = h("div", "coin");
      root.innerHTML = `<div class="coin-stage"><div class="coin-3d">
          <div class="coin-face heads"><span>${esc(heads)}</span></div>
          <div class="coin-face tails"><span>${esc(tails)}</span></div>
        </div></div>
        <div class="coin-result">Tap to flip</div>`;
      el.appendChild(root);
      const coin = root.querySelector(".coin-3d"), result = root.querySelector(".coin-result");
      let angle = 0, busy = false, timer = 0;
      tap(root, () => {
        if (busy) return;
        busy = true;
        const tailsUp = crypto.getRandomValues(new Uint8Array(1))[0] < 128;
        const base = Math.ceil(angle / 360) * 360 + 360 * 5;
        angle = base + (tailsUp ? 180 : 0);
        root.classList.add("flipping");
        result.textContent = " ";
        coin.style.transform = `rotateY(${angle}deg)`;
        timer = setTimeout(() => {
          busy = false;
          root.classList.remove("flipping");
          result.textContent = tailsUp ? tails : heads;
        }, 1600);
      });
      return { destroy() { clearTimeout(timer); } };
    },
  };
})();
