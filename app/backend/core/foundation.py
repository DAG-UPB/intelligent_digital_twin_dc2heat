"""A demand over a year from a pretrained forecaster: Chronos-2 (Amazon, 120M parameters, Apache-2.0).

The model knows nothing of houses or buildings: it is given a history of the demand with its weather and the weather
of the next 24 h, and forecasts those 24 h. The level, the daily shape and how the demand follows the cold come from
that history, in context (no training). A year is its days, each forecast on its own (batched):

- `rolling`: each day from the measured history up to it, a day-ahead forecast as an operator would have it. It
  needs the measurement of that year, and stays close to it.
- `from_weather`: each day from a measured year's history up to the same hour of the year (that year wrapped
  around), with the other weather for the day: a year for any weather. No day builds on another's forecast (fed back,
  the errors grow day by day and the year drifts off).

Its inputs are SHARED_INPUTS, made by the same steps as the app's prepared variables (core/prepare.py): the outdoor
temperature, its 24 h mean (the buildings' inertia) and the weekend. A trained model given the same prepared
variables sees exactly what Chronos-2 sees (the Rolling comparison, core/rolling.py); only the history differs, by the
kind of model: 2,048 h in context here, a trained model's lags there. The weights (~0.9 GB) download to the Hugging
Face cache on the first run; the data never leaves the machine.
"""

from __future__ import annotations

import importlib.util
from functools import lru_cache

import numpy as np
import pandas as pd

from . import prepare

MODEL_ID = "amazon/chronos-2"
HORIZON = 24  # h per forecast
YEAR = 8760  # h
CONTEXT = 2048  # h of history per forecast (longer is slower)
QUANTILES = (0.1, 0.5, 0.9)
MIN_HISTORY = 300 * HORIZON  # h: most of a year, so every season is in it


def check_hourly(times: pd.DatetimeIndex) -> None:
    """ValueError unless the data's step (the median one) is an hour: Chronos-2 here reads each row as an hour."""
    if len(times) > 1 and pd.Series(times).diff().median() != pd.Timedelta(hours=1):
        raise ValueError("The foundation model runs on hourly data only")


def history_before(start: int, rows: int) -> slice:
    """The measured year `from_weather` learns from: the hours before the period (up to a year), else, with too
    little before it, the data's first year (which then overlaps the period)."""
    return slice(max(0, start - YEAR), start) if start >= MIN_HISTORY else slice(0, min(YEAR, rows))


def available() -> bool:
    """Whether the forecaster's library is installed (the `foundation` dependency group)."""
    return importlib.util.find_spec("chronos") is not None


@lru_cache(maxsize=1)
def _pipeline():
    import torch
    from chronos import BaseChronosPipeline

    device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
    return BaseChronosPipeline.from_pretrained(MODEL_ID, device_map=device)


OUT_T = "Out_Temp"
# besides the outdoor temperature itself: the steps of the prepared variables of the same names (core/prepare.py)
SHARED_INPUTS: list[dict] = [
    {"name": "Out_Temp_mean24", "op": "rolling_mean", "inputs": [OUT_T], "params": {"window": 24}},
    {"name": "Is_Weekend", "op": "is_weekend", "inputs": [], "params": {}},
]


def covariates(temp: np.ndarray, times: pd.DatetimeIndex) -> dict[str, np.ndarray]:
    t = np.asarray(temp, dtype=np.float32)
    made = prepare.compute(pd.DataFrame({"time": times, OUT_T: t}), SHARED_INPUTS)
    return {OUT_T: t, **{c: made[c].to_numpy(np.float32) for c in made.columns}}


def _predict(items: list[dict]) -> np.ndarray:
    """(days, HORIZON, len(QUANTILES)) for one item per day."""
    q, _ = _pipeline().predict_quantiles(items, prediction_length=HORIZON, quantile_levels=list(QUANTILES))
    return np.stack([x[0].float().cpu().numpy() for x in q])


def _item(target: np.ndarray, past: dict[str, np.ndarray], future: dict[str, np.ndarray]) -> dict:
    return {"target": target, "past_covariates": past, "future_covariates": future}


def _stitch(q: np.ndarray, steps: int) -> np.ndarray:
    """Days back to one series, (steps, quantiles), no demand below 0."""
    return np.maximum(0.0, q.reshape(-1, len(QUANTILES))[:steps])


def rolling(
    y: np.ndarray, temp: np.ndarray, times: pd.DatetimeIndex, start: int, steps: int, context: int = CONTEXT
) -> np.ndarray:
    """Day-ahead forecasts of y over rows start..start+steps, each from the measured history before it."""
    if start < HORIZON:
        raise ValueError("no history before the period to forecast from")
    n = len(y)
    pad = max(0, start + steps + HORIZON - n)  # the last day may run past the data: its weather held
    temp = np.concatenate([temp, np.full(pad, temp[-1])])
    times = times.append(pd.date_range(times[-1], periods=pad + 1, freq="h")[1:]) if pad else times
    cov = covariates(temp, times)
    items = []
    for o in range(start, start + steps, HORIZON):
        a = max(0, o - context)
        items.append(_item(y[a:o], {k: v[a:o] for k, v in cov.items()}, {k: v[o : o + HORIZON] for k, v in cov.items()}))
    return _stitch(_predict(items), steps)


def hour_of_year(times: pd.DatetimeIndex) -> np.ndarray:
    return np.minimum(YEAR - 1, (times.dayofyear.to_numpy() - 1) * 24 + times.hour.to_numpy())


def from_weather(
    hist_y: np.ndarray,
    hist_temp: np.ndarray,
    hist_times: pd.DatetimeIndex,
    temp: np.ndarray,
    times: pd.DatetimeIndex,
    context: int = CONTEXT,
) -> np.ndarray:
    """A year of demand for the weather `temp` at `times`, from one measured year (hist_*, hourly; most of a year
    at least, a year at most: its last YEAR hours)."""
    if len(hist_y) < MIN_HISTORY:
        raise ValueError(f"needs most of a measured year of history ({MIN_HISTORY} h), has {len(hist_y)} h")
    span = min(len(hist_y), YEAR)
    hist_y, hist_temp, hist_times = hist_y[-span:], hist_temp[-span:], hist_times[-span:]
    tiled = np.tile(hist_y, 2)
    hist_cov = {k: np.tile(v, 2) for k, v in covariates(hist_temp, hist_times).items()}
    steps = len(temp)
    pad = (-steps) % HORIZON
    temp = np.concatenate([temp, np.full(pad, temp[-1])])
    times = times.append(pd.date_range(times[-1], periods=pad + 1, freq="h")[1:]) if pad else times
    cov = covariates(temp, times)
    phase = hour_of_year(hist_times[:1])[0]
    items = []
    for o in range(0, steps, HORIZON):
        e = span + (hour_of_year(times[o : o + 1])[0] - phase) % span  # the history ends at this hour of the year
        a = e - min(context, span)
        items.append(_item(tiled[a:e], {k: v[a:e] for k, v in hist_cov.items()}, {k: v[o : o + HORIZON] for k, v in cov.items()}))
    return _stitch(_predict(items), steps)
