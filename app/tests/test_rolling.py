"""Rolling comparison: interventions as Scenarios applies them, and a day of the data's own time step."""

import numpy as np
import pandas as pd
import pytest

from backend.core import rolling


def test_scale_moves_the_level_by_the_scaled_mean_as_simulate_does() -> None:
    iv = {"variable": "a", "kind": "scale", "value": 1.1}
    assert rolling._intervened(np.array([10.0, 20.0, 30.0]), [iv], "a") == pytest.approx([12.0, 22.0, 32.0])


def test_day_ahead_restarts_every_day_of_15_minute_data(monkeypatch: pytest.MonkeyPatch) -> None:
    starts = []

    def simulate(df, m, start, steps, ivs, n_draws, drivers):
        starts.append(start)
        return {"y": np.zeros((1, steps))}

    monkeypatch.setattr(rolling.twin, "simulate", simulate)
    df = pd.DataFrame({"time": pd.date_range("2024-01-01", periods=1000, freq="15min"), "y": 0.0})
    out = rolling.trained(df, {"drivers": [], "order": ["y"]}, "y", 100, 400, "day_ahead", [])
    assert len(out) == 400 and starts == [100, 196, 292, 388, 484]


def test_last_year_counts_days_not_rows() -> None:
    t = pd.date_range("2023-01-01", "2024-07-19", freq="15min")  # 2024: 200 days, 19,200 rows
    assert rolling.first_of_last_year(t) == len(t) // 2


def test_chronos_refuses_data_that_is_not_hourly(monkeypatch: pytest.MonkeyPatch) -> None:
    # B-W12: Chronos-2 reads every row as an hour; the rolling comparison gave it 15-minute rows without a word
    monkeypatch.setattr(rolling.foundation, "rolling", lambda *a: pytest.fail("Chronos ran"))
    df = pd.DataFrame({"time": pd.date_range("2024-01-01", periods=2000, freq="15min"), "y": 1.0, rolling.OUT_T: 5.0})
    with pytest.raises(ValueError, match="hourly data only"):
        rolling.pretrained(df, "y", 1000, 96, "day_ahead", [])
