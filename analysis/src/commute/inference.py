import warnings

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from scipy import stats

from commute.config import PRIMARY_ROUTE, RANDOM_STATE
from commute.data import paired_days

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
