"""Saved models: models/<name>.json (the fit result plus its training settings) and, for XGBoost and TabPFN, its
boosters or training rows in models/<name>.boosters/.

In-process caches, one entry per model file, replaced when the file changes (mtime): the boosters/TabPFN regressors
(TabPFN is refit from its saved rows; only one is kept, each is hundreds of MB), the free run an evaluation cuts its
setpoint windows from (TabPFN's takes minutes, so changing the window is quick), and the latest simulations. One lock
per model file: one save, or one load of its boosters, at a time. The routes (routers/training.py) give the paths;
an invalid name is theirs to refuse.
"""

import gc
import hashlib
import json
import shutil
import threading
import uuid
from pathlib import Path

import numpy as np
import pandas as pd

from . import dataset_files as files
from . import twin
from .limits import SIMULATIONS_KEPT, TABPFN_ROWS

_boosters: dict[str, tuple[float, dict]] = {}
_tabpfn_key: list[str] = []  # the one TabPFN model kept in memory (each is hundreds of MB)
_free_runs: dict[str, tuple[float, dict]] = {}
_simulations: dict[str, tuple[float, dict]] = {}  # model file + request -> (its mtime, the answer), the latest kept


class ModelMissing(LookupError):
    """No such model saved (the routes answer 404)."""


def read(path: Path, name: str) -> dict:
    """models/<name>.json as saved (no boosters); ModelMissing when it is not there."""
    if not path.exists():
        raise ModelMissing(f"Model '{name}' not found — train it first")
    return files.read_json(path)


_model_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _model_lock(path: Path) -> threading.Lock:
    """One lock per model file: one save, or one load of its boosters, at a time, so a model file and its boosters
    are always of one training (two trainings under one name mixed them)."""
    with _locks_guard:
        return _model_locks.setdefault(str(path), threading.Lock())


def load(path: Path, bdir: Path, name: str) -> dict:
    """A saved model; for XGBoost/TabPFN with its boosters (from `bdir`) under "_boosters" (in memory only)."""
    m = read(path, name)
    if m.get("kind") not in ("xgboost", "tabpfn"):
        return m
    with _model_lock(path):  # read again under the lock: a save may have replaced the model meanwhile
        m = read(path, name)
        key, mtime = str(path), path.stat().st_mtime
        if key not in _boosters or _boosters[key][0] != mtime:
            if m["kind"] == "tabpfn":
                _keep_one_tabpfn(key)
            _boosters[key] = (mtime, _load_boosters(bdir, m))
        m["_boosters"] = _boosters[key][1]
    return m


def save(path: Path, bdir: Path, result: dict, boosters: dict | None, samples: dict | None, tabpfn: bool) -> None:
    """A trained model (its JSON part `result`) and its boosters or TabPFN rows, whole: one save at a time per model
    file (the fit runs alongside another; the saves one after the other). Its boosters are kept in memory at once."""
    with _model_lock(path):
        path.parent.mkdir(exist_ok=True)
        _save_boosters(bdir, boosters, samples)
        files.write_atomic(path, json.dumps(result, indent=2))
        if tabpfn:
            _keep_one_tabpfn(str(path))
        _boosters[str(path)] = (path.stat().st_mtime, boosters or {})


def _keep_one_tabpfn(key: str) -> None:
    """Drop the TabPFN model held in memory (if another) before `key` loads: two at once can pass the 2 GB budget."""
    for old in [k for k in _tabpfn_key if k != key]:
        _boosters.pop(old, None)
        _tabpfn_key.remove(old)
    if key not in _tabpfn_key:
        _tabpfn_key.append(key)
    gc.collect()


def _load_boosters(directory: Path, m: dict) -> dict:
    if m["kind"] == "tabpfn":
        return {v: twin.tabpfn_regressor(*_rows(directory / f"{v}.npz")) for v in m["order"]}
    import xgboost as xgb

    loaded = {}
    for v in m["order"]:
        loaded[v] = xgb.Booster()
        loaded[v].load_model(str(directory / f"{v}.json"))
    return loaded


def _save_boosters(bdir: Path, boosters: dict | None, samples: dict | None) -> None:
    """The boosters (or TabPFN's rows) into a temporary folder beside, then in place of the old ones: a save that
    fails keeps the old folder whole. None: the old ones go (a model of fewer variables leaves none stale)."""
    if not boosters:
        shutil.rmtree(bdir, ignore_errors=True)
        return
    tmp = bdir.with_name(f".{bdir.name}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        tmp.mkdir()
        for v, b in boosters.items():
            if samples:
                np.savez(tmp / f"{v}.npz", X=samples[v][0], y=samples[v][1])
            else:
                b.save_model(str(tmp / f"{v}.json"))
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    shutil.rmtree(bdir, ignore_errors=True)
    tmp.rename(bdir)


def _rows(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """A TabPFN model's saved context rows, thinned evenly to TABPFN_ROWS (older models saved more)."""
    with np.load(path) as d:
        X, y = d["X"], d["y"]
    idx = np.linspace(0, len(y) - 1, min(TABPFN_ROWS, len(y))).astype(int)
    return X[idx], y[idx]


def public(m: dict) -> dict:
    """A model as JSON: without the in-memory keys (_boosters, _samples)."""
    return {k: v for k, v in m.items() if not k.startswith("_")}


def fingerprint(path: Path, bdir: Path) -> str | None:
    """A model's content hash, its file and its boosters (not their mtimes: a git checkout changes those); None
    when it is not saved."""
    if not path.exists():
        return None
    h = hashlib.sha256(path.read_bytes())
    for p in sorted(bdir.iterdir()) if bdir.is_dir() else []:
        if not p.name.startswith("."):  # not Finder's .DS_Store: looking at the folder changes no model
            h.update(p.name.encode() + p.read_bytes())
    return h.hexdigest()


def free_run(path: Path, df: pd.DataFrame, m: dict) -> dict:
    """The model's free run over `df`, kept until its file changes (evaluate cuts its setpoint windows from it)."""
    mtime = path.stat().st_mtime
    if _free_runs.get(str(path), (None,))[0] != mtime:
        _free_runs[str(path)] = (mtime, twin.free_run(df, m))
    return _free_runs[str(path)][1]


def simulation(key: str, mtime: float | None) -> dict | None:
    """A simulation's answer kept for `key` while its model file is unchanged (`mtime`), else None."""
    if (hit := _simulations.get(key)) and hit[0] == mtime:
        return hit[1]
    return None


def keep_simulation(key: str, mtime: float | None, out: dict) -> None:
    """Keep a simulation's answer; only the latest SIMULATIONS_KEPT stay."""
    _simulations[key] = (mtime, out)
    while len(_simulations) > SIMULATIONS_KEPT:
        _simulations.pop(next(iter(_simulations)))
