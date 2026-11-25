"""Components: a plant part (heat exchanger, heat pump, storage, a whole data center) as a small causal model.

A component is plain JSON (schemas.Component):

    inputs   exogenous, each with a default:          T_source, T_supply, load
    nodes    one equation each, in the physics language (core/physics.py) over inputs, nodes and parameters:
                 COP    = clip(eta_C * (T_supply[t] + 273.15) / maximum(lift[t], lift_min), 1, COP_max)
                 E      = E[t-1] + (Q_in[t] - Q_out[t]) * dt_h          (state: needs an init value)
    outputs  the nodes other parts read
    params   named numbers; `fixed: false` ones are learned from data by `fit`

Its causal graph is read off the equations: every `Name[t-k]` is a link Name -> node at lag k. A same-step
(`[t]`) link may only point forward: no algebraic loops; feedback goes through `[t-1]`.

Pure: no I/O. The router keeps the presets (core/component_library.py) and the user's saved components.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from graphlib import CycleError, TopologicalSorter

import numpy as np

from .limits import COMPONENT_MAX_NODES, COMPONENT_MAX_STEPS
from .physics import FUNCS, Equation, Ref
from .twin.evaluate import nmae, r2

NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")


@dataclass
class Compiled:
    """A checked component: equations in evaluation order, its parameters, initial values of lagged nodes."""

    inputs: dict[str, float]  # name -> default
    eqs: dict[str, Equation]  # node -> equation, in evaluation order
    init: dict[str, float]  # node -> value before the first step
    params: dict[str, float]
    learnable: list[str]
    outputs: list[str]


def _declared(comp: dict) -> tuple[list[str], list[str], dict[str, float]]:
    """Input names, node names, parameter values; ValueError for a bad, reserved or repeated name."""
    inputs = [i["name"] for i in comp.get("inputs", [])]
    nodes = [n["name"] for n in comp.get("nodes", [])]
    params = {p["name"]: float(p["value"]) for p in comp.get("params", [])}
    names = inputs + nodes + [p["name"] for p in comp.get("params", [])]
    if len(nodes) > COMPONENT_MAX_NODES:
        raise ValueError(f"at most {COMPONENT_MAX_NODES} nodes")
    for n in names:
        if not NAME.match(n) or n in FUNCS or n == "t":
            raise ValueError(f"'{n}' cannot be a name: letters, digits and _, not a function name or t")
    if dup := sorted({n for n in names if names.count(n) > 1}):
        raise ValueError(f"used twice: {', '.join(dup)} (inputs, nodes and parameters need different names)")
    return inputs, nodes, params


def _order(eqs: dict[str, Equation]) -> list[str]:
    """Nodes so that every same-step reference comes first; ValueError naming an algebraic loop."""
    deps = {n: {v for v, lag in eq.refs if lag == 0 and v in eqs} for n, eq in eqs.items()}
    try:
        return list(TopologicalSorter(deps).static_order())
    except CycleError as exc:
        loop = " → ".join(reversed(exc.args[1]))
        raise ValueError(f"algebraic loop at the same step: {loop}; make one of these links [t-1]") from exc


def check(comp: dict) -> dict:
    """Never raises: per-node parse results, undeclared names (`missing`, to add as parameters), links, order, error."""
    out: dict = {"ok": False, "error": None, "nodes": {}, "links": [], "order": [], "missing": []}
    try:
        inputs, nodes, params = _declared(comp)
    except ValueError as exc:
        return {**out, "error": str(exc)}
    eqs = {}
    for n in comp.get("nodes", []):
        try:
            eq = Equation(n["equation"], inputs + nodes)
        except ValueError as exc:
            out["nodes"][n["name"]] = {"ok": False, "error": str(exc), "uses": [], "params": []}
            continue
        eqs[n["name"]] = eq
        out["nodes"][n["name"]] = {
            "ok": True,
            "error": None,
            "uses": [f"{v}[t-{k}]" if k else f"{v}[t]" for v, k in eq.refs],
            "params": eq.params,
        }
        out["links"] += [{"source": v, "target": n["name"], "lag": k} for v, k in eq.refs]
    out["missing"] = sorted({p for eq in eqs.values() for p in eq.params if p not in params})
    try:
        out["order"] = _order(eqs)
    except ValueError as exc:
        return {**out, "error": str(exc)}
    bad = [n for n, r in out["nodes"].items() if not r["ok"]]
    if bad:
        out["error"] = f"check the equation of {', '.join(bad)}"
    elif out["missing"]:
        out["error"] = f"not a parameter: {', '.join(out['missing'])}"
    elif unknown := [o for o in comp.get("outputs", []) if o not in nodes]:
        out["error"] = f"outputs must be nodes: {', '.join(unknown)}"
    else:
        out["ok"] = True
    return out


def compile_component(comp: dict) -> Compiled:
    """The component ready to run; ValueError with the first problem `check` finds."""
    res = check(comp)
    if not res["ok"]:
        raise ValueError(res["error"])
    inputs, nodes, params = _declared(comp)
    eqs = {n["name"]: Equation(n["equation"], inputs + nodes) for n in comp["nodes"]}
    return Compiled(
        inputs={i["name"]: float(i.get("default", 0)) for i in comp.get("inputs", [])},
        eqs={n: eqs[n] for n in res["order"]},
        init={n["name"]: float(n.get("init", 0)) for n in comp["nodes"]},
        params=params,
        learnable=[p["name"] for p in comp.get("params", []) if not p.get("fixed", True)],
        outputs=list(comp.get("outputs", [])),
    )


def _upstream(c: Compiled, targets: list[str], stop: set[str] = frozenset()) -> set[str]:
    """`targets` and every node they read, at any lag (not walking past the nodes in `stop`)."""
    seen, todo = set(), list(targets)
    while todo:
        n = todo.pop()
        if n in seen:
            continue
        seen.add(n)
        todo += [v for v, _ in c.eqs[n].refs if v in c.eqs and v not in stop]
    return seen


def _shift(a: np.ndarray, k: int, first: float) -> np.ndarray:
    """`a` k steps back; the first k steps take `first`."""
    if k == 0:
        return a
    out = np.full(len(a), first, dtype=float)
    out[k:] = a[: len(a) - k] if k < len(a) else []
    return out


def input_series(c: Compiled, given: dict[str, float | list[float]], steps: int | None) -> tuple[dict[str, np.ndarray], int]:
    """Every input as an array of n steps: a list as given, a number (or a missing input: its default) held constant."""
    if unknown := [k for k in given if k not in c.inputs]:
        raise ValueError(f"not inputs of the component: {', '.join(unknown)}")
    lengths = {len(v) for v in given.values() if isinstance(v, list)}
    if len(lengths) > 1:
        raise ValueError("input series must have the same length")
    n = lengths.pop() if lengths else (steps or 1)
    if not 1 <= n <= COMPONENT_MAX_STEPS:
        raise ValueError(f"steps must be 1..{COMPONENT_MAX_STEPS}")
    return {
        k: np.asarray(given[k], dtype=float) if isinstance(given.get(k), list) else np.full(n, float(given.get(k, d)))
        for k, d in c.inputs.items()
    }, n


def simulate(
    comp: dict, given: dict[str, float | list[float]], steps: int | None = None, outputs: list[str] | None = None
) -> dict[str, list[float]]:
    """Run the component over the input series. Returns the inputs and the nodes `outputs` need (default: every node).

    Without feedback (no node reads itself or a later node at a lag) every node is one array operation; otherwise
    it runs step by step.
    """
    c = compile_component(comp)
    if unknown := [o for o in outputs or [] if o not in c.eqs]:
        raise ValueError(f"not nodes of the component: {', '.join(unknown)}")
    series, n = input_series(c, given, steps)
    need = _upstream(c, outputs) if outputs else set(c.eqs)
    order = [v for v in c.eqs if v in need]
    pos = {v: i for i, v in enumerate(order)}
    first = {**{k: a[0] for k, a in series.items()}, **c.init}
    feedback = any(lag and v in pos and pos[v] >= pos[node] for node in order for v, lag in c.eqs[node].refs)
    if not feedback:
        for node in order:
            vals = {(v, k): _shift(series[v], k, first[v]) for v, k in c.eqs[node].refs}
            series[node] = np.broadcast_to(c.eqs[node](vals, c.params), (n,)).astype(float)
    else:
        for node in order:
            series[node] = np.zeros(n)
        for t in range(n):
            for node in order:
                vals: dict[Ref, float] = {(v, k): series[v][t - k] if t >= k else first[v] for v, k in c.eqs[node].refs}
                series[node][t] = float(c.eqs[node](vals, c.params))
    return {k: a.tolist() for k, a in series.items() if k in c.inputs or k in need}


def _one_step(c: Compiled, data: dict[str, np.ndarray], params: dict[str, float], targets: list[str]) -> dict[str, np.ndarray]:
    """Teacher forcing: each target node from the measured inputs and nodes; unmeasured nodes it reads are computed."""
    n = len(next(iter(data.values())))
    series = {k: data.get(k, np.full(n, d)) for k, d in c.inputs.items()}
    series.update({k: v for k, v in data.items() if k in c.eqs})
    pred: dict[str, np.ndarray] = {}
    for node in c.eqs:  # evaluation order
        if node not in targets:
            continue
        vals = {}
        for v, k in c.eqs[node].refs:
            if v in series:  # input or measured node: the data (NaN before the first row)
                vals[(v, k)] = _shift(series[v], k, np.nan)
            elif v in pred:
                vals[(v, k)] = _shift(pred[v], k, c.init[v])
            else:
                raise ValueError(f"{node} reads its own past through {v}, which is not in the data: map {v} to a column")
        pred[node] = np.broadcast_to(c.eqs[node](vals, params), (n,)).astype(float)
    return pred


def fit(comp: dict, data: dict[str, np.ndarray]) -> dict:
    """Learn the non-fixed parameters from measured series (keys: input and node names) by least squares.

    Every measured node is predicted one step at a time from the measured inputs and nodes (inputs not in the data
    hold their default); the residuals of all measured nodes, each divided by its spread, are minimised together,
    starting from the current values. Returns all parameter values, which were learned, and R² / nMAE per measured node.
    """
    c = compile_component(comp)
    if unknown := [k for k in data if k not in c.inputs and k not in c.eqs]:
        raise ValueError(f"not inputs or nodes of the component: {', '.join(unknown)}")
    measured = [k for k in c.eqs if k in data]
    if not measured:
        raise ValueError("map at least one node to a data column: the fit compares its equation with the data")
    targets = _upstream(c, measured, stop=set(measured)) | set(measured)
    used = {p for node in targets for p in c.eqs[node].params}
    learn = [p for p in c.learnable if p in used]
    params = dict(c.params)
    _one_step(c, data, params, targets)  # raises for a feedback through an unmeasured node
    ys = {k: data[k] for k in measured}
    scale = {k: float(np.nanstd(y)) or 1.0 for k, y in ys.items()}
    if learn:
        from scipy.optimize import least_squares

        start = _one_step(c, data, params, targets)
        rows = {k: np.isfinite(ys[k]) & np.isfinite(start[k]) for k in measured}
        if sum(int(r.sum()) for r in rows.values()) < len(learn):
            raise ValueError("too few complete rows to learn the parameters")

        def resid(theta: np.ndarray) -> np.ndarray:
            pred = _one_step(c, data, {**params, **dict(zip(learn, theta, strict=True))}, targets)
            r = np.concatenate([(pred[k][rows[k]] - ys[k][rows[k]]) / scale[k] for k in measured])
            return np.where(np.isfinite(r), r, 1e6)

        x0 = np.array([params[p] for p in learn])
        sol = least_squares(resid, x0, x_scale=np.maximum(np.abs(x0), 1e-3))
        params.update({p: float(v) for p, v in zip(learn, sol.x, strict=True)})
    pred = _one_step(c, data, params, targets)
    quality = {
        k: {
            "r2": r2(ys[k], pred[k]),
            "nmae": nmae(ys[k], pred[k], float(np.nanmean(np.abs(ys[k])))),
            "rows": int((np.isfinite(ys[k]) & np.isfinite(pred[k])).sum()),
        }
        for k in measured
    }
    return {"params": params, "learned": learn, "quality": quality, "rows": len(next(iter(data.values())))}
