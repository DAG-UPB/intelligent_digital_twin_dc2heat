"""The twin: fit / simulate / free run / evaluate on systems with known dynamics."""

import numpy as np
import pandas as pd
import pytest

from backend.core import twin
from backend.core.limits import MAX_EVENTS, TABPFN_FREE_STEPS, TABPFN_MAX_INPUTS
from backend.core.twin.evaluate import mae, mase, season_steps, wape

N = 2000


@pytest.fixture(scope="module")
def ar1() -> pd.DataFrame:
    """y[t] = 0.8 y[t-1] + 0.5 u[t-1] + noise."""
    rng = np.random.default_rng(1)
    u = rng.normal(0, 1, N)
    y = np.zeros(N)
    for t in range(1, N):
        y[t] = 0.8 * y[t - 1] + 0.5 * u[t - 1] + rng.normal(0, 0.05)
    return pd.DataFrame({"time": pd.date_range("2023-01-01", periods=N, freq="h"), "u": u, "y": y})


@pytest.fixture(scope="module")
def stepped() -> pd.DataFrame:
    """A setpoint s that steps every 200 hours drives y: 10 steps, 5 of them in the test half."""
    rng = np.random.default_rng(2)
    s = np.repeat(np.arange(N // 200) % 3, 200).astype(float)
    y = np.zeros(N)
    for t in range(1, N):
        y[t] = 0.8 * y[t - 1] + 0.5 * s[t - 1] + rng.normal(0, 0.05)
    return pd.DataFrame({"time": pd.date_range("2023-01-01", periods=N, freq="h"), "s": s, "y": y})


GRAPH = {"y": [("y", -1), ("u", -1)], "u": []}


@pytest.fixture(scope="module")
def linear(ar1: pd.DataFrame) -> dict:
    return twin.fit(ar1, GRAPH, ["u"], 0.5)


def test_default_drivers() -> None:
    assert twin.default_drivers(GRAPH, ["u", "y"]) == ["u"]
    # own past only is still a driver; a missing entry too
    assert twin.default_drivers({"a": [("a", -1)], "b": [("a", -1)]}, ["a", "b", "c"]) == ["a", "c"]


def test_all_vs_all() -> None:
    targets = twin.all_vs_all(["s", "y"], ["s"], 3)
    assert set(targets) == {"y"} and len(targets["y"]) == 6
    assert targets["y"][:3] == [("s", -1), ("s", -2), ("s", -3)]


def test_linear_recovers_coefficients(linear: dict) -> None:
    c = {i["parent"]: i["coef"] for i in linear["variables"]["y"]["inputs"]}
    assert abs(c["y"] - 0.8) < 0.02 and abs(c["u"] - 0.5) < 0.02, c
    v = linear["variables"]["y"]
    assert v["r2_test"] > 0.95
    assert {"sigma", "scale", "nmae_test", "r2_train", "r2_test", "min", "max", "mean", "intercept"} <= set(v)
    assert all(set(i) == {"parent", "lag", "coef", "std"} and i["lag"] == -1 for i in v["inputs"])
    assert {k: linear[k] for k in ("order", "drivers", "max_lag", "split_index", "rows", "kind")} == {
        "order": ["y"],
        "drivers": ["u"],
        "max_lag": 1,
        "split_index": N // 2,
        "rows": N,
        "kind": "linear",
    }
    assert linear["split_time"] == "2023-02-11 16:00:00" and "_boosters" not in linear


def test_simulate_follows_the_data_and_interventions(ar1: pd.DataFrame, linear: dict) -> None:
    base = twin.simulate(ar1, linear, 1500, 200, n_draws=1)
    assert set(base) == {"u", "y"} and base["y"].shape == (1, 200)
    assert np.corrcoef(base["y"][0], ar1["y"].to_numpy()[1500:1700])[0, 1] > 0.9
    # set u = 1 from step 0: y settles at 0.5 / (1 - 0.8) = 2.5
    hi = twin.simulate(ar1, linear, 1500, 200, [{"variable": "u", "kind": "set", "value": 1.0}], n_draws=1)
    assert abs(hi["y"][0, -1] - 2.5) < 0.1
    # shift y's level by +1: settles about 1 above the baseline, not 5 (no AR compounding)
    sh = twin.simulate(ar1, linear, 1500, 200, [{"variable": "y", "kind": "shift", "value": 1.0}], n_draws=1)
    assert abs((sh["y"][0, -50:] - base["y"][0, -50:]).mean() - 1.0) < 0.05


def test_simulate_with_driver_series(ar1: pd.DataFrame, linear: dict) -> None:
    """Another series put in for a driver (Heat Matching's weather / demand): the run follows it, as if measured."""
    put = np.r_[np.ones(100), np.zeros(100)]
    run = twin.simulate(ar1, linear, 1500, 200, n_draws=1, drivers={"u": list(put)})
    assert np.array_equal(run["u"][0], put)
    assert abs(run["y"][0, 99] - 2.5) < 0.1 and abs(run["y"][0, -1]) < 0.1  # u = 1 settles at 2.5, u = 0 at 0
    short = twin.simulate(ar1, linear, 1500, 200, n_draws=1, drivers={"u": [1.0] * 10})
    assert np.allclose(short["u"][0, 10:], ar1["u"].to_numpy()[1510:1700])  # the rest as measured
    with pytest.raises(ValueError, match="not a driver"):
        twin.simulate(ar1, linear, 1500, 5, n_draws=1, drivers={"y": [0.0]})


def test_simulate_window_draws_and_bounds(ar1: pd.DataFrame, linear: dict) -> None:
    base = twin.simulate(ar1, linear, 1500, 100, n_draws=1)
    late = twin.simulate(
        ar1, linear, 1500, 100, [{"variable": "u", "kind": "set", "value": 1.0, "start": 50, "end": 60}], n_draws=1
    )
    assert np.allclose(late["y"][0, :51], base["y"][0, :51]) and not np.allclose(late["y"][0, 51:], base["y"][0, 51:])
    assert np.all(late["u"][0, 50:60] == 1.0) and np.allclose(late["u"][0, 60:], base["u"][0, 60:])
    a = twin.simulate(ar1, linear, 1500, 50, n_draws=5)
    b = twin.simulate(ar1, linear, 1500, 50, n_draws=5)
    assert a["y"].shape == (5, 50) and np.array_equal(a["y"], b["y"])  # seeded noise
    m = linear["variables"]["y"]
    span = m["max"] - m["min"]
    wild = twin.simulate(ar1, linear, 1500, 50, [{"variable": "u", "kind": "set", "value": 1e6}], n_draws=1)
    assert wild["y"].max() <= m["max"] + span + 1e-9
    # start before max_lag is clamped; past the end is an error
    assert twin.simulate(ar1, linear, 0, 3, n_draws=1)["y"].shape == (1, 3)
    with pytest.raises(ValueError, match="past the end"):
        twin.simulate(ar1, linear, N, 3, n_draws=1)


def test_a_set_value_is_kept_as_set_and_only_predictions_are_bounded(ar1: pd.DataFrame, linear: dict) -> None:
    # B-W4: set y to 24.06 returned 11.13 (the training range ± its span), without a word
    m = linear["variables"]["y"]
    high = m["max"] + 3 * (m["max"] - m["min"])
    run = twin.simulate(
        ar1, linear, 1500, 40, [{"variable": "y", "kind": "set", "value": high, "start": 10, "end": 20}], n_draws=1
    )
    assert np.all(run["y"][0, 10:20] == high)
    assert run["y"][0, 20:].max() <= m["max"] + (m["max"] - m["min"]) + 1e-9  # what the model predicts from it: bounded


def test_an_intervention_before_the_run_starts_with_it(ar1: pd.DataFrame, linear: dict) -> None:
    # B-W5: a negative start reached into the history before the run, or wrapped round to its last steps
    run = lambda iv: twin.simulate(ar1, linear, 1500, 50, [{"variable": "u", "kind": "set", "value": 1.0, **iv}], n_draws=1)  # noqa: E731
    assert np.array_equal(run({"start": -5})["y"], run({"start": 0})["y"])
    assert np.all(run({"start": -5})["u"][0] == 1.0)


@pytest.mark.filterwarnings("ignore:Degrees of freedom")  # numpy on the all-NaN column
def test_a_variable_without_data_is_refused_not_saved_as_nan(ar1: pd.DataFrame) -> None:
    # B-W7: 200 and a model file with bare NaN (not JSON) for y without a value in the training rows
    empty = ar1.assign(y=np.nan)
    with pytest.raises(ValueError, match="y: no training row"):
        twin.fit(empty, {"y": [("y", 1), ("u", 1)]}, ["u"], 0.5)


def test_fit_errors(ar1: pd.DataFrame) -> None:
    with pytest.raises(ValueError, match="Same-step"):
        twin.fit(ar1, {"y": [("u", 0)], "u": [("y", 0)]}, [], 0.5)
    with pytest.raises(ValueError, match="No variable to model"):
        twin.fit(ar1, GRAPH, ["u", "y"], 0.5)
    with pytest.raises(ValueError, match="split leaves too few"):
        twin.fit(ar1, GRAPH, ["u"], 0.001)


def test_tabpfn_input_limit_is_checked_before_fitting(ar1: pd.DataFrame) -> None:
    wide = pd.concat([ar1, *[ar1["u"].rename(f"x{i}") for i in range(TABPFN_MAX_INPUTS)]], axis=1)
    graph = {"y": [("y", -1)] + [(f"x{i}", -1) for i in range(TABPFN_MAX_INPUTS)]}
    with pytest.raises(ValueError, match=f"at most {TABPFN_MAX_INPUTS}"):
        twin.fit(wide, graph, [], 0.5, kind="tabpfn")


def test_not_modelled_parent_is_a_driver_and_missing_parent_dropped(frame: pd.DataFrame) -> None:
    m = twin.fit(frame, {"y": [("y", -1), ("u", -1), ("s", -1), ("nope", -1)], "z": [("y", 0)]}, [], 0.5)
    assert m["drivers"] == ["s", "u"] and m["order"] == ["y", "z"]
    assert [i["parent"] for i in m["variables"]["y"]["inputs"]] == ["y", "u", "s"]


def test_same_step_parent_is_read_in_order(frame: pd.DataFrame) -> None:
    graph = {"y": [("y", -1), ("u", -1), ("s", -1)], "z": [("y", 0)]}
    m = twin.fit(frame, graph, ["u", "s"], 0.5)
    sim = twin.simulate(frame, m, 400, 50, n_draws=1)
    assert np.allclose(sim["z"][0], 2 * sim["y"][0] + 1, atol=0.05)


def test_evaluate_free_run_and_setpoint_windows(stepped: pd.DataFrame) -> None:
    m = twin.fit(stepped, twin.all_vs_all(["s", "y"], ["s"], 3), ["s"], 0.5)
    run = twin.free_run(stepped, m)
    assert len(run["y"]) == N - m["split_index"]
    ev = twin.evaluate(stepped, m, ["s", "not_a_column"], horizon=100, run=run)
    assert ev["free_r2"]["y"] > 0.9
    assert 0 <= ev["free_nmae"]["y"] < 0.2 and m["variables"]["y"]["nmae_test"] < 0.1
    assert [e["start"] for e in ev["events"]] == [1000, 1200, 1400, 1600, 1800]
    assert all(e["steps"] == 100 and len(e["pred"]["y"]) == 100 and e["rmse"]["y"] < 0.3 for e in ev["events"])
    assert twin.evaluate(stepped, m, ["s"], horizon=100)["free_r2"] == ev["free_r2"]  # computes its own free run


def test_physics_model(stepped: pd.DataFrame) -> None:
    m = twin.fit(stepped, {}, ["s"], 0.5, kind="physics", equations={"y": "a*y[t-1] + b*s[t-1]"})
    p = m["variables"]["y"]["params"]
    assert abs(p["a"] - 0.8) < 0.02 and abs(p["b"] - 0.5) < 0.02 and m["variables"]["y"]["r2_test"] > 0.95
    assert m["variables"]["y"]["equation"] == "a*y[t-1] + b*s[t-1]"
    ev = twin.evaluate(stepped, m, ["s"], horizon=100)
    assert ev["free_r2"]["y"] > 0.9 and len(ev["events"]) == 5
    with pytest.raises(ValueError, match="equation for y"):
        twin.fit(stepped, {}, ["s"], 0.5, kind="physics", equations={"y": "a*q[t-1]"})


def test_physics_without_equation_is_linear(frame: pd.DataFrame) -> None:
    m = twin.fit(frame, {"y": [("y", -1), ("u", -1), ("s", -1)]}, ["u", "s"], 0.5, kind="physics", equations={})
    assert "equation" not in m["variables"]["y"] and m["variables"]["y"]["inputs"][0]["coef"] != 0


def test_xgboost_model(stepped: pd.DataFrame) -> None:
    m = twin.fit(stepped, twin.all_vs_all(["s", "y"], ["s"], 3), ["s"], 0.5, kind="xgboost")
    assert m["variables"]["y"]["r2_test"] > 0.9 and set(m["_boosters"]) == {"y"}
    assert all(i["coef"] == 0.0 and "std" in i for i in m["variables"]["y"]["inputs"])
    ev = twin.evaluate(stepped, m, ["s"], horizon=100)
    assert ev["free_r2"]["y"] > 0.8 and len(ev["events"]) == 5


def test_tabpfn_free_run_is_cut(stepped: pd.DataFrame) -> None:
    """Without loading TabPFN: a stub regressor that predicts the last value."""

    class Stub:
        def predict(self, X: np.ndarray) -> np.ndarray:
            return X[:, 0]

    m = twin.fit(stepped, {"y": [("y", -1), ("s", -1)]}, ["s"], 0.5)
    m |= {"kind": "tabpfn", "_boosters": {"y": Stub()}}
    assert len(twin.free_run(stepped, m)["y"]) == TABPFN_FREE_STEPS
    # the change at 1800 is past the 720-step free run
    assert [e["start"] for e in twin.evaluate(stepped, m, ["s"], horizon=100)["events"]] == [1000, 1200, 1400, 1600]


def test_metrics() -> None:
    assert twin.nmae(np.array([2.0, 4.0]), np.array([3.0, 3.0]), 2.0) == 0.5
    assert twin.nmae(np.array([np.nan]), np.array([1.0]), 1.0) is None
    assert twin.r2(np.array([1.0]), np.array([1.0])) is None
    assert twin.r2(np.array([1.0, 1.0]), np.array([1.0, 2.0])) is None  # no variance
    assert twin.r2(np.array([1.0, 2.0, np.nan, 3.0]), np.array([1.0, 2.0, 5.0, 3.0])) == 1.0  # gaps skipped


def test_fit_metrics_by_hand() -> None:
    y = np.array([1.0, -2.0, 3.0, np.nan])
    assert (mae(y, y), wape(y, y)) == (0.0, 0.0)  # a perfect prediction
    assert mae(y, y + 1) == 1.0 and wape(y, y + 1) == 3 / 6  # a constant offset of 1: 3 rows, sum |y| = 6
    assert wape(np.zeros(3), np.ones(3)) is None and mae(np.array([np.nan]), np.array([1.0])) is None
    day = np.tile([0.0, 5.0, 10.0], 4)  # a "day" of 3 steps that repeats: the seasonal naive is perfect
    assert mase(day, day + 1, day, 3) is None
    ramp = np.arange(10.0)  # naive one step back is off by 1, by 3 three steps back
    assert mase(ramp, ramp, ramp, 1) == 0.0 and mase(ramp, ramp + 2, ramp, 1) == 2.0 and mase(ramp, ramp + 3, ramp, 3) == 1.0
    assert mase(ramp, ramp, ramp[:3], 3) is None  # too few training rows for one season
    hours = pd.Series(pd.date_range("2024-01-01", periods=5, freq="h"))
    assert season_steps(hours) == 24 and season_steps(pd.Series(pd.date_range("2024-01-01", periods=5, freq="15min"))) == 96
    assert season_steps(pd.Series(pd.date_range("2024-01-01", periods=5, freq="D"))) == 1 and season_steps(hours[:1]) == 1


def test_evaluate_reports_mae_wape_mase(stepped: pd.DataFrame) -> None:
    m = twin.fit(stepped, {"y": [("y", -1), ("s", -1)]}, ["s"], 0.5)
    ev = twin.evaluate(stepped, m, ["s"], horizon=100)
    run = twin.free_run(stepped, m)["y"]
    test = stepped["y"].to_numpy()[m["split_index"] :]
    assert ev["free_mae"]["y"] == pytest.approx(np.mean(np.abs(test - run)))
    assert ev["free_wape"]["y"] == pytest.approx(np.abs(test - run).sum() / np.abs(test).sum())
    train = stepped["y"].to_numpy()[: m["split_index"]]
    naive = np.mean(np.abs(train[24:] - train[:-24]))  # hourly: the season is 24 steps
    assert ev["free_mase"]["y"] == pytest.approx(ev["free_mae"]["y"] / naive)
    assert {"free_r2", "free_nmae", "events"} <= set(ev)  # the old keys stay


def test_setpoint_changes() -> None:
    noisy = np.sin(np.arange(5000) / 7.0)  # a valve that moves every step
    assert len(twin.setpoint_changes(noisy)) == MAX_EVENTS
    assert list(twin.setpoint_changes(np.array([1.0, 1.0, 2.0, 2.0, 2.001, 3.0]))) == [2, 5]  # tiny jitter ignored
    assert len(twin.setpoint_changes(np.ones(10))) == 0
    assert list(twin.setpoint_changes(np.array([1.0, np.nan, 1.0, 2.0]))) == [3]


def test_free_run_with_a_gap_in_a_driver(stepped: pd.DataFrame) -> None:
    m = twin.fit(stepped, {"y": [("y", -1), ("s", -1)]}, ["s"], 0.5)
    gap = stepped.copy()
    gap.loc[1500:1510, "s"] = np.nan
    run = twin.free_run(gap, m)
    assert np.isfinite(run["y"]).all()  # the gap is filled along time: it does not end the free run
    ev = twin.evaluate(gap, m, ["s"], horizon=100, run=run)
    assert ev["free_r2"]["y"] > 0.9
    after = [e for e in ev["events"] if e["start"] > 1500]
    assert after and all(e["rmse"]["y"] is not None for e in after)


def test_shift_on_a_physics_variable_moves_its_level_once(stepped: pd.DataFrame) -> None:
    """An equation stores no coefficients: its own-lag gain is measured, so a shift of 1 settles at +1, not +1/(1-0.8)."""
    m = twin.fit(stepped, {}, ["s"], 0.5, kind="physics", equations={"y": "a*y[t-1] + b*s[t-1]"})
    base = twin.simulate(stepped, m, 1100, 80, n_draws=1)["y"][0]
    up = twin.simulate(stepped, m, 1100, 80, [{"variable": "y", "kind": "shift", "value": 1.0}], n_draws=1)["y"][0]
    assert abs((up - base)[-20:].mean() - 1.0) < 0.3


@pytest.mark.slow
def test_symbolic_model(stepped: pd.DataFrame) -> None:
    m = twin.fit(stepped, {"y": [("y", -1), ("s", -1)]}, ["s"], 0.5, kind="symbolic")
    assert m["variables"]["y"]["r2_test"] > 0.9 and m["variables"]["y"]["equation"]
    assert twin.evaluate(stepped, m, ["s"], horizon=100)["free_r2"]["y"] > 0.8


def test_estimate_counts_what_fit_fits_and_ranks_the_learners(frame) -> None:
    from backend.core import twin

    targets = {"y": [("y", -1), ("u", -1), ("s", -1)], "z": [("y", 0)]}
    fitted = twin.fit(frame, targets, ["u", "s"], 0.5, kind="linear")
    guesses = {k: twin.estimate(frame, targets, ["u", "s"], 0.5, kind=k) for k in ("linear", "xgboost", "symbolic", "tabpfn")}
    assert guesses["linear"]["models"] == len(fitted["order"]) == 2
    assert [v["variable"] for v in guesses["linear"]["variables"]] == fitted["order"]
    assert guesses["linear"]["inputs"] == 4
    seconds = [guesses[k]["seconds"] for k in ("linear", "xgboost", "symbolic", "tabpfn")]
    assert seconds == sorted(seconds)  # linear is instant, TabPFN the slowest
    assert guesses["tabpfn"]["low"] < guesses["tabpfn"]["seconds"] < guesses["tabpfn"]["high"]
    with pytest.raises(ValueError, match="split leaves too few"):  # as fit() raises it: no time shown for a Train that fails
        twin.estimate(frame, targets, ["u", "s"], 0.001)
