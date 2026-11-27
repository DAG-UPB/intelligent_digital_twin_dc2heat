"""How long training a model would take, before it starts: the plan fit() follows (fit.py plan: which variables get
a model, with how many inputs) times what each learner costs per model.

The costs were measured on an Apple-silicon laptop with one thread per process (before XGBoost used every core:
for it now an upper bound) on synthetic data, 2 000 and 8 000 rows, 4 and 12 inputs; another computer or other data
can take half to twice as long, so the answer is a range.
"""

import pandas as pd

from ..dataset_files import Graph
from ..limits import TABPFN_FREE_STEPS
from .fit import plan, split_of

# seconds per model, as a function of the rows (all rows of the file, or the training rows) and its inputs k
LINEAR_S = 2e-8  # x rows x (k + 1): least squares, effectively instant
XGBOOST_S = 1.4e-6  # x training rows x (k + 1); measured 0.05 s at 8 000 rows and 4 inputs
XGBOOST_IMPORT_S = 0.6  # once
TABPFN_S = 3.1e-4  # x rows x (1 + k / 4): it predicts every row; measured 5 s at 8 000 x 4, 11 s at 8 000 x 12
TABPFN_LOAD_S = 2.0  # once: the pretrained weights
TABPFN_STEP_S = 0.02  # one prediction of the free run in the comparison after training (limits.py)
SYMBOLIC_S = 2.2  # per model: gplearn evolves on at most SYMBOLIC_MAX_ROWS rows, ~2.2 s whatever the size
EQUATION_S = 0.2  # per physics equation: its coefficients by least squares
RANGE = (0.5, 2.0)


def estimate(
    df: pd.DataFrame,
    targets: Graph,
    drivers: list[str],
    split_fraction: float = 0.5,
    kind: str = "linear",
    equations: dict[str, str] | None = None,
) -> dict:
    """The models fit() would train and roughly how long it takes; ValueError as fit() would raise it."""
    _, parents, eqs, order = plan(df, targets, drivers, kind, equations)
    rows = len(df)
    train_rows = split_of(rows, parents, split_fraction)
    seconds = 0.0
    for v in order:
        k = len(parents[v])
        if v in eqs:
            seconds += EQUATION_S
        elif kind == "xgboost":
            seconds += XGBOOST_S * train_rows * (k + 1)
        elif kind == "tabpfn":
            seconds += TABPFN_S * rows * (1 + k / 4) + TABPFN_STEP_S * TABPFN_FREE_STEPS
        elif kind == "symbolic":
            seconds += SYMBOLIC_S + EQUATION_S
        else:
            seconds += LINEAR_S * rows * (k + 1)
    seconds += {"xgboost": XGBOOST_IMPORT_S, "tabpfn": TABPFN_LOAD_S}.get(kind, 0.0)
    return {
        "models": len(order),
        "inputs": sum(len(parents[v]) for v in order),
        "rows": rows,
        "train_rows": train_rows,
        "seconds": seconds,
        "low": seconds * RANGE[0],
        "high": seconds * RANGE[1],
        "variables": [{"variable": v, "inputs": len(parents[v])} for v in order],
    }
