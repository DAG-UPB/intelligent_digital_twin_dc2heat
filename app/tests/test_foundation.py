"""The pretrained forecaster's year (core/foundation.py, routers/foundation.py), with the model stubbed: which history
each day is forecast from, and the year put together. The real model: `pytest -m slow` (downloads ~0.5 GB once)."""

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from synthetic import write_dataset

from backend.app import create_app
from backend.core import foundation

YEAR = foundation.YEAR


def two_years() -> pd.DataFrame:
    t = pd.date_range("2023-01-01", periods=2 * YEAR, freq="h")
    temp = 10 - 10 * np.cos(2 * np.pi * (t.dayofyear.to_numpy() - 20) / 365)
    return pd.DataFrame({"time": t, "Out_Temp": temp, "Heat_Demand": np.maximum(0, 20 - temp) * 50, "Hour": t.hour})


@pytest.fixture
def seen(monkeypatch) -> list[dict]:
    """The stub forecasts each day as the last value of its history: what it was given shows in the result."""
    items: list[dict] = []

    def predict(batch: list[dict]) -> np.ndarray:
        items.extend(batch)
        last = np.array([b["target"][-1] for b in batch], dtype=np.float32)
        return np.repeat(last[:, None, None], foundation.HORIZON, 1).repeat(len(foundation.QUANTILES), 2)

    monkeypatch.setattr(foundation, "_predict", predict)
    return items


def test_rolling_forecasts_each_day_from_the_measured_history_before_it(seen: list[dict]) -> None:
    df = two_years()
    y, temp, times = df["Heat_Demand"].to_numpy(np.float32), df["Out_Temp"].to_numpy(np.float32), pd.DatetimeIndex(df["time"])
    q = foundation.rolling(y, temp, times, YEAR, 72, context=100)
    assert q.shape == (72, 3)
    assert [len(i["target"]) for i in seen] == [100, 100, 100]
    assert q[:24, 1].tolist() == [y[YEAR - 1]] * 24  # the measurement up to each day
    assert q[24:48, 1].tolist() == [y[YEAR + 23]] * 24
    assert seen[0]["future_covariates"]["Out_Temp"].tolist() == temp[YEAR : YEAR + 24].tolist()


def test_a_year_from_the_weather_starts_each_day_at_the_same_hour_of_the_measured_year(seen: list[dict]) -> None:
    df = two_years()
    hist = df.iloc[:YEAR]
    y = hist["Heat_Demand"].to_numpy(np.float32)
    times = pd.date_range("2024-03-01", periods=48, freq="h")
    warm = np.full(48, 25.0, dtype=np.float32)
    q = foundation.from_weather(
        y, hist["Out_Temp"].to_numpy(np.float32), pd.DatetimeIndex(hist["time"]), warm, times, context=500
    )
    hoy = foundation.hour_of_year(times[:1])[0]
    assert q[0, 1] == y[hoy - 1]  # the history ends just before 1 March of the measured year
    assert q[24, 1] == y[hoy + 23]
    assert seen[0]["future_covariates"]["Out_Temp"].tolist() == [25.0] * 24  # with the other weather
    with pytest.raises(ValueError, match="measured year"):
        foundation.from_weather(y[:100], warm, times, warm, times)


def test_the_endpoint_gives_the_year_and_its_band(tmp_path, seen: list[dict]) -> None:
    write_dataset(
        tmp_path / "sim_fm", two_years(), config={"name": "FM", "kind": "simulation", "levers": [], "actuators": [], "heat": []}
    )
    client = TestClient(create_app(tmp_path, None))
    start = int(pd.Timestamp("2024-01-01").timestamp())
    body = {"column": "Heat_Demand", "start_time": start, "steps": 48, "mode": "weather", "out_temp": [30.0] * 48}
    r = client.post("/api/datasets/sim_fm/foundation/demand", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["time"][0] == start and len(out["p50"]) == 48 and set(out) >= {"p10", "p50", "p90", "history"}
    assert client.post("/api/datasets/sim_fm/foundation/demand", json=body | {"mode": "rolling"}).status_code == 200
    assert client.post("/api/datasets/sim_fm/foundation/demand", json=body | {"column": "nope"}).status_code == 400


def test_rolling_cuts_the_interventions_per_day_and_scores_against_the_measurement() -> None:
    from backend.core import rolling

    iv = {"variable": "Out_Temp", "kind": "shift", "value": 3, "start": 30, "end": 50}
    assert rolling._windowed([iv], 0, 24) == []  # not yet on the first day
    assert rolling._windowed([iv], 24, 24) == [{**iv, "start": 6, "end": 26}]  # the second day, from its 6th hour
    assert rolling._windowed([iv], 48, 24) == [{**iv, "start": 0, "end": 2}]
    assert rolling._windowed([iv], 72, 24) == []  # over
    s = rolling.scores(np.array([1.0, 2, 3, 4]), np.array([1.0, 2, 3, 6]), 1.0)
    assert s["mae_pct"] == pytest.approx(0.5 / 3 * 100) and s["energy_mwh"] == pytest.approx(0.01)
    t = pd.date_range("2023-01-01", periods=2 * YEAR, freq="h")
    assert rolling.first_of_last_year(t) == int(np.argmax(t.year == 2024))
    assert foundation.history_before(YEAR, 2 * YEAR) == slice(0, YEAR)  # the year before
    assert foundation.history_before(100, 2 * YEAR) == slice(0, YEAR)  # too little before: the first year


def test_an_intervention_on_an_input_moves_the_prepared_inputs_made_from_it() -> None:
    from backend.core import prepare, rolling

    df = two_years().iloc[:200].copy()
    df = df.assign(**prepare.compute(df, foundation.SHARED_INPUTS))
    m = {"drivers": ["Out_Temp", "Out_Temp_mean24", "Is_Weekend"], "order": ["Heat_Demand"]}
    iv = {"variable": "Out_Temp", "kind": "shift", "value": 3.0, "start": 0, "end": None}
    drivers, left = rolling.carried(df, m, foundation.SHARED_INPUTS, [iv], 100, 50)
    assert left == [] and set(drivers) == {"Out_Temp", "Out_Temp_mean24"}  # the weekend does not move
    assert drivers["Out_Temp"] == pytest.approx(df["Out_Temp"].to_numpy()[100:150] + 3)
    assert drivers["Out_Temp_mean24"][30:] == pytest.approx(df["Out_Temp_mean24"].to_numpy()[130:150] + 3)  # a day in: +3
    cov = foundation.covariates(df["Out_Temp"].to_numpy(), pd.DatetimeIndex(df["time"]))  # Chronos-2's own: the same columns
    assert cov["Out_Temp_mean24"] == pytest.approx(df["Out_Temp_mean24"].to_numpy(), rel=1e-5)
    assert cov["Is_Weekend"].tolist() == df["Is_Weekend"].tolist()
