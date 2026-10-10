<p align="center">
  <img src="docs/assets/brand-mark.png" width="72" alt="">
</p>

<h1 align="center">The Commute, Decoded</h1>

<p align="center">
  Seven seasons of bicycle commuting, analysed with paired tests, mixed models, splines,<br>
  Gaussian processes, gradient boosting, SHAP and conformal prediction.
</p>

---

## Deliverables

| | |
|---|---|
| **Written analysis** | [`reports/FINDINGS.md`](reports/FINDINGS.md) answers every question in the brief |
| **Interactive story** | [`docs/index.html`](docs/index.html), a Tailwind + D3 site with a live ride planner |
| **Code** | [`analysis/`](analysis), a Python package that reproduces every number and figure |

## Headline findings

1. **Home is slower on 53 of 53 paired days**, by a median of **5:41** (95% CI 5.2–6.7 min).
2. **Fitness builds every season.** Each ride saves about 4.5 s on the next one, levelling off after about 15 rides.
3. **60% of the "cold-morning penalty" is really early-season fitness.** Cold mornings cluster at the start of each season.
4. **The rider isn't slowing down. They're riding less.** A +5 s/yr naive trend flips to −5.5 s/yr once in-season ride count is controlled.
5. **Route D's edge is distance, not speed.** The adjusted −26 s matches the 27 s that 0.1 mile predicts.
6. **Seven learners agree** that the signal is smooth and nearly additive. The best ensemble reaches CV-RMSE 64 s and R² 0.90.

## Repository layout

```
.
├── analysis/                    Python package (back end)
│   ├── data/raw/                source workbook
│   ├── data/processed/          engineered feature table
│   ├── src/commute/
│   │   ├── config.py            paths, brand palette, feature set
│   │   ├── data.py              loading, validation, feature engineering
│   │   ├── descriptive.py       summaries, paired days, LOWESS
│   │   ├── inference.py         paired tests, OLS, mixed model, confounding, trends
│   │   ├── models.py            model zoo, grouped CV, SHAP, ALE, PDP/ICE, conformal
│   │   ├── figures.py           branded static figures
│   │   ├── pipeline.py          orchestration and JSON export
│   │   └── __main__.py          CLI entry point
│   ├── tests/                   pytest suite
│   └── pyproject.toml
├── reports/
│   ├── FINDINGS.md              written report
│   ├── results.json             all statistics
│   └── figures/                 PNG figures
└── docs/                        static website (GitHub Pages ready)
    ├── index.html
    ├── css/site.css
    ├── js/charts.js             D3 chart library
    ├── js/app.js                narrative, controls, planner
    └── data/analysis.js         generated data feed
```

## Run it

```bash
cd analysis
python -m pip install -e ".[dev]"
python -m commute
pytest
```

The pipeline takes about four minutes on a laptop. It regenerates `reports/results.json`, `reports/figures/`, `docs/data/analysis.js` and the processed feature table. Options: `--cv-repeats`, `--bootstrap-reps`, `--conformal-reps`.

## View the site

Open `docs/index.html` directly in a browser, or serve it:

```bash
python -m http.server --directory docs 8000
```

To publish it, point GitHub Pages at the `/docs` folder.

## Methods at a glance

| Question | Method |
|---|---|
| Is home really slower? | Paired t-test, Wilcoxon signed-rank, bootstrap CI, Cohen's d<sub>z</sub> |
| What drives trip time? | OLS with robust errors; linear mixed model with a ride-day random intercept |
| Is the cold effect real? | Sequential adjustment with day-level bootstrap; direction-specific GAMs |
| Are things changing over time? | Season fixed effects with and without fitness controls; Theil–Sen; Kendall τ |
| Non-parametric structure | Penalised-spline GAM, random forest, LightGBM, ARD Gaussian process, ensemble |
| Validation | 5×5 repeated CV grouped by ride day; forward-chaining season-ahead tests |
| Interpretation | Tree SHAP and interaction values, permutation importance, PDP + ICE, ALE, GP length-scales |
| Uncertainty for planning | Split-conformal prediction intervals with empirical coverage checks |
