"""A dataset's demand over a period from the pretrained forecaster (core/foundation.py): day-ahead on its measurement,
or a year from a weather (Heat Matching's "Demand from")."""

import hashlib
import json
from typing import Literal

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..core import foundation
from ..deps import Dataset, Registry, dataframe

router = APIRouter(prefix="/api/datasets", tags=["foundation"])

OUT_T = "Out_Temp"


def _unix(ix: pd.DatetimeIndex) -> np.ndarray:
    """Seconds since 1970 of the data's (zone-less, UTC) times, whatever pandas' time unit."""
    return ((ix - pd.Timestamp("1970-01-01")) // pd.Timedelta(seconds=1)).to_numpy()


class FoundationRequest(BaseModel):
    column: str = Field(description="The demand column to forecast (kW, hourly)")
    start_time: int = Field(description="First hour of the period, unix seconds")
    steps: int = Field(ge=24, le=2 * foundation.YEAR, description="Hours of the period")
    mode: Literal["rolling", "weather"] = Field(
        description="rolling: each day forecast from the measured history before it; weather: a year from the weather "
        "(`out_temp`, default the data's own), each day from the measured year before the period up to the same hour"
    )
    out_temp: list[float] | None = Field(
        default=None, description="weather: the outdoor temperature of the period, one value per hour"
    )


_cache: dict[str, dict] = {}  # ponytail: in-process, the last few runs (a run takes ~30-60 s); drop when it grows a real store


@router.post("/{dataset_id}/foundation/demand", summary="A demand over a period from the pretrained forecaster")
def demand(meta: Dataset, registry: Registry, body: FoundationRequest):
    """Chronos-2's median (p50) and 80 % band (p10, p90) of `column` over the period."""
    if not foundation.available():
        raise HTTPException(501, "The foundation model is not installed (uv sync, group foundation)")
    file, df = dataframe(registry, meta, None)
    for c in (body.column, OUT_T):
        if c not in df.columns:
            raise HTTPException(400, f"No column {c} in {meta.id}")
    times = pd.DatetimeIndex(df["time"])
    try:
        foundation.check_hourly(times)  # the median step, as everywhere (one odd first step is no other resolution)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    start = int(np.searchsorted(_unix(times), body.start_time))
    y = df[body.column].astype(float).interpolate(limit_direction="both").to_numpy(np.float32)
    temp = df[OUT_T].astype(float).interpolate(limit_direction="both").to_numpy(np.float32)
    key = hashlib.sha1(json.dumps([meta.id, file, len(df), body.model_dump()]).encode()).hexdigest()
    if key in _cache:
        return _cache[key]
    try:
        if body.mode == "rolling":
            steps = min(body.steps, len(df) - start)
            q = foundation.rolling(y, temp, times, start, steps)
            out_times = times[start : start + steps]
            history = "each day from the measured history before it"
        else:
            h = foundation.history_before(start, len(df))
            w = np.asarray(body.out_temp, dtype=np.float32) if body.out_temp else temp[start : start + body.steps]
            out_times = pd.date_range(pd.Timestamp(body.start_time, unit="s"), periods=len(w), freq="h")
            q = foundation.from_weather(y[h], temp[h], times[h], w, out_times)
            history = (
                f"each day from the measured year {times[h.start]:%Y-%m-%d} .. {times[h.stop - 1]:%Y-%m-%d} up to the same date,"
                " with the period's weather"
            )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    out = {
        "model": foundation.MODEL_ID,
        "mode": body.mode,
        "history": history,
        "time": _unix(out_times).tolist(),
        **{f"p{round(q_ * 100)}": q[:, i].round(2).tolist() for i, q_ in enumerate(foundation.QUANTILES)},
    }
    if len(_cache) >= 8:
        _cache.pop(next(iter(_cache)))
    _cache[key] = out
    return out
