"""
export.py: turn the training and evaluation reports into small JSON files
for the website, plus models/meta.json for the API (/api/meta).

Website chart data (static/data/):
  feature_selection.json   number of features vs validation RMSE (+ chosen N, top features)
  bakeoff.json             LightGBM vs XGBoost vs CatBoost, validation RMSE per horizon
  learning_curves.json     train vs validation RMSE per boosting round + early stopping point
  gap_table.json           RMSE and MAE on train / validation / test per horizon
  shap.json                feature importance (mean |SHAP|) per horizon and per group

EDA chart data (static/data/, Phase 5):
  sites.json        the 5 sites (name, coordinates, grid elevation)
  coldsnap.json     January 1988 cold snap, 24 h average anomaly every 6 hours, for the map replay
  ridgeline.json    winter (Dec to Feb) daily temperature distributions by decade, 1940s to 2020s
  seasonal.json     UB's year: 10th to 90th percentile band, raw daily average and the smooth normal
  warming.json      warming trend per season since 1940 (degC per decade)
  upwind.json       how well each site today predicts UB's anomaly 1, 2, 3 days later

Run from the repo folder (after src.train and src.evaluate --unlock-test):
  python -m src.export
"""

import datetime as dt
import json
from importlib.metadata import version

import numpy as np
import pandas as pd

from src import config
from src.features import fingerprint
from src.train import load_report, model_path, selected_features

TOP_FEATURES = 15       # features shown in the importance charts


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1))
    print(f"  wrote {path.relative_to(config.ROOT)}")


def export():
    fs = load_report("feature_selection")
    bake = load_report("bakeoff")
    curves = load_report("learning_curves")
    gap = load_report("gap_table")
    shap = load_report("shap")
    final = load_report("final_models")
    tuning = load_report("tuning")
    if not gap["test_included"]:
        raise SystemExit("Run the one-time test evaluation first: python -m src.evaluate --unlock-test")
    out = config.STATIC_DATA_DIR

    ranked = list(fs["permutation_importance"].items())[:TOP_FEATURES]
    write_json(out / "feature_selection.json", {
        "n_start": fs["n_start"], "n_after_correlation_filter": fs["n_after_correlation_filter"],
        "chosen_n": fs["chosen_n"], "tolerance_degC": fs["tolerance"], "curve": fs["curve"],
        "top_features": [{"feature": f, "importance_degC": round(v["mean"], 3)} for f, v in ranked]})

    write_json(out / "bakeoff.json", {
        "winner": bake["winner"], "settings": bake["settings"],
        "results": {lib: {h: r[h]["rmse"] for h in ("d1", "d2", "d3")} | {"mean": r["mean_rmse"]}
                    for lib, r in bake["results"].items()},
        "fairness_check": bake.get("fairness_check")})

    write_json(out / "learning_curves.json", curves)

    write_json(out / "gap_table.json", {"note": gap["note"], "horizons": gap["horizons"]})

    write_json(out / "shap.json", {
        "period": shap["period"], "groups": shap["groups"],
        "features": {h: dict(list(v.items())[:TOP_FEATURES]) for h, v in shap["features"].items()}})

    ds = pd.read_parquet(config.DATASET_PATH)
    meta = {
        "project": "Forecasting the Coldest Capital on Earth",
        "created": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "target": "Ulaanbaatar daily mean temperature anomaly, day+1 to day+3 (forecast = anomaly + normal)",
        "library": final["library"],
        "library_version": version(final["library"]),
        "horizons": {h: {"model_file": model_path(final["library"], int(h[1:]), "final").name,
                         "rounds": final["horizons"][h]["rounds_final"],
                         "params": tuning["horizons"][h]["params"],
                         "val_rmse": gap["horizons"][h]["val"]["rmse"],
                         "test_rmse": gap["horizons"][h]["test_final_model"]["rmse"],
                         "test_mae": gap["horizons"][h]["test_final_model"]["mae"]}
                     for h in ("d1", "d2", "d3")},
        "features": selected_features(),
        "trained_on": final["final_period"],
        "data_source": "Open-Meteo archive API, ERA5 (era5_seamless), 5 sites, hourly",
        "sites": {s: {"lat": lat, "lon": lon} for s, (lat, lon) in config.SITES.items()},
        "dataset_fingerprint": fingerprint(ds),
    }
    write_json(config.MODELS_DIR / "meta.json", meta)


# ---------------------------------------------------------------------------
# EDA chart data (Phase 5)
# ---------------------------------------------------------------------------
SITE_NAMES = {"ulaanbaatar": "Ulaanbaatar", "uliastai": "Uliastai", "khovd": "Khovd",
              "moron": "M\u00f6r\u00f6n", "irkutsk": "Irkutsk"}
COLD_SNAP = ("1988-01-18", "1988-01-24")   # Khovd -> Uliastai -> Moron -> UB in about 2 days


def kde(values, grid, bandwidth):
    """Smooth histogram (Gaussian kernel density), area = 1."""
    v = np.asarray(values)[:, None]
    dens = np.exp(-0.5 * ((grid[None, :] - v) / bandwidth) ** 2).sum(axis=0)
    return dens / (len(v) * bandwidth * np.sqrt(2 * np.pi))


def export_eda():
    from src.download import load_daily_eda, load_hourly
    from src.features import load_normals, normal_for

    out = config.STATIC_DATA_DIR
    manifest = json.loads(config.MANIFEST_PATH.read_text())
    normals = load_normals()

    # Sites.
    sites = []
    for s, (lat, lon) in config.SITES.items():
        grid = manifest[f"hourly/{s}_1980s.parquet"]
        sites.append({"id": s, "name": SITE_NAMES[s], "lat": lat, "lon": lon,
                      "role": "main" if s == config.MAIN_SITE else "upwind",
                      "elevation_m": grid["elevation_m"]})
    write_json(out / "sites.json", sites)

    # Cold snap replay: 24 hour average temperature minus the normal, every 6
    # hours. (Raw 6 hourly values would make every night look like a cold wave.)
    start, end = COLD_SNAP
    frames = {}
    for s in config.SITES:
        h = load_hourly(s).set_index("time")["temperature_2m"]
        h = h.loc[pd.Timestamp(start) - pd.Timedelta(days=2): pd.Timestamp(end) + pd.Timedelta(hours=23)]
        r = h.rolling(24).mean()
        r = r[(r.index.hour % 6 == 5) & (r.index >= pd.Timestamp(start))]
        frames[s] = (r - normal_for(r.index.floor("D"), normals[s])).round(1)
    times = frames[config.MAIN_SITE].index
    write_json(out / "coldsnap.json", {
        "title": "The cold snap of January 1988",
        "definition": "24 hour average temperature minus the normal for that day (degC)",
        "times": [t.strftime("%Y-%m-%dT%H:%M") for t in times],
        "anomaly": {s: frames[s].tolist() for s in config.SITES},
        "arrival_threshold": -6,
        "arrival": {s: next((t.strftime("%Y-%m-%dT%H:%M") for t, v in frames[s].items() if v < -6), None)
                    for s in config.SITES}})

    # Ridgeline: winter = December to February; December counts toward the
    # NEXT year's winter (Dec 1987 + Jan/Feb 1988 = winter 1988).
    daily = load_daily_eda().set_index("time")["temperature_2m_mean"]
    winter = daily[daily.index.month.isin([12, 1, 2])]
    winter_year = winter.index.year + (winter.index.month == 12)
    winter = winter[(winter_year >= 1940) & (winter_year <= 2026)]
    winter_year = winter_year[(winter_year >= 1940) & (winter_year <= 2026)]
    grid = np.arange(-45, 5.01, 0.5)
    ridges = []
    for decade, vals in winter.groupby((winter_year // 10) * 10):
        ridges.append({"decade": f"{decade}s", "days": int(len(vals)),
                       "median": round(float(vals.median()), 1),
                       "p10": round(float(vals.quantile(0.1)), 1),
                       "coldest": round(float(vals.min()), 1),
                       "density": [round(float(d), 5) for d in kde(vals, grid, 1.5)]})
    write_json(out / "ridgeline.json", {"grid": grid.round(1).tolist(), "ridges": ridges,
                                        "note": "Daily mean temperature, December to February, ERA5. "
                                                "The 2020s include winters 2020 to 2026."})

    # Seasonal cycle (1980 to 2019, the years the normal was fitted on).
    d = pd.read_parquet(config.DAILY_PATH)["ub_t_mean"]
    d = d[(d.index.year >= config.TRAIN_YEARS[0]) & (d.index.year <= config.TRAIN_YEARS[1])]
    d = d[~((d.index.month == 2) & (d.index.day == 29))]
    key = d.index.strftime("%m-%d")
    g = d.groupby(key)
    days = pd.date_range("2023-01-01", "2023-12-31")      # a non-leap year as the calendar
    keys = days.strftime("%m-%d")
    def smooth(series, days=15):
        """Average over +-7 days, wrapping around New Year (each calendar day
        alone has only 40 values, so its percentiles are noisy)."""
        v = series.reindex(keys).to_numpy()
        padded = np.concatenate([v[-(days // 2):], v, v[:days // 2]])
        return pd.Series(np.convolve(padded, np.ones(days) / days, mode="valid")).round(1).tolist()

    write_json(out / "seasonal.json", {
        "dates": keys.tolist(),
        "p10": smooth(g.quantile(0.1)),
        "p90": smooth(g.quantile(0.9)),
        "raw_mean": g.mean().reindex(keys).round(1).tolist(),
        "normal": np.round(normal_for(days, normals[config.MAIN_SITE]), 1).tolist(),
        "years": list(config.TRAIN_YEARS)})

    # Warming per season since 1940: linear trend of each season's average.
    seasons = {"Winter": [12, 1, 2], "Spring": [3, 4, 5], "Summer": [6, 7, 8], "Autumn": [9, 10, 11]}
    full = daily[daily.index.year <= 2025]
    rows = []
    for name, months in seasons.items():
        part = full[full.index.month.isin(months)]
        year = part.index.year + ((part.index.month == 12) if name == "Winter" else 0)
        means = part.groupby(year).mean()
        counts = part.groupby(year).size()
        means = means[counts >= 85]                   # complete seasons only
        slope = np.polyfit(means.index, means.values, 1)[0] * 10
        rows.append({"season": name, "trend_per_decade": round(float(slope), 2),
                     "first_decade_mean": round(float(means.iloc[:10].mean()), 1),
                     "last_decade_mean": round(float(means.iloc[-10:].mean()), 1),
                     "years": [int(means.index.min()), int(means.index.max())]})
    write_json(out / "warming.json", rows)

    # Upwind head start.
    ds = pd.read_parquet(config.DATASET_PATH)
    write_json(out / "upwind.json", {
        "days": int(len(ds)),
        "correlation": {s: {f"d{h}": round(float(ds[f"{config.SITE_PREFIX[s]}_t_anom"].corr(ds[f"target_d{h}"])), 3)
                            for h in config.HORIZONS} for s in config.SITES}})

    # Map timeline: every day from 1980 to 2025 for the 4 Mongolian sites, so the
    # map slider can move through all of them. Irkutsk is not shown on the map
    # (the model still uses it). Compact JSON, because the file is large.
    daily_all = pd.read_parquet(config.DAILY_PATH)
    daily_all = daily_all[daily_all.index.year <= 2025]
    map_sites = [s for s in config.SITES if s != "irkutsk"]
    col = lambda c: [None if pd.isna(v) else round(float(v), 1) for v in daily_all[c]]
    path = out / "map_days.json"
    path.write_text(json.dumps({
        "start": str(daily_all.index[0].date()), "days": int(len(daily_all)), "sites": map_sites,
        "temp": {s: col(f"{config.SITE_PREFIX[s]}_t_mean") for s in map_sites},
        "anomaly": {s: col(f"{config.SITE_PREFIX[s]}_t_anom") for s in map_sites}}, separators=(",", ":")))
    print(f"  wrote {path.relative_to(config.ROOT)}")


def export_story():
    """Two extra chart files for the website.

    every_day.json  Ulaanbaatar's anomaly on every day since 1940 (daily ERA5),
                    compared with the 1980 to 2019 normal. One row per year.
    daily_cycle.json  For each day of the year, how much warmer or colder 12:00
                    and 20:00 usually are than the day's mean (UB, 1980 to 2019).
                    The website adds this to the model's daily mean forecast to
                    estimate noon and evening. The model itself only predicts the mean.
    """
    from src.download import load_daily_eda, load_hourly
    from src.features import fit_normals, normal_for

    out = config.STATIC_DATA_DIR

    # Every day since 1940. The normal is fitted to this same daily ERA5 series
    # (1980 to 2019), because its grid cell differs slightly from the hourly data's.
    daily = load_daily_eda().set_index("time")["temperature_2m_mean"]
    daily = daily[daily.index.year <= 2025]
    own_normal = fit_normals({"ub": daily.rename("t_mean").to_frame()})["ub"]
    anom = daily - normal_for(daily.index, own_normal)
    years = {}
    for y, part in daily.groupby(daily.index.year):
        a = anom.loc[part.index]
        years[str(y)] = {"start": str(part.index[0].date()),
                         "temp": [round(float(v), 1) for v in part],
                         "anomaly": [round(float(v), 1) for v in a]}
    # Are recent years really warmer? Yearly mean anomaly of the 1960s vs the
    # last ten years: Welch's t-test (unequal variances) and Cohen's d (effect
    # size). Yearly means are used because daily values are not independent.
    from scipy import stats
    yearly = anom.groupby(anom.index.year).mean()
    last = int(yearly.index.max())
    a, b = yearly.loc[1960:1969], yearly.loc[last - 9:last]
    pooled_sd = float(np.sqrt((a.var(ddof=1) + b.var(ddof=1)) / 2))
    comparison = {"early": [1960, 1969], "recent": [last - 9, last],
                  "early_mean": round(float(a.mean()), 2), "recent_mean": round(float(b.mean()), 2),
                  "welch_p": float(f"{stats.ttest_ind(b, a, equal_var=False).pvalue:.2g}"),
                  "cohens_d": round((float(b.mean()) - float(a.mean())) / pooled_sd, 2)}
    path = out / "every_day.json"
    path.write_text(json.dumps({"normal_years": list(config.TRAIN_YEARS), "comparison": comparison, "years": years},
                               separators=(",", ":")))
    print(f"  wrote {path.relative_to(config.ROOT)}")

    # Usual daily cycle: hour minus the day's mean, averaged per calendar day
    # over the training years, then smoothed over +-15 days (wrapping New Year).
    h = load_hourly(config.MAIN_SITE).set_index("time")["temperature_2m"]
    h = h[(h.index.year >= config.TRAIN_YEARS[0]) & (h.index.year <= config.TRAIN_YEARS[1])]
    day_mean = h.groupby(h.index.floor("D")).transform("mean")
    diff = (h - day_mean)
    diff = diff[~((diff.index.month == 2) & (diff.index.day == 29))]
    result = {}
    for hour in (12, 20):
        d = diff[diff.index.hour == hour]
        by_day = d.groupby(d.index.strftime("%m-%d")).mean()
        wrapped = pd.concat([by_day.iloc[-15:], by_day, by_day.iloc[:15]])
        smooth = wrapped.rolling(31, center=True).mean().iloc[15:-15]
        result[f"h{hour}"] = [round(float(v), 2) for v in smooth]
    write_json(out / "daily_cycle.json", {"dates": list(by_day.index), "years": list(config.TRAIN_YEARS), **result})


def export_model_card():
    """model_card.json: everything the website's Model and Accuracy sections show
    about the final models, read from the saved reports (no numbers typed by hand)."""
    meta = json.loads((config.MODELS_DIR / "meta.json").read_text())
    tuning = load_report("tuning")
    final = load_report("final_models")
    base = load_report("baselines")
    lock = json.loads((config.REPORTS_DIR / "test_unlock_log.json").read_text())
    ds = pd.read_parquet(config.DATASET_PATH)
    split = {}
    for name in ("train", "val", "test"):
        part = ds[ds["split"] == name]
        split[name] = {"start": str(part.index.min().date()), "end": str(part.index.max().date()), "days": int(len(part))}
    horizons = {}
    for h in config.HORIZONS:
        k = f"d{h}"
        t = tuning["horizons"][k]
        horizons[k] = {
            "params": {p: round(v, 4) if isinstance(v, float) else v for p, v in meta["horizons"][k]["params"].items()},
            "trees_train_only": final["horizons"][k]["rounds_train_only"],
            "trees_final": final["horizons"][k]["rounds_final"],
            "val_rmse_default": round(t["best_so_far"][0], 3),
            "val_rmse_tuned": round(t["val_rmse"], 3),
            "best_trial": t["trial"],
            "trials": t["trial_states"],
            "test": {"model": base["test"][k]["model"], "persistence": base["test"][k]["persistence"],
                     "climatology": base["test"][k]["climatology"]},
        }
    write_json(config.STATIC_DATA_DIR / "model_card.json", {
        "library": meta["library"], "library_version": meta["library_version"],
        "n_features": len(meta["features"]), "trials_per_horizon": tuning["trials_per_horizon"],
        "early_stopping_patience": config.EARLY_STOPPING, "max_trees": config.MAX_ROUNDS,
        "seed": config.SEED, "split": split, "gap_days": config.GAP_DAYS,
        "final_period": final["final_period"], "test_evaluated": lock[0]["time"][:10],
        "test_runs_same_models": all(r["same_as_first"] for r in lock),
        "horizons": horizons})


COLD_WAVE_GRID = {"lon": (87.5, 120.0, 2.5), "lat": (41.5, 52.5, 1.0),
                  "start": "1988-01-15", "end": "1988-01-26"}


def export_coldwave():
    """coldwave.json: the January 1988 cold wave on a grid over Mongolia, for the
    'Cold Wave of Mongolia' map. ERA5 hourly temperature and 10 m wind at 168 grid
    points (every 2.5 deg of longitude and 1 deg of latitude), one frame every 6 hours.
      change: 24 hour mean temperature minus the mean of 16 January (degC), so
              the cold air shows up as it arrives
      u, v:   6 hour mean wind toward the east and toward the north (km/h)
    The raw download is cached in data/raw/coldwave_1988_grid.json."""
    import requests

    g = COLD_WAVE_GRID
    lons = np.arange(g["lon"][0], g["lon"][1] + 1e-9, g["lon"][2])
    lats = np.arange(g["lat"][0], g["lat"][1] + 1e-9, g["lat"][2])
    raw_path = config.RAW_DIR / "coldwave_1988_grid.json"
    if not raw_path.exists():
        pts = [(la, lo) for la in lats for lo in lons]
        params = {"latitude": ",".join(f"{a:.2f}" for a, _ in pts), "longitude": ",".join(f"{b:.2f}" for _, b in pts),
                  "start_date": g["start"], "end_date": g["end"], "models": "era5", "timezone": config.TIMEZONE,
                  "hourly": "temperature_2m,wind_speed_10m,wind_direction_10m"}
        r = requests.get(config.ARCHIVE_URL, params=params, timeout=120, headers={"User-Agent": config.USER_AGENT})
        r.raise_for_status()
        raw_path.write_text(r.text)
    data = json.loads(raw_path.read_text())

    frames = pd.date_range("1988-01-17 00:00", "1988-01-25 18:00", freq="6h")
    change, u, v = [], [], []
    for loc in data:                                   # row by row: latitude, then longitude
        h = loc["hourly"]
        times = pd.to_datetime(h["time"])
        t = pd.Series(h["temperature_2m"], index=times, dtype=float)
        speed = np.asarray(h["wind_speed_10m"], dtype=float)
        rad = np.radians(np.asarray(h["wind_direction_10m"], dtype=float))   # direction the wind comes FROM
        ue = pd.Series(-speed * np.sin(rad), index=times).rolling(6).mean()
        vn = pd.Series(-speed * np.cos(rad), index=times).rolling(6).mean()
        base = t.loc["1988-01-16"].mean()
        change.append((t.rolling(24).mean() - base).loc[frames].round(1).tolist())
        u.append(ue.loc[frames].round(1).tolist())
        v.append(vn.loc[frames].round(1).tolist())
    path = config.STATIC_DATA_DIR / "coldwave.json"
    path.write_text(json.dumps({
        "source": "ERA5 via Open-Meteo archive", "lons": lons.round(2).tolist(), "lats": lats.round(2).tolist(),
        "times": [t.strftime("%Y-%m-%dT%H:%M") for t in frames],
        "change": change, "u": u, "v": v}, separators=(",", ":")))
    print(f"  wrote {path.relative_to(config.ROOT)}")


if __name__ == "__main__":
    export()
    export_eda()
    export_story()
    export_model_card()
    export_coldwave()
