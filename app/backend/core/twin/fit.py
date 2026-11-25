"""Fit the twin: one model per predicted variable, its inputs are its parents in the causal graph.

Drivers are variables taken from the data instead of being predicted (weather, clock,
setpoints). Any parent that is not itself modelled is a driver automatically.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..dataset_files import Graph
from ..limits import TABPFN_MAX_INPUTS
from ..physics import Equation, fit_equation
from ..symbolic import fit_symbolic
from .evaluate import nmae, r2
from .graph import input_name, step_order
from .learners import LEARNERS, fit_linear


def plan(
    df: pd.DataFrame,
    targets: Graph,
    drivers: list[str],
    kind: str = "linear",
    equations: dict[str, str] | None = None,
) -> tuple[list[str], dict[str, list[tuple[str, int]]], dict[str, Equation], list[str]]:
    """What fit() will model: (data columns, each modelled variable's inputs (variable, lag >= 0), the physics
    equations, the step order). ValueError when there is nothing to model or TabPFN would get too many inputs.
    The training-time estimate (estimate.py) uses the same plan, so it counts what fit() fits."""
    columns = [c for c in df.columns if c != "time" and pd.api.types.is_numeric_dtype(df[c])]
    parents = {
        v: [(p, abs(int(lag))) for p, lag in ps if p in columns] for v, ps in targets.items() if v in columns and v not in drivers
    }
    # physics: an equation defines its variable's inputs (any variable, any lag it names)
    eqs: dict[str, Equation] = {}
    if kind == "physics":
        for v, expr in (equations or {}).items():
            if v in columns and v not in drivers and expr.strip():
                try:
                    eqs[v] = Equation(expr, columns)
                except ValueError as exc:
                    raise ValueError(f"equation for {v}: {exc}") from exc
                parents[v] = list(eqs[v].refs)
    parents = {v: ps for v, ps in parents.items() if ps}
    if not parents:
        raise ValueError("No variable to model: every variable is a driver or has no parents")
    order = step_order(parents)
    if kind == "tabpfn":  # before any fit: TabPFN fits take minutes
        for v in order:
            if len(parents[v]) > TABPFN_MAX_INPUTS:
                raise ValueError(
                    f"TabPFN: {v} has {len(parents[v])} inputs, at most {TABPFN_MAX_INPUTS} fit in memory — use the causal graph"
                )
    return columns, parents, eqs, order


def split_of(n: int, parents: dict[str, list[tuple[str, int]]], split_fraction: float) -> int:
    """The first test row; ValueError when the split leaves too few rows. The estimate checks it too, so it does not
    show a time for a Train that would fail."""
    split = int(n * split_fraction)
    if split - max(tau for ps in parents.values() for _, tau in ps) < 10 or n - split < 1:
        raise ValueError("split leaves too few training or test rows")
    return split


def fit(
    df: pd.DataFrame,
    targets: Graph,
    drivers: list[str],
    split_fraction: float = 0.5,
    kind: str = "linear",
    equations: dict[str, str] | None = None,
) -> dict:
    """Fit one model per predicted variable.

    kind: "linear" (least squares), "xgboost", "physics": variables with an equation in
    `equations` fit only that equation's coefficients, the others are linear on their parents;
    "symbolic": gplearn evolves a formula per variable from its parents; or "tabpfn": a
    pretrained transformer that predicts from a sample of the training rows (in-context).
    XGBoost boosters and TabPFN regressors are returned under "_boosters" (not JSON); the caller
    saves the boosters, and TabPFN's training rows from "_samples".
    """
    columns, parents, eqs, order = plan(df, targets, drivers, kind, equations)

    used = sorted(set(parents) | {p for ps in parents.values() for p, _ in ps})
    max_lag = max(tau for ps in parents.values() for _, tau in ps)
    n = len(df)
    split = split_of(n, parents, split_fraction)

    data = {c: df[c].to_numpy(float) for c in used}
    std = {c: float(np.nanstd(data[c][:split])) for c in used}  # |coef| x std ranks terms by effect
    rows = np.arange(max_lag, n)
    train = rows < split
    out: dict[str, dict] = {}
    boosters: dict = {}
    samples: dict = {}
    for v in order:
        ps = parents[v]
        X = np.column_stack([np.ones(len(rows))] + [data[p][rows - tau] for p, tau in ps])
        y = data[v][rows]
        ok = np.isfinite(X).all(axis=1) & np.isfinite(y)
        tr, te = train & ok, ~train & ok
        if not tr.any():  # else its statistics are NaN, written as bare NaN into the model file (not JSON)
            raise ValueError(f"{v}: no training row has its value and all its inputs' values: nothing to fit it on")
        if kind == "symbolic":
            # symbolic regression writes an equation; from here on it is a physics equation
            eqs[v] = Equation(fit_symbolic(X[:, 1:], y, tr, [input_name(p, tau) for p, tau in ps]), columns)
        if v in eqs:
            values = {(p, tau): data[p][rows - tau] for p, tau in eqs[v].refs}
            params = fit_equation(eqs[v], values, y, tr)
            pred = eqs[v](values, params) * np.ones(len(rows))
            fitted = {"intercept": 0.0, "inputs": _inputs(eqs[v].refs, None, std), "equation": eqs[v].expr, "params": params}
        else:
            learned = LEARNERS.get(kind, fit_linear)(X, y, tr, ok)
            pred = learned.pred
            fitted = {"intercept": learned.intercept, "inputs": _inputs(ps, learned.coefs, std)}
            if learned.booster is not None:
                boosters[v] = learned.booster
            if learned.sample is not None:
                samples[v] = learned.sample
        scale = float(np.nanmean(np.abs(y[tr])))
        out[v] = {
            **fitted,
            "sigma": float((y[tr] - pred[tr]).std()),
            "scale": scale,
            "nmae_test": nmae(y[te], pred[te], scale),
            "r2_train": r2(y[tr], pred[tr]),
            "r2_test": r2(y[te], pred[te]),
            "min": float(np.nanmin(data[v][:split])),
            "max": float(np.nanmax(data[v][:split])),
            "mean": float(np.nanmean(data[v][:split])),
        }

    times = df["time"] if "time" in df.columns else None
    return {
        "order": order,
        "variables": out,
        "drivers": sorted(set(used) - set(parents)),
        "max_lag": max_lag,
        "split_index": split,
        "split_time": str(times.iloc[split]) if times is not None else None,
        "rows": n,
        "kind": kind,
        **({"_boosters": boosters} if boosters else {}),
        **({"_samples": samples} if samples else {}),
    }


def _inputs(refs: list[tuple[str, int]], coefs: np.ndarray | None, std: dict[str, float]) -> list[dict]:
    """Saved inputs: lag stored negative; coef 0 for models without coefficients."""
    coefs = np.zeros(len(refs)) if coefs is None else coefs
    return [{"parent": p, "lag": -tau, "coef": float(b), "std": std[p]} for (p, tau), b in zip(refs, coefs, strict=True)]
