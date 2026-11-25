"""Rolling models over a period, all the same two ways, to compare them (Structure and Modelling, "Rolling comparison"):

- `day_ahead`: each day from the measured history before it (a day of the data's steps, then the next day starts from the
  measurement);
- `free`: the whole period on the model's own predictions (a trained model's free run; the pretrained forecaster's
  year from the weather, core/foundation.py: each day from the measured year before up to the same hour).

Trained models run through twin.simulate; the pretrained forecaster (FOUNDATION) through core/foundation.py, which sees
only the outdoor temperature (and the calendar): an intervention on another variable does not reach it. Interventions
apply over the period, as in Scenarios ({"variable", "kind": set | shift | scale, "value", "start", "end"}).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import foundation, prepare, twin
from .twin.evaluate import season_steps

FOUNDATION = "chronos-2"
OUT_T = foundation.OUT_T


def first_of_last_year(times: pd.DatetimeIndex) -> int:
    """The row where the data's last calendar year starts when it has most of that year (300+ days), else half way."""
    last = times[-1].year
    day = season_steps(pd.Series(times))  # rows per day: 96 on 15-min data
    if (times.year == last).sum() >= 300 * day and len(times) > foundation.YEAR // 2:
        return int(np.argmax(times.year == last))
    return len(times) // 2


def _windowed(ivs: list[dict], offset: int, n: int) -> list[dict]:
    """The interventions of a window starting `offset` steps into the period, `n` steps long."""
    out = []
    for iv in ivs:
        a, e = iv.get("start", 0) - offset, None if iv.get("end") is None else iv["end"] - offset
        if (e is None or e > 0) and a < n:
            out.append({**iv, "start": max(0, a), "end": e})
    return out


def carried(
    df: pd.DataFrame,
    m: dict,
    recipe: list[dict],
    ivs: list[dict],
    start: int,
    steps: int,
    given: dict[str, list[float]] | None = None,
):
    """An intervention on a model input carried into the prepared variables made from it (the 24 h mean of a warmer
    outdoor temperature is warmer too, as Chronos-2 recomputes it): the moved inputs over the period as `drivers`,
    and the interventions left for the simulation. `given`: inputs' series put in from `start` (another weather),
    the interventions on top; a prepared variable given itself is kept as given."""
    on_inputs = [iv for iv in ivs if iv["variable"] in m["drivers"]]
    if not on_inputs and not given:
        return {}, ivs
    moved = df.copy()
    hit = set()
    for v, xs in (given or {}).items():
        if v not in m["drivers"]:
            raise ValueError(f"{v} is not a driver of the model")
        col = moved[v].to_numpy(float).copy()
        put = np.asarray(xs, float)[:steps]
        col[start : start + len(put)] = put
        moved[v] = col
        hit.add(v)
    for iv in on_inputs:
        col = moved[iv["variable"]].to_numpy(float).copy()
        col[start : start + steps] = _intervened(col[start : start + steps], [iv], iv["variable"])
        moved[iv["variable"]] = col
        hit.add(iv["variable"])
    for step in recipe:  # in order: a prepared variable made from a moved one moves too
        if hit & set(step["inputs"]) and step["name"] not in (given or {}):
            moved[step["name"]] = prepare.compute_step(step, moved)
            hit.add(step["name"])
    drivers = {c: moved[c].to_numpy(float)[start : start + steps] for c in m["drivers"] if c in hit}
    return drivers, [iv for iv in ivs if iv not in on_inputs]


def trained(
    df: pd.DataFrame, m: dict, column: str, start: int, steps: int, mode: str, ivs: list[dict], recipe: list[dict] | None = None
) -> np.ndarray:
    if column not in m["order"]:
        raise ValueError(f"the model does not make {column}")
    steps = min(steps, len(df) - start)
    drivers, ivs = carried(df, m, recipe or [], ivs, start, steps)
    if mode == "free":
        return twin.simulate(df, m, start, steps, ivs, n_draws=1, drivers={c: v.tolist() for c, v in drivers.items()})[column][0]
    parts = []
    day = season_steps(df["time"])  # a day in the data's own steps, not 24 rows
    for o in range(start, start + steps, day):
        n = min(day, start + steps - o)
        given = {c: v[o - start : o - start + n].tolist() for c, v in drivers.items()}
        parts.append(twin.simulate(df, m, o, n, _windowed(ivs, o - start, n), n_draws=1, drivers=given)[column][0])
    return np.concatenate(parts)


def _intervened(x: np.ndarray, ivs: list[dict], variable: str) -> np.ndarray:
    level = x
    x = x.copy()
    for iv in ivs:
        if iv["variable"] != variable:
            continue
        s = slice(iv.get("start", 0), iv.get("end"))
        if iv["kind"] == "set":
            x[s] = iv["value"]
        elif iv["kind"] == "shift":
            x[s] += iv["value"]
        else:  # as twin.simulate scales: a level shift by the scaled mean (multiplying a °C temperature means nothing)
            x[s] += (iv["value"] - 1) * np.nanmean(level)
    return x


def pretrained(df: pd.DataFrame, column: str, start: int, steps: int, mode: str, ivs: list[dict]) -> np.ndarray:
    if OUT_T not in df.columns:
        raise ValueError(f"needs the outdoor temperature ({OUT_T})")
    times = pd.DatetimeIndex(df["time"])
    foundation.check_hourly(times)
    y = df[column].astype(float).interpolate(limit_direction="both").to_numpy(np.float32)
    temp = df[OUT_T].astype(float).interpolate(limit_direction="both").to_numpy(np.float32)
    steps = min(steps, len(df) - start)
    period = _intervened(temp[start : start + steps], ivs, OUT_T)
    if mode == "day_ahead":
        temp = temp.copy()
        temp[start : start + steps] = period
        return foundation.rolling(y, temp, times, start, steps)[:, 1]
    h = foundation.history_before(start, len(df))
    return foundation.from_weather(y[h], temp[h], times[h], period, times[start : start + steps])[:, 1]


def scores(pred: np.ndarray, obs: np.ndarray, step_h: float) -> dict:
    """Error per step (% of the measured mean), the period's energy (MWh, kW data) and the correlation."""
    n = min(len(pred), len(obs))
    p, o = np.asarray(pred[:n], float), np.asarray(obs[:n], float)
    ok = np.isfinite(p) & np.isfinite(o)
    p, o = p[ok], o[ok]
    mean = float(np.abs(o).mean()) if len(o) else 0.0
    return {
        "mae_pct": float(np.abs(p - o).mean() / mean * 100) if mean else None,
        "energy_mwh": float(p.sum() * step_h / 1000),
        "corr": float(np.corrcoef(p, o)[0, 1]) if len(o) > 2 and p.std() > 0 and o.std() > 0 else None,
    }
