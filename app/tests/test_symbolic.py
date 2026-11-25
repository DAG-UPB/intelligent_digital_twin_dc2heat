"""Symbolic regression: gplearn programs as equations, and the fit (slow: gplearn)."""

import numpy as np
import pytest

from backend.core.physics import Equation
from backend.core.symbolic import fit_symbolic, to_expression


@pytest.mark.parametrize(
    ("program", "inputs", "text"),
    [
        ("add(mul(X0, 0.5), X1)", ["a[t-1]", "b[t-2]"], "0.5*a[t-1] + b[t-2]"),
        ("div(X0, -2.0)", ["a[t-1]"], "-0.5*a[t-1]"),
        ("div(X0, X1)", ["a[t-1]", "b[t-1]"], "pdiv(a[t-1], b[t-1])"),
        ("add(X0, add(0.119, 0.636))", ["a[t-1]"], "a[t-1] + 0.755"),
        ("max(X0, 15.0)", ["a[t-1]"], "Max(15.0, a[t-1])"),
    ],
)
def test_to_expression(program: str, inputs: list[str], text: str) -> None:
    assert to_expression(program, inputs) == text
    Equation(text, ["a", "b"])  # every result is valid in the equation language


@pytest.mark.slow
def test_fit_symbolic_linear_and_product() -> None:
    rng = np.random.default_rng(0)
    X = rng.normal(0, 1, (2000, 2))
    names = ["u[t-1]", "w[t-1]"]
    values = {("u", 1): X[:, 0], ("w", 1): X[:, 1]}
    for y in (2.0 * X[:, 0] - X[:, 1], X[:, 0] * X[:, 1]):  # linear, then nonlinear on top of a useless linear part
        expr = fit_symbolic(X, y, np.ones(2000, bool), names)
        pred = Equation(expr, ["u", "w"])(values, {})
        assert np.corrcoef(pred, y)[0, 1] > 0.99, expr
