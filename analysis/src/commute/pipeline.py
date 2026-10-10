import json
import time

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from sklearn.base import clone

from commute import assistant, descriptive, figures, inference, models
from commute.config import (
    FEATURE_LABELS,
    MODEL_FEATURES,
    PROCESSED_DIR,
    RESULTS_JSON,
    SITE_DATA_FILE,
)
from commute.data import load_trips, paired_days

PLANNER_CANDIDATES = ["Linear regression", "GAM (penalised splines)", "Gaussian process (ARD)", "Ensemble (GAM + GP + GBM)"]


def _records(frame: pd.DataFrame) -> list[dict]:
    clean = frame.copy()
    for column in clean.columns:
        if pd.api.types.is_datetime64_any_dtype(clean[column]):
            clean[column] = clean[column].dt.strftime("%Y-%m-%d")
    return json.loads(clean.to_json(orient="records"))


def _round_floats(value, digits: int = 4):
    if isinstance(value, float):
        return round(value, digits) if abs(value) >= 1e-3 or value == 0 else float(f"{value:.3e}")
    if isinstance(value, dict):
        return {key: _round_floats(item, digits) for key, item in value.items()}
    if isinstance(value, list):
        return [_round_floats(item, digits) for item in value]
    return value


def _trip_table(df: pd.DataFrame, oof: np.ndarray, shap_values: list) -> list[dict]:
    table = df[
        [
            "trip_id",
            "date",
            "destination",
            "route",
            "distance_miles",
            "temperature_f",
            "minutes",
            "mph",
            "season",
            "season_ride_number",
            "days_since_last_ride",
            "weekday",
        ]
    ].copy()
    table["predicted"] = np.round(oof, 2)
    table["residual"] = np.round(df["minutes"].to_numpy() - oof, 2)
    table["minutes"] = table["minutes"].round(3)
    table["mph"] = table["mph"].round(2)
    records = _records(table)
    for record, contributions in zip(records, shap_values):
        record["shap"] = contributions
    return records


def _season_learning_curve(df: pd.DataFrame) -> dict:
    primary = df[df["is_primary_route"]]
    fit = smf.ols("minutes ~ is_home + temperature_f + I(temperature_f ** 2)", data=primary).fit()
    points = primary.assign(adjusted=fit.resid)[["season", "season_ride_number", "adjusted", "destination"]]
    summary = (
        points.assign(bucket=pd.cut(points["season_ride_number"], [0, 3, 6, 10, 15, 20, 30], labels=False))
        .groupby("bucket")
        .agg(ride=("season_ride_number", "mean"), adjusted=("adjusted", "mean"), n=("adjusted", "size"))
        .reset_index(drop=True)
    )
    return {"points": _records(points.round(3)), "buckets": _records(summary.round(3))}


def run(cv_repeats: int = 5, bootstrap_reps: int = 300, conformal_reps: int = 60) -> dict:
    started = time.time()
    df = load_trips()
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(PROCESSED_DIR / "trips_features.csv", index=False)

    print("descriptive statistics")
    overview = {
        "headline": descriptive.headline_metrics(df),
        "paired": descriptive.paired_day_summary(df),
        "by_destination": _records(descriptive.by_destination(df).reset_index()),
        "by_route": _records(descriptive.by_route(df)),
        "by_season": _records(descriptive.by_season(df)),
        "by_month": _records(descriptive.by_month(df)),
        "by_weekday": _records(descriptive.by_weekday(df)),
        "frequency": _records(descriptive.trip_frequency(df)),
        "lowess_temperature": descriptive.lowess_curves(df, "temperature_f"),
        "lowess_day_of_year": descriptive.lowess_curves(df, "day_of_year"),
        "pairs": _records(paired_days(df)[["date", "minutes_work", "minutes_home", "gap_minutes", "temp_rise", "route_work", "route_home"]].round({"minutes_work": 3, "minutes_home": 3, "gap_minutes": 3})),
    }

    print("statistical inference")
    stats_results = inference.run_inference(df)

    print("cross-validating model zoo")
    cv_summary, oof = models.cross_validate(df, repeats=cv_repeats)
    forward = models.forward_validation(df)

    print("fitting interpretable learners")
    X, y = df[MODEL_FEATURES], df["minutes"].to_numpy()
    gbm = models.make_gbm().fit(X, y)
    gp = models.make_gp().fit(X, y)
    gam = models.make_gam().fit(X, y)
    ensemble = models.model_zoo()["Ensemble (GAM + GP + GBM)"].fit(X, y)
    shap_results = models.shap_analysis(gbm, df)

    interpretation = {"shap": {key: value for key, value in shap_results.items() if key != "values"}}
    interpretation["gp_relevance"] = models.gp_relevance(gp)
    interpretation["permutation"] = {
        "Gaussian process (ARD)": models.permutation_importances(gp, df),
        "Gradient boosting (LightGBM)": models.permutation_importances(gbm, df),
    }
    curves = {}
    for feature in ["temperature_f", "season_ride_number", "day_of_year", "log_days_since_last_ride", "years_elapsed"]:
        curves[feature] = {
            "label": FEATURE_LABELS[feature],
            "gbm": models.partial_dependence_curves(gbm, df, feature),
            "gp": models.partial_dependence_curves(gp, df, feature),
            "gam": models.partial_dependence_curves(gam, df, feature),
            "ensemble": models.partial_dependence_curves(ensemble, df, feature),
            "ale_ensemble": models.accumulated_local_effects(ensemble, df, feature),
            "ale_gbm": models.accumulated_local_effects(gbm, df, feature),
            "ale_gp": models.accumulated_local_effects(gp, df, feature),
        }
    interpretation["curves"] = curves
    interpretation["gam_temperature"] = models.gam_temperature_bands(df, reps=bootstrap_reps)
    interpretation["surface"] = models.surface_temperature_by_ride(ensemble, df)
    interpretation["season_learning"] = _season_learning_curve(df)

    print("conformal prediction")
    ranked = cv_summary.set_index("model").loc[PLANNER_CANDIDATES].sort_values("rmse_mean")
    planner_name = ranked.index[0]
    factories = {
        "Linear regression": lambda: clone(models.model_zoo()["Linear regression"]),
        "GAM (penalised splines)": models.make_gam,
        "Gaussian process (ARD)": models.make_gp,
        "Ensemble (GAM + GP + GBM)": lambda: clone(models.model_zoo()["Ensemble (GAM + GP + GBM)"]),
    }
    planner_model = factories[planner_name]().fit(X, y)
    half_width = models.conformal_quantile(y, oof[planner_name])
    conformal = models.conformal_study(df, factories[planner_name], reps=conformal_reps)
    conformal["model"] = planner_name
    conformal["cv_plus_half_width"] = round(half_width, 3)
    planner = models.planner_grid(planner_model, df, half_width)
    planner["model"] = planner_name

    best_name = cv_summary.iloc[0]["model"]
    residual_sd = float(np.std(y - oof[best_name]))
    trips = _trip_table(df, oof[best_name], shap_results["values"])
    for trip in trips:
        trip["z"] = round(trip["residual"] / residual_sd, 2)
    anomalies = sorted(trips, key=lambda trip: -abs(trip["z"]))[:8]

    modelling = {
        "features": [{"feature": f, "label": FEATURE_LABELS[f]} for f in MODEL_FEATURES],
        "cv": _records(cv_summary.round(4)),
        "forward": _records(forward.round(4)),
        "best_model": best_name,
        "residual_sd": round(residual_sd, 3),
        "conformal": conformal,
        "anomalies": [
            {key: trip[key] for key in ["date", "destination", "route", "temperature_f", "minutes", "predicted", "residual", "z"]}
            for trip in anomalies
        ],
    }

    results = _round_floats(
        {
            "generated": pd.Timestamp.now().strftime("%Y-%m-%d"),
            "overview": overview,
            "inference": stats_results,
            "modelling": modelling,
            "interpretation": interpretation,
            "planner": planner,
            "trips": trips,
        }
    )

    RESULTS_JSON.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_JSON.write_text(json.dumps({k: v for k, v in results.items() if k not in ("trips", "planner")}, indent=2))
    SITE_DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    SITE_DATA_FILE.write_text("window.COMMUTE = " + json.dumps(results, separators=(",", ":")) + ";\n")

    assistant.write_context(df, results)

    print("rendering figures")
    figures.render_all(df, results)
    print(f"done in {time.time() - started:.0f}s")
    return results
