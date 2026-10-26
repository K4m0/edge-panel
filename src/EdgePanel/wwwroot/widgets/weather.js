"use strict";

// Weather + AQI (Open-Meteo, no API key).
(() => {
  const { h, hint, esc, icon } = window.EdgeW;
  const REFRESH_MS = 15 * 60 * 1000;
  const RETRY_MS = 2 * 60 * 1000;
  const CACHE = new Map(); // url -> { t, data } | { t, promise }

  async function getJson(url) {
    const hit = CACHE.get(url);
    if (hit && Date.now() - hit.t < REFRESH_MS - 30000) return hit.data ?? hit.promise;
    const promise = fetch(url, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    CACHE.set(url, { t: Date.now(), promise });
    try {
      const data = await promise;
      CACHE.set(url, { t: Date.now(), data });
      return data;
    } catch (err) {
      CACHE.delete(url);
      throw err;
    }
  }

  const validLoc = (l) => l && Number.isFinite(+l.lat) && Number.isFinite(+l.lon);
  const coords = (l) => `latitude=${(+l.lat).toFixed(4)}&longitude=${(+l.lon).toFixed(4)}`;

  function aqiUrl(loc) {
    return `https://air-quality-api.open-meteo.com/v1/air-quality?${coords(loc)}&current=us_aqi,european_aqi&timezone=auto`;
  }

  /* ---------- AQI bands ---------- */
  const US = [[50, "Good", "#4cd18a"], [100, "Moderate", "#f2c94c"], [150, "Unhealthy for sensitive", "#f2994a"], [200, "Unhealthy", "#eb5757"], [300, "Very unhealthy", "#9b51e0"], [Infinity, "Hazardous", "#8b1e3f"]];
  const EU = [[20, "Good", "#4cd18a"], [40, "Fair", "#a6d96a"], [60, "Moderate", "#f2c94c"], [80, "Poor", "#f2994a"], [100, "Very poor", "#eb5757"], [Infinity, "Extremely poor", "#9b51e0"]];
  const band = (v, scale) => (scale === "eu" ? EU : US).find((b) => v <= b[0]);

  /* ---------- Weather codes + glyphs ---------- */
  function describe(code) {
    if (code === 0) return ["Clear", "clear"];
    if (code === 1) return ["Mainly clear", "partly"];
    if (code === 2) return ["Partly cloudy", "partly"];
    if (code === 3) return ["Overcast", "cloud"];
    if (code === 45 || code === 48) return ["Fog", "fog"];
    if (code >= 51 && code <= 57) return ["Drizzle", "drizzle"];
    if (code >= 61 && code <= 67) return [code >= 66 ? "Freezing rain" : code === 65 ? "Heavy rain" : "Rain", "rain"];
    if (code >= 71 && code <= 77) return ["Snow", "snow"];
    if (code >= 80 && code <= 82) return ["Showers", "rain"];
    if (code === 85 || code === 86) return ["Snow showers", "snow"];
    if (code >= 95) return ["Thunderstorm", "storm"];
    return ["--", "cloud"];
  }

  const CLOUD = "M18 52a11 11 0 0 1-1.5-21.9A15 15 0 0 1 45.3 26 12 12 0 0 1 46 52z";
  function glyph(kind, day = true) {
    const sun = `<g class="wx-sun"><circle cx="32" cy="32" r="11"/>${Array.from({ length: 8 }, (_, i) =>
      `<rect x="30.5" y="8" width="3" height="8" rx="1.5" transform="rotate(${i * 45} 32 32)"/>`).join("")}</g>`;
    const moon = `<path class="wx-moon" d="M38 12a20 20 0 1 0 14 30A16 16 0 0 1 38 12z"/>`;
    const small = (body) => `<g transform="translate(-10 -10) scale(0.8)">${body}</g>`;
    const cloud = (cls = "wx-cloud") => `<path class="${cls}" d="${CLOUD}"/>`;
    const lowCloud = (cls) => `<g transform="translate(0 -6)">${cloud(cls)}</g>`;
    let body;
    switch (kind) {
      case "clear": body = day ? sun : moon; break;
      case "partly": body = small(day ? sun : moon) + `<g transform="translate(6 6)">${cloud()}</g>`; break;
      case "cloud": body = `<g transform="translate(-8 -6) scale(.8)">${cloud("wx-cloud2")}</g>` + `<g transform="translate(4 4)">${cloud()}</g>`; break;
      case "fog": body = lowCloud("wx-cloud2") + [46, 53, 60].map((y, i) => `<rect class="wx-fog" x="${10 + i * 4}" y="${y}" width="${40 - i * 6}" height="3.5" rx="1.75"/>`).join(""); break;
      case "drizzle": body = lowCloud() + [18, 30, 42].map((x) => `<rect class="wx-rain" x="${x}" y="51" width="3" height="6" rx="1.5" transform="rotate(15 ${x} 54)"/>`).join(""); break;
      case "rain": body = lowCloud() + [16, 27, 38, 49].map((x) => `<rect class="wx-rain" x="${x}" y="49" width="3.2" height="12" rx="1.6" transform="rotate(15 ${x} 55)"/>`).join(""); break;
      case "snow": body = lowCloud() + [[18, 53], [30, 58], [42, 53], [24, 61], [36, 61]].map(([x, y]) => `<circle class="wx-snow" cx="${x}" cy="${y}" r="2.6"/>`).join(""); break;
      case "storm": body = lowCloud("wx-cloud2") + `<path class="wx-bolt" d="M34 44 24 58h8l-3 9 12-15h-8l4-8z"/>`; break;
      default: body = cloud();
    }
    return `<svg class="wx-glyph" viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`;
  }

  const hhmm = (iso) => (typeof iso === "string" && iso.includes("T") ? iso.split("T")[1].slice(0, 5) : "--");
  const round = (v) => (Number.isFinite(v) ? Math.round(v) : "--");

  function scheduler(load) {
    let timer = 0, dead = false;
    const run = async () => {
      clearTimeout(timer);
      let ok = true;
      try { await load(); } catch (err) { ok = false; console.warn("weather", err); }
      if (!dead) timer = setTimeout(run, ok ? REFRESH_MS : RETRY_MS);
    };
    run();
    return () => { dead = true; clearTimeout(timer); };
  }

  /* ---------- Weather widget ---------- */
  window.EDGE_WIDGETS.weather = {
    create(el, s) {
      const loc = s.location;
      if (!validLoc(loc)) {
        el.innerHTML = hint("weather", "Set a city in Settings");
        return {};
      }
      const imperial = s.units === "imperial";
      const url = `https://api.open-meteo.com/v1/forecast?${coords(loc)}`
        + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day"
        + "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&forecast_days=6"
        + (imperial ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : "");
      const windUnit = imperial ? "mph" : "km/h";
      const root = h("div", "wx loading");
      root.innerHTML = `<div class="wx-now">
          <div class="wx-icon"></div>
          <div class="wx-temp"><b>--</b><small>°</small></div>
        </div>
        <div class="wx-info">
          <div class="wx-city">${esc(loc.name ?? "")}</div>
          <div class="wx-cond">Loading…</div>
          <div class="wx-range"></div>
        </div>
        <div class="wx-details"></div>
        <div class="wx-days"></div>`;
      el.appendChild(root);
      const q = (c) => root.querySelector(c);

      let aqiHtml = "";
      const load = async () => {
        const [d, a] = await Promise.all([
          getJson(url),
          s.showAqi ? getJson(aqiUrl(loc)).catch(() => null) : Promise.resolve(null),
        ]);
        const c = d.current ?? {}, dl = d.daily ?? {};
        const [label, kind] = describe(c.weather_code);
        root.classList.remove("loading", "error");
        q(".wx-icon").innerHTML = glyph(kind, c.is_day !== 0);
        q(".wx-temp b").textContent = round(c.temperature_2m);
        q(".wx-cond").textContent = label;
        q(".wx-range").innerHTML = `<span class="hi">↑ ${round(dl.temperature_2m_max?.[0])}°</span><span class="lo">↓ ${round(dl.temperature_2m_min?.[0])}°</span>`;
        const aqi = a?.current?.us_aqi;
        aqiHtml = Number.isFinite(aqi)
          ? (() => { const b = band(aqi, "us"); return `<span class="wx-d wx-aqi" style="--band:${b[2]}"><i></i>AQI <b>${Math.round(aqi)}</b></span>`; })()
          : "";
        q(".wx-details").innerHTML = `
          <span class="wx-d">${icon("wind")}<b>${round(c.wind_speed_10m)}</b> ${windUnit}</span>
          <span class="wx-d">${icon("drop")}<b>${round(c.relative_humidity_2m)}</b>%</span>
          <span class="wx-d">${icon("sunrise")}<b>${hhmm(dl.sunrise?.[0])}</b></span>
          <span class="wx-d">${icon("sunset")}<b>${hhmm(dl.sunset?.[0])}</b></span>
          ${aqiHtml}`;
        const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
        q(".wx-days").innerHTML = (dl.time ?? []).slice(1, 6).map((t, i) => {
          const [, k] = describe(dl.weather_code?.[i + 1]);
          return `<div class="wx-day"><span>${dayFmt.format(new Date(`${t}T12:00`))}</span>${glyph(k)}<b>${round(dl.temperature_2m_max?.[i + 1])}°</b><small>${round(dl.temperature_2m_min?.[i + 1])}°</small></div>`;
        }).join("");
      };
      const stop = scheduler(() => load().catch((err) => {
        root.classList.add("error");
        root.classList.remove("loading");
        q(".wx-cond").textContent = "Weather unavailable";
        throw err;
      }));
      return { destroy: stop };
    },
  };

  /* ---------- AQI widget ---------- */
  window.EDGE_WIDGETS.aqi = {
    create(el, s) {
      const loc = s.location;
      if (!validLoc(loc)) {
        el.innerHTML = hint("aqi", "Set a city in Settings");
        return {};
      }
      const scale = s.scale === "eu" ? "eu" : "us";
      const root = h("div", "aqi");
      root.innerHTML = `<div class="aqi-head"><span>${scale === "eu" ? "European AQI" : "US AQI"}</span><small>${esc(loc.name ?? "")}</small></div>
        <div class="aqi-val">--</div>
        <div class="aqi-label">Loading…</div>
        <div class="aqi-bar">${(scale === "eu" ? EU : US).map((b) => `<i style="background:${b[2]}"></i>`).join("")}<b class="aqi-mark"></b></div>`;
      el.appendChild(root);
      const val = root.querySelector(".aqi-val"), label = root.querySelector(".aqi-label"), mark = root.querySelector(".aqi-mark");
      const stop = scheduler(async () => {
        try {
          const d = await getJson(aqiUrl(loc));
          const v = d?.current?.[scale === "eu" ? "european_aqi" : "us_aqi"];
          if (!Number.isFinite(v)) throw new Error("no AQI");
          const bands = scale === "eu" ? EU : US;
          const idx = bands.findIndex((b) => v <= b[0]);
          const b = bands[idx];
          const lo = idx ? bands[idx - 1][0] : 0;
          const hi = Number.isFinite(b[0]) ? b[0] : lo * 1.5;
          val.textContent = Math.round(v);
          label.textContent = b[1];
          root.style.setProperty("--band", b[2]);
          mark.style.left = `${((idx + Math.min(1, (v - lo) / (hi - lo || 1))) / bands.length) * 100}%`;
          root.classList.remove("error");
        } catch (err) {
          label.textContent = "Air quality unavailable";
          root.classList.add("error");
          throw err;
        }
      });
      return { destroy: stop };
    },
  };
})();
