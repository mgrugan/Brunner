import numpy as np
import pandas as pd
from statsmodels.nonparametric.smoothers_lowess import lowess

from commute.data import paired_days


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
