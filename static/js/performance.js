/* performance.js: error table, confusion matrices, learning curves,
   library choice, feature choice, and the live data check. */
(() => {
  const DAYS = ["1 day ahead", "2 days ahead", "3 days ahead"];

  function bignums(gap) {
    const box = document.getElementById("bignums");
    [1, 2, 3].forEach((h) => {
      const v = gap.horizons[`d${h}`].test_final_model.mae;
      const div = document.createElement("div");
      const a = document.createElement("p");
      a.className = "bignum-v";
      a.textContent = `${v.toFixed(1)}°`;
      const b = document.createElement("p");
      b.className = "bignum-l";
      b.textContent = `Average miss, ${DAYS[h - 1]}`;
      div.append(a, b);
      box.appendChild(div);
    });
  }

  function gapTable(gap) {
    const table = document.createElement("table");
    const head = table.createTHead().insertRow();
    ["", "Training", "Validation", "Test"].forEach((t) => { const th = document.createElement("th"); th.textContent = t; head.appendChild(th); });
    const body = table.createTBody();
    [1, 2, 3].forEach((h) => {
      const r = gap.horizons[`d${h}`];
      const tr = body.insertRow();
      [DAYS[h - 1], r.train.rmse, r.val.rmse, r.test_final_model.rmse].forEach((v, i) => {
        const td = tr.insertCell();
        td.textContent = i === 0 ? v : `${v.toFixed(2)}°`;
        if (i === 3) td.className = "hl";
      });
    });
    document.getElementById("gap-table").appendChild(table);
  }

  function confusion(cm) {
    const el = document.getElementById("cm");
    const names = ["Colder", "Near normal", "Warmer"];
    const cold = d3.color(UB.css("--cold"));
    UB.tabs(document.getElementById("cm-tabs"), DAYS, (k) => {
      const h = cm.horizons[`d${k + 1}`];
      el.replaceChildren();
      const cell = (cls, text) => { const d = document.createElement("div"); d.className = cls; d.textContent = text; el.appendChild(d); return d; };
      cell("cm-h", "");
      names.forEach((n) => cell("cm-h", `Predicted ${n.toLowerCase()}`));
      h.matrix.forEach((row, i) => {
        const total = d3.sum(row);
        cell("cm-r", `Actual ${names[i].toLowerCase()}`);
        row.forEach((v, j) => {
          const share = v / total;
          const c = cell("cm-c", "");
          const b = document.createElement("b");
          b.textContent = v;
          const s = document.createElement("span");
          s.textContent = `${Math.round(share * 100)}%`;
          c.append(b, s);
          const bg = cold.copy({ opacity: 0.08 + share * 0.82 });
          c.style.background = bg.formatRgb();
          c.style.color = share > 0.5 ? "#000" : UB.css("--text");
          if (i === j && share > 0.5) c.style.boxShadow = `0 0 28px ${cold.copy({ opacity: 0.35 }).formatRgb()}`;
        });
      });
      // Precision and recall for each class, and macro F1.
      const M = h.matrix;
      const scores = names.map((n, c) => {
        const tp = M[c][c];
        const predicted = d3.sum(M, (r) => r[c]);
        const actual = d3.sum(M[c]);
        const precision = tp / predicted;
        const recall = tp / actual;
        return { n, precision, recall, f1: (2 * precision * recall) / (precision + recall) };
      });
      const macroF1 = d3.mean(scores, (s) => s.f1);
      const box = document.getElementById("cm-scores");
      box.replaceChildren();
      const table = document.createElement("table");
      const head = table.createTHead().insertRow();
      ["", "Precision", "Recall", "F1"].forEach((t) => { const th = document.createElement("th"); th.textContent = t; head.appendChild(th); });
      const body = table.createTBody();
      scores.forEach((s) => {
        const tr = body.insertRow();
        [s.n, s.precision, s.recall, s.f1].forEach((v, i) => { tr.insertCell().textContent = i === 0 ? v : v.toFixed(2); });
      });
      box.appendChild(table);
      UB.rich(document.getElementById("cm-takeaway"),
        `Accuracy is [[${Math.round(h.accuracy * 100)}%]] on ${d3.format(",")(h.days)} test days (a random guess would score about 33%), macro F1 ${macroF1.toFixed(2)}. ` +
        `A cold day was predicted as warm, or the reverse, on only [[${h.far_misses} days]]. Most errors are between neighbouring classes.`);
    });
  }

  function curves(lc) {
    const el = document.getElementById("curve");
    let k = 0;
    const redraw = UB.responsive(el, (width) => {
      const d = lc[`d${k + 1}`];
      const m = { top: 14, right: 16, bottom: 34, left: 48 };
      const height = Math.round(Math.max(260, width * 0.38));
      const x = d3.scaleLinear().domain(d3.extent(d.rounds)).range([m.left, width - m.right]);
      const all = d.train_rmse.concat(d.val_rmse);
      const y = d3.scaleLinear().domain([Math.max(0, d3.min(all) - 0.1), d3.max(all) + 0.1]).nice().range([height - m.bottom, m.top]);
      const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("aria-label", "Learning curve");
      const blur = UB.glow(svg, "curve-glow", 3);
      svg.append("g").attr("class", "grid").selectAll("line").data(y.ticks(5)).join("line")
        .attr("x1", m.left).attr("x2", width - m.right).attr("y1", y).attr("y2", y);
      svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left - 8},0)`)
        .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${v.toFixed(1)}°`).tickSize(0)).call((g) => g.select(".domain").remove());
      svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.bottom + 12})`)
        .call(d3.axisBottom(x).ticks(width < 640 ? 3 : 5).tickFormat((v) => (width < 640 ? d3.format(",")(v) : `${d3.format(",")(v)} trees`)).tickSize(0)).call((g) => g.select(".domain").remove());
      const line = (ys) => d3.line().x((v, i) => x(d.rounds[i])).y((v) => y(v))(ys);
      svg.append("path").attr("d", line(d.train_rmse)).attr("fill", "none").attr("stroke", UB.css("--text-2"))
        .attr("stroke-width", 1.6).attr("stroke-dasharray", "5 4");
      svg.append("path").attr("d", line(d.val_rmse)).attr("fill", "none").attr("stroke", UB.css("--cold"))
        .attr("stroke-width", 2.2).attr("filter", blur);
      const xs = x(Math.min(d.early_stopping_round, x.domain()[1]));
      svg.append("line").attr("x1", xs).attr("x2", xs).attr("y1", m.top).attr("y2", height - m.bottom)
        .attr("stroke", "#fff").attr("opacity", 0.5);
      svg.append("text").attr("class", "label-strong").attr("x", xs - 8).attr("y", m.top + 12).attr("text-anchor", "end")
        .text(`Stopped at ${d3.format(",")(d.early_stopping_round)} trees`);
    });
    UB.tabs(document.getElementById("curve-tabs"), DAYS, (i) => { k = i; redraw(); });
  }

  function bakeoff(b) {
    const el = document.getElementById("bakeoff");
    const libs = [["catboost", "CatBoost"], ["lightgbm", "LightGBM"], ["xgboost", "XGBoost"]]
      .map(([id, name]) => ({ id, name, v: b.results[id].mean })).sort((a, c) => a.v - c.v);
    UB.rich(document.getElementById("bakeoff-takeaway"),
      `[[CatBoost had the lowest error]] and was selected for tuning. It also won a second comparison in which every library could grow as many trees as early stopping allowed, since the defaults give CatBoost 1,000 trees and the others 100.`);
    UB.responsive(el, (width) => {
      const row = 50;
      const m = { left: 96, right: 70 };
      const height = row * libs.length;
      const x = d3.scaleLinear().domain([2.3, 2.62]).range([m.left, width - m.right]);
      const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("aria-label", "Library comparison");
      const blur = UB.glow(svg, "bake-glow", 4);
      const g = svg.selectAll("g").data(libs).join("g").attr("transform", (d, i) => `translate(0,${i * row + row / 2})`);
      g.append("text").attr("class", (d, i) => (i === 0 ? "label-strong" : "label")).attr("dy", "0.35em").text((d) => d.name);
      g.append("line").attr("x1", m.left).attr("x2", (d) => x(d.v)).attr("stroke-width", 8).attr("stroke-linecap", "round")
        .attr("stroke", (d, i) => (i === 0 ? UB.css("--cold") : "#3a3a3c")).attr("filter", (d, i) => (i === 0 ? blur : null));
      g.append("text").attr("class", "label").attr("x", (d) => x(d.v) + 14).attr("dy", "0.35em").text((d) => `${d.v.toFixed(2)}°`);
    });
  }

  function selection(fs) {
    const el = document.getElementById("selection");
    UB.responsive(el, (width) => {
      const m = { top: 14, right: 16, bottom: 34, left: 48 };
      const height = Math.round(Math.max(240, width * 0.34));
      const x = d3.scaleLog().domain([1, d3.max(fs.curve, (d) => d.n_features)]).range([m.left, width - m.right]);
      const y = d3.scaleLinear().domain([2.4, d3.max(fs.curve, (d) => d.mean) + 0.05]).range([height - m.bottom, m.top]);
      const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("aria-label", "Feature selection curve");
      const blur = UB.glow(svg, "sel-glow", 3);
      svg.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line")
        .attr("x1", m.left).attr("x2", width - m.right).attr("y1", y).attr("y2", y);
      svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left - 8},0)`)
        .call(d3.axisLeft(y).ticks(4).tickFormat((v) => `${v.toFixed(1)}°`).tickSize(0)).call((g) => g.select(".domain").remove());
      svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.bottom + 12})`)
        .call(d3.axisBottom(x).tickValues([1, 5, 10, 25, 40, 126]).tickFormat((v) => v).tickSize(0)).call((g) => g.select(".domain").remove());
      svg.append("path").attr("fill", "none").attr("stroke", UB.css("--cold")).attr("stroke-width", 2.2).attr("filter", blur)
        .attr("d", d3.line().curve(d3.curveMonotoneX).x((d) => x(d.n_features)).y((d) => y(d.mean))(fs.curve));
      const chosen = fs.curve.find((d) => d.n_features === fs.chosen_n);
      if (chosen) {
        svg.append("circle").attr("cx", x(chosen.n_features)).attr("cy", y(chosen.mean)).attr("r", 5).attr("fill", "#fff");
        svg.append("text").attr("class", "label-strong").attr("x", x(chosen.n_features)).attr("y", y(chosen.mean) - 14)
          .attr("text-anchor", "middle").text(`${fs.chosen_n} kept`);
      }
      svg.selectAll("circle.pt").data(fs.curve).join("circle").attr("class", "pt")
        .attr("cx", (d) => x(d.n_features)).attr("cy", (d) => y(d.mean)).attr("r", 10).attr("fill", "transparent")
        .on("pointerenter pointermove", (e, d) => UB.showTip(e, `Top ${d.n_features} features`, [`Average error ${d.mean.toFixed(2)}°`]))
        .on("pointerleave", UB.hideTip);
    });
  }

  function baselines(mc) {
    const el = document.getElementById("baselines");
    const kinds = [
      { key: "climatology", label: "Climatology", color: "#2c2c2e" },
      { key: "persistence", label: "Persistence", color: "#5a5a5e" },
      { key: "model", label: "Model", color: UB.css("--cold") },
    ];
    const key = document.getElementById("baselines-key");
    kinds.forEach((k) => {
      const span = document.createElement("span");
      const i = document.createElement("i");
      i.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:3px;background:${k.color}`;
      span.append(i, document.createTextNode(k.label));
      key.appendChild(span);
    });
    const better = ["d1", "d2", "d3"].map((d) => {
      const t = mc.horizons[d].test;
      return Math.round((1 - t.model.rmse / t.persistence.rmse) * 100);
    });
    UB.rich(document.getElementById("baselines-takeaway"),
      `The model beats both baselines on all three days. Its RMSE is [[${better[0]}% lower than persistence]] 1 day ahead, ${better[1]}% lower 2 days ahead and ${better[2]}% lower 3 days ahead.`);

    UB.responsive(el, (width) => {
      const bar = 14;
      const group = bar * 3 + 34;
      const m = { left: width < 640 ? 0 : 120, right: 56, top: width < 640 ? 22 : 4 };
      const height = m.top + group * 3;
      const x = d3.scaleLinear().domain([0, 5.2]).range([m.left, width - m.right]);
      const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("aria-label", "Model vs simple rules");
      const blur = UB.glow(svg, "base-glow", 4);
      ["d1", "d2", "d3"].forEach((d, gi) => {
        const g = svg.append("g").attr("transform", `translate(0,${m.top + gi * group})`);
        g.append("text").attr("class", "label-strong").attr("x", width < 640 ? 0 : 0).attr("y", width < 640 ? -6 : bar * 1.5)
          .attr("dy", width < 640 ? 0 : "0.35em").text(DAYS[gi]);
        kinds.forEach((k, i) => {
          const v = mc.horizons[d].test[k.key].rmse;
          g.append("rect").attr("x", m.left).attr("y", i * bar).attr("width", x(v) - m.left).attr("height", bar - 3).attr("rx", 3)
            .attr("fill", k.color).attr("filter", k.key === "model" ? blur : null);
          g.append("text").attr("class", k.key === "model" ? "label-strong" : "label").attr("x", x(v) + 8).attr("y", i * bar + (bar - 3) / 2)
            .attr("dy", "0.35em").style("font-size", "12px").text(`${v.toFixed(2)}°`);
        });
      });
    });
  }

  function source(sc) {
    const s = sc.summary;
    document.getElementById("source-note").textContent =
      `The model learned from the ERA5 climate record, but the live forecast uses recent data from a different weather service, because ERA5 is about five days behind. ` +
      `On ${s.days_compared} recent days, the two sources differed by ${s.ub_temperature_mae.toFixed(1)}° on average for Ulaanbaatar. ` +
      `Switching sources moved the 1 day forecast by ${s.forecast_change_mae.d1.toFixed(1)}°, which is less than its usual error.`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const load = (id, path, fn) => UB.fetchJSON(path).then(fn).catch((err) => UB.fail(document.getElementById(id), err));
    load("gap-table", "data/gap_table.json", (g) => { bignums(g); gapTable(g); });
    load("cm", "data/confusion.json", confusion);
    load("curve", "data/learning_curves.json", curves);
    load("bakeoff", "data/bakeoff.json", bakeoff);
    load("selection", "data/feature_selection.json", selection);
    load("source-note", "data/source_check.json", source);
    load("baselines", "data/model_card.json", baselines);
  });
})();
