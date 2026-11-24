/* eda.js: the history section. Winter ridgeline, warming by season,
   the normal year, and how well each place predicts Ulaanbaatar. */
(() => {
  const NAMES = { ulaanbaatar: "Ulaanbaatar", uliastai: "Uliastai", khovd: "Khovd", moron: "Mörön", irkutsk: "Irkutsk" };

  /** A typical winter, decade by decade: for every day from 1 December to
      28 February, the median temperature over the winters of each decade.
      Built from the daily ERA5 record (data/every_day.json). */
  function winterLines(data) {
    const el = document.getElementById("ridgeline");
    const DAY = 864e5;
    const temp = (iso) => {
      const y = iso.slice(0, 4);
      const row = data.years[y];
      if (!row) return null;
      const k = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${row.start}T00:00:00Z`)) / DAY);
      return k >= 0 && k < row.temp.length ? row.temp[k] : null;
    };
    // The 90 days of a winter: December of the year before, then January and February.
    const winterDates = (wy) => {
      const out = [];
      for (let t = Date.UTC(wy - 1, 11, 1); out.length < 90; t += DAY) {
        const d = new Date(t);
        if (d.getUTCMonth() === 1 && d.getUTCDate() === 29) continue;
        out.push(d.toISOString().slice(0, 10));
      }
      return out;
    };
    const years = Object.keys(data.years).map(Number);
    const winters = [];
    for (let wy = d3.min(years) + 1; wy <= d3.max(years); wy++) {
      const vals = winterDates(wy).map(temp);
      if (vals.every((v) => v != null)) winters.push({ wy, vals });
    }
    const smooth = (arr, k = 5) => arr.map((_, i) => d3.mean(arr.slice(Math.max(0, i - k), i + k + 1)));
    const decades = d3.groups(winters, (w) => Math.floor(w.wy / 10) * 10).map(([dec, ws]) => ({
      decade: dec,
      line: smooth(d3.range(90).map((i) => d3.median(ws, (w) => w.vals[i]))),
      median: d3.median(ws.flatMap((w) => w.vals)),
      n: ws.length,
    }));
    const p10 = smooth(d3.range(90).map((i) => d3.quantile(winters.map((w) => w.vals[i]), 0.1)));
    const p90 = smooth(d3.range(90).map((i) => d3.quantile(winters.map((w) => w.vals[i]), 0.9)));
    const first = decades[0];
    const last = decades[decades.length - 1];
    UB.rich(document.getElementById("ridgeline-takeaway"),
      `The median winter day was ${UB.num(first.median)}° in the ${first.decade}s and ${UB.num(last.median)}° in the ${last.decade}s. ` +
      `The lines lie almost on top of each other: [[winters have barely changed]], while spring has warmed.`);

    UB.responsive(el, (width) => {
      const m = { top: 16, right: width < 640 ? 46 : 64, bottom: 40, left: 44 };
      const height = Math.round(Math.max(300, width * 0.45));
      const x = d3.scaleLinear().domain([0, 89]).range([m.left, width - m.right]);
      const y = d3.scaleLinear().domain([-34, -4]).range([height - m.bottom, m.top]);
      const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("aria-label", "Typical winter by decade");
      const blur = UB.glow(svg, "winter-glow", 3);
      const ramp = d3.scaleSequential(d3.interpolateRgb("#2c5a6b", "#eaf9ff")).domain([first.decade, last.decade]);

      svg.append("g").attr("class", "grid").selectAll("line").data(y.ticks(6)).join("line")
        .attr("x1", m.left).attr("x2", width - m.right).attr("y1", y).attr("y2", y);
      svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left - 8},0)`)
        .call(d3.axisLeft(y).ticks(6).tickFormat((v) => `${UB.num(v, 0)}°`).tickSize(0)).call((g) => g.select(".domain").remove());
      // Months on the bottom axis, with thin lines at the month borders.
      [[0, 31, "December"], [31, 62, "January"], [62, 90, "February"]].forEach(([a, b, name]) => {
        svg.append("text").attr("class", "label").attr("x", (x(a) + x(Math.min(b, 89))) / 2).attr("y", height - 12)
          .attr("text-anchor", "middle").text(width < 640 ? name.slice(0, 3) : name);
        if (a > 0) svg.append("line").attr("x1", x(a)).attr("x2", x(a)).attr("y1", m.top).attr("y2", height - m.bottom)
          .attr("stroke", UB.css("--line"));
      });

      svg.append("path").attr("fill", "#ffffff").attr("opacity", 0.06)
        .attr("d", d3.area().curve(d3.curveBasis).x((_, i) => x(i)).y0((_, i) => y(p10[i])).y1((_, i) => y(p90[i]))(p10));

      const lines = svg.append("g");
      decades.forEach((d) => {
        lines.append("path").attr("class", "ridge").attr("fill", "none").attr("stroke", ramp(d.decade))
          .attr("stroke-width", d === last ? 2.4 : 1.5).attr("filter", blur)
          .attr("d", d3.line().curve(d3.curveBasis).x((_, i) => x(i)).y((v) => y(v))(d.line));
      });
      [first, last].forEach((d) => {
        svg.append("text").attr("class", d === last ? "label-strong" : "label").attr("x", width - m.right + 8)
          .attr("y", y(d.line[89])).attr("dy", d === last ? "-0.2em" : "0.9em").text(`${d.decade}s`);
      });

      // Hover: the date and every decade's typical temperature on that day.
      const guide = svg.append("line").attr("y1", m.top).attr("y2", height - m.bottom).attr("stroke", "#fff")
        .attr("opacity", 0).attr("pointer-events", "none");
      svg.append("rect").attr("x", m.left).attr("y", m.top).attr("width", width - m.left - m.right)
        .attr("height", height - m.top - m.bottom).attr("fill", "transparent")
        .on("pointermove", (e) => {
          const i = Math.max(0, Math.min(89, Math.round(x.invert(d3.pointer(e)[0]))));
          guide.attr("x1", x(i)).attr("x2", x(i)).attr("opacity", 0.3);
          const date = new Date(Date.UTC(2001, 11, 1) + i * DAY);
          UB.showTip(e, date.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }),
            decades.map((d) => `${d.decade}s  ${UB.num(d.line[i])}°`));
        })
        .on("pointerleave", () => { guide.attr("opacity", 0); UB.hideTip(); });
    });
  }

  /** Ridges appear one decade at a time as the chart scrolls into view. */
  function ridgeScroll() {
    const el = document.getElementById("ridgeline");
    if (UB.reducedMotion()) { el.classList.add("all"); return; }
    let ticking = false;
    const update = () => {
      ticking = false;
      const r = el.getBoundingClientRect();
      const progress = (window.innerHeight * 0.92 - r.top) / (r.height * 0.85);
      const n = el.querySelectorAll(".ridge").length;
      const shown = Math.ceil(Math.max(0, Math.min(1, progress)) * n);
      el.querySelectorAll(".ridge").forEach((g) => {
        const i = Array.prototype.indexOf.call(g.parentNode.children, g);
        g.classList.toggle("on", i < shown);
      });
    };
    window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    new ResizeObserver(update).observe(el);
    update();
  }

  function warming(rows) {
    const el = document.getElementById("warming");
    const spring = rows.find((r) => r.season === "Spring");
    const winter = rows.find((r) => r.season === "Winter");
    UB.rich(document.getElementById("warming-takeaway"),
      `Spring has warmed the most, [[${UB.signed(spring.trend_per_decade, 2)}° per decade]], from a mean of ${UB.num(spring.first_decade_mean)}° in its first ten years to ${UB.num(spring.last_decade_mean)}° in the last ten. Winter has changed very little (${UB.signed(winter.trend_per_decade, 2)}° per decade).`);

    UB.responsive(el, (width) => {
      const bar = 46;
      const m = { top: 6, right: 120, bottom: 6, left: 84 };
      const height = m.top + bar * rows.length + m.bottom;
      const x = d3.scaleLinear().domain([0, 0.45]).range([m.left, width - m.right]);
      const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("aria-label", "Warming by season");
      const blur = UB.glow(svg, "warm-glow", 5);
      const g = svg.append("g").selectAll("g").data(rows).join("g")
        .attr("transform", (d, i) => `translate(0,${m.top + i * bar + bar / 2})`);
      g.append("text").attr("class", "label").attr("x", 0).attr("dy", "0.35em").text((d) => d.season);
      g.append("line").attr("x1", x(0)).attr("x2", (d) => x(Math.max(d.trend_per_decade, 0.004)))
        .attr("stroke", UB.css("--warm")).attr("stroke-width", 6).attr("stroke-linecap", "round").attr("filter", blur);
      g.append("text").attr("class", "label-strong").attr("x", (d) => x(Math.max(d.trend_per_decade, 0)) + 14).attr("dy", "0.35em")
        .text((d) => `${UB.signed(d.trend_per_decade, 2)}° per decade`);
    });
  }

  function seasonal(data) {
    const el = document.getElementById("seasonal");
    const dates = data.dates.map((s) => new Date(`2001-${s}T00:00:00Z`));
    UB.responsive(el, (width) => {
      const m = { top: 10, right: 10, bottom: 30, left: 44 };
      const height = Math.round(Math.max(260, width * 0.4));
      const x = d3.scaleUtc().domain([dates[0], dates[dates.length - 1]]).range([m.left, width - m.right]);
      const y = d3.scaleLinear().domain([-30, 25]).range([height - m.bottom, m.top]);
      const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("aria-label", "The normal year");
      const blur = UB.glow(svg, "season-glow", 4);
      svg.append("g").attr("class", "grid").selectAll("line").data(y.ticks(5)).join("line")
        .attr("x1", m.left).attr("x2", width - m.right).attr("y1", y).attr("y2", y);
      svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left - 8},0)`)
        .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${UB.num(v, 0)}°`).tickSize(0)).call((g) => g.select(".domain").remove());
      svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.bottom + 10})`)
        .call(d3.axisBottom(x).ticks(d3.utcMonth.every(width < 640 ? 2 : 1)).tickFormat(d3.utcFormat("%b")).tickSize(0))
        .call((g) => g.select(".domain").remove());

      svg.append("path").attr("fill", UB.css("--cold")).attr("opacity", 0.13)
        .attr("d", d3.area().curve(d3.curveBasis).x((d, i) => x(dates[i])).y0((d, i) => y(data.p10[i])).y1((d, i) => y(data.p90[i]))(dates));
      svg.append("path").attr("fill", "none").attr("stroke", UB.css("--cold")).attr("stroke-width", 2.2).attr("filter", blur)
        .attr("d", d3.line().curve(d3.curveBasis).x((d, i) => x(dates[i])).y((d, i) => y(data.normal[i]))(dates));

      const hover = svg.append("g").style("display", "none");
      hover.append("line").attr("y1", m.top).attr("y2", height - m.bottom).attr("stroke", "#ffffff").attr("opacity", 0.25);
      hover.append("circle").attr("r", 4).attr("fill", "#fff");
      svg.append("rect").attr("x", m.left).attr("y", m.top).attr("width", width - m.left - m.right).attr("height", height - m.top - m.bottom)
        .attr("fill", "transparent")
        .on("pointermove", (e) => {
          const i = Math.max(0, Math.min(dates.length - 1, d3.bisectCenter(dates, x.invert(d3.pointer(e)[0]))));
          hover.style("display", null).attr("transform", `translate(${x(dates[i])},0)`);
          hover.select("circle").attr("cy", y(data.normal[i]));
          UB.showTip(e, d3.utcFormat("%-d %B")(dates[i]), [`Normal ${UB.num(data.normal[i])}°`,
            `~8 in 10 days between ${UB.num(data.p10[i])}° and ${UB.num(data.p90[i])}°`]);
        })
        .on("pointerleave", () => { hover.style("display", "none"); UB.hideTip(); });
    });
  }

  function upwind(data) {
    const el = document.getElementById("upwind");
    const ids = Object.keys(data.correlation).filter((id) => id !== "irkutsk");
    UB.responsive(el, (width) => {
      const m = { top: 20, right: width < 640 ? 96 : 130, bottom: 34, left: 44 };
      const height = 340;
      const x = d3.scalePoint().domain([1, 2, 3]).range([m.left + 10, width - m.right]);
      const y = d3.scaleLinear().domain([0.25, 0.8]).range([height - m.bottom, m.top]);
      const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("aria-label", "Correlation with Ulaanbaatar");
      const blur = UB.glow(svg, "up-glow", 3);
      svg.append("g").attr("class", "grid").selectAll("line").data(y.ticks(5)).join("line")
        .attr("x1", m.left).attr("x2", width - m.right).attr("y1", y).attr("y2", y);
      svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left - 8},0)`)
        .call(d3.axisLeft(y).ticks(5).tickSize(0)).call((g) => g.select(".domain").remove());
      svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.bottom + 12})`)
        .call(d3.axisBottom(x).tickFormat((d) => (d === 1 ? "1 day later" : `${d} days later`)).tickSize(0))
        .call((g) => g.select(".domain").remove());

      const pts = (id) => [1, 2, 3].map((h) => [x(h), y(data.correlation[id][`d${h}`])]);
      ids.forEach((id) => {
        const main = id === "ulaanbaatar";
        const c = main ? "#ffffff" : UB.css("--cold");
        svg.append("path").attr("d", d3.line()(pts(id))).attr("fill", "none").attr("stroke", c)
          .attr("stroke-width", main ? 2.4 : 1.6).attr("opacity", main ? 1 : 0.75).attr("filter", main ? null : blur);
        svg.append("g").selectAll("circle").data(pts(id)).join("circle").attr("cx", (p) => p[0]).attr("cy", (p) => p[1])
          .attr("r", 3.5).attr("fill", c)
          .on("pointerenter pointermove", (e, p) => UB.showTip(e, NAMES[id], [`Match ${y.invert(p[1]).toFixed(2)}`]))
          .on("pointerleave", UB.hideTip);
      });

      // End labels, nudged apart so they never overlap.
      const labels = ids.map((id) => ({ id, y: y(data.correlation[id].d3) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 16);
      svg.append("g").selectAll("text").data(labels).join("text")
        .attr("class", (d) => (d.id === "ulaanbaatar" ? "label-strong" : "label"))
        .attr("x", x(3) + 12).attr("y", (d) => d.y).attr("dy", "0.35em").text((d) => NAMES[d.id]);
    });
  }

  /** Every day since 1940: one row per year, one cell per day, on canvas.
      A blurred copy underneath makes the colors glow. */
  function everyDay(data) {
    const el = document.getElementById("everyday");
    const years = Object.keys(data.years).map(Number).sort((a, b) => a - b);
    // Near normal days fade into the dark, so only unusual days glow.
    const color = d3.scaleLinear().domain([-10, -2.5, 0, 2.5, 10])
      .range([UB.css("--cold"), "#1f4250", "#0b0b0d", "#4d3820", UB.css("--warm")])
      .interpolate(d3.interpolateLab).clamp(true);
    const warmShare = (y0, y1) => {
      const all = years.filter((y) => y >= y0 && y <= y1).flatMap((y) => data.years[y].anomaly);
      return all.filter((v) => v > 0).length / all.length;
    };
    const lastYear = years[years.length - 1];
    const then = Math.round(warmShare(1960, 1969) * 100);
    const now = Math.round(warmShare(lastYear - 9, lastYear) * 100);
    const c = data.comparison;
    const p = c.welch_p < 0.001 ? "p < 0.001" : `p = ${c.welch_p}`;
    UB.rich(document.getElementById("everyday-takeaway"),
      `In the 1960s, ${then}% of days were warmer than normal. In ${c.recent[0]} to ${c.recent[1]}, [[${now}%]] were. ` +
      `The mean yearly anomaly rose from ${UB.signed(c.early_mean, 2)}° to ${UB.signed(c.recent_mean, 2)}°, a statistically significant difference ` +
      `([[Welch's t-test on yearly means, ${p}]]) with a large effect size ([[Cohen's d = ${c.cohens_d.toFixed(1)}]]).`);

    UB.responsive(el, (width) => {
      const m = { top: 22, right: 0, bottom: 0, left: width < 640 ? 34 : 44 };
      const rowH = width < 640 ? 4 : 5;
      const plotW = width - m.left - m.right;
      const cellW = plotW / 366;
      const height = m.top + rowH * years.length + m.bottom;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const make = (cls) => {
        const c = document.createElement("canvas");
        if (cls) c.className = cls;
        c.width = Math.round(width * dpr);
        c.height = Math.round(height * dpr);
        c.style.height = `${height}px`;
        el.appendChild(c);
        const ctx = c.getContext("2d");
        ctx.scale(dpr, dpr);
        return ctx;
      };
      const glowCtx = make("glow-layer");
      const ctx = make();
      [glowCtx, ctx].forEach((g) => {
        years.forEach((y, r) => {
          const row = data.years[y];
          const start = new Date(`${row.start}T00:00:00Z`);
          const jan1 = Date.UTC(y, 0, 1);
          const offset = Math.round((start - jan1) / 864e5);
          row.anomaly.forEach((a, j) => {
            g.fillStyle = color(a);
            g.fillRect(m.left + (offset + j) * cellW, m.top + r * rowH, Math.max(1, cellW + 0.3), rowH - 1);
          });
        });
      });

      const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
      const months = d3.utcMonths(new Date(Date.UTC(2001, 0, 1)), new Date(Date.UTC(2002, 0, 1)));
      svg.selectAll("text.m").data(months).join("text").attr("class", "label")
        .attr("x", (d) => m.left + ((d - Date.UTC(2001, 0, 1)) / 864e5) * cellW).attr("y", 12)
        .text((d) => (width < 640 ? d3.utcFormat("%b")(d)[0] : d3.utcFormat("%b")(d)));
      svg.selectAll("text.y").data(years.filter((y) => y % 10 === 0)).join("text").attr("class", "label")
        .attr("x", m.left - 8).attr("text-anchor", "end").attr("dy", "0.35em")
        .attr("y", (y) => m.top + (y - years[0]) * rowH + rowH / 2).text((y) => (width < 640 ? `\u2019${String(y).slice(2)}` : y));

      const pick = (e) => {
        const box = el.getBoundingClientRect();
        const x = e.clientX - box.left - m.left;
        const r = Math.floor((e.clientY - box.top - m.top) / rowH);
        if (x < 0 || r < 0 || r >= years.length) return null;
        const y = years[r];
        const row = data.years[y];
        const day = Math.floor(x / cellW);
        const start = Date.parse(`${row.start}T00:00:00Z`);
        const j = day - Math.round((start - Date.UTC(y, 0, 1)) / 864e5);
        if (j < 0 || j >= row.temp.length) return null;
        return { date: new Date(start + j * 864e5), t: row.temp[j], a: row.anomaly[j] };
      };
      el.onpointermove = (e) => {
        const p = pick(e);
        if (!p) { UB.hideTip(); return; }
        const how = Math.abs(p.a) < 0.5 ? "about normal" : `${Math.abs(p.a).toFixed(1)}° ${p.a < 0 ? "colder" : "warmer"} than normal`;
        UB.showTip(e, p.date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
          [`${UB.num(p.t)}° average`, `~${how}`]);
      };
      el.onpointerleave = UB.hideTip;
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const load = (id, path, fn) => UB.fetchJSON(path).then(fn).catch((err) => UB.fail(document.getElementById(id), err));
    load("everyday", "data/every_day.json", everyDay);
    load("ridgeline", "data/every_day.json", (d) => { winterLines(d); ridgeScroll(); });
    load("warming", "data/warming.json", warming);
    load("seasonal", "data/seasonal.json", seasonal);
    load("upwind", "data/upwind.json", upwind);
  });
})();
