/* map.js: Mongolia with the four Mongolian places the model watches, glowing by
   how far from normal each day was. The slider moves through every day 1980 to 2025.
   (Irkutsk is also used by the model, but it is not drawn on this map.) */
(() => {
  const LABEL_LEFT = { khovd: false, uliastai: false, moron: false, ulaanbaatar: false };
  const state = { i: 0, timer: null, stopAt: null };
  let days, sites, color, nodes, startMs;

  const dateAt = (i) => new Date(startMs + i * 864e5);
  const fmtDate = (i) => dateAt(i).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const indexOf = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - startMs) / 864e5);

  // The slider is not linear: 1980 to 2019 take the left half, 2020 to 2025 the
  // right half, so recent years are wide enough to have their own labels.
  const STEPS = 100000;
  const SPLIT = 0.5;
  let split = 0;                                     // day index of 2020-01-01
  const toIndex = (v) => {
    const f = v / STEPS;
    const i = f <= SPLIT ? (f / SPLIT) * split : split + ((f - SPLIT) / (1 - SPLIT)) * (days.days - 1 - split);
    return Math.max(0, Math.min(days.days - 1, Math.round(i)));
  };
  const toValue = (i) => Math.round(STEPS * (i <= split ? (i / split) * SPLIT
    : SPLIT + ((i - split) / (days.days - 1 - split)) * (1 - SPLIT)));
  const describe = (a) => (Math.abs(a) < 0.5 ? "about normal" : `${Math.abs(a).toFixed(1)}° ${a < 0 ? "colder" : "warmer"} than normal`);

  function draw(width) {
    const [basemap] = days.base;
    const height = Math.round(width * (width < 640 ? 0.62 : 0.5));
    const mongolia = basemap.features.find((f) => f.properties.name === "Mongolia");
    const projection = d3.geoConicConformal().parallels([44, 52]).rotate([-104, 0])
      .fitExtent([[width * 0.04, height * 0.06], [width * 0.96, height * 0.9]], mongolia);
    const path = d3.geoPath(projection);

    const svg = d3.select("#map").append("svg").attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img").attr("aria-label", "Map of Mongolia with four glowing places");
    const blur = UB.glow(svg, "map-glow", width < 640 ? 6 : 10);

    svg.append("g").selectAll("path").data(basemap.features).join("path")
      .attr("class", (d) => `country${d.properties.name === "Mongolia" ? " mongolia" : ""}`)
      .attr("d", path);

    nodes = svg.append("g").selectAll("g.site").data(sites).join("g").attr("class", "site")
      .attr("transform", (d) => `translate(${projection([d.lon, d.lat])})`)
      .attr("tabindex", 0)
      .on("pointerenter pointermove", (e, d) => UB.showTip(e, d.name, tipLines(d)))
      .on("pointerleave blur", UB.hideTip)
      .on("focus", function (e, d) {
        const r = this.getBoundingClientRect();
        UB.showTip({ clientX: r.right, clientY: r.top }, d.name, tipLines(d));
      });

    // Soft lights: radial gradients that fade to nothing, plus blur, so no hard edges.
    const defs = svg.append("defs");
    const grad = defs.selectAll("radialGradient").data(sites).join("radialGradient").attr("id", (d) => `glow-${d.id}`);
    grad.append("stop").attr("offset", "0%").attr("stop-opacity", 0.95);
    grad.append("stop").attr("offset", "35%").attr("stop-opacity", 0.45);
    grad.append("stop").attr("offset", "100%").attr("stop-opacity", 0);
    const soft = UB.glow(svg, "map-soft", 1.2);
    nodes.append("circle").attr("class", "pulse").attr("r", 14).attr("fill", (d) => `url(#glow-${d.id})`)
      .attr("filter", blur).style("animation-delay", (d, i) => `${i * 0.6}s`);
    nodes.append("circle").attr("class", "aura").attr("fill", (d) => `url(#glow-${d.id})`).attr("filter", blur);
    nodes.append("circle").attr("class", "core").attr("r", (d) => (d.role === "main" ? 3.2 : 2.6))
      .attr("fill", "#ffffff").attr("filter", soft);
    nodes.append("circle").attr("r", 22).attr("fill", "transparent");

    // On a phone the places sit close together, so some labels go above or below the light.
    const narrow = width < 640;
    const place = (d) => (narrow && d.id === "khovd" ? "above" : narrow && d.id === "uliastai" ? "below" : "side");
    const lx = (d) => (place(d) === "side" ? (LABEL_LEFT[d.id] ? -16 : 16) : 0);
    const ly = (d) => ({ above: -30, below: 26, side: -3 })[place(d)];
    const anchor = (d) => (place(d) === "side" ? (LABEL_LEFT[d.id] ? "end" : "start") : "middle");
    nodes.append("text").attr("class", "site-name").attr("x", lx).attr("y", ly).attr("text-anchor", anchor)
      .style("font-weight", (d) => (d.role === "main" ? 600 : 500)).text((d) => d.name);
    nodes.append("text").attr("class", "site-temp").attr("x", lx).attr("y", (d) => ly(d) + 16).attr("text-anchor", anchor);
    state.scale = narrow ? 0.55 : 1;
    render();
  }

  function tipLines(d) {
    const t = days.temp[d.id][state.i];
    const a = days.anomaly[d.id][state.i];
    return [fmtDate(state.i), `${UB.num(t)}° average`, `~${describe(a)}`];
  }

  /** Update colors, glow size and text for the current day. */
  function render() {
    const i = state.i;
    if (nodes) {
      nodes.each(function (d) {
        const a = days.anomaly[d.id][i];
        const c = color(a);
        const g = d3.select(this);
        const k = state.scale || 1;
        d3.select(`#glow-${d.id}`).selectAll("stop").attr("stop-color", c);
        g.select(".aura").attr("r", k * (16 + Math.min(Math.abs(a), 14) * 1.6));
        g.select(".site-temp").text(`${UB.num(days.temp[d.id][i], 0)}°`);
      });
    }
    const ub = days.anomaly.ulaanbaatar[i];
    document.getElementById("map-date").textContent = fmtDate(i);
    document.getElementById("map-sub").textContent =
      `Ulaanbaatar ${UB.num(days.temp.ulaanbaatar[i])}°, ${describe(ub)}`;
    document.getElementById("map-slider").value = toValue(i);
  }

  function stop() {
    clearInterval(state.timer);
    state.timer = null;
    state.stopAt = null;
    document.getElementById("map-play").textContent = "Play";
  }

  function play(speed = 120) {
    if (state.timer) return;
    if (state.i >= days.days - 1) state.i = 0;
    document.getElementById("map-play").textContent = "Pause";
    state.timer = setInterval(() => {
      const end = state.stopAt ?? days.days - 1;
      if (state.i >= end) { stop(); return; }
      state.i += 1;
      render();
    }, speed);
  }

  function yearMarks() {
    const box = document.getElementById("map-years");
    const first = dateAt(0).getUTCFullYear();
    const last = dateAt(days.days - 1).getUTCFullYear();
    const narrow = box.clientWidth < 480;
    const years = [];
    for (let y = Math.ceil(first / 10) * 10; y < 2020; y += narrow ? 20 : 10) years.push(y);
    for (let y = 2020; y <= last; y += narrow ? 2 : 1) years.push(y);
    for (const y of years) {
      const s = document.createElement("span");
      s.textContent = narrow ? `\u2019${String(y).slice(2)}` : y;
      s.style.left = `${(toValue(indexOf(`${y}-01-01`)) / STEPS) * 100}%`;
      box.appendChild(s);
    }
  }

  async function init() {
    const el = document.getElementById("map");
    let base, allSites;
    try {
      [base, allSites, days] = await Promise.all(["data/basemap.json", "data/sites.json", "data/map_days.json"].map(UB.fetchJSON));
    } catch (err) { UB.fail(el, err); return; }
    days.base = [base];
    sites = allSites.filter((s) => days.sites.includes(s.id));
    startMs = Date.parse(`${days.start}T00:00:00Z`);
    color = UB.anomalyColor(10);
    state.i = days.days - 1;

    const slider = document.getElementById("map-slider");
    split = indexOf("2020-01-01");
    slider.max = STEPS;
    slider.step = 1;
    slider.addEventListener("input", () => { stop(); state.i = toIndex(+slider.value); render(); });
    // Arrow keys move exactly one day, Page Up/Down one month.
    slider.addEventListener("keydown", (e) => {
      const jump = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 30, PageDown: -30 }[e.key];
      if (!jump) return;
      e.preventDefault();
      stop();
      state.i = Math.max(0, Math.min(days.days - 1, state.i + jump));
      render();
    });
    document.getElementById("map-play").addEventListener("click", () => (state.timer ? stop() : play()));
    yearMarks();
    UB.responsive(el, draw);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
