"""Preprocessing recommendations for the Dashboard: what in the data is worth fixing before modelling, and how.

Each finding names the variable(s), says what was found in plain words and, where the app can do it, carries the
prepared-variable step (core/prepare.py) that fixes it, so the page offers it with one click. Heuristics only:
the user decides. Pure and vectorised (pandas / numpy).
"""

import re

import numpy as np
import pandas as pd

MISSING_SHARE = 0.01  # more than 1 % missing: fill the gaps
OUTLIER_IQR = 3.0  # beyond Q1 - 3 IQR or Q3 + 3 IQR
OUTLIER_SHARE = 0.001  # at least 0.1 % of the values
SKEW = 2.0  # a long right tail: log
COUNTER_UP = 0.99  # rises (or stays) at 99 % of the steps: a meter count
DUPLICATE_R = 0.995  # two variables that move almost exactly together
MAX_PAIRS = 6
TEMP_NAME = re.compile(r"(^|_)(t|temp|temperature|tmp)(_|$)|temp", re.IGNORECASE)


def _name(base: str, suffix: str, taken: set[str]) -> str:
    """A free name for the new variable: base_suffix, base_suffix_2, ..."""
    name, i = f"{base}_{suffix}"[:64], 2
    while name in taken:
        name, i = f"{base}_{suffix}_{i}"[:64], i + 1
    taken.add(name)
    return name


def recommend(df: pd.DataFrame, config: dict) -> list[dict]:
    """The findings for one data file, most important first: {kind, severity, variables, text, step?}."""
    num = df.drop(columns="time", errors="ignore").select_dtypes(include=["number", "bool"]).astype(float)
    num = num.replace([np.inf, -np.inf], np.nan)
    taken = set(df.columns) | {s["name"] for s in config.get("prepared") or []}
    derived = set(config.get("derived") or {}) | {s["name"] for s in config.get("prepared") or []}
    rows = len(num)
    out: list[dict] = []
    if rows < 3:
        return out

    for c in num.columns:
        x = num[c]
        finite = x.dropna()
        if c in derived or len(finite) < 3:
            continue
        missing = 1 - len(finite) / rows
        if finite.nunique() <= 1:
            out.append(
                {
                    "kind": "constant",
                    "severity": "info",
                    "variables": [c],
                    "text": (
                        f"{c} never changes ({finite.iloc[0]:g}): it carries no information for a model."
                        f" Leave it out of the graph."
                    ),
                }
            )
            continue
        if missing > MISSING_SHARE:
            out.append(
                {
                    "kind": "gaps",
                    "severity": "warn",
                    "variables": [c],
                    "text": (
                        f"{c} is missing in {missing:.1%} of the rows."
                        f" Fill the gaps (linear between the neighbours) before modelling."
                    ),
                    "step": {
                        "name": _name(c, "filled", taken),
                        "op": "fill_gaps",
                        "inputs": [c],
                        "params": {"method": "interpolate"},
                    },
                }
            )
        steps = finite.diff().dropna()
        # a counter rises in most steps and (almost) never falls; a lever that steps up and back is no counter
        if len(steps) > 10 and (steps > 0).mean() >= 0.5 and (steps < 0).mean() <= 1 - COUNTER_UP:
            out.append(
                {
                    "kind": "counter",
                    "severity": "warn",
                    "variables": [c],
                    "text": f"{c} only rises: it looks like a meter count. Its change per step is the quantity it measures.",
                    "step": {"name": _name(c, "per_step", taken), "op": "diff", "inputs": [c], "params": {"steps": 1}},
                }
            )
            continue
        q1, q3 = finite.quantile([0.25, 0.75])
        iqr = q3 - q1
        if iqr > 0:
            lo, hi = q1 - OUTLIER_IQR * iqr, q3 + OUTLIER_IQR * iqr
            far = ((finite < lo) | (finite > hi)).mean()
            if far >= OUTLIER_SHARE:
                out.append(
                    {
                        "kind": "outliers",
                        "severity": "warn",
                        "variables": [c],
                        "text": (
                            f"{far:.1%} of {c} lie far outside its usual range ({lo:.3g} to {hi:.3g}):"
                            f" sensor faults or rare events. Check them; clipping keeps them from dominating a fit."
                        ),
                        "step": {
                            "name": _name(c, "clipped", taken),
                            "op": "clip",
                            "inputs": [c],
                            "params": {"min": float(lo), "max": float(hi)},
                        },
                    }
                )
        if finite.min() > 0 and finite.skew() > SKEW:
            out.append(
                {
                    "kind": "skewed",
                    "severity": "info",
                    "variables": [c],
                    "text": (
                        f"{c} has a long tail of large values (skewness {finite.skew():.1f})."
                        f" Its logarithm is easier for linear models."
                    ),
                    "step": {"name": _name(c, "log", taken), "op": "log", "inputs": [c], "params": {}},
                }
            )
        if TEMP_NAME.search(c) and 200 < finite.median() < 400:
            out.append(
                {
                    "kind": "kelvin",
                    "severity": "info",
                    "variables": [c],
                    "text": (
                        f"{c} looks like a temperature in kelvin (median {finite.median():.0f})."
                        f" In °C it reads like the other temperatures."
                    ),
                    "step": {"name": _name(c, "degC", taken), "op": "unit", "inputs": [c], "params": {"conversion": "K -> °C"}},
                }
            )

    # pairs that move almost exactly together: one is enough for a model, or average them (e.g. redundant sensors)
    usable = [c for c in num.columns if c not in derived and num[c].nunique() > 1]
    if len(usable) >= 2:
        corr = num[usable].corr().abs().to_numpy()
        iu = np.triu_indices(len(usable), 1)
        pairs = sorted(
            ((corr[i, j], usable[i], usable[j]) for i, j in zip(*iu, strict=True) if corr[i, j] >= DUPLICATE_R), reverse=True
        )
        for r, a, b in pairs[:MAX_PAIRS]:
            out.append(
                {
                    "kind": "duplicate",
                    "severity": "info",
                    "variables": [a, b],
                    "text": (
                        f"{a} and {b} move almost exactly together (|r| = {r:.3f})."
                        f" Use one of them, or their mean, in the graph and models."
                    ),
                    "step": {"name": _name(f"{a}_{b}", "mean", taken), "op": "mean", "inputs": [a, b], "params": {}},
                }
            )

    if "time" in df and rows > 1:
        steps = df["time"].diff().dt.total_seconds().dropna()
        if len(steps) and steps.median() > 0 and (steps > 1.5 * steps.median()).mean() > 0.001:
            out.append(
                {
                    "kind": "time_gaps",
                    "severity": "warn",
                    "variables": [],
                    "text": (
                        f"The time steps are not regular:"
                        f" {(steps > 1.5 * steps.median()).sum()} steps are longer than usual."
                        " Lagged links (t-1) then span different times there."
                    ),
                }
            )
    order = {"warn": 0, "info": 1}
    return sorted(out, key=lambda f: order[f["severity"]])
