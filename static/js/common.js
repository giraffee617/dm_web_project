/* common.js: small helpers shared by every section. */
const UB = (() => {
  const cache = {};

  /** Load a JSON file once. */
  function fetchJSON(path) {
    if (!cache[path]) {
      cache[path] = fetch(path).then((r) => {
        if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
        return r.json();
      });
    }
    return cache[path];
  }

  /** CSS variable value, e.g. css("--cold"). */
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /** Numbers with a real minus sign. */
  const num = (v, d = 1) => (v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  const signed = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);

  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** Anomaly color: cyan when colder, amber when warmer, dim grey near normal. */
  function anomalyColor(limit = 10) {
    return d3.scaleLinear().domain([-limit, 0, limit])
      .range([css("--cold"), "#3a3a3c", css("--warm")]).interpolate(d3.interpolateLab).clamp(true);
  }

  /** Tooltip. Title and lines are set as text only. */
  const tipEl = () => document.getElementById("tooltip");
  function showTip(event, title, lines = []) {
    const el = tipEl();
    el.replaceChildren();
    const b = document.createElement("b");
    b.textContent = title;
    el.appendChild(b);
    lines.forEach((l) => {
      const div = document.createElement("div");
      div.textContent = l;
      if (l.startsWith("~")) { div.textContent = l.slice(1); div.className = "muted"; }
      el.appendChild(div);
    });
    el.classList.add("on");
    moveTip(event);
  }
  function moveTip(event) {
    const el = tipEl();
    const x = event.clientX ?? 0;
    const y = event.clientY ?? 0;
    const w = el.offsetWidth;
    el.style.left = `${Math.min(window.innerWidth - w - 10, x + 14)}px`;
    el.style.top = `${y + 16}px`;
  }
  const hideTip = () => tipEl().classList.remove("on");

  /** Draw a chart now, and again when its width changes. */
  function responsive(el, draw) {
    let last = 0;
    const run = () => {
      const w = Math.round(el.clientWidth);
      if (!w || w === last) return;
      last = w;
      el.replaceChildren();
      draw(w);
    };
    run();
    new ResizeObserver(run).observe(el);
    return () => { last = 0; run(); };
  }

  /** Segmented tabs. Calls onSelect(index) right away and on every click. */
  function tabs(el, labels, onSelect) {
    const buttons = labels.map((label, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tab";
      b.setAttribute("role", "tab");
      b.textContent = label;
      b.addEventListener("click", () => select(i));
      el.appendChild(b);
      return b;
    });
    function select(i) {
      buttons.forEach((b, j) => b.setAttribute("aria-selected", String(i === j)));
      onSelect(i);
    }
    select(0);
  }

  /** Soft glow filter for SVG lines and points. */
  function glow(svg, id, blur = 4) {
    const f = svg.append("defs").append("filter").attr("id", id)
      .attr("filterUnits", "userSpaceOnUse").attr("x", -4000).attr("y", -4000).attr("width", 12000).attr("height", 12000);
    f.append("feGaussianBlur").attr("stdDeviation", blur).attr("result", "b");
    const m = f.append("feMerge");
    m.append("feMergeNode").attr("in", "b");
    m.append("feMergeNode").attr("in", "SourceGraphic");
    return `url(#${id})`;
  }

  /** Plain English names for the model's features. */
  const PLACES = { ub: "Ulaanbaatar", uli: "Uliastai", kho: "Khovd", mor: "Mörön", irk: "Irkutsk" };
  const PARTS = {
    t_anom: "temperature vs normal", t_range: "day to night temperature range",
    p_change_24h: "pressure change in 24 hours", p_mean: "air pressure",
    snow_depth_end: "snow on the ground", rh_mean: "humidity", dew_end: "evening dew point",
    wind_from_n: "north to south wind", wind_from_e: "east to west wind", wind_speed: "wind speed",
    cloud_mean: "cloud cover", precip_sum: "rain and snowfall",
    t_anom_roll3_mean: "temperature vs normal, last 3 days", t_anom_roll30_mean: "temperature vs normal, last 30 days",
    p_mean_roll30_mean: "air pressure, last 30 days",
  };
  function featureName(code) {
    const m = code.match(/^([a-z]+)_minus_ub_(.+)$/);
    if (m) return `${PLACES[m[1]]} minus Ulaanbaatar, ${PARTS[m[2]] || m[2]}`;
    const [place, ...rest] = code.split("_");
    const part = rest.join("_");
    return `${PLACES[place] || place}, ${PARTS[part] || part.replace(/_/g, " ")}`;
  }

  /** Fade sections in as they scroll into view. */
  function reveal() {
    const items = document.querySelectorAll(".reveal");
    if (reducedMotion() || !("IntersectionObserver" in window)) { items.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { rootMargin: "0px 0px -8% 0px" });
    items.forEach((e) => io.observe(e));
  }
  document.addEventListener("DOMContentLoaded", reveal);

  /** Set text where [[...]] parts are highlighted as key phrases (built as
      text nodes and spans, never as HTML). */
  function rich(el, text) {
    el.replaceChildren();
    text.split(/(\[\[[^\]]+\]\])/).forEach((part) => {
      if (part.startsWith("[[")) {
        const s = document.createElement("span");
        s.className = "kw";
        s.textContent = part.slice(2, -2);
        el.appendChild(s);
      } else if (part) {
        el.appendChild(document.createTextNode(part));
      }
    });
  }

  function fail(el, err) {
    console.error(err);
    el.textContent = "This chart could not be loaded.";
    el.style.color = css("--text-3");
  }

  return { fetchJSON, css, num, signed, reducedMotion, anomalyColor, showTip, moveTip, hideTip,
    responsive, tabs, glow, featureName, rich, fail };
})();
