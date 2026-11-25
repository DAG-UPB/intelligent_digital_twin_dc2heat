"""Calculated columns (dataset.json "derived"): a heat exchanger's heat Q = m * cp * (T_in - T_out) from its parts.

A derived column stays in the data but is never a model target or input: models predict its parts, and a
predicted Q is computed from the predicted T_in, T_out and m.
"""

from collections.abc import Mapping
from typing import Any

PARTS = ("m", "t_in", "t_out")


def derived_of(config: dict) -> dict[str, dict]:
    """dataset.json "derived": {column: {m, t_in, t_out, cp}} ({} when there is none)."""
    return config.get("derived") or {}


def add_derived(values: Mapping[str, Any], derived: dict[str, dict]) -> dict[str, Any]:
    """The derived columns whose parts are all in `values` (arrays or numbers), Q = m * cp * (T_in - T_out)."""
    return {
        c: values[d["m"]] * d["cp"] * (values[d["t_in"]] - values[d["t_out"]])
        for c, d in derived.items()
        if all(d[k] in values for k in PARTS)
    }
