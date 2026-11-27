"""Symbolic regression with gplearn, on top of a linear model.

Linear terms get exact coefficients by least squares; gplearn then searches only for the
nonlinear rest that the linear part cannot explain. Both are merged into one simplified
equation (sympy) in the physics-equation language (core/physics.py), so it is simulated,
evaluated and displayed exactly like an equation you wrote yourself.

Why not gplearn alone: it finds structure but not precise coefficients, and dynamic variables
need them. Alone it settles on y(t) = y(t-1) or drifting formulas that fail in a free run.
"""

from __future__ import annotations

import re

import numpy as np

from .limits import SYMBOLIC_MAX_ROWS

# Small, readable formulas: + - * and max/min (limits, like a clipped temperature); no division,
# which invites near-singular hacks. Short programs.
GP_PARAMS = dict(
    population_size=1000,
    generations=15,
    function_set=("add", "sub", "mul", "max", "min"),
    parsimony_coefficient=0.01,
    n_jobs=1,  # all cores was slower (3.6 s vs 2.1 s on 3000 rows, 8 cores: joblib's processes cost more)
    random_state=0,
)


def _parse(program: str):
    """gplearn's prefix program, e.g. add(mul(X0, 0.5), X1), as a sympy expression over X0, X1, ..."""
    import sympy as sp

    tokens = re.findall(r"[A-Za-z_]\w*|-?\d+\.?\d*(?:e-?\d+)?|[(),]", program)
    pos = 0
    pdiv = sp.Function("pdiv")

    def parse():
        nonlocal pos
        tok = tokens[pos]
        pos += 1
        if pos < len(tokens) and tokens[pos] == "(":
            pos += 1
            args = [parse()]
            while tokens[pos] == ",":
                pos += 1
                args.append(parse())
            pos += 1  # ")"
            a, b = args
            if tok == "add":
                return a + b
            if tok == "sub":
                return a - b
            if tok == "mul":
                return a * b
            if tok == "max":
                return sp.Max(a, b)
            if tok == "min":
                return sp.Min(a, b)
            if tok == "div":  # protected division; a plain division when the divisor is a safe number
                return a / b if b.is_Number and abs(float(b)) > 1e-3 else pdiv(a, b)
            raise ValueError(f"unexpected function {tok} in {program}")
        return sp.Symbol(tok) if re.fullmatch(r"X\d+", tok) else sp.Float(tok)

    return parse()


def _to_text(expr, inputs: list[str]) -> str:
    """sympy expression -> equation text, 4 significant digits, X_i -> input names."""
    import sympy as sp

    expr = sp.expand(expr)
    expr = expr.xreplace({f: sp.Float(f, 4) for f in expr.atoms(sp.Float)})
    return re.sub(r"\bX(\d+)\b", lambda m: inputs[int(m.group(1))], str(expr))


def to_expression(program: str, inputs: list[str]) -> str:
    """gplearn's program as a simplified equation over `inputs`."""
    return _to_text(_parse(program), inputs)


def fit_symbolic(X: np.ndarray, y: np.ndarray, train: np.ndarray, inputs: list[str]) -> str:
    """Linear terms by least squares + a nonlinear correction evolved by gplearn on the rest.

    Returns one simplified equation over `inputs`. The correction's target is standardized so
    the length penalty means the same for every variable; when nothing nonlinear is worth its
    length, the correction is a constant and the equation is the linear one.
    """
    import sympy as sp
    from gplearn.genetic import SymbolicRegressor

    tr = np.flatnonzero(train)
    A = np.column_stack([np.ones(len(X)), X])
    beta, *_ = np.linalg.lstsq(A[tr], y[tr], rcond=None)
    rest = y - A @ beta

    rows = tr[:: max(1, len(tr) // SYMBOLIC_MAX_ROWS)]
    mean, std = float(np.mean(rest[rows])), float(np.std(rest[rows])) or 1.0
    est = SymbolicRegressor(**GP_PARAMS).fit(X[rows], (rest[rows] - mean) / std)

    xs = [sp.Symbol(f"X{i}") for i in range(X.shape[1])]
    linear = sp.Float(beta[0]) + sum(sp.Float(b) * x for b, x in zip(beta[1:], xs, strict=True))
    expr = linear + sp.Float(std) * _parse(str(est._program)) + sp.Float(mean)
    text = _to_text(expr, inputs)
    # a formula without any input is a constant: keep one input at weight 0 so it stays an equation
    return text if any(i in text for i in inputs) else f"{text} + 0*{inputs[0]}"
