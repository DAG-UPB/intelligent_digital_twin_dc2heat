"""The synthetic dataset of the tests: hourly data with known linear dynamics (no real data)."""

import json
from pathlib import Path

import numpy as np
import pandas as pd

DATASET = "sim_x"
N_ROWS = 600
LEVER_PERIOD = 50  # the lever s steps every 50 hours: 0, 1, 2, 0, ...
GRAPH = {"y": [["y", -1], ["u", -1], ["s", -1]], "z": [["y", 0]]}


def make_frame(n: int = N_ROWS, seed: int = 0) -> pd.DataFrame:
    """Hourly data with known linear dynamics.

    u: noise driver; s: lever with step changes; y[t] = 0.8 y[t-1] + 0.5 u[t-1] + 0.3 s[t-1];
    z[t] = 2 y[t] + 1 (same step, so z is evaluated after y inside a step).
    """
    rng = np.random.default_rng(seed)
    u = rng.normal(0, 1, n)
    s = np.repeat(np.arange(n // LEVER_PERIOD + 1) % 3, LEVER_PERIOD)[:n].astype(float)
    y = np.zeros(n)
    for t in range(1, n):
        y[t] = 0.8 * y[t - 1] + 0.5 * u[t - 1] + 0.3 * s[t - 1] + rng.normal(0, 0.05)
    z = 2 * y + 1 + rng.normal(0, 0.01, n)
    return pd.DataFrame({"time": pd.date_range("2024-01-01", periods=n, freq="h"), "u": u, "s": s, "y": y, "z": z})


def write_dataset(directory: Path, df: pd.DataFrame, graph: dict | None = None, config: dict | None = None) -> Path:
    """A dataset folder: df_<id>.parquet, causal_graph.json and dataset.json."""
    directory.mkdir(parents=True, exist_ok=True)
    df.to_parquet(directory / f"df_{directory.name}.parquet", index=False)
    (directory / "causal_graph.json").write_text(json.dumps({"targets": graph or GRAPH, "link_strengths": []}))
    cfg = (
        config
        if config is not None
        else {"name": "Synthetic X", "kind": "simulation", "levers": ["s"], "actuators": ["s"], "heat": []}
    )
    (directory / "dataset.json").write_text(json.dumps(cfg))
    return directory
