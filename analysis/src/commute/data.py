import numpy as np
import pandas as pd

from commute.config import PRIMARY_ROUTE, RAW_WORKBOOK


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
