/* forecast.js: the live three day forecast from /api/forecast, shown as a list.
   Each row is one day: the model's prediction on the left, the actual weather
   (Open-Meteo, from national weather services) on the right. */
(() => {
  const dayName = (iso, today) => {
    const diff = Math.round((new Date(`${iso}T12:00:00`) - new Date(`${today}T12:00:00`)) / 864e5);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long" });
  };
  const shortDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const longDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

  /** The weather service's hourly temperatures for Ulaanbaatar, summarized per day:
      {date: {h12, h20, mean, min, max}}, or null if it cannot be reached. */
  async function serviceDays() {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=47.92&longitude=106.92"
      + "&hourly=temperature_2m&timezone=Asia%2FUlaanbaatar&past_days=1&forecast_days=4";
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const h = (await r.json()).hourly;
      const byDay = {};
      h.time.forEach((t, i) => {
        (byDay[t.slice(0, 10)] = byDay[t.slice(0, 10)] || {})[t.slice(11, 13)] = h.temperature_2m[i];
      });
      const out = {};
      Object.entries(byDay).forEach(([day, hours]) => {
        const vals = Object.values(hours).filter((v) => v != null);
        if (vals.length !== 24 || hours["12"] == null || hours["20"] == null) return;
        out[day] = { h12: hours["12"], h20: hours["20"], mean: d3.mean(vals), min: d3.min(vals), max: d3.max(vals) };
      });
      return out;
    } catch (err) {
      return null;
    }
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function timesBlock(pairs) {
    const times = el("div", "day-times");
    pairs.forEach(([label, value]) => {
      const box = el("div");
      box.append(el("p", "day-time-l", label), el("p", "day-time-v", `${UB.num(value, 0)}°`));
      times.appendChild(box);
    });
    return times;
  }

  async function load() {
    const rows = document.getElementById("forecast-days");
    const meta = document.getElementById("forecast-meta");
    let f;
    try {
      const r = await fetch("api/forecast");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      f = await r.json();
    } catch (err) {
      console.error(err);
      meta.textContent = "The forecast is not available right now. Please try again later.";
      return;
    }
    const [cycle, actual] = await Promise.all([UB.fetchJSON("data/daily_cycle.json").catch(() => null), serviceDays()]);
    let usedTypical = false;

    f.days.forEach((d) => {
      const row = el("div", "compare-row");

      // Model: the daily mean is the model's forecast. 12 PM and 8 PM add the
      // difference between that hour and the daily mean, from the weather
      // service if available, otherwise the usual difference for this date.
      const model = el("div", "day");
      model.append(el("p", "day-name", `${dayName(d.date, f.today)}, ${shortDate(d.date)}`));
      const a = actual && actual[d.date];
      let s = a ? { h12: a.h12 - a.mean, h20: a.h20 - a.mean } : null;
      if (!s && cycle) {
        const k = cycle.dates.indexOf(d.date.slice(5) === "02-29" ? "02-28" : d.date.slice(5));
        if (k >= 0) { s = { h12: cycle.h12[k], h20: cycle.h20[k] }; usedTypical = true; }
      }
      model.append(s ? timesBlock([["12 PM", d.temperature + s.h12], ["8 PM", d.temperature + s.h20]])
        : timesBlock([["Day average", d.temperature]]));
      model.append(el("p", "day-mean", `Day average ${UB.num(d.temperature)}°`));

      // Actual weather from the weather service.
      const real = el("div", "day day-actual");
      real.append(el("p", "day-name", `${dayName(d.date, f.today)}, ${shortDate(d.date)}`));
      if (a) {
        real.append(timesBlock([["12 PM", a.h12], ["8 PM", a.h20]]));
        real.append(el("p", "day-mean", `Day average ${UB.num(a.mean)}°`));
      } else {
        real.append(el("p", "day-err", "The weather service could not be reached."));
      }

      row.append(model, real);
      rows.appendChild(row);
    });

    meta.textContent = `Model: uses the weather up to ${longDate(f.data_through)}. `
      + "Actual weather: from Open-Meteo (national weather services). For days still to come, it is their forecast.";
    document.getElementById("swing-note").textContent = usedTypical
      ? "The model predicts the day average. Its 12 PM and 8 PM values add the usual difference for that hour on this date."
      : "The model predicts the day average. Its 12 PM and 8 PM values add that hour's difference from the weather service.";
    if (f.stale) document.getElementById("forecast-note").textContent = "The model forecast could not be updated, so this is the most recent saved forecast.";
  }

  document.addEventListener("DOMContentLoaded", load);
})();
