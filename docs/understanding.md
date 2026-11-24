# Understanding my project: Forecasting the Coldest Capital on Earth

Every number here comes from the project's own files: `models/meta.json`, `models/reports/*.json`, `data/processed/dataset.parquet` and `README.md`.

## 1. The big picture

1. We downloaded hourly weather from the Open-Meteo ERA5 archive for 5 places: Ulaanbaatar (UB) and four "upwind" places, Khovd, Uliastai, Mörön and Irkutsk, from 1980 to 2025. We also downloaded UB daily data back to 1940, just for the charts.
2. Each day's 24 hours were squeezed into 17 daily numbers per place, for example the mean, min and max temperature, the pressure change in 24 hours, the wind, the snow depth and the cloud cover.
3. For every calendar day we computed a "normal" temperature (a smooth curve fitted to 1980 to 2019). The anomaly is the real temperature minus the normal, meaning how much warmer or colder than usual it was.
4. From these we built 158 features, like yesterday's anomaly, 3 and 30 day averages, and the upwind places' values. The answers we want to predict are UB's anomaly 1, 2 and 3 days later.
5. The data was split by time into train (1980 to 2019), validation (2020 to 2022) and test (2023 to 2025).
6. We kept the 40 most useful features and compared three libraries. CatBoost won, so Optuna tuned it, with one model per day ahead.
7. The models were checked once on the locked test set, then retrained on 1980 to 2022 and saved.
8. On the website, the FastAPI backend fetches the last 60 days of weather, builds the same features, predicts the 3 anomalies, adds the normal back, and shows the forecast. The result is cached once per day.

```
 Open-Meteo ERA5 archive (5 places, hourly, 1980 to 2025)
        |
        v
 17 daily numbers per place  +  normal curve per place
        |
        v
 158 features, targets = UB anomaly on day+1, day+2, day+3
        |
        v
 split by time:  TRAIN 1980-2019 | VAL 2020-2022 | TEST 2023-2025
        |
        v
 feature selection 158 > 126 > 40
        |
        v
 bake off (LightGBM, XGBoost, CatBoost)  >  CatBoost wins
        |
        v
 Optuna tuning (50 trials per day ahead, early stopping)
        |
        v
 one locked test check  >  retrain on 1980-2022  >  3 saved models
        |
        v
 website: live data (forecast API, last 60 days)  >  same features
          >  3 models predict anomalies  >  + normal  =  forecast
```

## 2. How the three algorithms work

### a. Gradient boosting in general

Think of mini golf. Your first shot gets the ball somewhere near the hole. Each next shot does not start over; it only tries to fix the distance that is still left.

Gradient boosting works the same way with small decision trees:

1. Tree 1 makes a rough guess, for example "tomorrow will be about as unusual as today".
2. We measure what is still wrong (the "residuals").
3. Tree 2 learns only to predict those leftover errors.
4. Repeat hundreds or thousands of times. The final prediction is the sum of all the small corrections.

The **learning rate** is how hard you hit each shot. A small learning rate means careful little shots, so you need more trees but you overshoot less.

A decision tree here is just a chain of yes/no questions, like "is Mörön's anomaly below -3°C?" then "is UB's snow depth above 5 cm?", ending in a leaf with a number.

### b. The three libraries: same idea, different trees

```
 XGBoost: level wise          LightGBM: leaf wise         CatBoost: symmetric
 (grow layer by layer)        (split the worst leaf)      (same question per level)

        [Q]                          [Q]                          [Q1]
       /   \                        /   \                        /    \
     [Q]   [Q]                    [Q]   leaf                  [Q2]    [Q2]
     / \   / \                    / \                         /  \    /  \
    l   l l   l                 [Q]  leaf                    l    l  l    l
                                / \
                               l   l
```

| | XGBoost | LightGBM | CatBoost |
|---|---|---|---|
| How the tree grows | Level by level, so trees stay balanced | Always splits the leaf that reduces the error most, so trees get deep and lopsided | Every node on a level asks the **same** question (a "symmetric" or "oblivious" tree) |
| Speed trick | Histograms (optional) | Histograms: values are sorted into about 255 buckets, so it checks buckets instead of every value | Symmetric trees are very fast to predict |
| Protection against overfitting | L1/L2 regularization (penalizes extreme leaf values) | Limits like number of leaves and minimum rows per leaf | **Ordered boosting**: each row's error is computed by a model that has not seen that row, so the model can't "peek" at its own answers. Plus symmetric trees are simple by design |
| Known for | The classic, very flexible | The fastest | Strong results with default settings |

### c. Our bake off (validation RMSE in °C, lower is better)

| Library | day+1 | day+2 | day+3 | Mean | Fairness check mean* |
|---|---|---|---|---|---|
| **CatBoost** | **1.415** | **2.553** | **3.342** | **2.436** | **2.405** |
| LightGBM | 1.518 | 2.639 | 3.354 | 2.504 | 2.468 |
| XGBoost | 1.563 | 2.732 | 3.464 | 2.586 | 2.539 |

*With pure defaults, CatBoost builds 1,000 trees while the others build only 100, which isn't fair. In the fairness check, every library could grow as many trees as it needed, with early stopping on validation. CatBoost won both times.

**Why CatBoost probably won:** weather data is noisy. CatBoost's symmetric trees and ordered boosting act like built in "don't memorize" rules, so it learns the general pattern instead of random wiggles. LightGBM was the fastest (about 1 second vs about 5 seconds), but speed didn't matter much on 16,764 rows.

## 3. How training, validation and testing went

### a. The split

| Set | Dates | Days (rows) | Used for |
|---|---|---|---|
| Train | 1980-01-30 to 2019-12-28 | 14,578 | Learning the trees |
| Validation | 2020-01-01 to 2022-12-28 | 1,093 | Feature selection, bake off, Optuna, early stopping |
| Test | 2023-01-01 to 2025-12-28 | 1,093 | One final honest check |
| **Total** | | **16,764** | |

1. **Why train starts on 30 January:** some features are 30 day averages, so the first 29 days of 1980 have no complete history.
2. **Why each set ends on 28 December (the 3 day gap):** the day+3 target of 30 December 2019 is 2 January 2020, which is already inside validation. If we kept that row, the training set would contain a validation answer. Dropping the last 3 days of each set stops any answer from leaking across a border.
3. **Never random:** in weather, today and tomorrow are almost twins. A random split would put twins in both train and test, and the score would look much better than reality.

### b. Why the test set was touched only once

Every time you look at a score and change something, that data quietly becomes part of your training process. The validation set was looked at many times, so its scores are a little optimistic. The test set was locked: `src/evaluate.py` saves a fingerprint of the models the first time, and refuses to test different models later. That's why the test numbers are the honest ones.

After testing, the deployed models were retrained on train + validation (1980 to 2022). This was decided before testing, and on test they score the same as the train only models (1.44 vs 1.45 at day+1).

### c. Early stopping

Imagine studying for an exam with practice tests. At first your practice score goes up. Later you start memorizing the exact questions of your study book, and your practice score stops improving. Early stopping means: stop studying when the practice (validation) score hasn't improved for a while.

Our settings: at most 8,000 trees, and stop when validation RMSE hasn't improved for 200 trees.

| Horizon | Best number of trees (train only model) | Final model trees (about 7.5% more data, so about 7.5% more trees) |
|---|---|---|
| day+1 | 7,989 (almost the 8,000 cap; it was still improving, but by less than 0.001°C) | 8,588 |
| day+2 | 1,220 | 1,311 |
| day+3 | 887 | 954 |

Day+1 uses many trees because there's a lot of real signal to learn (tomorrow is closely linked to today). Day+3 runs out of useful signal much sooner.

### d. Optuna

Optuna is a smart search for settings. Instead of trying every combination, it uses the results of past trials to guess where good settings are (the TPE sampler). A **median pruner** stops a trial early if it's doing worse than the median of earlier trials at the same point, which saves time.

1. 50 trials per horizon, 150 in total. 97 of the 150 were pruned (stopped early).
2. Trial 0 was always CatBoost's own default, so tuning could never end up worse than the defaults.

| Setting | What it controls, in one line | day+1 | day+2 | day+3 |
|---|---|---|---|---|
| learning_rate | How big each correction step is | 0.027 | 0.062 | 0.060 |
| depth | How many yes/no questions each tree asks in a row (6 means 64 leaves) | 6 | 6 | 7 |
| l2_leaf_reg | A brake on extreme leaf values; bigger means more cautious | 1.1 | 13.0 | 24.5 |
| random_strength | Random noise added when choosing splits, so the model doesn't always grab the same one | 6.6 | 1.4 | 1.9 |
| subsample | Share of training days each tree sees | 0.63 | 0.82 | 0.55 |

| | day+1 | day+2 | day+3 |
|---|---|---|---|
| Default (trial 0) val RMSE | 1.396 | 2.549 | 3.299 |
| Tuned val RMSE | **1.370** | **2.528** | **3.285** |
| Best trial | 9 | 31 | 34 |

Two things worth saying out loud:

1. **Tuning helped only a little (0.01 to 0.03°C)**, because CatBoost's defaults were already good. That's an honest result, not a failure.
2. **Further ahead, Optuna chose a much stronger brake** (l2 of 1.1, then 13, then 24.5). Day+3 is noisier, so the model needs to be more careful not to chase noise.

### e. Feature selection: 158 to 126 to 40

1. **Correlation filter (train data):** 32 near duplicates with correlation above 0.95 were dropped, for example Mörön's mean and max temperature (r = 0.993). Two features that say the same thing just split the importance between them.
2. **Permutation importance (validation):** shuffle one feature and see how much the error grows. If shuffling it hurts a lot, it matters.
3. **Top N curve:** mean validation RMSE fell from 3.50 with 1 feature to 2.52 with 25, then went flat (2.50 at 40, 2.51 with all 126). We kept **40**, the smallest number within 0.01°C of the best.

Fewer features means a simpler model that's faster, easier to explain and less likely to learn noise.

## 4. Is the model overfitting?

**RMSE and MAE in plain words:** both say how far off the forecast is on average, in °C. MAE is the plain average miss. RMSE punishes big misses more, so it's always a bit larger.

| Horizon | Train RMSE | Val RMSE | Test RMSE (same model) | Test RMSE (deployed) | Test MAE (deployed) |
|---|---|---|---|---|---|
| day+1 | 0.48 | 1.37 | 1.45 | **1.44** | 1.09 |
| day+2 | 1.78 | 2.53 | 2.70 | **2.70** | 2.07 |
| day+3 | 2.47 | 3.29 | 3.36 | **3.39** | 2.60 |

So on unseen days: **the day+1 forecast is off by about 1.1°C on average, day+2 by about 2.1°C, and day+3 by about 2.6°C.**

**How to read it:**

1. **Validation vs test is the important gap, and it's small** (+0.08, +0.17, +0.07°C). The model works about as well on brand new years as on the years it was tuned on. That's the main sign it does NOT overfit in a harmful way.
2. **Train is much lower than validation**, especially at day+1 (0.48 vs 1.37). Boosting always memorizes some of the training years. The learning curves show this: the training line keeps falling while the validation line goes flat. Early stopping picks the point where validation is best, so the extra memorizing doesn't make the forecast worse.
3. **2023 to 2025 was a slightly harder period**, not a model problem. Even the simple "tomorrow = today" rule got worse on test (2.87 to 3.06 at day+1).
4. **For context** (in the README, not on the website): our day+1 error is 53% smaller than "tomorrow's anomaly = today's", and day+3 is 32% smaller.

**Why day+3 is less accurate than day+1:** weather is chaotic. Tiny things we can't see today (a pressure system forming far away) grow bigger every day. Tomorrow is mostly "today, slightly shifted"; in 3 days, new air can arrive from places outside our 5 points. You can see this in the README correlation table: UB's anomaly today matches UB tomorrow at 0.77, but UB in 3 days only at 0.38.

## 5. A confusion matrix for the 3 day forecast

### a. Why it doesn't fit directly

A confusion matrix counts right and wrong **labels** (for example "spam / not spam"). Our model predicts a **number** (like +4.5°C). A number is never exactly right or wrong, it's just close or far, so there's nothing to count yet.

### b. Making it honest: 3 classes

We turn each anomaly into a label:

| Class | Rule |
|---|---|
| colder than normal | anomaly below **-1.69°C** |
| near normal | between -1.69°C and +1.92°C |
| warmer than normal | anomaly above **+1.92°C** |

The thresholds are the **terciles** of the anomaly on the **training** days only (1980 to 2019), so each class is about one third of training days. The test set had no say in where the borders are.

The new script `src/confusion.py` does this with the deployed models on the test set (2023 to 2025). Before it runs, it checks that the models are exactly the ones already tested (same fingerprints as the test lock), so it doesn't sneak in a new test evaluation; it just shows the same test results in a different form.

```
python -m src.confusion
```

Outputs: `models/reports/confusion.json`, `static/data/confusion.json` (for the website) and `models/reports/confusion_d1.png`, `_d2.png`, `_d3.png`.

### c. Results (rows = what really happened, columns = what the model predicted)

**Day+1, accuracy 81.1%**

| real \ predicted | colder | near normal | warmer |
|---|---|---|---|
| colder | **220** | 46 | 1 |
| near normal | 33 | **286** | 59 |
| warmer | 1 | 67 | **380** |

**Day+2, accuracy 66.7%**

| real \ predicted | colder | near normal | warmer |
|---|---|---|---|
| colder | **165** | 82 | 19 |
| near normal | 57 | **257** | 65 |
| warmer | 14 | 127 | **307** |

**Day+3, accuracy 56.0%**

| real \ predicted | colder | near normal | warmer |
|---|---|---|---|
| colder | **127** | 112 | 26 |
| near normal | 45 | **260** | 75 |
| warmer | 19 | 204 | **225** |

### d. How to read them, and what the mistakes tell us

1. **The diagonal (bold) is correct.** Everything off the diagonal is a mistake.
2. **Random guessing would get about 33%.** We get 81%, 67% and 56%, all far above that.
3. **Almost all mistakes are "one step off".** Calling a cold day "warm" (or the reverse) is rare: 2 of 1,093 days at day+1 (0.2%), 33 at day+2 (3%), 45 at day+3 (4%).
4. **The model drifts toward "near normal" when it's unsure**, and more so further ahead. At day+3, 204 of 448 warm days were called "near normal". This is expected: a model trained to minimize RMSE plays it safe by predicting closer to the average when the signal is weak.
5. **The test years were warm.** The "warmer" row has about 448 days (41%) and "colder" only about 266 (24%), even though in training each class was one third. That matches the warming trend in the EDA.

## 6. What the model looks at (SHAP)

SHAP measures how much each feature pushed each prediction up or down. Averaged over all test days, it shows which features matter most. Values are in °C of anomaly.

**Short code names:** `ub` Ulaanbaatar, `mor` Mörön, `irk` Irkutsk, `kho` Khovd, `uli` Uliastai. `t_anom` is the temperature anomaly, `p` is pressure, `_end` means the value at 23:00.

**Top 10 for day+1**

| # | Feature | In plain words | Why it matters |
|---|---|---|---|
| 1 | ub_t_anom (1.31) | How unusual UB was today | Tomorrow is mostly today, slightly changed |
| 2 | mor_t_anom (0.48) | How unusual Mörön was today | Mörön is upwind; its air often reaches UB next |
| 3 | irk_p_change_24h (0.38) | How much Irkutsk's pressure changed in 24 hours | Rising pressure in the north often means a cold high pushing south |
| 4 | ub_snow_depth_end (0.38) | Snow on the ground in UB tonight | Snow makes clear, calm nights much colder |
| 5 | irk_minus_ub_p_mean (0.37) | Pressure in Irkutsk minus pressure in UB | Air flows from high to low pressure, so this hints at wind from the north |
| 6 | irk_t_anom (0.37) | How unusual Irkutsk was today | Cold air from Siberia arrives from that direction |
| 7 | uli_t_anom (0.35) | How unusual Uliastai was today | A western upwind place |
| 8 | uli_wind_from_e (0.33) | East-west wind at Uliastai | Tells which way the air is moving |
| 9 | ub_rh_mean (0.30) | UB's average humidity | Moist air loses heat more slowly at night |
| 10 | ub_dew_end (0.26) | UB's dew point at 23:00 | Another moisture signal |

**Top 10 for day+3:** UB snow depth (0.54), Khovd anomaly (0.46), Irkutsk anomaly (0.39), UB humidity (0.37), Uliastai pressure change (0.36), Khovd pressure (0.35), Mörön anomaly (0.34), Irkutsk northerly wind (0.32), UB 3 day average anomaly (0.29), UB pressure (0.28).

Notice that **UB's own temperature drops from #1 at day+1 to #14 at day+3**, while far away places like Khovd move up.

**Share of importance by group:**

| Group | day+1 | day+2 | day+3 |
|---|---|---|---|
| Upwind places | 59% | 69% | 68% |
| UB today | 36% | 26% | 24% |
| UB recent days | 5% | 5% | 8% |

**Why upwind places help day+2 and day+3:** weather in Mongolia mostly moves from the west and north. Air that's over Khovd or Irkutsk today can be over UB in 1 to 3 days, so these places give the model a head start. The data backs this up: today's anomaly in Irkutsk or Mörön predicts UB's anomaly 2 days later better (0.56) than UB's own anomaly does (0.51). Irkutsk is in Russia, but it sits right on the path of cold Siberian air, which is why it's on the map.

## 7. Honest limitations

1. **ERA5 is reconstructed data, not a thermometer.** It's a weather model's best estimate on a grid, built from many observations. It's smooth and complete, but it isn't the exact reading of a UB weather station, and it can miss very local effects like the city's own heat.
2. **ERA5 "sees" a few hours ahead.** It's made in 12 hour batches, so evening values already include some observations from the next morning. We measured it: at most 0.17°C better at day+1 than a perfectly clean setup (0.13 at day+2, 0.05 at day+3). The live site doesn't have this effect.
3. **The validation set was reused a lot:** feature selection, bake off, Optuna and early stopping all looked at it. So validation scores are a bit optimistic, and only the test numbers are fully honest.
4. **The live forecast uses a different data source** (Open-Meteo forecast API instead of the ERA5 archive). On 26 recent days, the two sources differed by 0.6°C on average for UB, and switching changed the day+1 forecast by 0.82°C on average. That's noticeable, but less than the model's typical error of 1.4°C.
5. **Only 5 points.** Weather can also arrive from places we don't watch, like the south or east, which limits day+3.
6. **One fixed time split** instead of several folds, and a test period of just 3 years.
7. **Features were selected with LightGBM, then used with CatBoost.** CatBoost might have preferred a slightly different set.
8. **It forecasts daily mean temperature only:** no min/max, no snow, no wind.

## 8. Presenting it

### a. 5 minute talk script

**Opening (30 s)**
"Ulaanbaatar is the coldest capital city on Earth. In mid-January, a normal day is minus 20 degrees. My project forecasts the next 3 days of temperature here with machine learning, and it runs live on this website."

**Hero, the live forecast (30 s)**
"At the top you see today's real forecast. For each day it shows the temperature, how much warmer or colder than normal that is, and the typical error. For example, today it says minus 3.1 degrees, which is 4.5 degrees warmer than normal for this date."

**The data (1 min 15 s)**
"The data comes from ERA5, a global weather reconstruction, through the free Open-Meteo API. I used 5 places: Ulaanbaatar and four places upwind of it, Khovd, Uliastai, Mörön and Irkutsk.
On this map you can replay a real cold wave from January 1988. The cold reaches Khovd first, then Uliastai and Mörön, and then Ulaanbaatar about two days later. That's the main idea of the model: watch the places the weather comes from.
The ridgeline shows winters by decade. Surprisingly, winters haven't really warmed: the median winter day was about minus 19 in the 1940s and still is today. But spring has warmed by about 0.4 degrees per decade."

**How it works (1 min 15 s)**
"Instead of predicting the temperature directly, the model predicts the anomaly, meaning how much warmer or colder than normal. The season is already known, so the model can focus on the weather itself.
I turned hourly data into daily features like temperature, pressure change, wind, humidity and snow, for all 5 places, and then selected the 40 most useful out of 158.
I compared three gradient boosting libraries, LightGBM, XGBoost and CatBoost. CatBoost won, and I tuned it with Optuna. There's one separate model for each day ahead.
This chart shows what the model looks at. For tomorrow, Ulaanbaatar's own temperature matters most. For 2 and 3 days ahead, the upwind places carry about two thirds of the importance."

**Performance (1 min)**
"I split the data by time: 1980 to 2019 for training, 2020 to 2022 for validation, and 2023 to 2025 as a locked test set that I used only once.
On the test years, the forecast is off by about 1.1 degrees on average for tomorrow, 2.1 for day 2 and 2.6 for day 3.
The learning curves show early stopping: training stops when the validation error stops improving. Validation and test errors are very close, so the model generalizes to new years."

**Closing (30 s)**
"The main limitations are that ERA5 is reconstructed data, not station readings, and that the live site uses a slightly different data source than training. I measured both and show them on the site. Thank you."

### b. 10 likely teacher questions

1. **Why predict the anomaly instead of the temperature?**
   The season is known exactly. If the model predicted raw temperature, it would mostly learn "January is cold" and look better than it really is. With the anomaly, it focuses on the actual weather.
2. **Why didn't you split the data randomly?**
   Neighbouring days are almost the same. A random split would put near twins in both train and test, so the score would be fake. A time split tests the model on the future, like real use.
3. **What is the 3 day gap for?**
   The day+3 answer of a late December training row falls in January of the next set. Dropping the last 3 days stops answers from leaking across sets.
4. **Why did CatBoost win?**
   Its symmetric trees and ordered boosting protect against memorizing noise, and weather data is noisy. It won both with defaults and in a fair comparison where every library could use as many trees as it needed.
5. **Is your model overfitting?**
   Train error is lower, which is normal for boosting, but validation and test are very close (1.37 vs 1.44 at day+1). Early stopping chose the number of trees on validation, so the extra memorizing doesn't hurt the forecast.
6. **What did Optuna actually improve?**
   Only 0.01 to 0.03 degrees, because CatBoost's defaults were already good. Trial 0 was always the default, so tuning could never make it worse.
7. **Why is day+3 worse than day+1?**
   Weather is chaotic. Small unknowns grow every day, and in 3 days new air can come from places we don't measure.
8. **Why is Irkutsk on the map if it's in Russia?**
   Cold air often comes to Mongolia from Siberia. Irkutsk's data predicts UB's temperature 2 days later better than UB's own data does.
9. **How do you make sure the live site builds features exactly like training?**
   Both use the same function, `build_features()`, and a test checks that features built from only 60 days equal those built from the full history.
10. **Can you show a confusion matrix?**
    Yes, after turning the anomaly into 3 classes using thresholds from training data. Accuracy is 81%, 67% and 56% for days 1 to 3, versus about 33% for random guessing, and most mistakes are only one class off.

### c. Quiz yourself

Answer first, then check below.

1. What's the difference between the validation set and the test set in this project?
2. What does early stopping watch, and when does it stop?
3. Why does the confusion matrix use thresholds from the training data and not from the test data?
4. In LightGBM, what does "leaf wise" mean?
5. Why do upwind places matter more for day+3 than for day+1?

**Answers**

1. Validation (2020 to 2022) was used many times to make choices: features, library, settings, early stopping. Test (2023 to 2025) was used once at the end, so it gives the honest score.
2. It watches the validation RMSE while trees are added, and stops when it hasn't improved for 200 trees. The best point is kept.
3. If the test data chose the borders, the test would influence its own evaluation. Training based borders are fixed before the test is seen.
4. It always splits the leaf that reduces the error the most, wherever it is, so trees grow deep and lopsided instead of level by level.
5. Weather moves mostly from the west and north, and air over those places today reaches UB in 1 to 3 days. UB's own temperature tells a lot about tomorrow but much less about 3 days from now.
