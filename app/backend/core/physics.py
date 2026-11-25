"""Physics equations with learned coefficients (gray box).

You write the right-hand side of a variable's equation; the data fits only its coefficients:

    eta * (ITE_Ener[t-1] + HVAC_Ener[t-1])
    a*In_Temp[t-1] + b*(Cool_Set[t-1] - In_Temp[t-1]) + c*ITE_Ener[t-1]

- `Var[t-k]`  value of data column Var, k steps back (`Var[t]` = same step)
- any other name is a coefficient to learn (eta, a, b, ...)
- functions: exp log sqrt abs tanh sin cos arctan minimum maximum Max Min clip pdiv (protected division)

The expression is parsed with `ast` against a whitelist and evaluated with numpy: nothing
else can run.
"""

from __future__ import annotations

import ast
import math
from collections.abc import Callable
from functools import reduce

import numpy as np

from .limits import EQUATION_MAX_LAG

FUNCS: dict[str, Callable] = {
    "exp": np.exp,
    "log": np.log,
    "sqrt": np.sqrt,
    "abs": np.abs,
    "tanh": np.tanh,
    "sin": np.sin,
    "cos": np.cos,
    "arctan": np.arctan,  # e.g. the Stull wet-bulb formula
    "minimum": np.minimum,
    "maximum": np.maximum,
    "clip": np.clip,
    # as sympy writes them in simplified symbolic-regression formulas: two or more arguments
    "Max": lambda *a: reduce(np.maximum, a),
    "Min": lambda *a: reduce(np.minimum, a),
    # protected division (as in gplearn): 1 where the divisor is ~0
    "pdiv": lambda a, b: np.where(np.abs(b) > 1e-3, np.divide(a, np.where(np.abs(b) > 1e-3, b, 1.0)), 1.0),
}
# how many arguments each function takes (least, most; None: any number): numpy reads a third argument of maximum as
# its output array, a second of sqrt as its `out`, so a wrong count is a 500 or a silently wrong result
ARGS: dict[str, tuple[int, int | None]] = {
    **{f: (1, 1) for f in ("exp", "log", "sqrt", "abs", "tanh", "sin", "cos", "arctan")},
    **{f: (2, 2) for f in ("minimum", "maximum", "pdiv")},
    "clip": (3, 3),
    "Max": (2, None),
    "Min": (2, None),
}
OPS = {
    ast.Add: np.add,
    ast.Sub: np.subtract,
    ast.Mult: np.multiply,
    ast.Div: np.divide,
    ast.Pow: np.power,
}

Ref = tuple[str, int]  # (variable, lag >= 0)


class Equation:
    """A parsed equation: evaluate(values, params) with values[(var, lag)] = array."""

    def __init__(self, expr: str, columns: list[str]):
        self.expr = expr.strip()
        if "=" in self.expr:  # allow "Target[t] = ..." and keep the right-hand side
            self.expr = self.expr.split("=", 1)[1].strip()
        self.columns = set(columns)
        self.refs: list[Ref] = []
        self.params: list[str] = []
        try:
            self._fn = self._compile(ast.parse(self.expr, mode="eval").body)
        except SyntaxError as exc:
            raise ValueError(f"not a valid expression: {exc.msg}") from exc
        except RecursionError as exc:  # user text: a 500 otherwise
            raise ValueError("the expression is nested too deeply") from exc
        if not self.refs:
            raise ValueError("the equation uses no data: write variables as Name[t-1]")

    def _compile(self, node: ast.AST) -> Callable:
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            try:
                value = float(node.value)
            except OverflowError:
                value = math.inf
            if not math.isfinite(value):
                raise ValueError(f"the number {ast.unparse(node)[:20]}… is too large")
            return lambda v, p: value
        if isinstance(node, ast.BinOp) and type(node.op) in OPS:
            op, left, right = OPS[type(node.op)], self._compile(node.left), self._compile(node.right)
            return lambda v, p: op(left(v, p), right(v, p))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            inner, sign = self._compile(node.operand), -1.0 if isinstance(node.op, ast.USub) else 1.0
            return lambda v, p: sign * inner(v, p)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FUNCS and not node.keywords:
            least, most = ARGS[node.func.id]
            if len(node.args) < least or (most is not None and len(node.args) > most):
                want = f"{least}" if least == most else f"at least {least}" if most is None else f"{least} to {most}"
                raise ValueError(f"{node.func.id} takes {want} argument{'s' if most != 1 else ''}, got {len(node.args)}")
            fn, args = FUNCS[node.func.id], [self._compile(a) for a in node.args]
            return lambda v, p: fn(*(a(v, p) for a in args))
        if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name):
            ref = (node.value.id, self._lag(node.slice))
            if ref[0] not in self.columns:
                raise ValueError(f"{ref[0]} is not a data column")
            if ref not in self.refs:
                self.refs.append(ref)
            return lambda v, p: v[ref]
        if isinstance(node, ast.Name):
            if node.id in self.columns:
                raise ValueError(f"write {node.id} with its time, e.g. {node.id}[t-1]")
            if node.id in FUNCS or node.id == "t":
                raise ValueError(f"{node.id} cannot be used as a coefficient name")
            if node.id not in self.params:
                self.params.append(node.id)
            name = node.id
            return lambda v, p: p[name]
        raise ValueError(f"not allowed in an equation: {ast.unparse(node)}")

    @staticmethod
    def _lag(node: ast.AST) -> int:
        if isinstance(node, ast.Name) and node.id == "t":
            return 0
        if (
            isinstance(node, ast.BinOp)
            and isinstance(node.op, ast.Sub)
            and isinstance(node.left, ast.Name)
            and node.left.id == "t"
            and isinstance(node.right, ast.Constant)
            and isinstance(node.right.value, int)
            and 0 <= node.right.value <= EQUATION_MAX_LAG
        ):
            return node.right.value
        raise ValueError(f"time must be t or t-k (k at most {EQUATION_MAX_LAG}), got [{ast.unparse(node)[:40]}]")

    def __call__(self, values: dict[Ref, np.ndarray], params: dict[str, float]) -> np.ndarray:
        """The right-hand side over the rows of `values` with coefficients `params` (NaN/inf where it is undefined)."""
        with np.errstate(all="ignore"):
            return np.asarray(self._fn(values, params), dtype=float)


def fit_equation(eq: Equation, values: dict[Ref, np.ndarray], y: np.ndarray, train: np.ndarray) -> dict[str, float]:
    """Least squares over the training rows; only the equation's coefficients are learned."""
    if not eq.params:
        return {}
    from scipy.optimize import least_squares

    def resid(theta: np.ndarray) -> np.ndarray:
        r = eq({k: a[train] for k, a in values.items()}, dict(zip(eq.params, theta, strict=True))) - y[train]
        return np.where(np.isfinite(r), r, 1e6)

    sol = least_squares(resid, np.ones(len(eq.params)), method="lm" if train.sum() > len(eq.params) else "trf")
    return {k: float(v) for k, v in zip(eq.params, sol.x, strict=True)}
