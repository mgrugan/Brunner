import numpy as np
import pandas as pd

from commute import models
from commute.config import MODEL_FEATURES
from commute.data import load_trips


def test_grouped_folds_never_split_a_ride_day():
    trips = load_trips()
    for _, _, train, test in models.grouped_folds(trips["date"], n_splits=5, repeats=2):
        assert set(trips["date"].iloc[train]).isdisjoint(trips["date"].iloc[test])


def test_direction_mean_reproduces_group_means():
    frame = pd.DataFrame({"is_home": [0, 0, 1, 1], "minutes": [30.0, 32.0, 38.0, 40.0]})
    fitted = models.DirectionMean().fit(frame[["is_home"]], frame["minutes"])
    assert np.allclose(fitted.predict(frame[["is_home"]]), [31, 31, 39, 39])


def test_conformal_quantile_covers_requested_share():
    rng = np.random.default_rng(0)
    y = rng.normal(size=500)
    q = models.conformal_quantile(y, np.zeros_like(y), alpha=0.1)
    assert np.mean(np.abs(y) <= q) >= 0.9


def test_ale_is_centred_and_monotone_for_linear_signal():
    rng = np.random.default_rng(1)
    frame = pd.DataFrame({feature: rng.normal(size=200) for feature in MODEL_FEATURES})

    class Linear:
        def predict(self, X):
            return 2 * X["temperature_f"].to_numpy()

    result = models.accumulated_local_effects(Linear(), frame, "temperature_f")
    assert np.all(np.diff(result["ale"]) > 0)
    assert abs(np.average(result["ale"])) < 1.0
