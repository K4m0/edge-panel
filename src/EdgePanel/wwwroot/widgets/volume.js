"use strict";

(() => {
  const { h, icon, tap, clamp, esc, hue } = window.EdgeW;

  /** Drag-friendly horizontal slider (0..1). onChange(value, final). */
  function slider(onChange) {
    const el = h("div", "slider", `<div class="sl-track"><div class="sl-fill"></div><div class="sl-thumb"></div></div>`);
    el.dataset.noswipe = "";
    const trackEl = el.firstChild;
    let value = 0, dragging = false, holdUntil = 0, lastSent = 0, timer = 0;
    const paint = (v) => el.style.setProperty("--v", v);
    const fromEvent = (e) => {
      const r = trackEl.getBoundingClientRect();
      return clamp((e.clientX - r.left) / (r.width || 1), 0, 1);
    };
    const emit = (final) => {
      clearTimeout(timer);
      const now = Date.now();
      if (final || now - lastSent > 60) {
        lastSent = now;
        onChange(Math.round(value * 100) / 100, final);
      } else {
        timer = setTimeout(() => emit(false), 60);
      }
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragging = true;
      el.classList.add("drag");
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      value = fromEvent(e); paint(value); emit(false);
    });
    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      value = fromEvent(e); paint(value); emit(false);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("drag");
      holdUntil = Date.now() + 1200;
      emit(true);
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    return {
      el,
      set(v) {
        if (dragging || Date.now() < holdUntil || typeof v !== "number") return;
        value = clamp(v, 0, 1); paint(value);
      },
      destroy() { clearTimeout(timer); },
    };
  }

  window.EDGE_WIDGETS.volume = {
    create(el, s, ctx) {
      const root = h("div", "vol");
      el.appendChild(root);
      const sliders = [];
      const mk = (fn) => { const sl = slider(fn); sliders.push(sl); return sl; };

      // Output device
      const dev = h("div", "vol-dev");
      dev.innerHTML = `<button class="btn ghost icon-only" data-d="-1" aria-label="Previous device">${icon("chevronLeft")}</button>
        <div class="vol-devname"><small>Output</small><span>--</span></div>
        <button class="btn ghost icon-only" data-d="1" aria-label="Next device">${icon("chevronRight")}</button>`;
      const devName = dev.querySelector(".vol-devname span");
      dev.querySelectorAll("[data-d]").forEach((b) => tap(b, () => switchDevice(+b.dataset.d)));
      root.appendChild(dev);

      const row = (cls, iconName, label, onSlide, onMute) => {
        const r = h("div", `vol-row ${cls}`);
        const mute = h("button", "btn ghost icon-only vol-mute", icon(iconName));
        mute.setAttribute("aria-label", `Mute ${label}`);
        tap(mute, onMute);
        const sl = mk(onSlide);
        const pct = h("span", "vol-pct", "--");
        r.append(mute, sl.el, pct);
        root.appendChild(r);
        return { r, mute, sl, pct, muted: null };
      };

      const master = row("master", "volume", "output",
        (v) => { master.pct.textContent = Math.round(v * 100); ctx.send({ type: "volume", action: "set", value: v }); },
        () => ctx.send({ type: "volume", action: "mute" }));
      const mic = s.showInput ? row("mic", "mic", "microphone",
        (v) => { mic.pct.textContent = Math.round(v * 100); ctx.send({ type: "volume", action: "setMic", value: v }); },
        () => ctx.send({ type: "volume", action: "muteMic" })) : null;

      const mixer = s.showMixer ? h("div", "vol-mixer") : null;
      if (mixer) root.appendChild(mixer);
      let mixKey = "", mixRows = new Map();

      const setRow = (rw, vol, muted, onIcon, offIcon) => {
        rw.sl.set(vol);
        if (typeof vol === "number" && !rw.sl.el.classList.contains("drag")) rw.pct.textContent = Math.round(vol * 100);
        if (muted !== rw.muted) {
          rw.muted = muted;
          rw.mute.innerHTML = icon(muted ? offIcon : onIcon);
          rw.mute.classList.toggle("on", !!muted);
          rw.r.classList.toggle("muted", !!muted);
        }
      };

      function switchDevice(dir) {
        const a = ctx.audio();
        const list = a?.devices ?? [];
        if (list.length < 2) return;
        let i = list.findIndex((d) => d.isDefault);
        if (i < 0) i = list.findIndex((d) => d.id === a?.device?.id);
        const next = list[(Math.max(0, i) + dir + list.length) % list.length];
        devName.textContent = next.name;
        ctx.send({ type: "volume", action: "setDefault", deviceId: next.id, flow: "render" });
      }

      function buildMixer(sessions) {
        const key = sessions.map((x) => `${x.pid}:${x.name}:${x.icon ? 1 : 0}`).join("|");
        if (key === mixKey) return;
        mixKey = key;
        for (const r of mixRows.values()) r.sl.destroy();
        mixRows = new Map();
        mixer.replaceChildren();
        if (!sessions.length) {
          mixer.innerHTML = `<div class="vol-empty">No apps playing audio</div>`;
          return;
        }
        for (const ses of sessions) {
          const r = h("div", "vol-row app");
          const ic = h("button", "btn ghost icon-only vol-app");
          ic.innerHTML = ses.icon
            ? `<img src="${esc(ses.icon)}" alt="">`
            : `<span class="letter" style="--h:${hue(ses.name)}">${esc((ses.name || "?").trim().charAt(0).toUpperCase())}</span>`;
          ic.setAttribute("aria-label", `Mute ${ses.name}`);
          const name = h("span", "vol-appname");
          name.textContent = ses.name || `PID ${ses.pid}`;
          const sl = slider((v) => { pct.textContent = Math.round(v * 100); ctx.send({ type: "volume", action: "setApp", pid: ses.pid, value: v }); });
          const pct = h("span", "vol-pct", "--");
          const wrap = h("div", "vol-appmain");
          wrap.append(name, sl.el);
          r.append(ic, wrap, pct);
          tap(ic, () => ctx.send({ type: "volume", action: "muteApp", pid: ses.pid }));
          mixer.appendChild(r);
          mixRows.set(ses.pid, { r, mute: ic, sl, pct, muted: null, letter: ic.innerHTML });
        }
      }

      function paint(a) {
        root.classList.toggle("no-audio", !a);
        const devs = a?.devices ?? [];
        const cur = devs.find((d) => d.isDefault) ?? a?.device;
        devName.textContent = cur?.name || a?.device?.name || "No output device";
        dev.classList.toggle("single", devs.length < 2);
        setRow(master, a?.volume, !!a?.muted, "volume", "volumeMute");
        if (mic) {
          mic.r.hidden = !a?.mic && typeof a?.micVolume !== "number";
          setRow(mic, a?.micVolume, !!a?.micMuted, "mic", "micMute");
        }
        if (mixer) {
          const sessions = Array.isArray(a?.sessions) ? a.sessions : [];
          buildMixer(sessions);
          for (const ses of sessions) {
            const r = mixRows.get(ses.pid);
            if (!r) continue;
            r.sl.set(ses.volume);
            if (typeof ses.volume === "number" && !r.sl.el.classList.contains("drag")) r.pct.textContent = Math.round(ses.volume * 100);
            if (!!ses.muted !== r.muted) { r.muted = !!ses.muted; r.r.classList.toggle("muted", r.muted); }
          }
        }
      }

      paint(ctx.audio());
      return {
        update(kind, data) { if (kind === "audio") paint(data); },
        destroy() { sliders.forEach((x) => x.destroy()); for (const r of mixRows.values()) r.sl.destroy(); },
      };
    },
  };
})();
