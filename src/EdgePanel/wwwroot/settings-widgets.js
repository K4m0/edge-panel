"use strict";

// Settings editor: live preview stage (iframe + editing overlay + page bar) and the Widgets view panels.

(() => {
  const { h } = EP;
  const PREVIEW_W = 2560, PREVIEW_H = 720;
  // Matches the panel's outer padding / gap (styles.css --gap: clamp(8px, 2.2vmin, 18px) at 720 px high).
  const PANEL_GAP = 15.84;

  let armedType = null;   // catalog type waiting for a click on an empty cell
  let drag = null;        // { kind: "add", type } | { kind: "move", id, dc, dr }
  let catalogQuery = "";

  /* =================== Stage =================== */

  const stage = () => EP.$("stage");
  const screen = () => EP.$("screen");
  const overlay = () => EP.$("overlay");

  EP.layoutStage = () => {
    const st = stage();
    if (!st || st.hidden) return;
    const main = EP.$("main");
    const avail = st.clientWidth;
    let maxH = PREVIEW_H;
    if (EP.view === "widgets") {
      // Leave room for the page bar and the three panels below.
      const header = EP.$("view-header")?.offsetHeight ?? 0;
      maxH = Math.max(140, main.clientHeight - header - 56 - 330 - 40);
    } else {
      maxH = Math.max(140, Math.min(320, main.clientHeight * 0.36));
    }
    const w = Math.floor(Math.min(avail, (maxH * PREVIEW_W) / PREVIEW_H));
    const scale = w / PREVIEW_W;
    const sc = screen();
    sc.style.width = `${w}px`;
    sc.style.height = `${Math.round(PREVIEW_H * scale)}px`;
    sc.style.setProperty("--scale", scale);
    sc.style.setProperty("--pgap", `${PANEL_GAP * scale}px`);
    EP.$("preview").style.transform = `scale(${scale})`;
  };

  /* ---------- Overlay ---------- */

  EP.renderOverlay = () => {
    const ov = overlay();
    const page = EP.page();
    if (!ov || !page) return;
    const editing = EP.view === "widgets";
    ov.classList.toggle("editing", editing);
    ov.classList.toggle("armed", !!armedType);
    ov.style.gridTemplateColumns = `repeat(${EP.GRID.cols}, 1fr)`;
    ov.style.gridTemplateRows = `repeat(${EP.GRID.rows}, 1fr)`;
    ov.replaceChildren();

    for (let row = 0; row < EP.GRID.rows; row++) {
      for (let col = 0; col < EP.GRID.cols; col++) {
        if (EP.occupantAt(page, col, row)) continue;
        ov.append(h("button", {
          type: "button", class: "cell-empty", tabIndex: editing ? 0 : -1,
          style: { gridColumn: `${col + 1}`, gridRow: `${row + 1}` },
          "aria-label": armedType ? `Place ${EP.cat(armedType)?.name} at column ${col + 1}, row ${row + 1}` : `Empty cell, column ${col + 1}, row ${row + 1}. Add a widget`,
          title: armedType ? `Place ${EP.cat(armedType)?.name} here` : "Add a widget here",
          html: `<span class="plus">${EP.ui("plus")}</span>`,
          onclick: (e) => onEmptyCell(col, row, e.currentTarget),
        }));
      }
    }

    for (const w of page.widgets) {
      if (!EP.inGrid(w.col, w.row, w.size)) continue;
      const s = EP.sizeOf(w.size);
      const sel = w.id === EP.selectedId;
      const box = h("div", {
        class: `wbox ${sel ? "selected" : ""}`, role: "button", tabIndex: editing ? 0 : -1, draggable: editing,
        "aria-pressed": String(sel), dataset: { id: w.id },
        "aria-label": `${EP.widgetName(w)}, size ${w.size}, column ${w.col + 1}, row ${w.row + 1}. Arrow keys move, Delete removes.`,
        style: { gridColumn: `${w.col + 1} / span ${s.cols}`, gridRow: `${w.row + 1} / span ${s.rows}` },
        title: `${EP.widgetName(w)} (${EP.sizeOf(w.size).label ?? w.size}). Drag to move.`,
      },
      h("span", { class: "wchip" }, h("span", { class: "wchip-ico", html: EP.edgeIcon(EP.cat(w.type)?.icon) }), EP.widgetName(w), h("small", null, w.size)),
      sel && editing && h("button", { type: "button", class: "wdel", title: "Delete widget", "aria-label": `Delete ${EP.widgetName(w)}`, html: EP.ui("trash"),
        onclick: (e) => { e.stopPropagation(); deleteWidget(w.id); } }));
      box.addEventListener("click", () => select(w.id));
      box.addEventListener("keydown", (e) => onBoxKey(e, w));
      box.addEventListener("dragstart", (e) => {
        const r = ov.getBoundingClientRect();
        const cell = cellAt(e, r);
        drag = { kind: "move", id: w.id, dc: cell.col - w.col, dr: cell.row - w.row };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", w.id);
        requestAnimationFrame(() => box.classList.add("dragging"));
      });
      box.addEventListener("dragend", () => { box.classList.remove("dragging"); endDrag(); });
      ov.append(box);
    }
    ov.append(h("div", { class: "drop-ghost", id: "drop-ghost", hidden: true }));
  };

  const cellAt = (e, r) => ({
    col: EP.clamp(Math.floor(((e.clientX - r.left) / r.width) * EP.GRID.cols), 0, EP.GRID.cols - 1),
    row: EP.clamp(Math.floor(((e.clientY - r.top) / r.height) * EP.GRID.rows), 0, EP.GRID.rows - 1),
  });

  /** Where a drag would land: { col, row, size, ok }. */
  const dropTarget = (cell) => {
    const page = EP.page();
    if (drag?.kind === "move") {
      const w = page.widgets.find((x) => x.id === drag.id);
      if (!w) return null;
      const s = EP.sizeOf(w.size);
      const col = EP.clamp(cell.col - drag.dc, 0, EP.GRID.cols - s.cols);
      const row = EP.clamp(cell.row - drag.dr, 0, EP.GRID.rows - s.rows);
      if (EP.fits(page, col, row, w.size, w.id)) return { col, row, size: w.size, ok: true };
      return swapTarget(page, w, cell) ?? { col, row, size: w.size, ok: false };
    }
    if (drag?.kind === "add") return placementAt(drag.type, cell.col, cell.row);
    return null;
  };

  /**
   * Dropping a widget onto another one swaps their places when both still fit
   * (each takes the other's top-left cell). Returns a drop target with `swapWith`, or null.
   */
  const swapTarget = (page, a, cell) => {
    const b = EP.occupantAt(page, cell.col, cell.row);
    if (!b || b.id === a.id) return null;
    const others = { widgets: page.widgets.filter((x) => x.id !== a.id && x.id !== b.id) };
    const aNew = { col: b.col, row: b.row, size: a.size };
    const bNew = { col: a.col, row: a.row, size: b.size };
    const ok = EP.inGrid(aNew.col, aNew.row, aNew.size) && EP.inGrid(bNew.col, bNew.row, bNew.size)
      && EP.fits(others, aNew.col, aNew.row, aNew.size) && EP.fits(others, bNew.col, bNew.row, bNew.size)
      && !EP.overlaps(aNew, bNew);
    return ok ? { ...aNew, ok: true, swapWith: b.id } : null;
  };

  /** Default size if it fits at (or anchored back from) the cell, else the smallest allowed size that does. */
  const placementAt = (type, col, row) => {
    const c = EP.cat(type);
    const page = EP.page();
    const sizes = [c.defaultSize, ...EP.sizesBySmallest(c.sizes.filter((s) => s !== c.defaultSize))];
    for (const size of sizes) {
      const s = EP.sizeOf(size);
      const ac = EP.clamp(col, 0, EP.GRID.cols - s.cols), ar = EP.clamp(row, 0, EP.GRID.rows - s.rows);
      // Prefer the clicked cell as the top-left; otherwise any anchor whose footprint covers the cell.
      const anchors = [[ac, ar]];
      for (let dr = 0; dr < s.rows; dr++) for (let dc = 0; dc < s.cols; dc++) anchors.push([col - dc, row - dr]);
      for (const [x, y] of anchors) if (EP.fits(page, x, y, size)) return { col: x, row: y, size, ok: true };
    }
    const s = EP.sizeOf(c.defaultSize);
    return { col: EP.clamp(col, 0, EP.GRID.cols - s.cols), row: EP.clamp(row, 0, EP.GRID.rows - s.rows), size: c.defaultSize, ok: false };
  };

  const showGhost = (t) => {
    const g = EP.$("drop-ghost");
    if (!g) return;
    if (!t) { g.hidden = true; return; }
    const s = EP.sizeOf(t.size);
    g.hidden = false;
    g.className = `drop-ghost ${t.ok ? "ok" : "bad"}`;
    g.style.gridColumn = `${t.col + 1} / span ${s.cols}`;
    g.style.gridRow = `${t.row + 1} / span ${s.rows}`;
  };

  const endDrag = () => { drag = null; showGhost(null); overlay()?.classList.remove("dragover"); };

  const wireOverlayDnD = () => {
    const ov = overlay();
    ov.addEventListener("dragover", (e) => {
      if (!drag || EP.view !== "widgets") return;
      e.preventDefault();
      const t = dropTarget(cellAt(e, ov.getBoundingClientRect()));
      e.dataTransfer.dropEffect = t?.ok ? (drag.kind === "add" ? "copy" : "move") : "none";
      ov.classList.add("dragover");
      showGhost(t);
    });
    ov.addEventListener("dragleave", (e) => { if (!ov.contains(e.relatedTarget)) { showGhost(null); ov.classList.remove("dragover"); } });
    ov.addEventListener("drop", (e) => {
      e.preventDefault();
      const t = drag && dropTarget(cellAt(e, ov.getBoundingClientRect()));
      const d = drag;
      endDrag();
      if (!t) return;
      if (!t.ok) { EP.toast("That spot is taken or too small.", "warn"); return; }
      if (d.kind === "move" && t.swapWith) swapWidgets(d.id, t.swapWith);
      else if (d.kind === "move") moveWidgetTo(d.id, t.col, t.row);
      else addWidget(d.type, t.col, t.row, t.size);
    });
  };

  const onBoxKey = (e, w) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) {
      e.preventDefault();
      if (EP.selectedId !== w.id) select(w.id, false);
      if (!nudge(w.id, d[0], d[1])) EP.toast("Can't move there.", "warn");
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteWidget(w.id); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(w.id); EP.$("settings-body")?.querySelector("button, input, select, textarea")?.focus(); }
  };

  const focusBox = (id) => overlay()?.querySelector(`.wbox[data-id="${id}"]`)?.focus();

  /* ---------- Widget operations ---------- */

  const select = (id, render = true) => {
    EP.selectedId = id;
    if (armedType) disarm();
    if (render) { EP.renderOverlay(); renderSidePanels(); }
    else { EP.renderOverlay(); renderSidePanels(); }
    focusBox(id);
  };

  const addWidget = (type, col, row, size) => {
    let w;
    EP.edit(() => {
      w = EP.makeWidget(type, col, row, size);
      EP.page().widgets.push(w);
    }, { render: "none" });
    EP.selectedId = w.id;
    disarm();
    EP.render();
    focusBox(w.id);
    EP.toast(`Added ${EP.cat(type)?.name}.`);
  };

  EP.addWidgetAnywhere = (type) => {
    const c = EP.cat(type);
    const page = EP.page();
    for (const size of [c.defaultSize, ...EP.sizesBySmallest(c.sizes.filter((s) => s !== c.defaultSize))]) {
      const slot = EP.findSlot(page, size);
      if (slot) { addWidget(type, slot.col, slot.row, size); return true; }
    }
    EP.toast(`No room for ${c.name} on this page. Remove a widget or add a page.`, "warn");
    return false;
  };

  const deleteWidget = async (id) => {
    const page = EP.page();
    const name = EP.widgetName(page.widgets.find((w) => w.id === id) ?? {});
    if (!(await EP.confirm(`Delete the ${name} widget?`, "Delete"))) return;
    const i = page.widgets.findIndex((w) => w.id === id);
    if (i < 0) return;
    EP.edit(() => page.widgets.splice(i, 1), { render: "none" });
    if (EP.selectedId === id) EP.selectedId = null;
    EP.render();
    overlay()?.querySelector(".wbox, .cell-empty")?.focus();
    EP.toast(`Deleted ${name}. Ctrl+Z to undo.`);
  };

  const moveWidgetTo = (id, col, row) => {
    const w = EP.page().widgets.find((x) => x.id === id);
    if (!w || (w.col === col && w.row === row)) return;
    EP.edit(() => { w.col = col; w.row = row; }, { render: "none" });
    EP.selectedId = id;
    EP.render();
    focusBox(id);
  };

  const swapWidgets = (idA, idB) => {
    const page = EP.page();
    const a = page.widgets.find((x) => x.id === idA), b = page.widgets.find((x) => x.id === idB);
    if (!a || !b) return;
    EP.edit(() => { [a.col, a.row, b.col, b.row] = [b.col, b.row, a.col, a.row]; }, { render: "none" });
    EP.selectedId = idA;
    EP.render();
    focusBox(idA);
    EP.toast(`Swapped ${EP.widgetName(a)} and ${EP.widgetName(b)}.`);
  };

  const nudge = (id, dc, dr) => {
    const w = EP.page().widgets.find((x) => x.id === id);
    if (!w || !EP.fits(EP.page(), w.col + dc, w.row + dr, w.size, w.id)) return false;
    moveWidgetTo(id, w.col + dc, w.row + dr);
    return true;
  };

  const resize = (id, size) => {
    const w = EP.page().widgets.find((x) => x.id === id);
    if (!w || !EP.fits(EP.page(), w.col, w.row, size, w.id)) return;
    EP.edit(() => { w.size = size; }, { render: "none" });
    EP.render();
    EP.$("settings-body")?.querySelector(".size-seg .on")?.focus();
  };

  const moveToPage = (id, target) => {
    const from = EP.page();
    const to = EP.config.pages[target];
    const w = from.widgets.find((x) => x.id === id);
    if (!w || !to) return;
    const c = EP.cat(w.type);
    const sizes = [w.size, ...EP.sizesBySmallest((c?.sizes ?? [w.size]).filter((s) => s !== w.size))];
    for (const size of sizes) {
      const slot = EP.findSlot(to, size);
      if (!slot) continue;
      EP.edit(() => {
        from.widgets.splice(from.widgets.indexOf(w), 1);
        Object.assign(w, slot, { size });
        to.widgets.push(w);
      }, { render: "none" });
      EP.selectedId = w.id;
      EP.gotoPage(target);
      EP.toast(`Moved to ${to.name || "page " + (target + 1)}.`);
      return;
    }
    EP.toast(`${to.name || "That page"} has no room for this widget.`, "warn");
  };

  /* ---------- Empty cell ---------- */

  const onEmptyCell = (col, row, anchor) => {
    if (armedType) {
      const t = placementAt(armedType, col, row);
      if (t.ok) addWidget(armedType, t.col, t.row, t.size);
      else EP.toast(`${EP.cat(armedType).name} doesn't fit here.`, "warn");
      return;
    }
    // Quick picker: widgets that can go in this cell.
    const search = h("input", { type: "search", placeholder: "Add a widget…", "aria-label": "Search widgets" });
    const list = h("div", { class: "pick-list", role: "listbox", "aria-label": "Widgets that fit here" });
    const fill = () => {
      const q = search.value.trim().toLowerCase();
      list.replaceChildren();
      for (const c of EP.CATALOG) {
        if (q && !`${c.name} ${c.category}`.toLowerCase().includes(q)) continue;
        const t = placementAt(c.type, col, row);
        if (!t.ok) continue;
        const opt = h("div", { role: "option", class: "pick-opt", id: `qp-${c.type}`, onclick: () => { pop.close(); addWidget(c.type, t.col, t.row, t.size); } },
          h("span", { class: "pick-ico", html: EP.edgeIcon(c.icon) }),
          h("span", { class: "pick-main" }, h("span", { class: "pick-name" }, c.name), h("span", { class: "pick-sub" }, c.category)),
          h("span", { class: "size-badge" }, t.size));
        opt.dataset.type = c.type;
        list.append(opt);
      }
      if (!list.children.length) list.append(h("div", { class: "pick-empty" }, "Nothing fits here."));
      list.querySelector(".pick-opt")?.classList.add("active");
    };
    search.addEventListener("input", fill);
    EP.listNav(search, list, (o) => o.click());
    fill();
    const pop = EP.popover(anchor, [search, list], { width: 320, class: "quick-pop" });
    search.focus();
  };

  const arm = (type) => {
    armedType = armedType === type ? null : type;
    EP.$("catalog")?.querySelectorAll(".tile").forEach((t) => t.classList.toggle("armed", t.dataset.type === armedType));
    EP.renderOverlay();
    if (armedType) EP.toast(`Click an empty cell to place ${EP.cat(type).name}. Esc to cancel.`);
  };
  const disarm = () => { if (armedType) arm(armedType); };
  EP.disarm = () => { const was = !!armedType; disarm(); return was; };

  /* =================== Page bar =================== */

  EP.gotoPage = (i, focusDot = false) => {
    EP.pageIndex = EP.clamp(i, 0, EP.config.pages.length - 1);
    if (!EP.page().widgets.some((w) => w.id === EP.selectedId)) EP.selectedId = null;
    EP.send({ type: "previewPage", index: EP.pageIndex });
    EP.toPreview({ type: "goto", index: EP.pageIndex });
    EP.render();
    if (focusDot) EP.$("pagebar")?.querySelector(".dot.on")?.focus();
  };

  EP.renderPagebar = () => {
    const bar = EP.$("pagebar");
    if (!bar || !EP.config) return;
    const pages = EP.config.pages;
    const i = EP.pageIndex;
    const page = EP.page();
    const dots = h("div", { class: "dots", role: "tablist", "aria-label": "Pages" },
      pages.map((p, pi) => h("button", {
        type: "button", role: "tab", class: `dot ${pi === i ? "on" : ""}`, "aria-selected": String(pi === i), tabIndex: pi === i ? 0 : -1,
        title: p.name || `Page ${pi + 1}`, onclick: () => EP.gotoPage(pi, true),
        onkeydown: (e) => {
          const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
          if (d && pages[pi + d]) { e.preventDefault(); EP.gotoPage(pi + d, true); }
        },
      }, pi + 1)),
      h("button", { type: "button", class: "dot add", title: "Add page", "aria-label": "Add page", html: EP.ui("plus"), onclick: addPage }));
    const name = h("input", { type: "text", class: "page-name", value: page.name ?? "", placeholder: `Page ${i + 1}`, "aria-label": "Page name", maxlength: "40" });
    name.addEventListener("input", () => EP.edit(() => { page.name = name.value; }, { coalesce: `pname:${page.id}`, render: "none" }));
    name.addEventListener("change", () => EP.renderPagebar());
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });
    const editing = EP.view === "widgets";
    bar.replaceChildren(dots,
      h("label", { class: "page-name-wrap", title: "Rename page" }, EP.uiEl("edit"), name),
      h("span", { class: "page-count muted" }, `${page.widgets.length} widget${page.widgets.length === 1 ? "" : "s"}`),
      h("div", { class: "page-actions" },
        EP.iconBtn("left", "Move page left", () => movePage(-1), { disabled: i === 0 }),
        EP.iconBtn("right", "Move page right", () => movePage(1), { disabled: i === pages.length - 1 }),
        EP.iconBtn("copy", "Duplicate page", duplicatePage),
        EP.iconBtn("trash", "Delete page", deletePage, { disabled: pages.length < 2, class: "danger" })));
    bar.classList.toggle("compact", !editing);
  };

  const addPage = () => {
    EP.edit(() => {
      EP.config.pages.splice(EP.pageIndex + 1, 0, { id: EP.newId("p"), name: `Page ${EP.config.pages.length + 1}`, theme: null, widgets: [] });
    }, { render: "none" });
    EP.gotoPage(EP.pageIndex + 1);
    EP.$("pagebar")?.querySelector(".page-name")?.select();
  };
  const duplicatePage = () => {
    EP.edit(() => {
      const taken = EP.allIds();
      const src = EP.page();
      const copy = structuredClone(src);
      copy.id = EP.newId("p", taken);
      copy.name = `${src.name || "Page " + (EP.pageIndex + 1)} copy`;
      copy.widgets.forEach((w) => (w.id = EP.newId("w", taken)));
      EP.config.pages.splice(EP.pageIndex + 1, 0, copy);
    }, { render: "none" });
    EP.gotoPage(EP.pageIndex + 1);
    EP.toast("Page duplicated.");
  };
  const deletePage = async () => {
    const page = EP.page();
    if (EP.config.pages.length < 2) return;
    if (page.widgets.length && !(await EP.confirm(`Delete “${page.name || "this page"}” and its ${page.widgets.length} widget${page.widgets.length === 1 ? "" : "s"}?`, "Delete page", true))) return;
    EP.edit(() => EP.config.pages.splice(EP.pageIndex, 1), { render: "none" });
    EP.gotoPage(Math.min(EP.pageIndex, EP.config.pages.length - 1));
    EP.toast("Page deleted. Ctrl+Z to undo.");
  };
  const movePage = (d) => {
    const i = EP.pageIndex;
    if (!EP.config.pages[i + d]) return;
    EP.edit(() => {
      const [p] = EP.config.pages.splice(i, 1);
      EP.config.pages.splice(i + d, 0, p);
    }, { render: "none" });
    EP.gotoPage(i + d);
  };

  /* =================== Panels =================== */

  const renderCatalog = () => {
    const box = EP.$("catalog");
    if (!box) return;
    const q = catalogQuery.trim().toLowerCase();
    const groups = new Map();
    for (const c of EP.CATALOG) {
      if (q && !`${c.name} ${c.category} ${c.type}`.toLowerCase().includes(q)) continue;
      if (!groups.has(c.category)) groups.set(c.category, []);
      groups.get(c.category).push(c);
    }
    box.replaceChildren();
    if (!groups.size) { box.append(h("p", { class: "muted pad" }, "No widget matches your search.")); return; }
    for (const [cat, items] of groups) {
      box.append(h("h4", { class: "cat-title" }, cat), h("div", { class: "tiles", role: "list" }, items.map((c) => {
        const tile = h("button", {
          type: "button", class: `tile ${armedType === c.type ? "armed" : ""}`, draggable: true, role: "listitem", dataset: { type: c.type },
          title: c.description ? `${c.name}: ${c.description}` : c.name,
          "aria-label": `${c.name}. Sizes ${c.sizes.join(", ")}. Enter adds to the first free spot; Space selects it for placing.`,
        }, h("span", { class: "tile-ico", html: EP.edgeIcon(c.icon) }), h("span", { class: "tile-name" }, c.name));
        tile.addEventListener("click", () => arm(c.type));
        tile.addEventListener("dblclick", (e) => { e.preventDefault(); armedType = null; EP.addWidgetAnywhere(c.type); });
        tile.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); armedType = null; EP.addWidgetAnywhere(c.type); }
        });
        tile.addEventListener("dragstart", (e) => {
          drag = { kind: "add", type: c.type };
          e.dataTransfer.effectAllowed = "copy";
          e.dataTransfer.setData("text/plain", c.type);
        });
        tile.addEventListener("dragend", endDrag);
        return tile;
      })));
    }
  };

  const panelHead = (title, sub) => h("div", { class: "panel-title" }, h("h3", null, title), sub);

  const renderSettings = () => {
    const head = EP.$("settings-head");
    const body = EP.$("settings-body");
    if (!body) return;
    const w = EP.selected();
    if (!w) {
      head.replaceChildren(panelHead("Widget Settings"));
      body.replaceChildren(h("div", { class: "empty-state" }, EP.uiEl("widget"),
        h("p", null, "Select a widget on the preview to edit it."),
        h("p", { class: "muted small" }, "Add one from the catalog: drag a tile onto an empty cell, or double-click it.")));
      return;
    }
    const c = EP.cat(w.type);
    const page = EP.page();
    head.replaceChildren(panelHead(`${c?.name ?? w.type} Settings`, h("span", { class: "head-ico", html: EP.edgeIcon(c?.icon) })));

    const sizes = c?.sizes ?? [w.size];
    const sizeSeg = EP.segmented(sizes.map((s) => [s, EP.sizeOf(s).label === s ? s : `${EP.sizeOf(s).label}`]), w.size, (s) => resize(w.id, s), {
      label: "Size", disabled: (s) => s !== w.size && !EP.fits(page, w.col, w.row, s, w.id), titles: Object.fromEntries(sizes.map((s) => [s, "Not enough room here"])),
    });
    sizeSeg.classList.add("size-seg");
    sizeSeg.querySelectorAll("button").forEach((b, i) => {
      const s = EP.sizeOf(sizes[i]);
      b.prepend(h("span", { class: "size-glyph", style: { "--sc": s.cols, "--sr": s.rows } }));
      if (!b.disabled) b.title = `${sizes[i]}: ${s.cols} × ${s.rows} cells`;
    });

    const ctx = {
      widgetId: w.id,
      get: (k) => EP.getPath(EP.widgetSettings(w), k),
      set: (k, v, typing) => EP.edit(() => { w.settings ??= {}; EP.setPath(w.settings, k, v); },
        { coalesce: typing ? `${w.id}:${k}:${typing === true ? "" : typing}` : null, render: "light" }),
    };

    const pos = h("div", { class: "move-pad", role: "group", "aria-label": "Move widget" },
      EP.iconBtn("left", "Move left", () => nudge(w.id, -1, 0), { disabled: !EP.fits(page, w.col - 1, w.row, w.size, w.id) }),
      EP.iconBtn("up", "Move up", () => nudge(w.id, 0, -1), { disabled: !EP.fits(page, w.col, w.row - 1, w.size, w.id) }),
      EP.iconBtn("down", "Move down", () => nudge(w.id, 0, 1), { disabled: !EP.fits(page, w.col, w.row + 1, w.size, w.id) }),
      EP.iconBtn("right", "Move right", () => nudge(w.id, 1, 0), { disabled: !EP.fits(page, w.col + 1, w.row, w.size, w.id) }));
    const pageSel = EP.config.pages.length > 1 && h("select", { "aria-label": "Move to page" },
      h("option", { value: "", selected: true }, "Move to page…"),
      EP.config.pages.map((p, pi) => pi !== EP.pageIndex && h("option", { value: pi }, `${pi + 1} · ${p.name || "Page " + (pi + 1)}`))) || null;
    pageSel?.addEventListener("change", () => { if (pageSel.value !== "") moveToPage(w.id, Number(pageSel.value)); });

    body.replaceChildren(
      h("div", { class: "field normal" }, h("span", { class: "field-label" }, "Size"), h("div", { class: "field-control" }, sizeSeg)),
      c ? EP.renderForm(c.fields ?? [], ctx) : h("p", { class: "muted" }, `Unknown widget type “${w.type}”.`),
      h("div", { class: "widget-actions" },
        h("div", { class: "field normal" }, h("span", { class: "field-label" }, "Position"),
          h("div", { class: "field-control row" }, pos, pageSel)),
        h("button", { type: "button", class: "btn danger block", html: `${EP.ui("trash")}<span>Delete widget</span>`, onclick: () => deleteWidget(w.id) })));
  };

  const renderStyle = () => {
    const body = EP.$("style-body");
    if (!body) return;
    const w = EP.selected();
    if (!w) {
      body.replaceChildren(h("div", { class: "empty-state" }, EP.uiEl("palette"), h("p", null, "Select a widget to personalize its look.")));
      return;
    }
    w.style = { ...EP.DEFAULT_STYLE, ...w.style };
    const st = w.style;
    const theme = EP.effectiveTheme(EP.page());
    const set = (k, v, typing) => EP.edit(() => { w.style[k] = v; }, { coalesce: typing ? `${w.id}:style:${k}` : null, render: "light" });
    const custom = h("div", { class: "field inline" },
      h("label", { class: "field-label", for: "custom-style" }, "Custom Style"),
      h("div", { class: "field-control" }, Object.assign(EP.toggle(st.custom, (v) => { set("custom", v); renderStyle(); }, "Custom style"), { id: "custom-style" })));
    if (!st.custom) {
      body.replaceChildren(custom, h("div", { class: "note" }, EP.uiEl("info"),
        h("p", null, "This widget follows the ", h("button", { type: "button", class: "link", onclick: () => EP.showView("pages") }, "Pages Personalization"),
          " settings. Turn on Custom Style to give it its own colors, background and transparency.")));
      return;
    }
    const pct = (v) => `${Math.round(v)}%`;
    body.replaceChildren(custom, EP.renderForm([
      { key: "textColor", label: "Text color", type: "color", fallback: theme.textColor },
      { key: "accentColor", label: "Accent color", type: "color", fallback: theme.accentColor },
      { key: "background", label: "Background color", type: "color", fallback: theme.widgetBackground },
      { key: "backgroundImage", label: "Background image", type: "media", accept: "image" },
      { key: "opacity", label: "Opacity", type: "range", min: 0, max: 100, step: 1, scale: 100, fallback: theme.widgetOpacity, format: pct },
    ], { get: (k) => st[k], set }), h("button", { type: "button", class: "btn small ghost", onclick: () => {
      EP.edit(() => { w.style = { ...EP.DEFAULT_STYLE, custom: true }; }, { render: "none" });
      renderStyle();
      EP.renderLight();
    } }, "Reset to page style"));
  };

  const renderSidePanels = () => { renderSettings(); renderStyle(); };

  /* =================== View entry points =================== */

  EP.widgetsView = {
    mount() {
      const search = EP.$("catalog-search");
      search.addEventListener("input", () => { catalogQuery = search.value; renderCatalog(); });
      search.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || (e.key === "Enter" && search.value)) { e.preventDefault(); EP.$("catalog").querySelector(".tile")?.focus(); }
      });
      EP.$("catalog").addEventListener("keydown", (e) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
        const tiles = [...EP.$("catalog").querySelectorAll(".tile")];
        const i = tiles.indexOf(document.activeElement);
        if (i < 0) return;
        const cols = Math.max(1, Math.round(EP.$("catalog").querySelector(".tiles").clientWidth / tiles[0].offsetWidth));
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
        e.preventDefault();
        if (i + step < 0 && e.key === "ArrowUp") { search.focus(); return; }
        tiles[EP.clamp(i + step, 0, tiles.length - 1)].focus();
      });
      wireOverlayDnD();
    },
    render() { renderCatalog(); renderSidePanels(); },
  };
  EP.renderSidePanels = renderSidePanels;
})();
