import argparse
import json
import time
import urllib.parse
import urllib.request
import warnings
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import shap
import statsmodels.formula.api as smf
from scipy import stats
from sklearn.base import BaseEstimator, RegressorMixin, clone
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.exceptions import ConvergenceWarning
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF, ConstantKernel, WhiteKernel
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LinearRegression, RidgeCV
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import SplineTransformer, StandardScaler
from statsmodels.nonparametric.smoothers_lowess import lowess

warnings.filterwarnings("ignore", category=UserWarning, module="lightgbm")
warnings.filterwarnings("ignore", category=ConvergenceWarning)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ANALYSIS_DIR = PROJECT_ROOT / "analysis"
RAW_WORKBOOK = ANALYSIS_DIR / "data" / "commute_trips.xlsx"
PROCESSED_DIR = ANALYSIS_DIR / "data"
SITE_DATA_FILE = PROJECT_ROOT / "docs" / "data" / "analysis.js"
ASSISTANT_CONTEXT_FILE = PROJECT_ROOT / "api" / "_context.js"
WEATHER_FILE = ANALYSIS_DIR / "data" / "weather_hourly.csv"
WEATHER_TRIPS_FILE = ANALYSIS_DIR / "data" / "trips_weather.csv"
PITTSBURGH = (40.4406, -79.9959)
WEATHER_FIELDS = [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "precipitation",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "cloud_cover",
]
DEPARTURE_WINDOWS = {"Work": (5, 10), "Home": (14, 20)}

RANDOM_STATE = 2026
PRIMARY_ROUTE = "A"

MODEL_FEATURES = [
    "is_home",
    "temperature_f",
    "day_of_year",
    "season_ride_number",
    "log_days_since_last_ride",
    "years_elapsed",
    "distance_miles",
]

FEATURE_LABELS = {
    "is_home": "Direction (home vs work)",
    "temperature_f": "Temperature (°F)",
    "day_of_year": "Day of year",
    "season_ride_number": "Ride # within season",
    "log_days_since_last_ride": "Days since last ride (log)",
    "years_elapsed": "Years since first ride",
    "distance_miles": "Route distance (mi)",
}


def _duration_to_minutes(value) -> float:
    if isinstance(value, pd.Timedelta):
        return value.total_seconds() / 60
    return value.hour * 60 + value.minute + value.second / 60


def read_workbook(path=RAW_WORKBOOK) -> tuple[pd.DataFrame, pd.DataFrame]:
    trips = pd.read_excel(path, sheet_name="raw_data")
    routes = pd.read_excel(path, sheet_name="route_lookup")
    return trips, routes


def validate(trips: pd.DataFrame, routes: pd.DataFrame) -> None:
    expected = {"date", "temperature_f", "destination", "time", "route"}
    missing = expected - set(trips.columns)
    if missing:
        raise ValueError(f"raw_data is missing columns: {sorted(missing)}")
    unknown_routes = set(trips["route"]) - set(routes["route"])
    if unknown_routes:
        raise ValueError(f"routes absent from lookup: {sorted(unknown_routes)}")
    if trips[["date", "temperature_f", "time"]].isna().any().any():
        raise ValueError("raw_data contains missing values")
    if trips.duplicated(subset=["date", "destination"]).any():
        raise ValueError("more than one trip per date and destination")


def engineer_features(trips: pd.DataFrame, routes: pd.DataFrame) -> pd.DataFrame:
    df = trips.merge(routes, on="route", how="left").copy()
    df["date"] = pd.to_datetime(df["date"])
    df["minutes"] = df["time"].map(_duration_to_minutes)
    df["mph"] = df["distance_miles"] / (df["minutes"] / 60)
    df["is_home"] = (df["destination"] == "Home").astype(int)
    df["year"] = df["date"].dt.year
    df["month"] = df["date"].dt.month
    df["day_of_year"] = df["date"].dt.dayofyear
    df["weekday"] = df["date"].dt.day_name()
    df["years_elapsed"] = (df["date"] - df["date"].min()).dt.days / 365.25
    df["season"] = df["year"]

    ride_days = pd.Series(sorted(df["date"].unique()))
    gaps = ride_days.diff().dt.days
    df["days_since_last_ride"] = df["date"].map(dict(zip(ride_days, gaps))).fillna(365).clip(upper=365)
    df["log_days_since_last_ride"] = np.log1p(df["days_since_last_ride"])
    df["season_ride_number"] = df.groupby("season")["date"].rank(method="dense").astype(int)

    df["is_primary_route"] = df["route"].eq(PRIMARY_ROUTE)
    df["trip_id"] = np.arange(len(df))
    ordered = df.sort_values(["date", "is_home"]).reset_index(drop=True)
    return ordered.drop(columns=["time"])


def load_trips(path=RAW_WORKBOOK) -> pd.DataFrame:
    trips, routes = read_workbook(path)
    validate(trips, routes)
    return engineer_features(trips, routes)


def load_routes(path=RAW_WORKBOOK) -> pd.DataFrame:
    return read_workbook(path)[1]


def paired_days(df: pd.DataFrame) -> pd.DataFrame:
    wide = df.pivot_table(
        index="date",
        columns="destination",
        values=["minutes", "temperature_f", "route"],
        aggfunc="first",
    )
    wide.columns = [f"{metric}_{dest.lower()}" for metric, dest in wide.columns]
    wide = wide.dropna().reset_index()
    for col in ["minutes_home", "minutes_work", "temperature_f_home", "temperature_f_work"]:
        wide[col] = wide[col].astype(float)
    wide["gap_minutes"] = wide["minutes_home"] - wide["minutes_work"]
    wide["temp_rise"] = wide["temperature_f_home"] - wide["temperature_f_work"]
    return wide


def headline_metrics(df: pd.DataFrame) -> dict:
    return {
        "trips": int(len(df)),
        "ride_days": int(df["date"].nunique()),
        "seasons": int(df["season"].nunique()),
        "first_ride": df["date"].min().date().isoformat(),
        "last_ride": df["date"].max().date().isoformat(),
        "total_miles": round(float(df["distance_miles"].sum()), 1),
        "total_hours": round(float(df["minutes"].sum() / 60), 1),
        "mean_minutes": round(float(df["minutes"].mean()), 2),
        "mean_mph": round(float(df["mph"].mean()), 2),
        "fastest_minutes": round(float(df["minutes"].min()), 2),
        "slowest_minutes": round(float(df["minutes"].max()), 2),
        "temperature_range": [int(df["temperature_f"].min()), int(df["temperature_f"].max())],
        "share_primary_route": round(float(df["is_primary_route"].mean()), 3),
    }


def _summarise(group: pd.DataFrame) -> pd.Series:
    return pd.Series(
        {
            "trips": len(group),
            "mean_minutes": group["minutes"].mean(),
            "median_minutes": group["minutes"].median(),
            "sd_minutes": group["minutes"].std(),
            "mean_mph": group["mph"].mean(),
            "mean_temperature": group["temperature_f"].mean(),
        }
    )


def by_destination(df: pd.DataFrame) -> pd.DataFrame:
    return df.groupby("destination").apply(_summarise, include_groups=False).round(2)


def by_route(df: pd.DataFrame) -> pd.DataFrame:
    table = df.groupby(["route", "destination"]).apply(_summarise, include_groups=False)
    table["distance_miles"] = df.groupby(["route", "destination"])["distance_miles"].first()
    return table.round(2).reset_index()


def by_season(df: pd.DataFrame) -> pd.DataFrame:
    table = df.groupby(["season", "destination"]).apply(_summarise, include_groups=False)
    table = table.round(2).reset_index()
    days = df.groupby("season")["date"].agg(["min", "max", "nunique"])
    days.columns = ["first_ride", "last_ride", "ride_days"]
    return table.merge(days.reset_index(), on="season")


def by_month(df: pd.DataFrame) -> pd.DataFrame:
    return (
        df.groupby(["month", "destination"])
        .apply(_summarise, include_groups=False)
        .round(2)
        .reset_index()
    )


def by_weekday(df: pd.DataFrame) -> pd.DataFrame:
    order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    table = df.groupby("weekday").apply(_summarise, include_groups=False).round(2)
    return table.reindex([day for day in order if day in table.index]).reset_index()


def trip_frequency(df: pd.DataFrame) -> pd.DataFrame:
    seasons = df.groupby("season").agg(
        trips=("trip_id", "size"),
        ride_days=("date", "nunique"),
        miles=("distance_miles", "sum"),
    )
    full_range = range(df["season"].min(), df["season"].max() + 1)
    return seasons.reindex(full_range, fill_value=0).reset_index().rename(columns={"index": "season"})


def paired_day_summary(df: pd.DataFrame) -> dict:
    pairs = paired_days(df)
    both_primary = pairs[(pairs["route_home"] == "A") & (pairs["route_work"] == "A")]
    correlation = np.corrcoef(both_primary["minutes_home"], both_primary["minutes_work"])[0, 1]
    return {
        "paired_days": int(len(pairs)),
        "paired_days_primary_route": int(len(both_primary)),
        "mean_gap_minutes": round(float(both_primary["gap_minutes"].mean()), 2),
        "median_gap_minutes": round(float(both_primary["gap_minutes"].median()), 2),
        "share_home_slower": round(float((both_primary["gap_minutes"] > 0).mean()), 3),
        "mean_temp_rise": round(float(both_primary["temp_rise"].mean()), 1),
        "same_day_correlation": round(float(correlation), 3),
    }


def lowess_curves(df: pd.DataFrame, x: str, frac: float = 0.6, points: int = 50) -> dict:
    curves = {}
    for destination, group in df[df["is_primary_route"]].groupby("destination"):
        grid = np.linspace(group[x].min(), group[x].max(), points)
        fitted = lowess(group["minutes"], group[x], frac=frac, xvals=grid)
        curves[destination] = {"x": grid.round(2).tolist(), "y": np.round(fitted, 3).tolist()}
    return curves


ADJUSTED_FORMULA = (
    "minutes ~ is_home + temperature_f + I(temperature_f ** 2) + season_ride_number"
    " + log_days_since_last_ride + years_elapsed + C(route, Treatment('A'))"
)


def _coefficient_table(result, rename: dict | None = None) -> list[dict]:
    ci = result.conf_int()
    rows = []
    for term in result.params.index:
        rows.append(
            {
                "term": (rename or {}).get(term, term),
                "estimate": round(float(result.params[term]), 4),
                "ci_low": round(float(ci.loc[term, 0]), 4),
                "ci_high": round(float(ci.loc[term, 1]), 4),
                "p_value": float(result.pvalues[term]),
            }
        )
    return rows


def bootstrap_ci(values: np.ndarray, statistic=np.median, reps: int = 5000, level: float = 0.95) -> tuple:
    rng = np.random.default_rng(RANDOM_STATE)
    draws = rng.choice(values, size=(reps, len(values)), replace=True)
    boot = np.apply_along_axis(statistic, 1, draws)
    tail = (1 - level) / 2
    return float(np.quantile(boot, tail)), float(np.quantile(boot, 1 - tail))


def direction_gap_tests(df: pd.DataFrame) -> dict:
    pairs = paired_days(df)
    pairs = pairs[(pairs["route_home"] == PRIMARY_ROUTE) & (pairs["route_work"] == PRIMARY_ROUTE)]
    gap = pairs["gap_minutes"].to_numpy()
    t_test = stats.ttest_1samp(gap, 0.0)
    wilcoxon = stats.wilcoxon(gap)
    low, high = bootstrap_ci(gap)
    effect_size = gap.mean() / gap.std(ddof=1)
    return {
        "n_pairs": int(len(gap)),
        "mean_gap": round(float(gap.mean()), 3),
        "median_gap": round(float(np.median(gap)), 3),
        "median_gap_ci": [round(low, 3), round(high, 3)],
        "t_statistic": round(float(t_test.statistic), 2),
        "t_p_value": float(t_test.pvalue),
        "wilcoxon_p_value": float(wilcoxon.pvalue),
        "cohens_dz": round(float(effect_size), 2),
        "min_gap": round(float(gap.min()), 2),
        "max_gap": round(float(gap.max()), 2),
    }


def adjusted_ols(df: pd.DataFrame):
    return smf.ols(ADJUSTED_FORMULA, data=df).fit(cov_type="HC1")


def mixed_model(df: pd.DataFrame) -> dict:
    data = df[df["is_primary_route"]].assign(day=lambda frame: frame["date"].dt.strftime("%Y-%m-%d"))
    model = smf.mixedlm(
        "minutes ~ is_home + temperature_f + I(temperature_f ** 2) + season_ride_number"
        " + log_days_since_last_ride + years_elapsed",
        data=data,
        groups=data["day"],
    )
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        result = model.fit(reml=True)
    day_variance = float(result.cov_re.iloc[0, 0])
    residual_variance = float(result.scale)
    return {
        "coefficients": _coefficient_table(result),
        "day_variance": round(day_variance, 3),
        "residual_variance": round(residual_variance, 3),
        "icc": round(day_variance / (day_variance + residual_variance), 3),
        "on_boundary": bool(day_variance < 1e-3),
    }


def same_day_residual_correlation(df: pd.DataFrame, residuals: pd.Series) -> dict:
    frame = df.assign(residual=residuals.to_numpy())
    wide = frame.pivot_table(index="date", columns="destination", values="residual").dropna()
    result = stats.pearsonr(wide["Work"], wide["Home"])
    return {"pairs": int(len(wide)), "r": round(float(result.statistic), 3), "p_value": float(result.pvalue)}


def temperature_optimum(result) -> dict:
    linear = result.params["temperature_f"]
    quadratic = result.params["I(temperature_f ** 2)"]
    cov = result.cov_params().loc[
        ["temperature_f", "I(temperature_f ** 2)"], ["temperature_f", "I(temperature_f ** 2)"]
    ].to_numpy()
    rng = np.random.default_rng(RANDOM_STATE)
    draws = rng.multivariate_normal([linear, quadratic], cov, size=20000)
    draws = draws[draws[:, 1] > 0]
    optimum = -draws[:, 0] / (2 * draws[:, 1])
    return {
        "optimum_f": round(float(-linear / (2 * quadratic)), 1),
        "optimum_ci": [round(float(np.quantile(optimum, 0.05)), 1), round(float(np.quantile(optimum, 0.95)), 1)],
        "share_draws_convex": round(float(len(draws) / 20000), 3),
    }


COLD_PENALTY_SPECS = {
    "Temperature only": "minutes ~ temperature_f + I(temperature_f ** 2)",
    "+ ride number in season": "minutes ~ temperature_f + I(temperature_f ** 2) + season_ride_number",
    "+ calendar, layoff & year": (
        "minutes ~ temperature_f + I(temperature_f ** 2) + season_ride_number + day_of_year"
        " + log_days_since_last_ride + years_elapsed"
    ),
}


def cold_penalty_decomposition(df: pd.DataFrame, cold: float = 35, mild: float = 65, reps: int = 2000) -> dict:
    work = df[(df["destination"] == "Work") & df["is_primary_route"]].reset_index(drop=True)
    reference = work.median(numeric_only=True)
    grid = pd.DataFrame([reference, reference])
    grid["temperature_f"] = [cold, mild]
    rng = np.random.default_rng(RANDOM_STATE)
    rows = []
    for label, formula in COLD_PENALTY_SPECS.items():
        fitted = smf.ols(formula, data=work).fit()
        point = float(np.diff(fitted.predict(grid))[0] * -1)
        boot = []
        for _ in range(reps):
            sample = work.iloc[rng.integers(0, len(work), len(work))]
            prediction = smf.ols(formula, data=sample).fit().predict(grid)
            boot.append(float(prediction.iloc[0] - prediction.iloc[1]))
        rows.append(
            {
                "model": label,
                "penalty_minutes": round(point, 3),
                "ci_low": round(float(np.quantile(boot, 0.05)), 3),
                "ci_high": round(float(np.quantile(boot, 0.95)), 3),
                "r_squared": round(float(fitted.rsquared), 3),
            }
        )
    correlations = work[["temperature_f", "season_ride_number", "day_of_year"]].corr(method="spearman")
    return {
        "cold_f": cold,
        "mild_f": mild,
        "n_work_trips": int(len(work)),
        "steps": rows,
        "share_explained_by_fitness": round(1 - rows[-1]["penalty_minutes"] / rows[0]["penalty_minutes"], 3),
        "spearman_temp_ride": round(float(correlations.loc["temperature_f", "season_ride_number"]), 3),
        "spearman_temp_doy": round(float(correlations.loc["temperature_f", "day_of_year"]), 3),
    }


def route_comparison(df: pd.DataFrame) -> dict:
    work = df[df["destination"] == "Work"]
    route_a = work.loc[work["route"] == "A", "minutes"]
    route_d = work.loc[work["route"] == "D", "minutes"]
    same_window = work[(work["date"] >= "2019-08-01") & (work["date"] <= "2019-10-31")]
    window_a = same_window.loc[same_window["route"] == "A", "minutes"]
    window_d = same_window.loc[same_window["route"] == "D", "minutes"]
    mann_whitney = stats.mannwhitneyu(route_d, route_a, alternative="less")
    window_test = stats.mannwhitneyu(window_d, window_a, alternative="less")
    return {
        "work_route_a_mean": round(float(route_a.mean()), 2),
        "work_route_d_mean": round(float(route_d.mean()), 2),
        "work_route_d_n": int(len(route_d)),
        "mann_whitney_p": float(mann_whitney.pvalue),
        "autumn_2019_route_a_mean": round(float(window_a.mean()), 2),
        "autumn_2019_route_d_mean": round(float(window_d.mean()), 2),
        "autumn_2019_route_a_n": int(len(window_a)),
        "autumn_2019_mann_whitney_p": float(window_test.pvalue),
    }


def _season_effects(data: pd.DataFrame, formula: str) -> list[dict]:
    fitted = smf.ols(formula, data=data).fit(cov_type="HC1")
    ci = fitted.conf_int()
    seasons = sorted(data["season"].unique())
    effects = [{"season": int(seasons[0]), "estimate": 0.0, "ci_low": 0.0, "ci_high": 0.0}]
    for season in seasons[1:]:
        term = f"C(season)[T.{season}]"
        effects.append(
            {
                "season": int(season),
                "estimate": round(float(fitted.params[term]), 3),
                "ci_low": round(float(ci.loc[term, 0]), 3),
                "ci_high": round(float(ci.loc[term, 1]), 3),
            }
        )
    return effects


def long_term_trend(df: pd.DataFrame) -> dict:
    primary = df[df["is_primary_route"]].copy()
    base = smf.ols(
        "minutes ~ is_home + temperature_f + I(temperature_f ** 2) + season_ride_number + log_days_since_last_ride",
        data=primary,
    ).fit()
    primary["adjusted_residual"] = base.resid
    tau = stats.kendalltau(primary["years_elapsed"], primary["adjusted_residual"])
    slope, intercept, low, high = stats.theilslopes(primary["adjusted_residual"], primary["years_elapsed"])

    naive = smf.ols("minutes ~ is_home + temperature_f + I(temperature_f ** 2) + years_elapsed", data=primary).fit(
        cov_type="HC3"
    )
    full = smf.ols(
        "minutes ~ is_home + temperature_f + I(temperature_f ** 2) + years_elapsed + season_ride_number"
        " + log_days_since_last_ride",
        data=primary,
    ).fit(cov_type="HC3")
    effects = _season_effects(primary, "minutes ~ is_home + temperature_f + I(temperature_f ** 2) + C(season)")
    effects_fitness = _season_effects(
        primary,
        "minutes ~ is_home + temperature_f + I(temperature_f ** 2) + season_ride_number + log_days_since_last_ride + C(season)",
    )
    return {
        "kendall_tau": round(float(tau.statistic), 3),
        "kendall_p": float(tau.pvalue),
        "theil_sen_seconds_per_year": round(float(slope * 60), 1),
        "theil_sen_ci_seconds": [round(float(low * 60), 1), round(float(high * 60), 1)],
        "naive_years_coef_seconds": round(float(naive.params["years_elapsed"] * 60), 1),
        "naive_years_p": float(naive.pvalues["years_elapsed"]),
        "adjusted_years_coef_seconds": round(float(full.params["years_elapsed"] * 60), 1),
        "adjusted_years_p": float(full.pvalues["years_elapsed"]),
        "season_effects": effects,
        "season_effects_fitness_adjusted": effects_fitness,
    }


def weekday_test(df: pd.DataFrame, residuals: pd.Series) -> dict:
    groups = [residuals[df["weekday"] == day].to_numpy() for day in df["weekday"].unique()]
    groups = [group for group in groups if len(group) >= 5]
    result = stats.kruskal(*groups)
    return {"kruskal_h": round(float(result.statistic), 2), "p_value": float(result.pvalue)}


def run_inference(df: pd.DataFrame) -> dict:
    ols = adjusted_ols(df)
    return {
        "direction_gap": direction_gap_tests(df),
        "ols": {
            "formula": ADJUSTED_FORMULA,
            "r_squared": round(float(ols.rsquared), 3),
            "adj_r_squared": round(float(ols.rsquared_adj), 3),
            "residual_sd": round(float(np.sqrt(ols.scale)), 3),
            "coefficients": _coefficient_table(ols),
        },
        "temperature_optimum": temperature_optimum(ols),
        "cold_penalty": cold_penalty_decomposition(df),
        "mixed_model": mixed_model(df),
        "routes": route_comparison(df),
        "trend": long_term_trend(df),
        "weekday": weekday_test(df, ols.resid),
        "same_day_residuals": same_day_residual_correlation(df, ols.resid),
    }



SMOOTH_FEATURES = [
    "temperature_f",
    "day_of_year",
    "season_ride_number",
    "log_days_since_last_ride",
    "years_elapsed",
]
LINEAR_FEATURES = ["is_home", "distance_miles"]


class DirectionMean(BaseEstimator, RegressorMixin):
    def fit(self, X, y):
        frame = pd.DataFrame({"is_home": np.asarray(X["is_home"]), "y": np.asarray(y)})
        self.means_ = frame.groupby("is_home")["y"].mean().to_dict()
        return self

    def predict(self, X):
        return np.array([self.means_[int(value)] for value in X["is_home"]])


class AveragingEnsemble(BaseEstimator, RegressorMixin):
    def __init__(self, estimators):
        self.estimators = estimators

    def fit(self, X, y):
        self.fitted_ = [clone(estimator).fit(X, y) for estimator in self.estimators]
        return self

    def predict(self, X):
        return np.mean([estimator.predict(X) for estimator in self.fitted_], axis=0)


def make_gam() -> object:
    preprocess = ColumnTransformer(
        [
            ("splines", SplineTransformer(n_knots=4, degree=3, extrapolation="linear"), SMOOTH_FEATURES),
            ("linear", "passthrough", LINEAR_FEATURES),
        ]
    )
    return make_pipeline(preprocess, StandardScaler(), RidgeCV(alphas=np.logspace(-2, 3, 30)))


def make_gbm() -> lgb.LGBMRegressor:
    return lgb.LGBMRegressor(
        n_estimators=600,
        learning_rate=0.02,
        num_leaves=7,
        max_depth=3,
        min_child_samples=6,
        subsample=0.8,
        subsample_freq=1,
        colsample_bytree=0.8,
        reg_lambda=1.0,
        random_state=RANDOM_STATE,
        verbose=-1,
    )


def make_gp() -> object:
    kernel = ConstantKernel(1.0) * RBF(length_scale=np.ones(len(MODEL_FEATURES)), length_scale_bounds=(1e-2, 1e3))
    kernel += WhiteKernel(noise_level=0.1, noise_level_bounds=(1e-4, 10))
    regressor = GaussianProcessRegressor(kernel=kernel, normalize_y=True, n_restarts_optimizer=3, random_state=RANDOM_STATE)
    return make_pipeline(StandardScaler(), regressor)


def make_forest() -> RandomForestRegressor:
    return RandomForestRegressor(
        n_estimators=500, min_samples_leaf=3, max_features=0.6, random_state=RANDOM_STATE, n_jobs=-1
    )


def model_zoo() -> dict:
    return {
        "Direction mean (baseline)": DirectionMean(),
        "Linear regression": make_pipeline(StandardScaler(), LinearRegression()),
        "GAM (penalised splines)": make_gam(),
        "Random forest": make_forest(),
        "Gradient boosting (LightGBM)": make_gbm(),
        "Gaussian process (ARD)": make_gp(),
        "Ensemble (GAM + GP + GBM)": AveragingEnsemble([make_gam(), make_gp(), make_gbm()]),
    }


def grouped_folds(groups: pd.Series, n_splits: int, repeats: int):
    unique = np.array(sorted(groups.unique()))
    rng = np.random.default_rng(RANDOM_STATE)
    for repeat in range(repeats):
        shuffled = rng.permutation(unique)
        for fold, held_out in enumerate(np.array_split(shuffled, n_splits)):
            test_mask = groups.isin(held_out).to_numpy()
            yield repeat, fold, np.where(~test_mask)[0], np.where(test_mask)[0]


def _scores(y_true, y_pred) -> dict:
    return {
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "r2": float(r2_score(y_true, y_pred)),
    }


def cross_validate(df: pd.DataFrame, n_splits: int = 5, repeats: int = 5) -> tuple[pd.DataFrame, dict]:
    X, y, groups = df[MODEL_FEATURES], df["minutes"].to_numpy(), df["date"]
    zoo = model_zoo()
    records = []
    oof = {name: np.zeros((repeats, len(df))) for name in zoo}
    for repeat, fold, train, test in grouped_folds(groups, n_splits, repeats):
        for name, estimator in zoo.items():
            fitted = clone(estimator).fit(X.iloc[train], y[train])
            prediction = fitted.predict(X.iloc[test])
            oof[name][repeat, test] = prediction
            records.append({"model": name, "repeat": repeat, "fold": fold, **_scores(y[test], prediction)})
    folds = pd.DataFrame(records)
    summary = (
        folds.groupby("model")[["rmse", "mae", "r2"]]
        .agg(["mean", "std"])
        .sort_values(("rmse", "mean"))
    )
    summary.columns = [f"{metric}_{stat}" for metric, stat in summary.columns]
    out_of_fold = {name: values.mean(axis=0) for name, values in oof.items()}
    return summary.reset_index(), out_of_fold


def forward_validation(df: pd.DataFrame, min_training_seasons: int = 2) -> pd.DataFrame:
    X, y = df[MODEL_FEATURES], df["minutes"].to_numpy()
    seasons = sorted(df["season"].unique())
    records = []
    for season in seasons[min_training_seasons:]:
        train = (df["season"] < season).to_numpy()
        test = (df["season"] == season).to_numpy()
        for name, estimator in model_zoo().items():
            fitted = clone(estimator).fit(X[train], y[train])
            prediction = fitted.predict(X[test])
            records.append(
                {
                    "model": name,
                    "season": int(season),
                    "n": int(test.sum()),
                    "mae": float(mean_absolute_error(y[test], prediction)),
                }
            )
    return pd.DataFrame(records)


def _feature_grid(series: pd.Series, points: int = 60) -> np.ndarray:
    return np.linspace(series.quantile(0.02), series.quantile(0.98), points)


def partial_dependence_curves(estimator, df: pd.DataFrame, feature: str, points: int = 60, ice_samples: int = 40) -> dict:
    X = df[MODEL_FEATURES].reset_index(drop=True)
    grid = _feature_grid(X[feature], points)
    rng = np.random.default_rng(RANDOM_STATE)
    ice_rows = rng.choice(len(X), size=min(ice_samples, len(X)), replace=False)
    ice = np.zeros((len(ice_rows), len(grid)))
    pdp_by_direction = {}
    for direction in (0, 1):
        subset = X[X["is_home"] == direction]
        values = []
        for value in grid:
            frame = subset.copy()
            frame[feature] = value
            values.append(float(estimator.predict(frame).mean()))
        pdp_by_direction["Home" if direction else "Work"] = values
    overall = []
    for column, value in enumerate(grid):
        frame = X.copy()
        frame[feature] = value
        prediction = estimator.predict(frame)
        overall.append(float(prediction.mean()))
        ice[:, column] = prediction[ice_rows]
    centred_ice = ice - ice[:, [0]]
    return {
        "grid": grid.round(3).tolist(),
        "pdp": np.round(overall, 3).tolist(),
        "by_direction": {key: np.round(val, 3).tolist() for key, val in pdp_by_direction.items()},
        "ice_centred": centred_ice.round(3).tolist(),
        "ice_direction": X.loc[ice_rows, "is_home"].map({0: "Work", 1: "Home"}).tolist(),
    }


def accumulated_local_effects(estimator, df: pd.DataFrame, feature: str, bins: int = 12) -> dict:
    X = df[MODEL_FEATURES].reset_index(drop=True)
    edges = np.unique(np.quantile(X[feature], np.linspace(0, 1, bins + 1)))
    assignment = np.clip(np.digitize(X[feature], edges[1:-1], right=True), 0, len(edges) - 2)
    effects = np.zeros(len(edges) - 1)
    counts = np.zeros(len(edges) - 1)
    for k in range(len(edges) - 1):
        rows = X[assignment == k]
        if rows.empty:
            continue
        upper, lower = rows.copy(), rows.copy()
        upper[feature], lower[feature] = edges[k + 1], edges[k]
        effects[k] = float(np.mean(estimator.predict(upper) - estimator.predict(lower)))
        counts[k] = len(rows)
    accumulated = np.concatenate([[0.0], np.cumsum(effects)])
    centres = (accumulated[:-1] + accumulated[1:]) / 2
    accumulated -= np.average(centres, weights=np.maximum(counts, 1))
    return {"edges": edges.round(3).tolist(), "ale": accumulated.round(3).tolist(), "counts": counts.astype(int).tolist()}


def shap_analysis(gbm: lgb.LGBMRegressor, df: pd.DataFrame) -> dict:
    X = df[MODEL_FEATURES]
    explainer = shap.TreeExplainer(gbm)
    values = explainer.shap_values(X)
    interactions = explainer.shap_interaction_values(X)
    mean_abs = np.abs(values).mean(axis=0)
    order = np.argsort(mean_abs)[::-1]
    interaction_strength = np.abs(interactions).mean(axis=0)
    np.fill_diagonal(interaction_strength, 0)
    temp_idx, home_idx = MODEL_FEATURES.index("temperature_f"), MODEL_FEATURES.index("is_home")
    return {
        "base_value": float(np.ravel(explainer.expected_value)[0]),
        "importance": [
            {"feature": MODEL_FEATURES[i], "label": FEATURE_LABELS[MODEL_FEATURES[i]], "mean_abs_shap": round(float(mean_abs[i]), 4)}
            for i in order
        ],
        "values": np.round(values, 4).tolist(),
        "feature_values": X.round(3).to_numpy().tolist(),
        "features": MODEL_FEATURES,
        "interaction_matrix": np.round(interaction_strength, 4).tolist(),
        "temperature_direction_interaction": np.round(2 * interactions[:, temp_idx, home_idx], 4).tolist(),
    }


def gp_relevance(gp_pipeline) -> list[dict]:
    kernel = gp_pipeline[-1].kernel_
    scales = np.atleast_1d(kernel.k1.k2.length_scale)
    noise = float(kernel.k2.noise_level)
    relevance = 1 / scales
    return [
        {"feature": feature, "label": FEATURE_LABELS[feature], "length_scale": round(float(scale), 3), "relevance": round(float(rel / relevance.max()), 4)}
        for feature, scale, rel in sorted(zip(MODEL_FEATURES, scales, relevance), key=lambda item: -item[2])
    ] + [{"feature": "noise", "label": "Learned noise (std-scaled)", "length_scale": round(noise, 4), "relevance": None}]


def permutation_importances(estimator, df: pd.DataFrame) -> list[dict]:
    result = permutation_importance(
        estimator, df[MODEL_FEATURES], df["minutes"], n_repeats=40, random_state=RANDOM_STATE, scoring="neg_root_mean_squared_error"
    )
    order = np.argsort(result.importances_mean)[::-1]
    return [
        {
            "feature": MODEL_FEATURES[i],
            "label": FEATURE_LABELS[MODEL_FEATURES[i]],
            "rmse_increase": round(float(result.importances_mean[i]), 4),
            "std": round(float(result.importances_std[i]), 4),
        }
        for i in order
    ]


def gam_temperature_bands(df: pd.DataFrame, reps: int = 300) -> dict:
    primary = df[df["is_primary_route"]].reset_index(drop=True)
    grids = {
        label: np.arange(
            int(primary.loc[primary["is_home"] == flag, "temperature_f"].min()),
            int(primary.loc[primary["is_home"] == flag, "temperature_f"].max()) + 1,
        )
        for label, flag in (("Work", 0), ("Home", 1))
    }
    rng = np.random.default_rng(RANDOM_STATE)
    days = primary["date"].unique()
    output = {}
    for direction, flag in (("Work", 0), ("Home", 1)):
        subset = primary[primary["is_home"] == flag]
        features = [f for f in MODEL_FEATURES if f not in ("is_home", "distance_miles")]
        reference = subset[features].median()
        grid = grids[direction]
        frame = pd.DataFrame([reference] * len(grid))
        frame["temperature_f"] = grid
        curves = []
        for _ in range(reps):
            sampled_days = rng.choice(days, size=len(days), replace=True)
            boot = pd.concat([subset[subset["date"] == day] for day in sampled_days])
            if boot.empty:
                continue
            model = _direction_gam(features).fit(boot[features], boot["minutes"])
            curves.append(model.predict(frame[features]))
        fitted = _direction_gam(features).fit(subset[features], subset["minutes"]).predict(frame[features])
        curves = np.array(curves)
        output[direction] = {
            "temperature": grid.tolist(),
            "fit": np.round(fitted, 3).tolist(),
            "low": np.round(np.quantile(curves, 0.05, axis=0), 3).tolist(),
            "high": np.round(np.quantile(curves, 0.95, axis=0), 3).tolist(),
            "optimum_f": int(grid[np.argmin(fitted)]),
        }
    return output


def _direction_gam(features: list[str]):
    preprocess = ColumnTransformer(
        [("splines", SplineTransformer(n_knots=4, degree=3, extrapolation="linear"), features)]
    )
    return make_pipeline(preprocess, StandardScaler(), RidgeCV(alphas=np.logspace(-1, 3, 25)))


def conformal_study(df: pd.DataFrame, estimator_factory, alpha: float = 0.1, reps: int = 60) -> dict:
    X, y = df[MODEL_FEATURES], df["minutes"].to_numpy()
    days = np.array(sorted(df["date"].unique()))
    rng = np.random.default_rng(RANDOM_STATE)
    coverage, widths = [], []
    for _ in range(reps):
        shuffled = rng.permutation(days)
        n_train, n_cal = int(0.6 * len(days)), int(0.2 * len(days))
        train = df["date"].isin(shuffled[:n_train]).to_numpy()
        calibrate = df["date"].isin(shuffled[n_train : n_train + n_cal]).to_numpy()
        test = ~(train | calibrate)
        model = estimator_factory().fit(X[train], y[train])
        scores = np.abs(y[calibrate] - model.predict(X[calibrate]))
        level = min(1.0, np.ceil((len(scores) + 1) * (1 - alpha)) / len(scores))
        q = np.quantile(scores, level, method="higher")
        prediction = model.predict(X[test])
        coverage.append(float(np.mean(np.abs(y[test] - prediction) <= q)))
        widths.append(float(2 * q))
    return {
        "target_coverage": 1 - alpha,
        "empirical_coverage": round(float(np.mean(coverage)), 3),
        "coverage_p10_p90": [round(float(np.quantile(coverage, 0.1)), 3), round(float(np.quantile(coverage, 0.9)), 3)],
        "mean_interval_width_minutes": round(float(np.mean(widths)), 2),
    }


def conformal_quantile(y: np.ndarray, oof_prediction: np.ndarray, alpha: float = 0.1) -> float:
    scores = np.abs(y - oof_prediction)
    level = min(1.0, np.ceil((len(scores) + 1) * (1 - alpha)) / len(scores))
    return float(np.quantile(scores, level, method="higher"))


def planner_grid(estimator, df: pd.DataFrame, half_width: float) -> dict:
    latest = df["years_elapsed"].max()
    typical_gap = float(df["log_days_since_last_ride"].median())
    temperatures = np.arange(25, 96)
    months = np.arange(3, 11)
    ride_numbers = np.array([1, 3, 5, 8, 12, 16, 20, 25, 30])
    rows = []
    for is_home in (0, 1):
        for month in months:
            for ride in ride_numbers:
                for temperature in temperatures:
                    rows.append(
                        {
                            "is_home": is_home,
                            "temperature_f": float(temperature),
                            "day_of_year": float(pd.Timestamp(2026, month, 15).dayofyear),
                            "season_ride_number": float(ride),
                            "log_days_since_last_ride": typical_gap,
                            "years_elapsed": latest,
                            "distance_miles": 7.4,
                        }
                    )
    grid = pd.DataFrame(rows)[MODEL_FEATURES]
    prediction = estimator.predict(grid)
    shape = (2, len(months), len(ride_numbers), len(temperatures))
    return {
        "temperatures": temperatures.tolist(),
        "months": months.tolist(),
        "ride_numbers": ride_numbers.tolist(),
        "predictions": np.round(prediction.reshape(shape), 2).tolist(),
        "half_width": round(half_width, 2),
    }


def surface_temperature_by_ride(estimator, df: pd.DataFrame) -> dict:
    rides = np.arange(1, 31)
    reference = df[MODEL_FEATURES].median()
    output = {"rides": rides.tolist(), "temperatures": {}, "values": {}}
    for label, flag in (("Work", 0), ("Home", 1)):
        observed = df.loc[df["is_home"] == flag, "temperature_f"]
        temperatures = np.arange(int(observed.min()) // 2 * 2, int(observed.max()) + 2, 2)
        rows = []
        for ride in rides:
            for temperature in temperatures:
                row = reference.copy()
                row["is_home"], row["temperature_f"], row["season_ride_number"] = flag, temperature, ride
                row["distance_miles"] = 7.4
                rows.append(row)
        prediction = estimator.predict(pd.DataFrame(rows)[MODEL_FEATURES])
        output["temperatures"][label] = temperatures.tolist()
        output["values"][label] = np.round(prediction.reshape(len(rides), len(temperatures)), 2).tolist()
    return output


def download_weather(dates: pd.Series) -> pd.DataFrame:
    frames = []
    for _, span in dates.groupby(dates.dt.year):
        query = {
            "latitude": PITTSBURGH[0],
            "longitude": PITTSBURGH[1],
            "start_date": span.min().strftime("%Y-%m-%d"),
            "end_date": span.max().strftime("%Y-%m-%d"),
            "hourly": ",".join(WEATHER_FIELDS),
            "temperature_unit": "fahrenheit",
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timezone": "America/New_York",
        }
        url = "https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode(query)
        with urllib.request.urlopen(url, timeout=60) as response:
            hourly = pd.DataFrame(json.load(response)["hourly"])
        frames.append(hourly)
    weather = pd.concat(frames)
    weather["time"] = pd.to_datetime(weather["time"])
    return weather[weather["time"].dt.normalize().isin(dates.unique())].sort_values("time")


def load_weather(df: pd.DataFrame) -> pd.DataFrame:
    ride_days = df["date"].dt.normalize()
    if WEATHER_FILE.exists():
        weather = pd.read_csv(WEATHER_FILE, parse_dates=["time"])
        if set(ride_days.unique()) <= set(weather["time"].dt.normalize().unique()):
            return weather
    weather = download_weather(ride_days)
    weather.to_csv(WEATHER_FILE, index=False)
    return weather


def attach_weather(df: pd.DataFrame, weather: pd.DataFrame) -> pd.DataFrame:
    weather = weather.assign(day=weather["time"].dt.normalize(), hour=weather["time"].dt.hour)
    rows = []
    for _, trip in df.iterrows():
        start, end = DEPARTURE_WINDOWS[trip["destination"]]
        window = weather[(weather["day"] == trip["date"]) & weather["hour"].between(start, end)]
        gap = (window["temperature_2m"] - trip["temperature_f"]).abs()
        match = window.loc[gap.idxmin()]
        rows.append(
            {
                "trip_id": trip["trip_id"],
                "departure_hour": int(match["hour"]),
                "temperature_match_error": float(gap.min()),
                **{field: float(match[field]) for field in WEATHER_FIELDS},
            }
        )
    return df.merge(pd.DataFrame(rows), on="trip_id")


def headwind(df: pd.DataFrame, work_bearing: float) -> pd.Series:
    travel = np.where(df["is_home"] == 1, (work_bearing + 180) % 360, work_bearing)
    return df["wind_speed_10m"] * np.cos(np.radians(df["wind_direction_10m"] - travel))


def crosswind(df: pd.DataFrame, work_bearing: float) -> pd.Series:
    travel = np.where(df["is_home"] == 1, (work_bearing + 180) % 360, work_bearing)
    return (df["wind_speed_10m"] * np.sin(np.radians(df["wind_direction_10m"] - travel))).abs()


def _wind_design(df: pd.DataFrame) -> np.ndarray:
    return np.c_[
        np.ones(len(df)),
        df["is_home"],
        df["temperature_f"],
        df["temperature_f"] ** 2,
        df["season_ride_number"],
        df["log_days_since_last_ride"],
        df["years_elapsed"],
    ]


def best_bearing(df: pd.DataFrame, bearings: np.ndarray) -> tuple[float, float, list[float]]:
    base = _wind_design(df)
    y = df["minutes"].to_numpy()
    fits = []
    for bearing in bearings:
        X = np.c_[base, headwind(df, bearing)]
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        residual = y - X @ beta
        fits.append((float(residual @ residual), float(bearing), float(beta[-1])))
    _, bearing, cost = min(fits)
    if cost < 0:
        bearing, cost = (bearing + 180) % 360, -cost
    total = float(((y - y.mean()) ** 2).sum())
    return bearing, cost, [round(1 - ssr / total, 4) for ssr, _, _ in fits]


def wind_analysis(df: pd.DataFrame, reps: int = 500) -> dict:
    primary = df[df["is_primary_route"]].reset_index(drop=True)
    bearings = np.arange(0, 360, 5)
    bearing, cost, profile = best_bearing(primary, bearings)

    rng = np.random.default_rng(RANDOM_STATE)
    groups = {day: np.where(primary["date"] == day)[0] for day in primary["date"].unique()}
    days = list(groups)
    boot_bearings, boot_costs = [], []
    for _ in range(reps):
        index = np.concatenate([groups[days[i]] for i in rng.integers(0, len(days), len(days))])
        b, c, _ = best_bearing(primary.iloc[index].reset_index(drop=True), bearings)
        boot_bearings.append(((b - bearing + 180) % 360) - 180)
        boot_costs.append(c)

    data = primary.assign(headwind=headwind(primary, bearing), crosswind=crosswind(primary, bearing))
    base_formula = (
        "minutes ~ is_home + temperature_f + I(temperature_f ** 2) + season_ride_number"
        " + log_days_since_last_ride + years_elapsed"
    )
    base = smf.ols(base_formula, data=data).fit(cov_type="HC1")
    with_wind = smf.ols(base_formula + " + headwind", data=data).fit(cov_type="HC1")
    extras = {}
    for term in ["precipitation", "wind_gusts_10m", "crosswind", "relative_humidity_2m", "cloud_cover"]:
        fitted = smf.ols(base_formula + " + headwind + " + term, data=data).fit(cov_type="HC1")
        extras[term] = {"estimate": round(float(fitted.params[term]), 4), "p_value": float(fitted.pvalues[term])}

    adjusted = smf.ols(base_formula, data=data).fit()
    points = data.assign(adjusted_seconds=adjusted.resid * 60)[["date", "destination", "headwind", "adjusted_seconds", "wind_speed_10m", "wind_direction_10m"]]

    def circular_mean(angles):
        radians = np.radians(angles)
        return round(float(np.degrees(np.arctan2(np.sin(radians).mean(), np.cos(radians).mean())) % 360), 1)

    by_direction = {
        destination: {
            "mean_wind_mph": round(float(group["wind_speed_10m"].mean()), 2),
            "mean_headwind_mph": round(float(group["headwind"].mean()), 2),
            "wind_from_deg": circular_mean(group["wind_direction_10m"]),
            "share_headwind": round(float((group["headwind"] > 0).mean()), 3),
        }
        for destination, group in data.groupby("destination")
    }
    hours = df.groupby("destination")["departure_hour"].value_counts().sort_index()
    return {
        "source": "Open-Meteo historical reanalysis (ERA5), hourly, central Pittsburgh",
        "work_bearing_deg": bearing,
        "work_bearing_ci": [round(bearing + float(np.percentile(boot_bearings, 5))), round(bearing + float(np.percentile(boot_bearings, 95)))],
        "headwind_seconds_per_mph": round(cost * 60, 2),
        "headwind_seconds_ci": [round(float(np.percentile(boot_costs, 5)) * 60, 1), round(float(np.percentile(boot_costs, 95)) * 60, 1)],
        "bearing_profile": {"bearings": bearings.tolist(), "r_squared": profile},
        "r_squared_without_wind": round(float(base.rsquared), 4),
        "r_squared_with_wind": round(float(with_wind.rsquared), 4),
        "residual_sd_without_wind_s": round(float(np.sqrt(base.mse_resid)) * 60, 1),
        "residual_sd_with_wind_s": round(float(np.sqrt(with_wind.mse_resid)) * 60, 1),
        "home_penalty_without_wind": round(float(base.params["is_home"]), 3),
        "home_penalty_with_wind": round(float(with_wind.params["is_home"]), 3),
        "headwind_p_value": float(with_wind.pvalues["headwind"]),
        "by_direction": by_direction,
        "other_weather": extras,
        "rainy_trips": int((df["precipitation"] > 0.01).sum()),
        "temperature_match_error_median": round(float(df["temperature_match_error"].median()), 2),
        "temperature_match_correlation": round(float(np.corrcoef(df["temperature_f"], df["temperature_2m"])[0, 1]), 3),
        "departure_hours": {destination: {int(h): int(n) for h, n in hours[destination].items()} for destination in ["Work", "Home"]},
        "points": json.loads(points.assign(date=points["date"].dt.strftime("%Y-%m-%d")).round(3).to_json(orient="records")),
    }


def _clock(minutes: float) -> str:
    total = round(minutes * 60)
    return f"{total // 60}:{total % 60:02d}"


def _table(rows: list[dict], columns: list[str]) -> str:
    header = "| " + " | ".join(columns) + " |"
    rule = "|" + "|".join("---" for _ in columns) + "|"
    body = ["| " + " | ".join(str(row.get(column, "")) for column in columns) + " |" for row in rows]
    return "\n".join([header, rule, *body])


def build_context(df: pd.DataFrame, results: dict) -> str:
    overview = results["overview"]
    headline = overview["headline"]
    inference = results["inference"]
    modelling = results["modelling"]
    interpretation = results["interpretation"]
    gap = inference["direction_gap"]
    cold = inference["cold_penalty"]
    trend = inference["trend"]
    routes = inference["routes"]
    coefficients = {row["term"]: row for row in inference["ols"]["coefficients"]}
    route_d = coefficients["C(route, Treatment('A'))[T.D]"]["estimate"]
    route_b = coefficients["C(route, Treatment('A'))[T.B]"]["estimate"]

    lines = [
        "# Bicycle commute dataset and analysis",
        "",
        "## Source data",
        "One commuter logged bicycle trips between home and work. Each row is a trip with date, temperature at departure (°F),",
        "destination (Work = morning ride, Home = evening ride), duration and route code. Route distances: "
        + ", ".join(f"{route} {distance} mi" for route, distance in df.groupby("route")["distance_miles"].first().items())
        + ".",
        f"Trips: {headline['trips']} over {headline['ride_days']} ride days, {headline['first_ride']} to {headline['last_ride']}. "
        f"No rides were logged in 2020 and only one ride day in 2025. Total {headline['total_miles']} miles, {headline['total_hours']} hours.",
        f"Mean trip {_clock(headline['mean_minutes'])}, mean speed {headline['mean_mph']} mph, fastest {_clock(headline['fastest_minutes'])}, "
        f"slowest {_clock(headline['slowest_minutes'])}, temperatures {headline['temperature_range'][0]}–{headline['temperature_range'][1]}°F. "
        f"Route A carries {round(headline['share_primary_route'] * 100)}% of trips.",
        "",
        "## Key findings",
        f"1. Direction: on all {gap['n_pairs']} days with Route A both ways, home was slower. Median gap {gap['median_gap']} min "
        f"(95% bootstrap CI {gap['median_gap_ci'][0]}–{gap['median_gap_ci'][1]}), mean {gap['mean_gap']} min, range {gap['min_gap']}–{gap['max_gap']} min, "
        f"Wilcoxon p={gap['wilcoxon_p_value']:.1e}, Cohen's dz={gap['cohens_dz']}. Adjusted regression effect "
        f"+{coefficients['is_home']['estimate']} min. Evenings average {overview['paired']['mean_temp_rise']}°F warmer. "
        f"Mixed-model ICC for ride day ≈ {inference['mixed_model']['icc']}; same-day residual correlation r={inference['same_day_residuals']['r']} "
        f"(p={inference['same_day_residuals']['p_value']:.3f}). Likely causes (not measured): net climb toward home, afternoon wind, evening traffic.",
        f"2. Fitness: each extra ride in a season saves about {abs(round(coefficients['season_ride_number']['estimate'] * 60, 1))} s "
        f"(95% CI {abs(round(coefficients['season_ride_number']['ci_high'] * 60, 1))}–{abs(round(coefficients['season_ride_number']['ci_low'] * 60, 1))} s). "
        "Bucket means of adjusted time by ride number: "
        + "; ".join(f"ride ~{round(b['ride'])}: {round(b['adjusted'] * 60):+d} s (n={b['n']})" for b in interpretation["season_learning"]["buckets"])
        + ". The curve flattens after about 15 rides. Days since last ride add a little (OLS "
        f"+{round(coefficients['log_days_since_last_ride']['estimate'] * 60, 1)} s per log-day, p={coefficients['log_days_since_last_ride']['p_value']:.2f}).",
        f"3. Temperature: raw {cold['cold_f']}°F vs {cold['mild_f']}°F penalty on work trips is "
        + "; ".join(f"{step['model']}: {round(step['penalty_minutes'] * 60)} s (90% CI {round(step['ci_low'] * 60)}–{round(step['ci_high'] * 60)} s)" for step in cold["steps"])
        + f". About {round(cold['share_explained_by_fitness'] * 100)}% of the apparent cold penalty is early-season fitness "
        f"(temperature vs ride number Spearman ρ={cold['spearman_temp_ride']}, vs day of year ρ={cold['spearman_temp_doy']}). "
        "On the ride home temperature has no detectable effect between 55°F and 90°F. Pooled quadratic optimum "
        f"{inference['temperature_optimum']['optimum_f']}°F (90% CI {inference['temperature_optimum']['optimum_ci'][0]}–{inference['temperature_optimum']['optimum_ci'][1]}°F), weak.",
        f"4. Trend: naive trend {trend['naive_years_coef_seconds']} s/year (p={trend['naive_years_p']:.3f}); with ride-number and layoff controls "
        f"{trend['adjusted_years_coef_seconds']} s/year (p={trend['adjusted_years_p']:.3f}); Theil–Sen {trend['theil_sen_seconds_per_year']} s/year. "
        "Season effects vs 2019 (direction+temperature adjusted / plus fitness adjusted, seconds): "
        + "; ".join(
            f"{a['season']}: {round(a['estimate'] * 60):+d} / {round(b['estimate'] * 60):+d}"
            for a, b in zip(trend["season_effects"], trend["season_effects_fitness_adjusted"])
        )
        + ". The rider rides less often rather than getting slower.",
        f"5. Routes: to work, Route D averaged {_clock(routes['work_route_d_mean'])} (n={routes['work_route_d_n']}) vs Route A {_clock(routes['work_route_a_mean'])} "
        f"(Mann–Whitney p={routes['mann_whitney_p']:.3f}). In the same autumn-2019 window A averaged {_clock(routes['autumn_2019_route_a_mean'])} vs D "
        f"{_clock(routes['autumn_2019_route_d_mean'])} (p={routes['autumn_2019_mann_whitney_p']:.2f}). Adjusted D effect "
        f"{round(route_d * 60)} s, about what 0.1 mi shorter predicts (~27 s). "
        f"Route B adds {round(route_b, 2)} min, in line with its extra 0.9 mi.",
        f"6. Weekday has no effect (Kruskal–Wallis p={inference['weekday']['p_value']:.2f}).",
        "",
        "## Trips per season",
        _table(overview["frequency"], ["season", "trips", "ride_days", "miles"]),
        "",
        "## Models (cross-validated, 5 folds × 5 repeats grouped by ride day; RMSE/MAE in minutes)",
        _table(
            [{key: (round(value, 3) if isinstance(value, float) else value) for key, value in row.items()} for row in modelling["cv"]],
            ["model", "rmse_mean", "mae_mean", "r2_mean"],
        ),
        f"Best model: {modelling['best_model']}. Conformal 90% interval half-width ±{modelling['conformal']['cv_plus_half_width']} min; "
        f"empirical coverage {modelling['conformal']['empirical_coverage']} over 60 random splits.",
        "Mean |SHAP| (LightGBM, minutes): " + "; ".join(f"{d['label']} {d['mean_abs_shap']}" for d in interpretation["shap"]["importance"]) + ".",
        "Gaussian-process ARD relevance: "
        + "; ".join(f"{d['label']} {d['relevance']}" for d in interpretation["gp_relevance"] if d["relevance"] is not None)
        + ". The GP drops temperature and day of year because they are collinear with ride number.",
        "Largest surprises (actual vs expected, minutes): "
        + "; ".join(f"{a['date']} {a['destination']} route {a['route']}: {a['minutes']} vs {a['predicted']}" for a in modelling["anomalies"][:5])
        + ".",
        "",
        "## Weather (added from Open-Meteo hourly reanalysis for central Pittsburgh)",
        *weather_lines(results.get("weather")),
        "",
        "## Caveats",
        "Small sample; departure time, wind, rain, traffic and elevation were not recorded; routes other than A have 7 trips between them; "
        "results are associations, not causal effects.",
        "",
        "## All trips (minutes are decimal)",
        "date,destination,route,miles,temp_f,minutes,mph,season_ride_number,days_since_last_ride,weekday",
    ]
    for _, trip in df.sort_values(["date", "is_home"]).iterrows():
        lines.append(
            f"{trip['date'].date()},{trip['destination']},{trip['route']},{trip['distance_miles']},{trip['temperature_f']},"
            f"{trip['minutes']:.2f},{trip['mph']:.2f},{trip['season_ride_number']},{int(trip['days_since_last_ride'])},{trip['weekday']}"
        )
    return "\n".join(lines)


def weather_lines(weather: dict | None) -> list[str]:
    if not weather:
        return []
    home = weather["by_direction"]["Home"]
    work = weather["by_direction"]["Work"]
    rain = weather["other_weather"]["precipitation"]
    return [
        "Departure hour for each trip was estimated by matching the recorded temperature to the hourly temperature "
        f"(median mismatch {weather['temperature_match_error_median']}°F, correlation {weather['temperature_match_correlation']}). "
        "Morning departures cluster at 8–9 am, evening departures at 3–4 pm.",
        f"Searching every compass bearing, the ride to work heads about {weather['work_bearing_deg']:.0f}° (west-north-west; "
        f"90% CI {weather['work_bearing_ci'][0]}–{weather['work_bearing_ci'][1]}°), so the ride home heads east-south-east.",
        f"Each mph of headwind adds {weather['headwind_seconds_per_mph']} s (90% CI {weather['headwind_seconds_ci'][0]}–{weather['headwind_seconds_ci'][1]} s, "
        f"p={weather['headwind_p_value']:.1e}). Adding wind lifts R² from {weather['r_squared_without_wind']} to {weather['r_squared_with_wind']} "
        f"and cuts the typical error from {weather['residual_sd_without_wind_s']} s to {weather['residual_sd_with_wind_s']} s.",
        f"Evening winds are stronger ({home['mean_wind_mph']} mph vs {work['mean_wind_mph']} mph) and come from about {home['wind_from_deg']:.0f}°, "
        f"giving the ride home an average tailwind of {abs(home['mean_headwind_mph'])} mph. Wind therefore does not explain why home is slower: "
        f"with wind controlled the home penalty grows from {weather['home_penalty_without_wind']} to {weather['home_penalty_with_wind']} min, "
        "which points to terrain (a net climb toward home) or evening traffic.",
        f"Rain: +{rain['estimate']} min per inch per hour (p={rain['p_value']:.3f}) but only {weather['rainy_trips']} rides had measurable rain. "
        "Gusts, crosswind, humidity and cloud cover show no reliable effect.",
    ]


def write_context(df: pd.DataFrame, results: dict) -> None:
    context = build_context(df, results)
    ASSISTANT_CONTEXT_FILE.parent.mkdir(parents=True, exist_ok=True)
    ASSISTANT_CONTEXT_FILE.write_text("export const DATASET_CONTEXT = " + json.dumps(context, ensure_ascii=False) + ";\n")


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


def _section(title: str) -> None:
    print(f"\n{title.upper()}\n{'-' * len(title)}")


def _clock_text(minutes: float) -> str:
    total = round(minutes * 60)
    return f"{total // 60}:{abs(total) % 60:02d}"


def print_report(results: dict) -> None:
    overview = results["overview"]
    headline = overview["headline"]
    inference = results["inference"]
    modelling = results["modelling"]
    coefficients = {row["term"]: row for row in inference["ols"]["coefficients"]}

    _section("Data")
    print(f"trips: {headline['trips']}  ride days: {headline['ride_days']}  seasons: {headline['seasons']}  ({headline['first_ride']} to {headline['last_ride']})")
    print(f"miles: {headline['total_miles']}  hours: {headline['total_hours']}  mean trip: {_clock_text(headline['mean_minutes'])}  mean speed: {headline['mean_mph']} mph")
    print(f"route A share: {headline['share_primary_route']:.0%}  temperature range: {headline['temperature_range'][0]}-{headline['temperature_range'][1]} F")
    for row in overview["by_destination"]:
        print(f"  to {row['destination'].lower():<5} mean {_clock_text(row['mean_minutes'])}  median {_clock_text(row['median_minutes'])}  {row['mean_mph']:.2f} mph  n={int(row['trips'])}")

    _section("Direction: paired same-day test (route A both ways)")
    gap = inference["direction_gap"]
    print(f"paired days: {gap['n_pairs']}  home slower on {overview['paired']['share_home_slower']:.0%} of them")
    print(f"mean gap {gap['mean_gap']:.2f} min  median gap {gap['median_gap']:.2f} min  95% bootstrap CI {gap['median_gap_ci'][0]:.2f}-{gap['median_gap_ci'][1]:.2f}")
    print(f"paired t = {gap['t_statistic']}  p = {gap['t_p_value']:.1e}   Wilcoxon p = {gap['wilcoxon_p_value']:.1e}   Cohen's dz = {gap['cohens_dz']}")
    print(f"mixed model day-level ICC = {inference['mixed_model']['icc']}   same-day residual r = {inference['same_day_residuals']['r']} (p = {inference['same_day_residuals']['p_value']:.3f})")

    _section("Adjusted regression (OLS, robust SE)")
    print(f"R2 = {inference['ols']['r_squared']}  adj R2 = {inference['ols']['adj_r_squared']}  residual SD = {inference['ols']['residual_sd'] * 60:.0f} s")
    for term, label, scale, unit in [
        ("is_home", "home vs work", 1, "min"),
        ("season_ride_number", "per ride in season", 60, "s"),
        ("log_days_since_last_ride", "per log-day off", 60, "s"),
        ("years_elapsed", "per year", 60, "s"),
        ("C(route, Treatment('A'))[T.D]", "route D vs A", 60, "s"),
        ("C(route, Treatment('A'))[T.B]", "route B vs A", 1, "min"),
    ]:
        row = coefficients[term]
        print(f"  {label:<22} {row['estimate'] * scale:+8.2f} {unit}  95% CI {row['ci_low'] * scale:+.2f} to {row['ci_high'] * scale:+.2f}  p = {row['p_value']:.1e}")
    optimum = inference["temperature_optimum"]
    print(f"  quadratic temperature optimum {optimum['optimum_f']} F (90% CI {optimum['optimum_ci'][0]}-{optimum['optimum_ci'][1]})")

    _section("Confounding: cold-morning penalty (work trips, 35 F vs 65 F)")
    cold = inference["cold_penalty"]
    for step in cold["steps"]:
        print(f"  {step['model']:<28} {step['penalty_minutes'] * 60:6.0f} s  90% CI {step['ci_low'] * 60:.0f}-{step['ci_high'] * 60:.0f}  R2 {step['r_squared']}")
    print(f"share of raw penalty explained by fitness and calendar: {cold['share_explained_by_fitness']:.0%}")
    print(f"Spearman rho: temperature vs ride number {cold['spearman_temp_ride']}, vs day of year {cold['spearman_temp_doy']}")

    _section("Fitness curve (adjusted seconds by ride number)")
    for bucket in results["interpretation"]["season_learning"]["buckets"]:
        print(f"  around ride {bucket['ride']:5.1f}: {bucket['adjusted'] * 60:+5.0f} s  (n={bucket['n']})")

    _section("Trend over seasons")
    trend = inference["trend"]
    print(f"naive trend {trend['naive_years_coef_seconds']:+} s/yr (p = {trend['naive_years_p']:.3f})   fitness-adjusted {trend['adjusted_years_coef_seconds']:+} s/yr (p = {trend['adjusted_years_p']:.3f})")
    print(f"Theil-Sen {trend['theil_sen_seconds_per_year']:+} s/yr  Kendall tau {trend['kendall_tau']} (p = {trend['kendall_p']:.3f})")
    print("  season  trips  vs 2019 (dir+temp)  vs 2019 (+fitness)")
    trips_by_season = {row["season"]: row["trips"] for row in overview["frequency"]}
    for plain, adjusted in zip(trend["season_effects"], trend["season_effects_fitness_adjusted"]):
        print(f"  {plain['season']}    {trips_by_season[plain['season']]:>4}   {plain['estimate'] * 60:+8.0f} s           {adjusted['estimate'] * 60:+8.0f} s")

    _section("Routes (to work)")
    routes = inference["routes"]
    print(f"route D {_clock_text(routes['work_route_d_mean'])} (n={routes['work_route_d_n']}) vs route A {_clock_text(routes['work_route_a_mean'])}  Mann-Whitney p = {routes['mann_whitney_p']:.3f}")
    print(f"same autumn-2019 window: A {_clock_text(routes['autumn_2019_route_a_mean'])} vs D {_clock_text(routes['autumn_2019_route_d_mean'])}  p = {routes['autumn_2019_mann_whitney_p']:.2f}")
    print(f"weekday effect: Kruskal-Wallis p = {inference['weekday']['p_value']:.2f}")

    weather = results.get("weather")
    if weather:
        _section("Weather and wind (Open-Meteo hourly, central Pittsburgh)")
        print(f"departure-hour match: median temperature gap {weather['temperature_match_error_median']} F, correlation {weather['temperature_match_correlation']}")
        print(f"inferred bearing of ride to work: {weather['work_bearing_deg']:.0f} deg (90% CI {weather['work_bearing_ci'][0]}-{weather['work_bearing_ci'][1]})")
        print(f"headwind cost: {weather['headwind_seconds_per_mph']} s per mph (90% CI {weather['headwind_seconds_ci'][0]}-{weather['headwind_seconds_ci'][1]}), p = {weather['headwind_p_value']:.1e}")
        print(f"R2 without wind {weather['r_squared_without_wind']} -> with wind {weather['r_squared_with_wind']}   residual SD {weather['residual_sd_without_wind_s']} s -> {weather['residual_sd_with_wind_s']} s")
        print(f"home penalty without wind {weather['home_penalty_without_wind']} min -> with wind {weather['home_penalty_with_wind']} min")
        for destination, row in weather["by_direction"].items():
            print(f"  to {destination.lower():<5} wind {row['mean_wind_mph']} mph from {row['wind_from_deg']:.0f} deg, mean headwind {row['mean_headwind_mph']:+} mph")
        for term, row in weather["other_weather"].items():
            print(f"  {term:<22} coef {row['estimate']:+.4f}  p = {row['p_value']:.3f}")

    _section("Models (5 folds x 5 repeats, grouped by ride day)")
    print(f"  {'model':<30} {'RMSE':>6} {'MAE':>6} {'R2':>6}")
    for row in modelling["cv"]:
        print(f"  {row['model']:<30} {row['rmse_mean'] * 60:5.0f}s {row['mae_mean'] * 60:5.0f}s {row['r2_mean']:6.3f}")
    print("forward validation, MAE by season (s):")
    forward = pd.DataFrame(modelling["forward"]).pivot(index="model", columns="season", values="mae") * 60
    print(forward.round(0).astype(int).to_string())
    conformal = modelling["conformal"]
    print(f"conformal 90% interval: +/-{modelling['conformal']['cv_plus_half_width'] * 60:.0f} s, empirical coverage {conformal['empirical_coverage']:.0%}")

    _section("Feature importance")
    print("  SHAP mean |contribution| (LightGBM):")
    for row in results["interpretation"]["shap"]["importance"]:
        print(f"    {row['label']:<28} {row['mean_abs_shap'] * 60:6.1f} s")
    print("  Gaussian process ARD relevance:")
    for row in results["interpretation"]["gp_relevance"]:
        if row["relevance"] is not None:
            print(f"    {row['label']:<28} {row['relevance']:.2f}")

    _section("Largest surprises (out-of-fold residuals)")
    for row in modelling["anomalies"][:5]:
        print(f"  {row['date']} to {row['destination'].lower():<5} route {row['route']}  actual {_clock_text(row['minutes'])}  expected {_clock_text(row['predicted'])}  {row['residual'] * 60:+.0f} s")


def run(cv_repeats: int = 5, bootstrap_reps: int = 300, conformal_reps: int = 60) -> dict:
    started = time.time()
    df = load_trips()
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(PROCESSED_DIR / "trips_features.csv", index=False)

    print("descriptive statistics")
    overview = {
        "headline": headline_metrics(df),
        "paired": paired_day_summary(df),
        "by_destination": _records(by_destination(df).reset_index()),
        "by_route": _records(by_route(df)),
        "by_season": _records(by_season(df)),
        "by_month": _records(by_month(df)),
        "by_weekday": _records(by_weekday(df)),
        "frequency": _records(trip_frequency(df)),
        "lowess_temperature": lowess_curves(df, "temperature_f"),
        "lowess_day_of_year": lowess_curves(df, "day_of_year"),
        "pairs": _records(paired_days(df)[["date", "minutes_work", "minutes_home", "gap_minutes", "temp_rise", "route_work", "route_home"]].round({"minutes_work": 3, "minutes_home": 3, "gap_minutes": 3})),
    }

    print("statistical inference")
    stats_results = run_inference(df)

    print("weather and wind")
    weather_trips = attach_weather(df, load_weather(df))
    weather_trips.to_csv(WEATHER_TRIPS_FILE, index=False)
    weather_results = wind_analysis(weather_trips)

    print("cross-validating model zoo")
    cv_summary, oof = cross_validate(df, repeats=cv_repeats)
    forward = forward_validation(df)

    print("fitting interpretable learners")
    X, y = df[MODEL_FEATURES], df["minutes"].to_numpy()
    gbm = make_gbm().fit(X, y)
    gp = make_gp().fit(X, y)
    gam = make_gam().fit(X, y)
    ensemble = model_zoo()["Ensemble (GAM + GP + GBM)"].fit(X, y)
    shap_results = shap_analysis(gbm, df)

    interpretation = {"shap": {key: value for key, value in shap_results.items() if key != "values"}}
    interpretation["gp_relevance"] = gp_relevance(gp)
    interpretation["permutation"] = {
        "Gaussian process (ARD)": permutation_importances(gp, df),
        "Gradient boosting (LightGBM)": permutation_importances(gbm, df),
    }
    curves = {}
    for feature in ["temperature_f", "season_ride_number", "day_of_year", "log_days_since_last_ride", "years_elapsed"]:
        curves[feature] = {
            "label": FEATURE_LABELS[feature],
            "gbm": partial_dependence_curves(gbm, df, feature),
            "gp": partial_dependence_curves(gp, df, feature),
            "gam": partial_dependence_curves(gam, df, feature),
            "ensemble": partial_dependence_curves(ensemble, df, feature),
            "ale_ensemble": accumulated_local_effects(ensemble, df, feature),
            "ale_gbm": accumulated_local_effects(gbm, df, feature),
            "ale_gp": accumulated_local_effects(gp, df, feature),
        }
    interpretation["curves"] = curves
    interpretation["gam_temperature"] = gam_temperature_bands(df, reps=bootstrap_reps)
    interpretation["surface"] = surface_temperature_by_ride(ensemble, df)
    interpretation["season_learning"] = _season_learning_curve(df)

    print("conformal prediction")
    ranked = cv_summary.set_index("model").loc[PLANNER_CANDIDATES].sort_values("rmse_mean")
    planner_name = ranked.index[0]
    factories = {
        "Linear regression": lambda: clone(model_zoo()["Linear regression"]),
        "GAM (penalised splines)": make_gam,
        "Gaussian process (ARD)": make_gp,
        "Ensemble (GAM + GP + GBM)": lambda: clone(model_zoo()["Ensemble (GAM + GP + GBM)"]),
    }
    planner_model = factories[planner_name]().fit(X, y)
    half_width = conformal_quantile(y, oof[planner_name])
    conformal = conformal_study(df, factories[planner_name], reps=conformal_reps)
    conformal["model"] = planner_name
    conformal["cv_plus_half_width"] = round(half_width, 3)
    planner = planner_grid(planner_model, df, half_width)
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
            "weather": weather_results,
            "modelling": modelling,
            "interpretation": interpretation,
            "planner": planner,
            "trips": trips,
        }
    )

    SITE_DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    SITE_DATA_FILE.write_text("window.COMMUTE = " + json.dumps(results, separators=(",", ":")) + ";\n")

    write_context(df, results)
    print_report(results)

    print(f"done in {time.time() - started:.0f}s")
    return results


def report_from_site_data() -> None:
    text = SITE_DATA_FILE.read_text()
    print_report(json.loads(text[text.index("{") : text.rstrip().rstrip(";").rindex("}") + 1]))


def main() -> None:
    parser = argparse.ArgumentParser(prog="commute_analysis", description="Bicycle commute analysis pipeline")
    parser.add_argument("--cv-repeats", type=int, default=5)
    parser.add_argument("--bootstrap-reps", type=int, default=300)
    parser.add_argument("--conformal-reps", type=int, default=60)
    parser.add_argument("--report", action="store_true", help="print the results of the last run without recomputing")
    args = parser.parse_args()
    if args.report:
        report_from_site_data()
        return
    run(cv_repeats=args.cv_repeats, bootstrap_reps=args.bootstrap_reps, conformal_reps=args.conformal_reps)


if __name__ == "__main__":
    main()
