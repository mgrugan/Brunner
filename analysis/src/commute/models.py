import warnings

import lightgbm as lgb
import numpy as np
import pandas as pd
import shap
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

from commute.config import FEATURE_LABELS, MODEL_FEATURES, RANDOM_STATE

warnings.filterwarnings("ignore", category=UserWarning, module="lightgbm")
warnings.filterwarnings("ignore", category=ConvergenceWarning)

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
