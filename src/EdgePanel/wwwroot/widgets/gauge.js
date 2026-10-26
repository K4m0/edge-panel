"use strict";

(() => {
  const { h, sensorCell } = window.EdgeW;

  window.EDGE_WIDGETS.gauge = {
    create(el, s, ctx) {
      const min = Number(s.min), max = Number(s.max);
      const cell = sensorCell({
        sensor: s.sensor, name: s.name, mode: s.mode,
        min: Number.isFinite(min) ? min : undefined,
        max: Number.isFinite(max) && max > min ? max : undefined,
      });
      const root = h("div", "sgauge");
      root.appendChild(cell.el);
      el.appendChild(root);
      const paint = () => cell.set(ctx.sensor(s.sensor));
      paint();
      return { update(kind) { if (kind === "sensors") paint(); } };
    },
  };
})();
