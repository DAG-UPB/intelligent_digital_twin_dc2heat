"""Score the twin on the test data: one free run, and the windows after each setpoint change."""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..limits import MAX_EVENTS
from .simulate import free_run


def nmae(y: np.ndarray, y_hat: np.ndarray, scale: float) -> float | None:
    """Normalized MAE: mean absolute error / mean absolute value of the variable (training data)."""
    ok = np.isfinite(y) & np.isfinite(y_hat)
    return None if not ok.any() or scale == 0 else float(np.mean(np.abs(y[ok] - y_hat[ok])) / scale)


def r2(y: np.ndarray, y_hat: np.ndarray) -> float | None:
    """Coefficient of determination over the rows where both are finite (None if undefined)."""
    ok = np.isfinite(y) & np.isfinite(y_hat)
    y, y_hat = y[ok], y_hat[ok]
    if len(y) < 2:
        return None
    ss = float(((y - y.mean()) ** 2).sum())
    return None if ss == 0 else 1 - float(((y - y_hat) ** 2).sum()) / ss


def mae(y: np.ndarray, y_hat: np.ndarray) -> float | None:
    """Mean absolute error in the variable's own unit, over the rows where both are finite (None if none)."""
    ok = np.isfinite(y) & np.isfinite(y_hat)
    return float(np.mean(np.abs(y[ok] - y_hat[ok]))) if ok.any() else None


def wape(y: np.ndarray, y_hat: np.ndarray) -> float | None:
    """Weighted absolute percentage error: sum |y - y_hat| / sum |y| (None when sum |y| is 0 or no row is finite)."""
    ok = np.isfinite(y) & np.isfinite(y_hat)
    total = float(np.abs(y[ok]).sum())
    return None if total == 0 else float(np.abs(y[ok] - y_hat[ok]).sum()) / total


def season_steps(time: pd.Series) -> int:
    """Steps in 24 h at the data's median time step: the season of MASE's naive forecast (1 for a day or longer)."""
    step = pd.to_datetime(time).diff().median()
    if pd.isna(step) or step <= pd.Timedelta(0) or step >= pd.Timedelta(days=1):
        return 1
    return max(1, round(pd.Timedelta(days=1) / step))


def mase(y: np.ndarray, y_hat: np.ndarray, train: np.ndarray, m: int) -> float | None:
    """Mean absolute scaled error: MAE of the prediction / MAE of the seasonal naive forecast y[t-m] on the training rows.

    Below 1: better than repeating the value of one season (a day) earlier. None when the naive forecast is perfect
    or has no finite pair (too few training rows), or the prediction has no finite row.
    """
    err = mae(y, y_hat)
    naive = mae(train[m:], train[:-m]) if len(train) > m else None
    return None if err is None or not naive else err / naive


def setpoint_changes(col: np.ndarray, min_step: float = 0.02) -> np.ndarray:
    """Steps where a lever changes by more than `min_step` of its range (not noise), at most MAX_EVENTS.

    The subset is spread over the whole column, before evaluate() keeps the test period only.
    """
    span = float(np.nanmax(col) - np.nanmin(col)) or 1.0
    idx = np.flatnonzero(np.abs(np.diff(col)) > min_step * span) + 1
    return idx[np.linspace(0, len(idx) - 1, MAX_EVENTS).astype(int)] if len(idx) > MAX_EVENTS else idx


def evaluate(df: pd.DataFrame, model: dict, levers: list[str], horizon: int = 168, run: dict | None = None) -> dict:
    """How well the model behaves on its own on the test data, from one free run.

    Free run: the model predicts the whole test period on its own predictions; only the
    inputs from the data (weather, setpoints, load) are real. free_r2 / free_nmae / free_mae / free_wape / free_mase
    score all of it (MASE against the seasonal naive forecast, one day earlier, on the training rows).
    events: every change of a lever (setpoint) in the test period, scored on the same free run
    in the `horizon` steps after the change only: does the twin, running on its own, react right
    to the intervention. `run` = a free run computed before (it does not depend on `horizon`).
    """
    split = max(model["split_index"], model["max_lag"])
    order = model["order"]
    actual = {v: df[v].to_numpy(float) for v in order}
    # old saved models have no "scale"
    scale = {v: model["variables"][v].get("scale") or float(np.nanmean(np.abs(actual[v][:split]))) for v in order}

    run = run if run is not None else free_run(df, model)
    n_run = len(run[order[0]])
    free_r2 = {v: r2(actual[v][split : split + n_run], run[v]) for v in order}
    free_nmae = {v: nmae(actual[v][split : split + n_run], run[v], scale[v]) for v in order}
    free_mae = {v: mae(actual[v][split : split + n_run], run[v]) for v in order}
    free_wape = {v: wape(actual[v][split : split + n_run], run[v]) for v in order}
    season = season_steps(df["time"]) if "time" in df else 1  # no times: the naive forecast is one step earlier
    train = model["split_index"]
    free_mase = {v: mase(actual[v][split : split + n_run], run[v], actual[v][:train], season) for v in order}

    events = []
    for lever in [x for x in levers if x in df.columns and x in model["drivers"]]:
        col = df[lever].to_numpy(float)
        for i in setpoint_changes(col):
            a, b = int(i) - split, min(int(i) - split + horizon, n_run)
            if a < 0 or a >= n_run:  # before the test period, or past the free run (TabPFN)
                continue
            pred = {v: run[v][a:b] for v in order}
            events.append(
                {
                    "lever": lever,
                    "start": int(i),
                    "steps": b - a,
                    "from": float(col[i - 1]),
                    "to": float(col[i]),
                    "pred": pred,
                    "rmse": {v: _rmse(actual[v][i : i + b - a], pred[v]) for v in order},
                    "nmae": {v: nmae(actual[v][i : i + b - a], pred[v], scale[v]) for v in order},
                }
            )
    return {
        "free_r2": free_r2,
        "free_nmae": free_nmae,
        "free_mae": free_mae,
        "free_wape": free_wape,
        "free_mase": free_mase,
        "events": events,
    }


def _rmse(y: np.ndarray, y_hat: np.ndarray) -> float | None:
    ok = np.isfinite(y) & np.isfinite(y_hat)
    return float(np.sqrt(np.mean((y_hat[ok] - y[ok]) ** 2))) if ok.any() else None
