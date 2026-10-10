import json

import pandas as pd

from commute.config import ASSISTANT_CONTEXT_FILE


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


def write_context(df: pd.DataFrame, results: dict) -> None:
    context = build_context(df, results)
    ASSISTANT_CONTEXT_FILE.parent.mkdir(parents=True, exist_ok=True)
    ASSISTANT_CONTEXT_FILE.write_text("export const DATASET_CONTEXT = " + json.dumps(context, ensure_ascii=False) + ";\n")
