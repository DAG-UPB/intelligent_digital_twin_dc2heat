"""Prepared variables: new columns the user makes from the data (Dashboard › Prepare variables).

A recipe (the silver's recipe.json "prepared", in order) lists one step per new variable: combine several columns (mean, sum,
min, max, difference, ratio, product), transform one (scale, unit, log, change per step, rolling mean, shift, clip,
fill gaps, standardise), a time feature (time since start, hour of day, ...) or a formula in the equation language
(core/physics.py, without coefficients). A step may use the variables made before it. The data as delivered is never
changed: the new columns are written per data file to the data center's silver (core/storage.py prepared_file), the recipe to
its recipe.json, and read back as extra columns (core/registry.py).
"""

import math
import re
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pandas as pd

from . import dataset_files
from .dataset_files import read_json
from .physics import Equation
from .storage import Storage

NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}")

COMBINE = {"mean", "sum", "min", "max", "product"}  # two or more inputs
PAIR = {"difference", "ratio"}  # exactly two: a - b, a / b
SINGLE = {"scale", "unit", "log", "sqrt", "abs", "diff", "rolling_mean", "shift", "clip", "fill_gaps", "standardize"}
TIME = {"time_since_start", "hour_of_day", "day_of_week", "month", "day_of_year", "is_weekend"}
OPS = COMBINE | PAIR | SINGLE | TIME | {"formula"}

# unit conversions: value * factor + offset
UNITS: dict[str, tuple[float, float]] = {
    "K -> °C": (1.0, -273.15),
    "°C -> K": (1.0, 273.15),
    "°F -> °C": (5 / 9, -32 * 5 / 9),
    "W -> kW": (1e-3, 0.0),
    "kW -> W": (1e3, 0.0),
    "kW -> MW": (1e-3, 0.0),
    "MW -> kW": (1e3, 0.0),
    "Wh -> kWh": (1e-3, 0.0),
    "kWh -> MWh": (1e-3, 0.0),
    "J -> kWh": (1 / 3.6e6, 0.0),
    "m³/h -> l/s": (1 / 3.6, 0.0),
    "l/s -> m³/h": (3.6, 0.0),
}
TIME_UNITS = {"seconds": 1.0, "minutes": 60.0, "hours": 3600.0, "days": 86400.0}
FILL = {"interpolate", "previous", "zero", "mean"}
# the settings (params) each operation reads; any other key is a mistake (a typo, or the setting put beside params)
PARAMS = {
    "scale": {"factor", "offset"},
    "unit": {"conversion"},
    "diff": {"steps"},
    "shift": {"steps"},
    "rolling_mean": {"window", "steps"},
    "clip": {"min", "max"},
    "fill_gaps": {"method"},
    "time_since_start": {"unit"},
    "formula": {"expr"},
}
MAX_WINDOW = 10_000


def describe(op: str) -> str:
    """The step in words, for the recipe list."""
    return {
        "mean": "mean of",
        "sum": "sum of",
        "min": "minimum of",
        "max": "maximum of",
        "product": "product of",
        "difference": "difference",
        "ratio": "ratio",
    }.get(op, op.replace("_", " "))


def check(step: dict, columns: list[str], taken: list[str]) -> dict:
    """The step, cleaned; ValueError with a reason the user can act on. `columns`: what it may use, `taken`: names
    already in use (data columns and other prepared variables)."""
    name, op = str(step.get("name", "")).strip(), str(step.get("op", ""))
    inputs = [str(c) for c in step.get("inputs") or []]
    params = dict(step.get("params") or {})
    if not NAME.fullmatch(name):
        raise ValueError("The name must start with a letter or _, then letters, digits or _ (up to 64)")
    if name in taken:
        raise ValueError(f"{name} already exists: pick another name")
    if op not in OPS:
        raise ValueError(f"Unknown operation {op!r}: one of {', '.join(sorted(OPS))}")
    unknown = [c for c in inputs if c not in columns]
    if unknown:
        raise ValueError(f"Not variables of this data: {', '.join(unknown)}")
    extra = sorted(set(params) - PARAMS.get(op, set()))
    if extra:
        has = ", ".join(sorted(PARAMS.get(op, set()))) or "none"
        raise ValueError(f"'{op}' has no setting {', '.join(extra)} (its settings in params: {has})")
    need = (2, None) if op in COMBINE else (2, 2) if op in PAIR else (1, 1) if op in SINGLE else (0, 0)
    if op != "formula" and (len(inputs) < need[0] or (need[1] is not None and len(inputs) > need[1])):
        n = f"{need[0]}" if need[0] == need[1] else f"at least {need[0]}"
        raise ValueError(f"'{op}' needs {n} input variable{'s' if need[0] != 1 else ''}")
    if op == "unit" and not _choice(params.get("conversion"), UNITS):
        raise ValueError(f"Pick a conversion: {', '.join(UNITS)}")
    if op in ("rolling_mean", "diff", "shift"):
        for steps in [params[k] for k in ("steps", "window") if k in params] or [1]:  # each one given: compute reads either
            if not _number(steps) or int(steps) != steps or not 1 <= int(steps) <= MAX_WINDOW:
                raise ValueError(f"steps must be a whole number from 1 to {MAX_WINDOW}")
    if op == "fill_gaps" and not _choice(params.get("method", "interpolate"), FILL):
        raise ValueError(f"method must be one of {', '.join(sorted(FILL))}")
    if op == "time_since_start" and not _choice(params.get("unit", "hours"), TIME_UNITS):
        raise ValueError(f"unit must be one of {', '.join(TIME_UNITS)}")
    if op == "formula":
        eq = Equation(str(params.get("expr", "")), columns)
        if eq.params:
            raise ValueError(f"A formula has no coefficients to learn: {', '.join(eq.params)} is not a data column")
        inputs = sorted({v for v, _ in eq.refs})
    for key in ("factor", "offset", "min", "max"):
        if key in params and params[key] is not None and not _number(params[key]):
            raise ValueError(f"{key} must be a number")
    scope = step.get("scope")
    if scope not in (None, "dc", "heat", "district"):
        raise ValueError("scope must be dc, heat or district")
    return {"name": name, "op": op, "inputs": inputs, "params": params, **({"scope": scope} if scope else {})}


def _number(x: object) -> bool:
    """A finite number from the JSON (not true/false, not NaN or infinity)."""
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _choice(x: object, options) -> bool:
    """One of the options' names (a list or an object is none of them, not a 500)."""
    return isinstance(x, str) and x in options


def _single(op: str, x: pd.Series, p: dict) -> pd.Series:
    if op == "scale":
        return x * float(p.get("factor", 1.0)) + float(p.get("offset", 0.0))
    if op == "unit":
        factor, offset = UNITS[p["conversion"]]
        return x * factor + offset
    if op == "log":
        return np.log(x.where(x > 0))
    if op == "sqrt":
        return np.sqrt(x.where(x >= 0))
    if op == "abs":
        return x.abs()
    if op == "diff":  # change per step: a meter count becomes what it measured in that step
        return x.diff(int(p.get("steps", 1)))
    if op == "rolling_mean":
        w = int(p.get("window", p.get("steps", 1)))
        return x.rolling(w, min_periods=1).mean()
    if op == "shift":  # the value k steps before
        return x.shift(int(p.get("steps", 1)))
    if op == "clip":
        lo, hi = p.get("min"), p.get("max")
        return x.clip(lower=None if lo is None else float(lo), upper=None if hi is None else float(hi))
    if op == "fill_gaps":
        method = p.get("method", "interpolate")
        if method == "interpolate":
            return x.interpolate(limit_direction="both")
        if method == "previous":
            return x.ffill().bfill()
        return x.fillna(0.0 if method == "zero" else x.mean())
    if op == "standardize":
        sd = x.std()
        return (x - x.mean()) / sd if sd and sd > 0 else x * np.nan
    raise ValueError(op)


def _time(op: str, time: pd.Series, p: dict) -> pd.Series:
    if op == "time_since_start":
        return (time - time.min()).dt.total_seconds() / TIME_UNITS[p.get("unit", "hours")]
    if op == "hour_of_day":
        return time.dt.hour + time.dt.minute / 60
    if op == "day_of_week":
        return time.dt.dayofweek.astype(float)  # Monday = 0
    if op == "month":
        return time.dt.month.astype(float)
    if op == "day_of_year":
        return time.dt.dayofyear.astype(float)
    return (time.dt.dayofweek >= 5).astype(float)  # is_weekend


def _formula(expr: str, df: pd.DataFrame, columns: list[str]) -> pd.Series:
    eq = Equation(expr, columns)
    values = {(v, lag): df[v].shift(lag).to_numpy(dtype=float) for v, lag in eq.refs}
    return pd.Series(eq(values, {}), index=df.index)


def compute_step(step: dict, df: pd.DataFrame) -> pd.Series:
    """One prepared variable from the frame (its inputs must be columns of it)."""
    op, inputs, p = step["op"], step["inputs"], step.get("params") or {}
    with np.errstate(all="ignore"):
        if op in COMBINE:
            block = df[inputs].astype(float)
            out = block.prod(axis=1, min_count=1) if op == "product" else getattr(block, op)(axis=1)
        elif op == "difference":
            out = df[inputs[0]].astype(float) - df[inputs[1]].astype(float)
        elif op == "ratio":
            b = df[inputs[1]].astype(float)
            out = df[inputs[0]].astype(float) / b.where(b.abs() > 1e-12)
        elif op in SINGLE:
            out = _single(op, df[inputs[0]].astype(float), p)
        elif op in TIME:
            if "time" not in df:
                raise ValueError("This data has no time column")
            out = _time(op, df["time"], p)
        else:
            out = _formula(str(p["expr"]), df, [c for c in df.columns if c != "time"])
    return out.replace([np.inf, -np.inf], np.nan).astype(float).rename(step["name"])


def compute(df: pd.DataFrame, recipe: list[dict]) -> pd.DataFrame:
    """Every prepared variable of the recipe, in order (each may use the ones before), as new columns."""
    work = df.copy()
    out = pd.DataFrame(index=df.index)
    for step in recipe:
        col = compute_step(step, work)
        work[step["name"]] = col
        out[step["name"]] = col
    return out


def doable(recipe: list[dict], columns: list[str]) -> tuple[list[dict], list[str]]:
    """The steps a data file can make from its columns (an aggregated file may have dropped an input), in order, and
    the names of the ones it cannot (with every step made from them)."""
    have, kept, left = set(columns), [], []
    for step in recipe:
        if set(step.get("inputs") or []) <= have:
            kept.append(step)
            have.add(step["name"])
        else:
            left.append(step["name"])
    return kept, left


def dependents(recipe: list[dict], name: str) -> list[str]:
    """The prepared variables that use `name`, directly or through others."""
    used = {name}
    for step in recipe:
        if used & set(step.get("inputs") or []):
            used.add(step["name"])
    return [s["name"] for s in recipe if s["name"] in used and s["name"] != name]


def read_recipe(path: Path) -> dict:
    """A data center's recipe (core/storage.py recipe_file): {"prepared": [steps], "resampled": [files]}."""
    raw = read_json(path)  # a broken one is named (BrokenFile), not read as empty and then overwritten
    return {"prepared": list(raw.get("prepared") or []), "resampled": list(raw.get("resampled") or [])}


def write_prepared(
    storage: Storage,
    dc: str,
    steps: list[dict],
    stems: list[str],
    raw: Callable[[str], pd.DataFrame],
    too_big: Callable[[str], object],
) -> list[str]:
    """Recompute the prepared variables of the given data files of data center `dc` (core/storage.py); the files
    written (or removed, when none), relative to the version folder. Every file is computed before any is written, so a
    failure changes nothing. A step whose inputs a file does not have (an aggregated file that dropped them) is left
    out of that file, and said so. A CSV too big to load (`too_big`) is skipped: its aggregated files and time windows
    get the prepared variables when they are made. `raw` reads one delivered data file (no prepared columns)."""
    rel = lambda path: path.relative_to(storage.version_root).as_posix()  # noqa: E731
    todo: list[tuple[str | None, Path | None, pd.DataFrame | None]] = []  # (a note, the file, its values or None: remove)
    for stem in stems:
        if too_big(stem):
            todo.append((f"{stem}: skipped, too big to load (its aggregated files get the variable)", None, None))
            continue
        path = storage.prepared_file(dc, stem)
        if not steps:
            todo.append((None, path, None))
            continue
        data = raw(stem)
        kept, left = doable(steps, list(data.columns))
        out = compute(data, kept) if kept else None
        if out is not None and "time" in data:
            out.insert(0, "time", data["time"])
        todo.append((f"{stem}: without {', '.join(left)} (made from variables it does not have)" if left else None, path, out))
    written = []
    for note, path, out in todo:
        if path is not None and out is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            dataset_files.write_atomic(path, out.to_parquet(index=False))
            written.append(rel(path))
        elif path is not None and path.exists():
            path.unlink()
            written.append(f"{rel(path)} (removed)")
        if note:
            written.append(note)
    return written
