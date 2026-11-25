"""Lag discovery for drawn links (slow: tigramite)."""

import numpy as np
import pandas as pd
import pytest

from backend.core.causal_discovery import discover_lags, relag_graph

pytestmark = pytest.mark.slow


@pytest.fixture(scope="module")
def lagged() -> pd.DataFrame:
    """x drives y two steps later; w is independent noise."""
    rng = np.random.default_rng(0)
    n = 800
    x, w, y = rng.normal(0, 1, n), rng.normal(0, 1, n), np.zeros(n)
    for t in range(2, n):
        y[t] = 0.9 * x[t - 2] + 0.1 * rng.normal()
    return pd.DataFrame({"time": pd.date_range("2024-01-01", periods=n, freq="h"), "x": x, "y": y, "w": w})


@pytest.mark.parametrize("method", ["pcmci", "pc"])
def test_discover_lags(lagged: pd.DataFrame, method: str) -> None:
    res = discover_lags(lagged, [("x", "y"), ("nope", "y"), ("x", "x")], min_lag=1, max_lag=3, method=method)
    assert res["links"][("x", "y")]["lags"] == [2]
    assert set(res["links"][("x", "y")]["p"]) == {1, 2, 3}
    assert res["skipped"] == [("nope", "y")]
    assert set(res["self"]) == {"x", "y"}
    # one strength per significant lag, own-past lags included; x drives y strongly at lag 2
    keys = {(s["source"], s["target"], s["lag"]) for s in res["strengths"]}
    assert keys == {("x", "y", -2)} | {(v, v, -tau) for v, lags in res["self"].items() for tau in lags}
    [xy] = [s for s in res["strengths"] if s["target"] == "y" and s["source"] == "x"]
    assert xy["value"] > 0.5


def test_discover_lags_input_checks(lagged: pd.DataFrame) -> None:
    with pytest.raises(ValueError, match="1 <= from <= to"):
        discover_lags(lagged, [("x", "y")], min_lag=3, max_lag=2)
    assert discover_lags(lagged, [("nope", "y")]) == {"links": {}, "self": {}, "skipped": [("nope", "y")], "strengths": []}


def test_relag_graph(lagged: pd.DataFrame) -> None:
    new, no_evidence = relag_graph({"y": [("x", -1), ("w", -1)]}, lagged, min_lag=1, max_lag=3)
    assert ("x", -2) in new["y"]
    assert ("w", "y") in no_evidence and ("w", -1) in new["y"]  # no evidence: the old lag stays
