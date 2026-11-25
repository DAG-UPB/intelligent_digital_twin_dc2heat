"""TabPFN models (slow: loads torch and the TabPFN weights)."""

import numpy as np
import pandas as pd
import pytest

from backend.core import twin

pytestmark = pytest.mark.slow


def test_tabpfn_fit_and_evaluate() -> None:
    n = 2000
    rng = np.random.default_rng(2)
    s = np.repeat(np.arange(n // 200) % 3, 200).astype(float)
    y = np.zeros(n)
    for t in range(1, n):
        y[t] = 0.8 * y[t - 1] + 0.5 * s[t - 1] + rng.normal(0, 0.05)
    df = pd.DataFrame({"time": pd.date_range("2023-01-01", periods=n, freq="h"), "s": s, "y": y})
    m = twin.fit(df, twin.all_vs_all(["s", "y"], ["s"], 3), ["s"], 0.5, kind="tabpfn")
    assert m["variables"]["y"]["r2_test"] > 0.9 and set(m["_samples"]) == {"y"}
    ev = twin.evaluate(df, m, ["s"], horizon=100)
    # TabPFN's free run covers 720 of the 1000 test steps: the change at step 1800 is past it
    assert ev["free_r2"]["y"] > 0.8 and len(ev["events"]) == 4
    # refit from the saved rows predicts the same
    X, yy = m["_samples"]["y"]
    again = twin.tabpfn_regressor(X, yy)
    assert np.allclose(again.predict(X[:50]), m["_boosters"]["y"].predict(X[:50]), atol=1e-4)


def test_tabpfn_model_over_the_api(client, api) -> None:
    r = client.post(f"{api}/models/train", json={"name": "tabpfn", "model": "tabpfn"})
    assert r.status_code == 200, r.text
    got = client.get(f"{api}/models/tabpfn")
    assert got.status_code == 200 and "_boosters" not in got.json()
    assert client.post(f"{api}/models/tabpfn/simulate", json={"start": 400, "steps": 5}).status_code == 200
