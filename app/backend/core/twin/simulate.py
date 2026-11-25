"""Run the twin: roll a fitted model forward on its own predictions, with interventions."""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..limits import TABPFN_FREE_STEPS
from ..physics import Equation
from .learners import predict


def simulate(
    df: pd.DataFrame,
    model: dict,
    start: int,
    steps: int,
    interventions: list[dict] | None = None,
    n_draws: int = 50,
    seed: int = 0,
    drivers: dict[str, list[float]] | None = None,
) -> dict[str, np.ndarray]:
    """Roll the model forward from `start` for `steps` rows.

    Returns {variable: array (n_draws, steps)} for every modelled variable and driver.
    History before `start` is the real data. Drivers follow the data unless intervened.
    Interventions: {"variable", "kind": "set"|"shift"|"scale", "value", "start", "end"}
    with start/end as step offsets (end exclusive, None = to the end).
    Shift and scale move the variable's settled level (scaled by 1 - its own-lag
    coefficients so an autoregressive variable does not compound the change; equations and boosters store none,
    so their own-lag gain is measured once at the parents' means). Gaps in the data are filled along time.
    With n_draws > 1 every prediction gets N(0, sigma) noise (seeded: runs are repeatable). A prediction (shifted or
    scaled too) is bounded to the training range ± its span; a set value is kept as the user set it.
    `drivers` replaces drivers' data from `start` on by other series (one value per step; interventions apply on top).
    """
    variables, max_lag = model["variables"], model["max_lag"]
    names = model["drivers"] + model["order"]
    idx = {v: i for i, v in enumerate(names)}
    start = max(start, max_lag)
    steps = min(steps, len(df) - start)
    if steps <= 0:
        raise ValueError("start is past the end of the data")

    lo = start - max_lag
    real = np.stack([df[v].to_numpy(float)[lo : start + steps] for v in names])  # (vars, L)
    for v, xs in (drivers or {}).items():
        if v not in model["drivers"]:
            raise ValueError(f"{v} is not a driver of the model")
        put = np.asarray(xs, float)[:steps]
        real[idx[v], max_lag : max_lag + len(put)] = put
    # a gap would turn the rest of the run into NaN (the own lag carries it on): fill along time; an all-NaN row stays NaN
    real = pd.DataFrame(real.T).ffill().bfill().to_numpy().T
    S = np.repeat(real[:, None, :], n_draws, axis=1)  # (vars, draws, L)
    t0 = max_lag  # position of `start` inside the window

    by_var: dict[str, list[dict]] = {}
    for iv in interventions or []:
        by_var.setdefault(iv["variable"], []).append(iv)

    def window(iv: dict) -> slice:
        """Its steps of the run: never the history before it (a negative offset counts as 0, it does not wrap)."""
        end = iv.get("end")
        return slice(t0 + max(0, int(iv.get("start") or 0)), t0 + (steps if end is None else max(0, int(end))))

    def shift_of(iv: dict, level: float) -> float:
        return iv["value"] if iv["kind"] == "shift" else (iv["value"] - 1) * level

    for v in model["drivers"]:
        for iv in by_var.get(v, []):
            w, row = window(iv), S[idx[v]]
            if iv["kind"] == "set":
                row[:, w] = iv["value"]
            else:
                row[:, w] += shift_of(iv, float(np.nanmean(real[idx[v]])))

    rng = np.random.default_rng(seed)
    boosters = model.get("_boosters") if model.get("kind") in ("xgboost", "tabpfn") else None
    eqs = {v: Equation(variables[v]["equation"], names) for v in model["order"] if variables[v].get("equation")}

    def step(v: str, m: dict, coef: np.ndarray, X: np.ndarray) -> np.ndarray:
        """The variable's prediction from its inputs X (rows, inputs in m["inputs"] order)."""
        if v in eqs:
            vals = {(i["parent"], -i["lag"]): X[:, j] for j, i in enumerate(m["inputs"])}
            return eqs[v](vals, m["params"]) * np.ones(len(X))
        if boosters:
            return predict(boosters[v], X)
        return m["intercept"] + X @ coef

    plan = []
    for v in model["order"]:
        m = variables[v]
        pidx = np.array([idx[i["parent"]] for i in m["inputs"]])
        taus = np.array([-i["lag"] for i in m["inputs"]])
        coef = np.array([i["coef"] for i in m["inputs"]])
        own = np.array([i["parent"] == v for i in m["inputs"]])
        span = m["max"] - m["min"]
        gain = 1 - float(coef[own].sum())
        if own.any() and not coef.any() and (v in eqs or boosters) and by_var.get(v):
            # equations and boosters store no coefficients: measure the own-lag gain once, at the parents' means
            delta = 0.01 * span or 1.0
            x0 = np.nanmean(real[pidx], axis=1)[None, :]
            dy = step(v, m, coef, x0 + delta * own) - step(v, m, coef, x0)
            gain = float(np.clip(1 - dy[0] / delta, 0.05, 1)) if np.isfinite(dy[0]) else 1.0
        plan.append((idx[v], m, pidx, taus, coef, gain, m["min"] - span, m["max"] + span, by_var.get(v, [])))

    for t in range(t0, t0 + steps):
        for vi, m, pidx, taus, coef, gain, lo_b, hi_b, ivs in plan:
            x = step(names[vi], m, coef, S[pidx, :, t - taus].T)
            if n_draws > 1:
                x = x + rng.normal(0, m["sigma"], n_draws)
            as_set = False  # the user's set value is kept as set; a prediction (shifted or not) is bounded
            for iv in ivs:
                w = window(iv)
                if w.start <= t < w.stop:
                    if iv["kind"] == "set":
                        x, as_set = np.full(n_draws, float(iv["value"])), True
                    else:
                        x, as_set = x + shift_of(iv, m["mean"]) * gain, False
            # ponytail: fixed clamp at ±1 training span, a per-variable bound if this hides real behavior
            S[vi, :, t] = x if as_set else np.clip(x, lo_b, hi_b)

    return {v: S[idx[v], :, t0 : t0 + steps] for v in names}


def free_run(df: pd.DataFrame, model: dict) -> dict[str, np.ndarray]:
    """The model alone over the test period, from the split on (TabPFN: its first TABPFN_FREE_STEPS)."""
    split = max(model["split_index"], model["max_lag"])
    steps = len(df) - split if model.get("kind") != "tabpfn" else TABPFN_FREE_STEPS
    return {v: a[0] for v, a in simulate(df, model, split, steps, n_draws=1).items()}
