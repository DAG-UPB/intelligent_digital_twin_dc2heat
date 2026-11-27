"""One learner per model kind for a single variable: linear, XGBoost, TabPFN.

Each takes the design matrix X (first column all ones), the target y and the masks of the
usable training rows `tr` and of all usable rows `ok`, and returns its predictions for every
row. Physics and symbolic models are equations instead (core/physics.py, core/symbolic.py).
Heavy libraries are imported inside the functions: the app starts without loading torch.
"""

from typing import Any, NamedTuple

import numpy as np

from ..limits import TABPFN_CHUNK_ROWS, TABPFN_ROWS

# no "nthread": XGBoost takes OMP_NUM_THREADS, every core when it is unset (start.sh leaves it unset)
XGB_PARAMS = {
    "max_depth": 4,
    "eta": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "objective": "reg:squarederror",
}
XGB_ROUNDS = 300


class Learned(NamedTuple):
    """A fitted variable: predictions for every row, plus what the kind needs to predict again."""

    pred: np.ndarray
    intercept: float = 0.0
    coefs: np.ndarray | None = None  # linear only; the others store 0 per input
    booster: Any = None  # XGBoost booster or TabPFN regressor (not JSON: saved by the router)
    sample: tuple[np.ndarray, np.ndarray] | None = None  # TabPFN: the rows it learned from (X, y)


def fit_linear(X: np.ndarray, y: np.ndarray, tr: np.ndarray, ok: np.ndarray) -> Learned:
    """Least squares with an intercept."""
    beta, *_ = np.linalg.lstsq(X[tr], y[tr], rcond=None)
    return Learned(X @ beta, float(beta[0]), beta[1:])


def fit_xgboost(X: np.ndarray, y: np.ndarray, tr: np.ndarray, ok: np.ndarray) -> Learned:
    """Gradient-boosted trees, fixed hyperparameters, every core."""
    import xgboost as xgb

    # ponytail: fixed hyperparameters, tune per variable if XGBoost becomes the main model
    booster = xgb.train(XGB_PARAMS, xgb.DMatrix(X[tr][:, 1:], y[tr]), num_boost_round=XGB_ROUNDS)
    return Learned(booster.inplace_predict(X[:, 1:]), booster=booster)


def fit_tabpfn(X: np.ndarray, y: np.ndarray, tr: np.ndarray, ok: np.ndarray) -> Learned:
    """TabPFN in-context regression on TABPFN_ROWS evenly spaced training rows."""
    idx = np.flatnonzero(tr)
    idx = idx[np.linspace(0, len(idx) - 1, min(TABPFN_ROWS, len(idx))).astype(int)]
    reg = tabpfn_regressor(X[idx, 1:], y[idx])
    pred = np.full(len(y), np.nan)
    if ok.any():
        chunks = np.array_split(X[ok, 1:], max(1, ok.sum() // TABPFN_CHUNK_ROWS))
        pred[ok] = np.concatenate([reg.predict(c) for c in chunks])
    return Learned(pred, booster=reg, sample=(X[idx, 1:], y[idx]))


LEARNERS = {"linear": fit_linear, "xgboost": fit_xgboost, "tabpfn": fit_tabpfn}


class NotInstalled(ValueError):
    """A library this model kind needs is not installed (an install without TabPFN, the container without IDT_ML=1):
    the request cannot be met here, which is not a bug."""


def tabpfn_regressor(X: np.ndarray, y: np.ndarray) -> Any:
    """A fitted TabPFN regressor (v2 weights, no license login, CPU); NotInstalled without TabPFN or torch."""
    try:
        import torch
        from tabpfn import TabPFNRegressor
        from tabpfn.constants import ModelVersion
    except ImportError:
        raise NotInstalled("TabPFN is not installed here (uv sync installs it; the container needs IDT_ML=1)") from None

    # one thread: with XGBoost's OpenMP already loaded, torch's thread pool deadlocks on macOS (8 threads hung in
    # 2026-11; Chronos-2 runs on the GPU, mps, and is not affected)
    torch.set_num_threads(1)
    reg = TabPFNRegressor.create_default_for_version(
        ModelVersion.V2, n_estimators=1, device="cpu", fit_mode="fit_with_cache", random_state=0, ignore_pretraining_limits=True
    )
    return reg.fit(X, y)


def predict(booster: Any, X: np.ndarray) -> np.ndarray:
    """Predictions of an XGBoost booster or a TabPFN regressor."""
    return booster.inplace_predict(X) if hasattr(booster, "inplace_predict") else booster.predict(X)
