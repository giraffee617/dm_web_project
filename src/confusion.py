"""
confusion.py: a 3 class confusion matrix for each forecast horizon.

Our models do REGRESSION (they predict a number: the temperature anomaly in degC).
A confusion matrix belongs to CLASSIFICATION, so we first turn every anomaly into
one of 3 classes:

    colder than normal  |  near normal  |  warmer than normal

The two thresholds are the terciles (33rd and 67th percentile) of the day+1 target
on the TRAINING rows (1980 to 2019) only, so each class holds about one third of
training days and the test set has no say in where the borders are.

Then, on the TEST set (2023 to 2025), both the true anomaly and the predicted
anomaly of the deployed (final) model are put into classes and compared.

Test lock: this script reads test rows, so it first checks that the models are
exactly the ones already evaluated by `src.evaluate --unlock-test` (same
fingerprints as models/reports/test_unlock_log.json). It only re-describes that
evaluation in another form; it never evaluates different models.

Outputs:
  models/reports/confusion.json       full results
  static/data/confusion.json          same results for the website
  models/reports/confusion_d1.png     one image per horizon (d1, d2, d3)

Run from the repo folder:
  python -m src.confusion
"""

import hashlib
import json

import numpy as np
import pandas as pd

from src import config

HORIZONS = (1, 2, 3)
CLASSES = ["colder", "near normal", "warmer"]
LOCK_PATH = config.REPORTS_DIR / "test_unlock_log.json"


def sha256(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_same_models_as_test_run():
    """Refuse to run unless the models are the ones already tested once."""
    if not LOCK_PATH.exists():
        raise SystemExit("REFUSED: run `python -m src.evaluate --unlock-test` first.")
    first = json.loads(LOCK_PATH.read_text())[0]["fingerprints"]
    now = {"selected_features": sha256(config.MODELS_DIR / "selected_features.json")}
    for h in HORIZONS:
        now[f"final_d{h}"] = sha256(config.MODELS_DIR / f"model_d{h}.cbm")
        now[f"train_only_d{h}"] = sha256(config.REPORTS_DIR / "train_only" / f"model_d{h}.cbm")
    if now != first:
        raise SystemExit("REFUSED: these models differ from the ones evaluated on the test set.")


def to_class(anomaly, low, high) -> np.ndarray:
    """0 = colder, 1 = near normal, 2 = warmer."""
    return np.digitize(anomaly, [low, high])


def matrix(true_cls, pred_cls) -> np.ndarray:
    """Rows = what really happened, columns = what the model predicted."""
    m = np.zeros((3, 3), dtype=int)
    for t, p in zip(true_cls, pred_cls):
        m[t, p] += 1
    return m


def save_image(m, h, accuracy, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    bg, ink, muted = "#0f1620", "#e6eef5", "#8a9aab"
    share = m / m.sum(axis=1, keepdims=True)          # share of each real class
    fig, ax = plt.subplots(figsize=(5.2, 4.6), dpi=160)
    fig.patch.set_facecolor(bg)
    ax.set_facecolor(bg)
    ax.imshow(share, cmap="Blues", vmin=0, vmax=1)
    for i in range(3):
        for j in range(3):
            dark = share[i, j] > 0.5
            ax.text(j, i, f"{m[i, j]}\n{share[i, j]:.0%}", ha="center", va="center",
                    fontsize=11, color="white" if dark else "#0f1620")
    ax.set_xticks(range(3), CLASSES, color=ink)
    ax.set_yticks(range(3), CLASSES, color=ink)
    ax.set_xlabel("Model predicted", color=muted)
    ax.set_ylabel("What really happened", color=muted)
    ax.set_title(f"Day+{h}  (test 2023 to 2025, accuracy {accuracy:.0%})", color=ink, fontsize=11)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.tick_params(length=0)
    fig.tight_layout()
    fig.savefig(path, facecolor=bg)
    plt.close(fig)


def main():
    from catboost import CatBoostRegressor

    check_same_models_as_test_run()
    features = json.loads((config.MODELS_DIR / "selected_features.json").read_text())
    ds = pd.read_parquet(config.DATASET_PATH)
    train, test = ds[ds["split"] == "train"], ds[ds["split"] == "test"]

    low, high = np.quantile(train["target_d1"], [1 / 3, 2 / 3])
    out = {
        "classes": CLASSES,
        "thresholds_degC": {"low": round(float(low), 2), "high": round(float(high), 2)},
        "threshold_rule": "terciles of the day+1 anomaly on training rows (1980 to 2019)",
        "period": [str(test.index.min().date()), str(test.index.max().date())],
        "model": "final (deployed) CatBoost models, trained 1980 to 2022",
        "rows_are": "what really happened", "columns_are": "model predicted",
        "horizons": {},
    }

    for h in HORIZONS:
        model = CatBoostRegressor()
        model.load_model(str(config.MODELS_DIR / f"model_d{h}.cbm"))
        pred = model.predict(test[features])
        true_cls = to_class(test[f"target_d{h}"].to_numpy(), low, high)
        pred_cls = to_class(pred, low, high)
        m = matrix(true_cls, pred_cls)
        acc = float(np.trace(m) / m.sum())
        far_misses = int(m[0, 2] + m[2, 0])             # colder called warmer, or the reverse
        out["horizons"][f"d{h}"] = {
            "matrix": m.tolist(),
            "accuracy": round(acc, 3),
            "far_misses": far_misses,
            "far_miss_share": round(far_misses / m.sum(), 3),
            "days": int(m.sum()),
        }
        save_image(m, h, acc, config.REPORTS_DIR / f"confusion_d{h}.png")
        print(f"  day+{h}: accuracy {acc:.1%}, colder<->warmer mix-ups {far_misses} of {m.sum()} days")
        print("           " + "\n           ".join(str(r) for r in m.tolist()))

    text = json.dumps(out, indent=2)
    (config.REPORTS_DIR / "confusion.json").write_text(text)
    config.STATIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    (config.STATIC_DATA_DIR / "confusion.json").write_text(text)
    print(f"Thresholds: colder below {low:.2f} degC, warmer above {high:.2f} degC")


if __name__ == "__main__":
    main()
