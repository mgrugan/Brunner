import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import commute_analysis as ca


@pytest.fixture(scope="module")
def trips() -> pd.DataFrame:
    return ca.load_trips()


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
    assert (trips.groupby("season")["season_ride_number"].min() == 1).all()


def test_same_day_trips_share_ride_features(trips):
    shared = trips.groupby("date")[["season_ride_number", "days_since_last_ride"]].nunique()
    assert (shared == 1).all().all()


def test_paired_days_have_both_directions(trips):
    pairs = ca.paired_days(trips)
    assert len(pairs) == 66
    assert pairs[["minutes_home", "minutes_work"]].notna().all().all()


def test_grouped_folds_never_split_a_ride_day(trips):
    for _, _, train, test in ca.grouped_folds(trips["date"], n_splits=5, repeats=2):
        assert set(trips["date"].iloc[train]).isdisjoint(trips["date"].iloc[test])


def test_direction_mean_reproduces_group_means():
    frame = pd.DataFrame({"is_home": [0, 0, 1, 1], "minutes": [30.0, 32.0, 38.0, 40.0]})
    fitted = ca.DirectionMean().fit(frame[["is_home"]], frame["minutes"])
    assert np.allclose(fitted.predict(frame[["is_home"]]), [31, 31, 39, 39])


def test_conformal_quantile_covers_requested_share():
    y = np.random.default_rng(0).normal(size=500)
    q = ca.conformal_quantile(y, np.zeros_like(y), alpha=0.1)
    assert np.mean(np.abs(y) <= q) >= 0.9


def test_ale_is_centred_and_monotone_for_linear_signal():
    rng = np.random.default_rng(1)
    frame = pd.DataFrame({feature: rng.normal(size=200) for feature in ca.MODEL_FEATURES})

    class Linear:
        def predict(self, X):
            return 2 * X["temperature_f"].to_numpy()

    result = ca.accumulated_local_effects(Linear(), frame, "temperature_f")
    assert np.all(np.diff(result["ale"]) > 0)
    assert abs(np.average(result["ale"])) < 1.0
