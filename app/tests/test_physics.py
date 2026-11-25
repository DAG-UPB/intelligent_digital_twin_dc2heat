"""The equation language: parsing, the safety whitelist, and the coefficient fit."""

import numpy as np
import pytest

from backend.core.physics import ARGS, FUNCS, Equation, fit_equation


def test_linear_coefficients_are_recovered() -> None:
    rng = np.random.default_rng(0)
    n = 500
    u, y = rng.normal(0, 1, n), np.zeros(n)
    for t in range(1, n):
        y[t] = 0.8 * y[t - 1] + 0.5 * u[t - 1] + rng.normal(0, 0.01)
    eq = Equation("y[t] = a*y[t-1] + b*u[t-1]", ["y", "u"])
    assert eq.expr == "a*y[t-1] + b*u[t-1]"  # the "Target[t] =" prefix is dropped
    assert eq.refs == [("y", 1), ("u", 1)] and eq.params == ["a", "b"]
    rows = np.arange(1, n)
    p = fit_equation(eq, {("y", 1): y[rows - 1], ("u", 1): u[rows - 1]}, y[rows], np.ones(len(rows), bool))
    assert abs(p["a"] - 0.8) < 0.01 and abs(p["b"] - 0.5) < 0.01, p


def test_nonlinear_coefficients_are_recovered() -> None:
    x = np.abs(np.random.default_rng(0).normal(0, 1, 500))
    eq = Equation("k * (1 - exp(-r * u[t]))", ["u"])
    p = fit_equation(eq, {("u", 0): x}, 2.0 * (1 - np.exp(-1.5 * x)), np.ones(500, bool))
    assert abs(p["k"] - 2.0) < 1e-3 and abs(p["r"] - 1.5) < 1e-3, p


def test_no_coefficients() -> None:
    eq = Equation("2*u[t-1] + 1", ["u"])
    assert eq.params == [] and fit_equation(eq, {}, np.zeros(1), np.ones(1, bool)) == {}
    assert eq({("u", 1): np.array([1.0, 2.0])}, {}).tolist() == [3.0, 5.0]


def test_every_function_has_its_argument_count() -> None:
    assert set(ARGS) == set(FUNCS)


@pytest.mark.parametrize("name", sorted(FUNCS))
def test_every_function_evaluates(name: str) -> None:
    args = "u[t], u[t]" if name in ("minimum", "maximum", "Max", "Min", "pdiv") else "u[t]"
    args = "u[t], 0, 1" if name == "clip" else args
    out = Equation(f"{name}({args})", ["u"])({("u", 0): np.array([0.5, 2.0])}, {})
    assert out.shape == (2,)


def test_max_and_min_take_any_number_of_arguments_as_sympy_writes_them() -> None:
    values = {("u", 0): np.array([1.0, 5.0]), ("w", 0): np.array([3.0, 2.0])}
    assert Equation("Max(u[t], w[t], 4)", ["u", "w"])(values, {}).tolist() == [4.0, 5.0]
    assert Equation("Min(u[t], w[t], 4)", ["u", "w"])(values, {}).tolist() == [1.0, 2.0]


def test_pdiv_protects_small_divisors() -> None:
    out = Equation("pdiv(u[t], w[t])", ["u", "w"])({("u", 0): np.array([4.0, 4.0]), ("w", 0): np.array([2.0, 1e-4])}, {})
    assert out.tolist() == [2.0, 1.0]


@pytest.mark.parametrize(
    "bad",
    [
        "__import__('os')",  # not a function of the language
        "y.mean()",  # attributes
        "y + 1",  # a column without its time
        "a*y[t+1]",  # the future
        "a*q[t-1]",  # not a column
        "open[t-1]",  # not a column
        "exp[t-1]",  # not a column either
        "exp + y[t-1]",  # a function name as a coefficient
        "t * y[t-1]",  # t as a coefficient
        "clip(y[t-1], a_min=0)",  # keyword arguments
        "a * b",  # no data at all
        "y[t-1] +",  # syntax
        "lambda: 1",
        pytest.param("-" * 1990 + "y[t-1]", id="nested deeper than Python's recursion limit"),
        # B-C1: argument counts and sizes (a 500 on equations/check, prepared/preview, components/simulate, train)
        "maximum(y[t-1])",
        "sqrt(y[t-1], 3)",
        "clip(y[t-1])",
        "exp(a, y[t-1])",
        "pdiv(y[t-1])",
        "Max(y[t-1])",
        pytest.param("1" + "0" * 400 + " * y[t-1]", id="a 400-digit constant"),
        pytest.param("1e400 * y[t-1]", id="a constant that is infinite"),
        pytest.param("y[t-" + "9" * 30 + "]", id="a lag beyond any data"),
    ],
)
def test_rejected(bad: str) -> None:
    with pytest.raises(ValueError):
        Equation(bad, ["y", "u"])
