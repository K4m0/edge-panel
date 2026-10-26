"use strict";

(() => {
  const { h, sensorCell } = window.EdgeW;

  window.EDGE_WIDGETS.sensorPair = {
    create(el, s, ctx) {
      const root = h("div", "spair");
      const cells = [s.left, s.right].map((c) => ({ id: c?.sensor, cell: sensorCell(c ?? {}) }));
      cells.forEach((c, i) => {
        if (i) root.appendChild(h("div", "spair-sep"));
        root.appendChild(c.cell.el);
      });
      el.appendChild(root);
      const paint = () => cells.forEach((c) => c.cell.set(ctx.sensor(c.id)));
      paint();
      return { update(kind) { if (kind === "sensors") paint(); } };
    },
  };
})();
