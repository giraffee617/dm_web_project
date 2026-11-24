/* model.js: the Model section. Model card, the time split, and tuning. */
(() => {
  const DAYS = ["1 day ahead", "2 days ahead", "3 days ahead"];
  const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const n = (v) => d3.format(",")(v);

  function card(m) {
    const el = document.getElementById("card");
    const s = m.split;
    const rows = [
      ["Task", "Forecast Ulaanbaatar's daily average temperature 1, 2 and 3 days ahead (regression)"],
      ["Target", "Temperature anomaly in °C: the difference from the normal for that date. Forecast = anomaly + normal"],
      ["Strategy", "Direct: one separate model for each day ahead"],
      ["Algorithm", `Gradient boosted decision trees, ${m.library === "catboost" ? "CatBoost" : m.library} ${m.library_version}`],
      ["Inputs", `${m.n_features} features chosen from 158, built from Ulaanbaatar and four upwind places`],
      ["Training", `${fmtDate(s.train.start)} to ${fmtDate(s.train.end)}, ${n(s.train.days)} days`],
      ["Validation", `${fmtDate(s.val.start)} to ${fmtDate(s.val.end)}, ${n(s.val.days)} days`],
      ["Test", `${fmtDate(s.test.start)} to ${fmtDate(s.test.end)}, ${n(s.test.days)} days, used once`],
      ["Deployed model", `Retrained on ${fmtDate(m.final_period[0])} to ${fmtDate(m.final_period[1])} with the tuned settings`],
      ["Metric", "RMSE in °C (average miss, big misses count more), plus MAE"],
      ["Early stopping", `Stop when validation error has not improved for ${m.early_stopping_patience} trees (at most ${n(m.max_trees)})`],
      ["Tuning", `Optuna, ${m.trials_per_horizon} trials for each day ahead, weak trials stopped early`],
      ["Reproducible", `Fixed random seed (${m.seed}), pinned package versions, fingerprints of every data file`],
    ];
    rows.forEach(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      el.append(dt, dd);
    });
  }

  function timeline(m) {
    const el = document.getElementById("timeline");
    const s = m.split;
    const parts = [
      { key: "train", label: "Training", color: "#5a5a5e" },
      { key: "val", label: "Validation", color: UB.css("--text") },
      { key: "test", label: "Test", color: UB.css("--cold") },
    ];
    const key = document.getElementById("split-key");
    parts.forEach((p) => {
      const span = document.createElement("span");
      const dot = document.createElement("i");
      dot.style.background = p.color;
      const name = document.createElement("b");
      name.textContent = p.label;
      span.append(dot, name, document.createTextNode(
        ` ${new Date(s[p.key].start).getFullYear()} to ${new Date(s[p.key].end).getFullYear()}, ${n(s[p.key].days)} days`));
      key.appendChild(span);
    });
    UB.responsive(el, (width) => {
      const height = 44;
      const x = d3.scaleUtc().domain([new Date("1980-01-01"), new Date("2026-01-01")]).range([0, width]);
      const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("aria-label", "Time split");
      const blur = UB.glow(svg, "split-glow", 4);
      parts.forEach((p) => {
        const a = x(new Date(s[p.key].start));
        const b = x(new Date(s[p.key].end));
        svg.append("rect").attr("x", a).attr("y", 10).attr("width", Math.max(2, b - a)).attr("height", 12).attr("rx", 6)
          .attr("fill", p.color).attr("filter", p.key === "test" ? blur : null);
      });
      [1980, 2000, 2020].forEach((yr) => {
        svg.append("text").attr("class", "label").attr("x", x(new Date(`${yr}-01-01`))).attr("y", 40)
          .attr("text-anchor", yr === 1980 ? "start" : "middle").style("font-size", "12px").text(yr);
      });
    });
  }

  function tuning(m) {
    document.getElementById("tuning-explain").textContent =
      `Optuna tried ${m.trials_per_horizon} settings for each day ahead, always starting from CatBoost's own defaults (trial 0), so tuning could never make things worse. Weak trials were stopped early to save time.`;
    const table = document.createElement("table");
    const head = table.createTHead().insertRow();
    ["", ...DAYS].forEach((t) => { const th = document.createElement("th"); th.textContent = t; head.appendChild(th); });
    const body = table.createTBody();
    const H = ["d1", "d2", "d3"].map((k) => m.horizons[k]);
    const rows = [
      ["Learning rate (step size)", (h) => h.params.learning_rate.toFixed(3)],
      ["Tree depth", (h) => h.params.depth],
      ["L2 (brake on extreme values)", (h) => h.params.l2_leaf_reg.toFixed(1)],
      ["Random strength", (h) => h.params.random_strength.toFixed(1)],
      ["Share of days per tree", (h) => h.params.subsample.toFixed(2)],
      ["Trees (early stopping)", (h) => n(h.trees_train_only)],
      ["Validation error, defaults", (h) => `${h.val_rmse_default.toFixed(3)}°`],
      ["Validation error, tuned", (h) => `${h.val_rmse_tuned.toFixed(3)}°`, true],
    ];
    rows.forEach(([label, f, hl]) => {
      const tr = body.insertRow();
      const th = tr.insertCell();
      th.textContent = label;
      H.forEach((h) => { const td = tr.insertCell(); td.textContent = f(h); if (hl) td.className = "hl"; });
    });
    document.getElementById("tuning-table").appendChild(table);
  }

  document.addEventListener("DOMContentLoaded", () => {
    UB.fetchJSON("data/model_card.json").then((m) => { card(m); timeline(m); tuning(m); })
      .catch((err) => UB.fail(document.getElementById("card"), err));
  });
})();
