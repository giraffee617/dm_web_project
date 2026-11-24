/* coldwave.js: the January 1988 cold wave over Mongolia.
   Color: 24 hour mean temperature compared with 16 January, on an ERA5 grid.
   Streaks: particles carried by the real ERA5 wind at 10 m.
   Both are interpolated in space (bilinear) and in time (between 6 hourly frames). */
(() => {
  const el = document.getElementById("coldwave");
  if (!el) return;
  const state = { t: 0, playing: false, visible: false, raf: 0, last: 0 };
  let base, sites, cw, view = null;

  const nT = () => cw.times.length;
  const fmt = (t) => {
    const i = Math.min(nT() - 1, Math.floor(t));
    const d = new Date(`${cw.times[i]}:00Z`);
    const hours = Math.round((t - i) * 6);
    d.setUTCHours(d.getUTCHours() + hours);
    return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}, `
      + `${String(d.getUTCHours()).padStart(2, "0")}:00`;
  };

  /** Value of a field (change, u or v) at lon/lat and time t, or null outside the grid. */
  function sample(field, lon, lat, t) {
    const { lons, lats } = cw;
    const fx = (lon - lons[0]) / (lons[1] - lons[0]);
    const fy = (lat - lats[0]) / (lats[1] - lats[0]);
    const nx = lons.length;
    if (fx < 0 || fy < 0 || fx > nx - 1 || fy > lats.length - 1) return null;
    const i = Math.min(nx - 2, Math.floor(fx));
    const j = Math.min(lats.length - 2, Math.floor(fy));
    const ax = fx - i;
    const ay = fy - j;
    const k0 = Math.min(nT() - 1, Math.floor(t));
    const k1 = Math.min(nT() - 1, k0 + 1);
    const at = t - k0;
    const f = cw[field];
    const v = (jj, ii) => {
      const s = f[jj * nx + ii];
      return s[k0] * (1 - at) + s[k1] * at;
    };
    return (v(j, i) * (1 - ax) + v(j, i + 1) * ax) * (1 - ay) + (v(j + 1, i) * (1 - ax) + v(j + 1, i + 1) * ax) * ay;
  }

  function draw(width) {
    const height = Math.round(width * (width < 640 ? 0.62 : 0.5));
    const mongolia = base.features.find((f) => f.properties.name === "Mongolia");
    const projection = d3.geoConicConformal().parallels([44, 52]).rotate([-104, 0])
      .fitExtent([[width * 0.04, height * 0.06], [width * 0.96, height * 0.9]], mongolia);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const layer = (cls) => {
      const c = document.createElement("canvas");
      c.className = cls;
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
      c.style.height = `${height}px`;
      el.appendChild(c);
      const ctx = c.getContext("2d");
      ctx.scale(dpr, dpr);
      return ctx;
    };
    el.style.height = `${height}px`;
    const field = layer("cw-field");
    const trails = layer("cw-trails");

    // Mongolia as a clip path and as a pixel mask (to keep particles inside).
    const clip = new Path2D(d3.geoPath(projection)(mongolia));
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = width;
    maskCanvas.height = height;
    const mctx = maskCanvas.getContext("2d");
    mctx.fill(clip);
    const mask = mctx.getImageData(0, 0, width, height).data;
    const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[(Math.floor(y) * width + Math.floor(x)) * 4 + 3] > 0;

    // Outline, neighbours and the four places on top.
    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${width} ${height}`)
      .attr("aria-label", "Map of the January 1988 cold wave over Mongolia");
    const path = d3.geoPath(projection);
    svg.append("g").selectAll("path").data(base.features).join("path")
      .attr("class", (d) => `country cw-line${d.properties.name === "Mongolia" ? " mongolia" : ""}`).attr("d", path);
    const g = svg.append("g").selectAll("g").data(sites).join("g")
      .attr("transform", (d) => `translate(${projection([d.lon, d.lat])})`);
    g.append("circle").attr("r", 3).attr("fill", "#fff");
    g.append("text").attr("class", "site-name").attr("x", 9).attr("y", 4).text((d) => d.name);

    const color = d3.scaleLinear().domain([-16, -6, 0, 4, 10])
      .range([UB.css("--cold"), "#2b6f86", "#0b0b0d", "#6b4a22", UB.css("--warm")])
      .interpolate(d3.interpolateLab).clamp(true);

    // Color field, drawn at low resolution and smoothed when scaled up.
    const cell = width < 640 ? 4 : 5;
    const lw = Math.ceil(width / cell);
    const lh = Math.ceil(height / cell);
    const low = document.createElement("canvas");
    low.width = lw;
    low.height = lh;
    const lctx = low.getContext("2d");
    const img = lctx.createImageData(lw, lh);
    const lonlat = [];
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) lonlat.push(projection.invert([x * cell + cell / 2, y * cell + cell / 2]));
    let drawnT = -1;
    function paintField(t) {
      if (Math.abs(t - drawnT) < 0.02) return;
      drawnT = t;
      for (let p = 0; p < lonlat.length; p++) {
        const [lon, lat] = lonlat[p];
        const v = sample("change", lon, lat, t);
        const o = p * 4;
        if (v === null) { img.data[o + 3] = 0; continue; }
        const c = d3.rgb(color(v));
        img.data[o] = c.r; img.data[o + 1] = c.g; img.data[o + 2] = c.b;
        img.data[o + 3] = Math.round(255 * Math.min(0.92, 0.25 + Math.abs(v) / 14));
      }
      lctx.putImageData(img, 0, 0);
      field.clearRect(0, 0, width, height);
      field.save();
      field.clip(clip);
      field.fillStyle = "#0a0a0c";
      field.fillRect(0, 0, width, height);
      field.imageSmoothingEnabled = true;
      field.imageSmoothingQuality = "high";
      field.drawImage(low, 0, 0, width, height);
      field.restore();
    }

    // Wind particles.
    const count = Math.round(Math.min(650, (width * height) / 520));
    const spawn = () => {
      for (let tries = 0; tries < 30; tries++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        if (inside(x, y)) return { x, y, age: Math.floor(Math.random() * 60) };
      }
      return { x: width / 2, y: height / 2, age: 0 };
    };
    const particles = Array.from({ length: count }, spawn);
    const speedScale = width / 1600;
    function stepParticles(t) {
      trails.save();
      trails.globalCompositeOperation = "destination-in";
      trails.fillStyle = "rgba(0, 0, 0, 0.86)";
      trails.fillRect(0, 0, width, height);
      trails.restore();
      trails.lineWidth = 0.9;
      trails.strokeStyle = "rgba(225, 238, 250, 0.28)";
      trails.beginPath();
      particles.forEach((p, k) => {
        const [lon, lat] = projection.invert([p.x, p.y]);
        const u = sample("u", lon, lat, t);
        const v = sample("v", lon, lat, t);
        p.age += 1;
        if (u === null || p.age > 90 || !inside(p.x, p.y)) { particles[k] = spawn(); particles[k].age = 0; return; }
        const nx = p.x + u * speedScale;
        const ny = p.y - v * speedScale;
        trails.moveTo(p.x, p.y);
        trails.lineTo(nx, ny);
        p.x = nx;
        p.y = ny;
      });
      trails.stroke();
    }

    view = { paintField, stepParticles, trails, width, height };
    paintField(state.t);
    if (UB.reducedMotion()) stepParticles(state.t);
  }

  function setTime(t) {
    state.t = Math.max(0, Math.min(nT() - 1, t));
    document.getElementById("cw-time").textContent = fmt(state.t);
    if (view) view.paintField(state.t);
  }

  function loop(now) {
    state.raf = 0;
    if (!state.visible || !view) return;
    const dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 0;
    state.last = now;
    if (state.playing) {
      setTime(state.t + dt * 1.6);
      if (state.t >= nT() - 1) {
        state.playing = false;
        document.getElementById("cw-play").textContent = "Simulate again";
      }
    }
    view.stepParticles(state.t);
    state.raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (!state.raf && state.visible && !UB.reducedMotion()) { state.last = 0; state.raf = requestAnimationFrame(loop); } };

  async function init() {
    let all;
    try {
      [base, all, cw] = await Promise.all(["data/basemap.json", "data/sites.json", "data/coldwave.json"].map(UB.fetchJSON));
    } catch (err) { UB.fail(el, err); return; }
    sites = all.filter((s) => s.id !== "irkutsk");
    const button = document.getElementById("cw-play");
    button.addEventListener("click", () => {
      if (state.playing) { state.playing = false; button.textContent = "Continue"; return; }
      if (state.t >= nT() - 1) setTime(0);
      state.playing = true;
      button.textContent = "Pause";
      if (UB.reducedMotion()) { setTime(nT() - 1); state.playing = false; button.textContent = "Simulate again"; view.stepParticles(state.t); }
      kick();
    });
    new IntersectionObserver((entries) => {
      state.visible = entries[0].isIntersecting;
      kick();
    }).observe(el);
    UB.responsive(el, draw);
    setTime(0);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
