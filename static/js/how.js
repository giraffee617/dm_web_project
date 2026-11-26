/* how.js: what the model pays attention to (SHAP), per forecast day. */
(() => {
  const DAYS = ["1 day ahead", "2 days ahead", "3 days ahead"];
  const GROUPS = [
    { key: "Upwind sites", label: "Upwind places", color: () => UB.css("--cold") },
    { key: "UB today", label: "Ulaanbaatar today", color: () => "#f5f5f7" },
    { key: "UB recent days", label: "Ulaanbaatar, past days", color: () => "#48484a" },
  ];

  function draw(data) {
    const groupsEl = document.getElementById("shap-groups");
    const featEl = document.getElementById("shap-features");
    let day = 0;
    let redrawGroups = () => {};
    let redrawFeatures = () => {};

    redrawGroups = UB.responsive(groupsEl, (width) => {
      const g = data.groups[`d${day + 1}`];
      const total = d3.sum(GROUPS, (k) => g[k.key]);
      const svg = d3.select(groupsEl).append("svg").attr("viewBox", `0 0 ${width} 74`).attr("aria-label", "Attention by group");
      let x0 = 0;
      GROUPS.forEach((k) => {
        const w = (g[k.key] / total) * width;
        svg.append("rect").attr("x", x0 + 1).attr("y", 0).attr("width", Math.max(0, w - 2)).attr("height", 14).attr("rx", 7)
          .attr("fill", k.color());
        if (w > 70) {
          svg.append("text").attr("class", "label-strong").attr("x", x0 + 2).attr("y", 40).text(`${Math.round((g[k.key] / total) * 100)}%`);
          svg.append("text").attr("class", "label").attr("x", x0 + 2).attr("y", 60).text(k.label);
        }
        x0 += w;
      });
      const up = Math.round((g["Upwind sites"] / total) * 100);
      UB.rich(document.getElementById("shap-takeaway"), day === 0
        ? `1 day ahead, Ulaanbaatar's own temperature is the strongest single feature, but upwind places together give [[${up}% of the importance]].`
        : `${DAYS[day][0]} days ahead, upwind places give [[${up}% of the importance]], more than Ulaanbaatar itself.`);
    });

    redrawFeatures = UB.responsive(featEl, (width) => {
      // Top 10 from the four Mongolian places (Irkutsk's numbers are left out of the list).
      const entries = Object.entries(data.features[`d${day + 1}`]).filter(([f]) => !f.startsWith("irk_")).slice(0, 10);
      const row = 38;
      const narrow = width < 640;
      const m = { top: 4, right: 50, bottom: 4, left: narrow ? 0 : 330 };
      const height = m.top + entries.length * row * (narrow ? 1.5 : 1) + m.bottom;
      const x = d3.scaleLinear().domain([0, d3.max(entries, (e) => e[1])]).range([m.left, width - m.right]);
      const svg = d3.select(featEl).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("aria-label", "Top 10 features");
      const blur = UB.glow(svg, "shap-glow", 3);
      const g = svg.selectAll("g").data(entries).join("g")
        .attr("transform", (d, i) => `translate(0,${m.top + i * row * (narrow ? 1.5 : 1) + (narrow ? 34 : row / 2)})`);
      g.append("text").attr("class", "label").attr("x", narrow ? 0 : m.left - 16).attr("y", narrow ? -16 : 0).attr("dy", "0.35em")
        .attr("text-anchor", narrow ? "start" : "end").text((d) => UB.featureName(d[0]));
      g.append("line").attr("x1", x(0)).attr("x2", (d) => x(d[1])).attr("stroke-width", 6).attr("stroke-linecap", "round")
        .attr("stroke", (d) => (d[0].startsWith("ub_") ? "#f5f5f7" : UB.css("--cold")))
        .attr("filter", (d) => (d[0].startsWith("ub_") ? null : blur));
      g.append("text").attr("class", "label").attr("x", (d) => x(d[1]) + 12).attr("dy", "0.35em")
        .text((d) => `${d[1].toFixed(2)}°`);
    });

    UB.tabs(document.getElementById("shap-tabs"), DAYS, (i) => { day = i; redrawGroups(); redrawFeatures(); });
  }

  document.addEventListener("DOMContentLoaded", () => {
    UB.fetchJSON("data/shap.json").then(draw).catch((err) => UB.fail(document.getElementById("shap-features"), err));
  });
})();
