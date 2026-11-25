"""Physics equations, and training / listing / evaluating / simulating the twin's models.

A model is saved as models/<name>.json (the fit result plus its training settings), with its
XGBoost boosters or TabPFN training rows in models/<name>.boosters/ (core/model_store.py: saving, loading, the caches
and the per-model lock). The last evaluation asked to be stored is models/evaluation.json, read back while the models
it scored are unchanged.
"""

import functools
import json
import logging
import time

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException

from ..core import csv_data, foundation, model_store, prepare, rolling, twin
from ..core import dataset_files as files
from ..core.derived import add_derived
from ..core.limits import EVALUATION_STORED_MAX_BYTES
from ..core.physics import Equation
from ..core.registry import DatasetMeta
from ..core.twin.evaluate import season_steps
from ..deps import Dataset, Registry, Structure, dataframe, derived_columns, graph_path, model_file, read_graph, times, values
from ..schemas import CompareRequest, EquationCheck, EvaluateRequest, SimulateRequest, TrainEstimate, TrainRequest

router = APIRouter(prefix="/api/datasets", tags=["training"])


def _read_model(meta: DatasetMeta, name: str) -> dict:
    """models/<name>.json as saved (no boosters), or 404."""
    try:
        return model_store.read(model_file(meta, name), name)
    except model_store.ModelMissing as exc:
        raise HTTPException(404, str(exc)) from None


log = logging.getLogger(__name__)


def _timed(what: str):
    """The route with an info line of how long it took (train, evaluate, simulate, compare: seconds to minutes)."""

    def wrap(route):
        @functools.wraps(route)
        def run(*args, **kwargs):
            t0 = time.monotonic()
            out = route(*args, **kwargs)
            log.info("%s %s: %.1f s", what, getattr(kwargs.get("meta"), "id", "?"), time.monotonic() - t0)
            return out

        return run

    return wrap


def load_model(meta: DatasetMeta, name: str) -> dict:
    """A saved model; for XGBoost/TabPFN with its boosters under "_boosters" (in memory only), or 404; 501 when its
    library is not installed here."""
    path = model_file(meta, name)
    try:
        return model_store.load(path, files.booster_dir(meta.file(files.MODELS_DIR), name), name)
    except model_store.ModelMissing as exc:
        raise HTTPException(404, str(exc)) from None
    except twin.NotInstalled as exc:
        raise HTTPException(501, f"{name}: {exc}") from None


def _fingerprint(meta: DatasetMeta, name: str) -> str | None:
    """A model's content hash (model_store.fingerprint); None when it is not saved."""
    return model_store.fingerprint(model_file(meta, name), files.booster_dir(meta.file(files.MODELS_DIR), name))


# --- physics equations, kept per dataset in equations.json -------------------------------


@router.get("/{dataset_id}/equations", summary="Get the physics equations")
def get_equations(meta: Structure):
    """The dataset's physics equations {variable: right-hand side}."""
    return {"equations": files.read_json(meta.file(files.EQUATIONS))}


@router.put("/{dataset_id}/equations", summary="Save the physics equations")
def save_equations(meta: Structure, body: dict[str, str]):
    """Replace the equations (keys must be data columns; expressions are checked when training)."""
    bad = [v for v in body if v not in meta.columns]
    if bad:
        raise HTTPException(400, f"Not data columns: {bad}")
    files.write_atomic(meta.file(files.EQUATIONS), json.dumps(body, indent=2))
    return {"equations": body}


@router.post("/{dataset_id}/equations/check", summary="Check a physics equation")
def check_equation(meta: Dataset, body: EquationCheck):
    """Parse an equation: which data it uses and which coefficients will be learned (always 200)."""
    try:
        eq = Equation(body.expr, meta.columns)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    if (body.target, 0) in eq.refs:
        return {"ok": False, "error": f"{body.target}[t] cannot be on the right-hand side of its own equation"}
    return {"ok": True, "uses": [twin.input_name(v, k) for v, k in eq.refs], "coefficients": eq.params}


# --- models ------------------------------------------------------------------------------


@router.get("/{dataset_id}/models", summary="List trained models")
def list_models(meta: Structure):
    """Names of the trained models."""
    d = meta.file(files.MODELS_DIR)
    return {"models": sorted(p.stem for p in d.glob("*.json") if p.name != files.EVALUATION) if d.exists() else []}


@router.get("/{dataset_id}/models/evaluation", summary="Get the stored evaluation")
def stored_evaluation(meta: Structure):
    """The last evaluation stored (Evaluate with store), with what it scored: names, levers, horizon and each model's
    content hash; null when none is stored or a model it scored has changed or gone since."""
    saved = files.read_json(meta.file(f"{files.MODELS_DIR}/{files.EVALUATION}"))
    hashes = saved.get("hashes") or {}
    return saved if hashes and all(_fingerprint(meta, n) == h for n, h in hashes.items()) else None


@router.get("/{dataset_id}/models/{name}", summary="Get a trained model")
def get_model(meta: Structure, name: str):
    """A trained model: fit result (per-variable inputs, metrics) and its training settings."""
    return model_store.public(_read_model(meta, name))  # no boosters: refitting TabPFN only to drop it takes seconds


def _setup(meta: DatasetMeta, registry: Registry, body: TrainRequest):
    """What a training request fits: (file, data, each variable's inputs, drivers, variables used, equations).
    Train and its estimate both start here, so the estimate counts what training fits."""
    file, df = dataframe(registry, meta, body.file)
    graph, _ = read_graph(graph_path(meta, body.graph_file))
    derived = derived_columns(meta)  # calculated: never modelled
    used = [c for c in (body.variables or meta.columns) if c in meta.columns and c not in derived]
    drivers = body.drivers if body.drivers is not None else twin.default_drivers(graph, meta.columns)
    drivers = [d for d in drivers if d in used]
    if body.structure == "all":
        targets = twin.all_vs_all(used, drivers, body.max_lag)
    else:
        targets = {v: [(p, lag) for p, lag in ps if p in used] for v, ps in graph.items() if v in used}
    equations = {v: e for v, e in (body.equations or {}).items() if v not in derived}
    return file, df, targets, drivers, used, equations


@router.post("/{dataset_id}/models/estimate", response_model=TrainEstimate, summary="Estimate a training")
def estimate_training(meta: Structure, registry: Registry, body: TrainRequest):
    """How many variable models a training request fits and roughly how long it takes (a range: computers and data
    differ). Nothing is trained or saved."""
    _, df, targets, drivers, _, equations = _setup(meta, registry, body)
    try:
        return twin.estimate(df, targets, drivers, body.split_fraction, kind=body.model, equations=equations)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/{dataset_id}/models/train", summary="Train a model")
@_timed("train")
def train(meta: Structure, registry: Registry, body: TrainRequest):
    """Fit a model and save it as models/{name}.json (replacing one of the same name)."""
    path = model_file(meta, body.name)  # before the fit, which can take minutes
    file, df, targets, drivers, used, equations = _setup(meta, registry, body)
    try:
        result = twin.fit(df, targets, drivers, body.split_fraction, kind=body.model, equations=equations)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    result |= {
        "name": body.name,
        "file": file,
        "graph_file": body.graph_file,
        "requested_drivers": drivers,
        "structure": body.structure,
        "max_lag_setting": body.max_lag,
        "variables_used": used,
        "model_type": body.model,
        **({"equations": equations} if body.model == "physics" else {}),
    }
    boosters = result.pop("_boosters", None)
    samples = result.pop("_samples", None)
    bdir = files.booster_dir(meta.file(files.MODELS_DIR), body.name)
    model_store.save(path, bdir, result, boosters, samples, body.model == "tabpfn")
    return result


@router.post("/{dataset_id}/models/evaluate", summary="Evaluate models on the test period")
@_timed("evaluate")
def evaluate(meta: Structure, registry: Registry, body: EvaluateRequest):
    """Compare trained models on the test data: free run, and after each setpoint change. With `store` the answer is
    also saved beside the models (GET .../models/evaluation). A model whose library is not installed here is left out,
    with the reason under "skipped"; the others are scored."""
    models, skipped = {}, {}
    for n in body.names:
        try:
            models[n] = load_model(meta, n)
        except HTTPException as exc:
            if exc.status_code != 501:
                raise
            skipped[n] = exc.detail
    if not models:
        raise HTTPException(501, "; ".join(skipped.values()))
    # ponytail: every model is scored on the first model's data file; models of one dataset share it today
    _, df = dataframe(registry, meta, next(iter(models.values()))["file"])
    res = {}
    for n, m in models.items():
        res[n] = twin.evaluate(df, m, body.levers, body.horizon, run=model_store.free_run(model_file(meta, n), df, m))
    out_events = _merge_events(res, df)
    out = {
        "models": {
            n: {
                "free_r2": res[n]["free_r2"],
                "free_nmae": res[n]["free_nmae"],
                "free_mae": res[n]["free_mae"],
                "free_wape": res[n]["free_wape"],
                "free_mase": res[n]["free_mase"],
                "nmae_test": {v: d.get("nmae_test") for v, d in m["variables"].items()},
                "r2_test": {v: d["r2_test"] for v, d in m["variables"].items()},
                "structure": m.get("structure", "graph"),
                "kind": m.get("kind", "linear"),
            }
            for n, m in models.items()
        },
        "events": out_events,
        **({"skipped": skipped} if skipped else {}),
    }
    if body.store:
        _store(meta, body, out)
    return out


def _store(meta: DatasetMeta, body: EvaluateRequest, answer: dict) -> None:
    """Save an evaluation beside its models with what it scored (stored_evaluation reads it back while that holds)."""
    # ponytail: the data file is not in the signature; a data file changed under unchanged models keeps its old scores
    stored = {
        "names": body.names,
        "levers": body.levers,
        "horizon": body.horizon,
        "hashes": {n: _fingerprint(meta, n) for n in body.names},
    } | answer
    text = json.dumps(stored, separators=(",", ":"))
    if len(text) > EVALUATION_STORED_MAX_BYTES:  # long windows after many changes: the scores only
        text = json.dumps(stored | {"events": []}, separators=(",", ":"))
    files.write_atomic(meta.file(f"{files.MODELS_DIR}/{files.EVALUATION}"), text)


def _merge_events(results: dict[str, dict], df: pd.DataFrame) -> list[dict]:
    """The setpoint-change windows of every model merged into one entry per change (lever, start).

    Each entry holds every model's prediction cut to the shortest window, and the real data of it.
    """
    events: dict[tuple[str, int], dict] = {}
    for n, r in results.items():
        for e in r["events"]:
            ev = events.setdefault(
                (e["lever"], e["start"]),
                {"lever": e["lever"], "start": e["start"], "from": e["from"], "to": e["to"], "steps": e["steps"]}
                | {"pred": {}, "rmse": {}, "nmae": {}},
            )
            ev["steps"] = min(ev["steps"], e["steps"])
            ev["pred"][n] = {v: a.tolist() for v, a in e["pred"].items()}
            ev["rmse"][n] = e["rmse"]
            ev["nmae"][n] = e["nmae"]
    merged = sorted(events.values(), key=lambda e: e["start"])
    for ev in merged:
        a, b = ev["start"], ev["start"] + ev["steps"]
        variables = sorted({v for p in ev["pred"].values() for v in p})
        ev["time"] = times(df["time"].iloc[a:b])
        ev["actual"] = {v: values(df[v].iloc[a:b]) for v in variables}
        ev["pred"] = {n: {v: vals[: ev["steps"]] for v, vals in p.items()} for n, p in ev["pred"].items()}
    return merged


@router.post("/{dataset_id}/models/{name}/simulate", summary="Simulate a scenario")
@_timed("simulate")
def simulate(meta: Structure, registry: Registry, name: str, body: SimulateRequest):
    """Run a model from `start` with interventions; percentiles p05/p50/p95 when n_draws > 1.

    Columns may also be derived ones (dataset.json "derived") whose parts the model has: computed per draw from them.
    The same request on the same saved model gets the answer it had (a year of XGBoost takes seconds)."""
    path = model_file(meta, name)
    key = f"{path}|{body.model_dump_json()}"
    mtime = path.stat().st_mtime if path.exists() else None
    if (hit := model_store.simulation(key, mtime)) is not None:
        return hit
    m = load_model(meta, name)
    _, df = dataframe(registry, meta, m["file"])
    names = m["drivers"] + m["order"]
    derived = derived_columns(meta)
    derivable = add_derived(dict.fromkeys(names, 0.0), derived)
    cols = body.columns or names
    bad = [c for c in cols if c not in names and c not in derivable]
    bad += [iv.variable for iv in body.interventions if iv.variable not in names]
    if bad:
        raise HTTPException(400, f"Not in the model: {sorted(set(bad))}")

    # an input moved (put in, or intervened on) that the model's prepared inputs are made from: those are made again
    # from it (rolling.carried; a colder outdoor temperature makes its 24 h and 72 h means colder too), else the model
    # sees a colder hour after unchanged days; the other interventions stay the twin's own
    recipe = prepare.read_recipe(meta.storage.recipe_file(meta.id))["prepared"]
    feeding = {d for d in m["drivers"] if set(prepare.dependents(recipe, d)) & set(m["drivers"])}
    at = max(body.start, m["max_lag"])

    def run(ivs: list[dict]) -> dict:
        moved = [iv for iv in ivs if iv["variable"] in feeding]
        drivers = body.drivers
        if moved or feeding & set(drivers or {}):
            put, _ = rolling.carried(df, m, recipe, moved, at, min(body.steps, len(df) - at), drivers)
            drivers, ivs = {**(drivers or {}), **put}, [iv for iv in ivs if iv not in moved]
        try:
            sim = twin.simulate(df, m, body.start, body.steps, ivs, body.n_draws, drivers=drivers)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return sim | add_derived(sim, derived)

    def summary(sim: dict) -> dict:
        if body.n_draws == 1:
            return {c: sim[c][0].tolist() for c in cols}
        q = {c: np.percentile(sim[c], [5, 50, 95], axis=0) for c in cols}
        return {c: {"p05": v[0].tolist(), "p50": v[1].tolist(), "p95": v[2].tolist()} for c, v in q.items()}

    sim = run([iv.model_dump() for iv in body.interventions])
    start = max(body.start, m["max_lag"])
    steps = len(next(iter(sim.values()))[0])
    window = df.iloc[start : start + steps]
    out = {
        "start": start,
        "steps": steps,
        "time": times(window["time"]),
        "actual": {c: values(window[c]) for c in cols},
        "scenario": summary(sim),
    }
    if body.baseline:
        out["baseline"] = summary(run([]))
    # ponytail: keyed by the model file only; a data file changed under an unchanged model keeps its old answer until
    # the model is saved again or the app restarts
    model_store.keep_simulation(key, mtime, out)
    return out


def _max_lag(meta: DatasetMeta, name: str) -> int:
    """A trained model's largest lag; 0 when there is no such model (its run in compare says so)."""
    try:
        return int(_read_model(meta, name).get("max_lag", 0))
    except HTTPException:
        return 0


@router.post("/{dataset_id}/models/compare", summary="Roll models over a period and compare them")
@_timed("compare")
def compare(meta: Structure, registry: Registry, body: CompareRequest):
    """Each model (trained, or chronos-2) rolled over the period the same way, with and without the interventions:
    its series, its scores against the measurement and how much the interventions change its total."""
    _, df = dataframe(registry, meta, None)
    if body.column not in df.columns:
        raise HTTPException(400, f"No column {body.column} in the data")
    times_ = pd.DatetimeIndex(df["time"])
    start = rolling.first_of_last_year(times_) if body.start is None else body.start
    # every run starts where each trained model has its history (as simulate raises its start): the measurement, the
    # times and the windows from there too, else they sit that many steps off the runs
    start = max([start, *(_max_lag(meta, n) for n in body.models if n != rolling.FOUNDATION)])
    steps = min(body.steps or len(df) - start, len(df) - start)
    if steps < season_steps(df["time"]):
        raise HTTPException(400, "The period is shorter than a day")
    step_h = (csv_data.step_seconds(df["time"]) or 3600) / 3600
    obs = df[body.column].to_numpy(float)[start : start + steps]
    ivs = [iv.model_dump() for iv in body.interventions]
    recipe = prepare.read_recipe(meta.storage.recipe_file(meta.id))["prepared"]  # what the inputs are made from
    runs = []
    for name in body.models:
        run: dict = {"model": name}
        try:
            if name == rolling.FOUNDATION:
                if not foundation.available():
                    raise ValueError("not installed (uv sync, group foundation)")
                go = lambda ivs_: rolling.pretrained(df, body.column, start, steps, body.mode, ivs_)  # noqa: E731
                seen = [iv["variable"] for iv in ivs if iv["variable"] != rolling.OUT_T]
                if seen:
                    run["note"] = f"sees only {rolling.OUT_T} and the calendar, not {', '.join(sorted(set(seen)))}"
            else:
                m = load_model(meta, name)
                go = lambda ivs_, m=m: rolling.trained(df, m, body.column, start, steps, body.mode, ivs_, recipe)  # noqa: E731
            base = go([])
            run |= {"base": np.round(base, 3).tolist(), "scores": rolling.scores(base, obs, step_h)}
            if ivs:
                moved = go(ivs)
                run["intervened"] = np.round(moved, 3).tolist()
                b, w = float(np.nansum(base)), float(np.nansum(moved))
                run["change_pct"] = (w / b - 1) * 100 if b else None
        except (ValueError, HTTPException) as exc:
            run["error"] = exc.detail if isinstance(exc, HTTPException) else str(exc)
        runs.append(run)
    window = df.iloc[start : start + steps]
    return {
        "column": body.column,
        "mode": body.mode,
        "start": start,
        "steps": steps,
        "time": times(window["time"]),
        "measured": values(window[body.column]),
        "measured_mwh": float(np.nansum(obs) * step_h / 1000),
        "runs": runs,
    }
