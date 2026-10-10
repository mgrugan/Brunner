import numpy as np
import pandas as pd
import pytest

from commute.data import load_trips, paired_days


@pytest.fixture(scope="module")
def trips() -> pd.DataFrame:
    return load_trips()


def test_row_count_matches_workbook(trips):
    assert len(trips) == 143


def test_minutes_parsed_within_plausible_range(trips):
    assert trips["minutes"].between(25, 50).all()


def test_speed_is_distance_over_time(trips):
    expected = trips["distance_miles"] / (trips["minutes"] / 60)
    assert np.allclose(trips["mph"], expected)


def test_every_route_has_a_distance(trips):
    assert trips["distance_miles"].notna().all()


def test_season_ride_number_restarts_each_year(trips):
    first_rides = trips.groupby("season")["season_ride_number"].min()
    assert (first_rides == 1).all()


def test_same_day_trips_share_ride_features(trips):
    shared = trips.groupby("date")[["season_ride_number", "days_since_last_ride"]].nunique()
    assert (shared == 1).all().all()


def test_paired_days_have_both_directions(trips):
    pairs = paired_days(trips)
    assert len(pairs) == 66
    assert pairs[["minutes_home", "minutes_work"]].notna().all().all()
