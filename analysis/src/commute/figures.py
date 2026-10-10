import matplotlib

matplotlib.use("Agg")

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from commute.config import BRAND, DESTINATION_COLORS, FIGURES_DIR


def _apply_style() -> None:
    plt.rcParams.update(
        {
            "figure.facecolor": BRAND["navy"],
            "axes.facecolor": BRAND["navy"],
            "savefig.facecolor": BRAND["navy"],
            "axes.edgecolor": BRAND["grid"],
            "axes.labelcolor": BRAND["muted"],
            "axes.titlecolor": BRAND["ink"],
            "axes.titleweight": "bold",
            "axes.titlesize": 13,
            "axes.titlelocation": "left",
            "axes.labelsize": 10,
            "axes.grid": True,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "grid.color": BRAND["grid"],
            "grid.linewidth": 0.6,
            "xtick.color": BRAND["muted"],
            "ytick.color": BRAND["muted"],
            "text.color": BRAND["ink"],
            "legend.frameon": False,
            "legend.labelcolor": BRAND["ink"],
            "font.family": "DejaVu Sans",
            "font.size": 10,
        }
    )


def _save(fig, name: str) -> None:
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    fig.savefig(FIGURES_DIR / name, dpi=180, bbox_inches="tight")
    plt.close(fig)


def timeline(df: pd.DataFrame) -> None:
    fig, ax = plt.subplots(figsize=(11, 4.2))
    for destination, color in DESTINATION_COLORS.items():
        subset = df[df["destination"] == destination]
        ax.scatter(subset["date"], subset["minutes"], s=34, color=color, edgecolor=BRAND["navy"], linewidth=1.2, label=f"To {destination.lower()}", zorder=3)
    ax.axvspan(pd.Timestamp("2019-11-15"), pd.Timestamp("2021-04-01"), color=BRAND["navy_soft"], zorder=0)
    ax.text(pd.Timestamp("2020-07-20"), 43.3, "No rides logged\n2020", ha="center", va="top", color=BRAND["muted"], fontsize=9)
    ax.xaxis.set_major_locator(mdates.YearLocator())
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y"))
    ax.set_ylabel("Trip time (minutes)")
    ax.set_title("Seven seasons of commuting: every trip, 2019–2026")
    ax.legend(loc="upper right", ncol=2)
    _save(fig, "01_timeline.png")


def direction_gap(results: dict) -> None:
    pairs = pd.DataFrame(results["overview"]["pairs"])
    pairs = pairs[(pairs["route_work"] == "A") & (pairs["route_home"] == "A")]
    fig, (left, right) = plt.subplots(1, 2, figsize=(11, 4.4), gridspec_kw={"width_ratios": [1, 1.3]})
    for _, row in pairs.iterrows():
        left.plot([0, 1], [row["minutes_work"], row["minutes_home"]], color=BRAND["muted"], alpha=0.35, linewidth=1)
    left.scatter(np.zeros(len(pairs)), pairs["minutes_work"], color=DESTINATION_COLORS["Work"], s=26, zorder=3)
    left.scatter(np.ones(len(pairs)), pairs["minutes_home"], color=DESTINATION_COLORS["Home"], s=26, zorder=3)
    left.set_xticks([0, 1], ["Morning\nto work", "Evening\nto home"])
    left.set_xlim(-0.35, 1.35)
    left.set_ylabel("Minutes")
    left.set_title("Morning vs. evening, same day")
    gap = results["inference"]["direction_gap"]
    right.hist(pairs["gap_minutes"], bins=np.arange(2, 10.5, 0.5), rwidth=0.9, color=BRAND["orange"], edgecolor="none")
    right.axvline(gap["median_gap"], color=BRAND["ink"], linewidth=1.5)
    right.text(gap["median_gap"] - 0.15, right.get_ylim()[1] * 0.97, f"median +{gap['median_gap']:.1f} min\n95% CI {gap['median_gap_ci'][0]:.1f}–{gap['median_gap_ci'][1]:.1f}", color=BRAND["ink"], fontsize=9, va="top", ha="right")
    right.set_xlabel("Home minus work (minutes)")
    right.set_ylabel("Days")
    right.set_title("Distribution of the daily gap")
    fig.suptitle(f"Home is slower on {gap['n_pairs']} of {gap['n_pairs']} paired days on Route A", x=0.01, ha="left", fontsize=13, fontweight="bold", color=BRAND["ink"])
    _save(fig, "02_direction_gap.png")


def temperature_effect(df: pd.DataFrame, results: dict) -> None:
    bands = results["interpretation"]["gam_temperature"]
    lowess = results["overview"]["lowess_temperature"]
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.4))
    primary = df[df["is_primary_route"]]
    for ax, destination in zip(axes, ["Work", "Home"]):
        color = DESTINATION_COLORS[destination]
        band = bands[destination]
        subset = primary[primary["destination"] == destination]
        ax.scatter(subset["temperature_f"], subset["minutes"], s=22, color=color, alpha=0.4, edgecolor="none")
        ax.plot(lowess[destination]["x"], lowess[destination]["y"], color=BRAND["ink"], linewidth=1.6, label="Raw trend (LOWESS)")
        ax.fill_between(band["temperature"], band["low"], band["high"], color=color, alpha=0.22, linewidth=0)
        ax.plot(band["temperature"], band["fit"], color=color, linewidth=2.4, label="Adjusted GAM + 90% band")
        ax.set_xlabel("Temperature at departure (°F)")
        ax.set_title(f"To {destination.lower()}")
        ax.legend(loc="upper right", fontsize=8.5)
    axes[0].set_ylabel("Minutes")
    fig.suptitle("Raw vs. adjusted temperature effect: the cold penalty shrinks once fitness is held fixed", x=0.01, ha="left", fontsize=13, fontweight="bold", color=BRAND["ink"])
    _save(fig, "03_temperature_effect.png")


def season_learning(results: dict) -> None:
    learning = results["interpretation"]["season_learning"]
    points = pd.DataFrame(learning["points"])
    buckets = pd.DataFrame(learning["buckets"])
    curve = results["interpretation"]["curves"]["season_ride_number"]["ensemble"]
    fig, ax = plt.subplots(figsize=(11, 4.2))
    for destination, color in DESTINATION_COLORS.items():
        subset = points[points["destination"] == destination]
        ax.scatter(subset["season_ride_number"], subset["adjusted"], s=20, color=color, alpha=0.5, edgecolor="none", label=f"To {destination.lower()} (adjusted)")
    centred = np.array(curve["pdp"]) - np.mean(curve["pdp"])
    ax.plot(curve["grid"], centred, color=BRAND["ink"], linewidth=2.4, label="Ensemble partial dependence")
    ax.scatter(buckets["ride"], buckets["adjusted"], s=70, color=BRAND["ink"], edgecolor=BRAND["navy"], linewidth=2, zorder=4, label="Bucket means")
    ax.axhline(0, color=BRAND["muted"], linewidth=0.8)
    ax.set_xlabel("Ride number within the season")
    ax.set_ylabel("Minutes vs. typical (direction & temperature removed)")
    ax.set_title("Riding legs: each season starts slow and gets faster with every ride")
    ax.legend(loc="upper right", fontsize=8.5)
    _save(fig, "04_season_learning.png")


def frequency_and_trend(results: dict) -> None:
    frequency = pd.DataFrame(results["overview"]["frequency"])
    effects = pd.DataFrame(results["inference"]["trend"]["season_effects"])
    fig, (top, bottom) = plt.subplots(2, 1, figsize=(11, 6.4), sharex=True, gridspec_kw={"height_ratios": [1, 1]})
    top.bar(frequency["season"], frequency["trips"], color=BRAND["orange"], width=0.6, edgecolor=BRAND["navy"])
    for _, row in frequency.iterrows():
        top.text(row["season"], row["trips"] + 1, str(int(row["trips"])), ha="center", fontsize=9)
    top.set_ylabel("Trips logged")
    top.set_title("Fewer rides each year…")
    fitness = pd.DataFrame(results["inference"]["trend"]["season_effects_fitness_adjusted"])
    for frame, offset, color, label in (
        (effects, -0.12, BRAND["sky"], "Direction + temperature adjusted"),
        (fitness, 0.12, BRAND["orange"], "+ ride number & layoff adjusted"),
    ):
        bottom.errorbar(
            frame["season"] + offset,
            frame["estimate"] * 60,
            yerr=[(frame["estimate"] - frame["ci_low"]) * 60, (frame["ci_high"] - frame["estimate"]) * 60],
            fmt="o",
            color=color,
            ecolor=color,
            elinewidth=1.4,
            markersize=7,
            label=label,
        )
    bottom.legend(loc="upper left", fontsize=8.5)
    bottom.set_ylim(-150, 150)
    bottom.axhline(0, color=BRAND["muted"], linewidth=0.8)
    bottom.set_ylabel("Seconds vs. 2019\n(direction & temperature adjusted)")
    bottom.set_title("…and a small slowdown that disappears once in-season ride count is controlled")
    bottom.set_xticks(frequency["season"])
    _save(fig, "05_frequency_and_trend.png")


def routes(df: pd.DataFrame) -> None:
    work = df[df["destination"] == "Work"]
    order = work.groupby("route")["mph"].mean().sort_values().index
    fig, ax = plt.subplots(figsize=(11, 3.6))
    rng = np.random.default_rng(1)
    for position, route in enumerate(order):
        values = work.loc[work["route"] == route, "mph"]
        color = BRAND["orange"] if route == "D" else BRAND["sky"]
        ax.scatter(values, position + rng.uniform(-0.12, 0.12, len(values)), s=24, color=color, alpha=0.6, edgecolor="none")
        ax.scatter(values.mean(), position, s=140, marker="|", color=BRAND["ink"], linewidth=2.5)
        distance = df.loc[df["route"] == route, "distance_miles"].iloc[0]
        ax.text(15.15, position, f"n={len(values)} · {distance} mi", va="center", fontsize=9, color=BRAND["muted"])
    ax.set_yticks(range(len(order)), [f"Route {route}" for route in order])
    ax.set_xlim(12.2, 16.2)
    ax.set_xlabel("Average speed to work (mph)")
    ax.set_title("Route D looks faster, but it was ridden at peak fitness and is 0.1 mi shorter")
    _save(fig, "06_routes.png")


def model_comparison(results: dict) -> None:
    cv = pd.DataFrame(results["modelling"]["cv"]).sort_values("rmse_mean", ascending=False)
    fig, ax = plt.subplots(figsize=(11, 3.9))
    colors = [BRAND["orange"] if name == results["modelling"]["best_model"] else BRAND["sky"] for name in cv["model"]]
    ax.barh(cv["model"], cv["rmse_mean"] * 60, xerr=cv["rmse_std"] * 60, color=colors, height=0.55, error_kw={"ecolor": BRAND["muted"], "elinewidth": 1})
    for position, (value, r2) in enumerate(zip(cv["rmse_mean"] * 60, cv["r2_mean"])):
        ax.text(value + 14, position, f"{value:.0f}s · R² {r2:.2f}", va="center", fontsize=9)
    ax.set_xlabel("Cross-validated RMSE (seconds) — grouped by ride day, 5×5 folds")
    ax.set_title("Seven learners, one verdict: the signal is smooth and mostly additive")
    ax.grid(axis="y", visible=False)
    _save(fig, "07_model_comparison.png")


def shap_beeswarm(results: dict) -> None:
    shap_block = results["interpretation"]["shap"]
    trips = results["trips"]
    features = shap_block["features"]
    order = [item["feature"] for item in shap_block["importance"]][::-1]
    values = np.array([trip["shap"] for trip in trips])
    feature_values = np.array(shap_block["feature_values"])
    labels = {item["feature"]: item["label"] for item in shap_block["importance"]}
    fig, ax = plt.subplots(figsize=(11, 4.8))
    cmap = matplotlib.colors.LinearSegmentedColormap.from_list("brand", [BRAND["sky"], "#c9d6d9", BRAND["orange"]])
    rng = np.random.default_rng(3)
    for position, feature in enumerate(order):
        index = features.index(feature)
        raw = feature_values[:, index]
        scaled = (raw - raw.min()) / (np.ptp(raw) or 1)
        ax.scatter(values[:, index] * 60, position + rng.uniform(-0.25, 0.25, len(raw)), c=scaled, cmap=cmap, s=14, alpha=0.85, edgecolor="none")
    ax.set_yticks(range(len(order)), [labels[feature] for feature in order])
    ax.axvline(0, color=BRAND["muted"], linewidth=0.8)
    ax.set_xlabel("SHAP contribution to trip time (seconds) · colour = feature value (low → high)")
    ax.set_title("What moves the clock: LightGBM SHAP values for every trip")
    _save(fig, "08_shap_beeswarm.png")


def cold_penalty(results: dict) -> None:
    block = results["inference"]["cold_penalty"]
    steps = pd.DataFrame(block["steps"])[::-1].reset_index(drop=True)
    fig, ax = plt.subplots(figsize=(11, 3.4))
    colors = [BRAND["orange"] if index == len(steps) - 1 else BRAND["sky"] for index in range(len(steps))]
    ax.barh(steps["model"], steps["penalty_minutes"] * 60, color=colors, height=0.5)
    ax.errorbar(steps["penalty_minutes"] * 60, range(len(steps)), xerr=[(steps["penalty_minutes"] - steps["ci_low"]) * 60, (steps["ci_high"] - steps["penalty_minutes"]) * 60], fmt="none", ecolor=BRAND["ink"], elinewidth=1.2)
    for position, value in enumerate(steps["penalty_minutes"] * 60):
        ax.text(4, position + 0.33, f"{value:.0f}s", fontsize=9, color=BRAND["ink"])
    ax.set_xlabel(f"Extra seconds on a {block['cold_f']}°F vs. {block['mild_f']}°F morning (90% bootstrap interval)")
    ax.set_title(f"About {block['share_explained_by_fitness']:.0%} of the cold-morning penalty is really early-season fitness")
    ax.grid(axis="y", visible=False)
    _save(fig, "09_cold_penalty.png")


def render_all(df: pd.DataFrame, results: dict) -> None:
    _apply_style()
    timeline(df)
    direction_gap(results)
    temperature_effect(df, results)
    season_learning(results)
    frequency_and_trend(results)
    routes(df)
    model_comparison(results)
    shap_beeswarm(results)
    cold_penalty(results)
