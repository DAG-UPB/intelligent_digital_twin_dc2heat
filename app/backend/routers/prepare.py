"""What the user makes from a data center's data, kept in its silver (core/storage.py), never in the delivered files:
prepared variables (core/prepare.py: preview, add, remove) and aggregated data files (core/resample.py: add, remove).
The recipe of both is the silver's recipe.json. Each answer says exactly which files were written.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException

from ..core import csv_data, prepare, resample
from ..core.dataset_files import write_atomic
from ..core.registry import DatasetMeta, load_parquet
from ..core.summary import MAX_POINTS, TIME_FORMAT, histogram
from ..deps import Dataset, Registry
from ..schemas import PreparedChange, PreparedPreview, PreparedStep, ResampleRequest, WindowRequest

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


def _recipe(meta: DatasetMeta) -> dict:
    return prepare.read_recipe(meta.storage.recipe_file(meta.id))


def _rel(meta: DatasetMeta, path) -> str:
    return path.relative_to(meta.storage.version_root).as_posix()


def _save_recipe(meta: DatasetMeta, recipe: dict) -> str:
    path = meta.storage.recipe_file(meta.id)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_atomic(path, json.dumps(recipe, indent=2, ensure_ascii=False))
    return _rel(meta, path)


def _raw_columns(meta: DatasetMeta, steps: list[dict]) -> list[str]:
    made = {s["name"] for s in steps}
    return [c for c in meta.columns if c not in made]


def _checked(meta: DatasetMeta, step: PreparedStep, steps: list[dict]) -> dict:
    """The step against the data and the recipe so far (it may use the variables prepared before it)."""
    usable = _raw_columns(meta, steps) + [s["name"] for s in steps]
    try:
        return prepare.check(step.model_dump(), usable, usable)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _write_prepared(meta: DatasetMeta, steps: list[dict], stems: list[str]) -> list[str]:
    """Recompute the prepared variables of the given data files (core/prepare.py write_prepared); the files written."""
    return prepare.write_prepared(
        meta.storage, meta.id, steps, stems, lambda stem: _raw(meta, stem), lambda stem: _too_big(meta, stem)
    )


def _too_big(meta: DatasetMeta, stem: str) -> Path | None:
    """The delivered CSV of a data file when it is too big to load (core/csv_data.py), else None."""
    path = meta.data_file(stem)
    return path if path.suffix.lower() == ".csv" and path.stat().st_size > csv_data.CSV_LOAD_MAX_BYTES else None


def _resampled(meta: DatasetMeta, source: str, body: ResampleRequest):
    """The aggregated file: from the loaded data file, or a too-big CSV read in chunks (only the kept variables)."""
    big = _too_big(meta, source)
    if big is None:
        return resample.resample(_raw(meta, source), body.step, body.methods, body.default)
    columns = csv_data.csv_meta(big)["columns"]
    kept = [c for c in columns if body.methods.get(c, body.default) != "drop"]
    return resample.resample_chunks(csv_data.chunks(big, kept), columns, body.step, body.methods, body.default)


def _raw(meta: DatasetMeta, stem: str):
    """One delivered data file as read (no prepared columns); 422 for a CSV too big to load here."""
    try:
        return load_parquet(meta.data_file(stem))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/{dataset_id}/prepared/preview", response_model=PreparedPreview, summary="Preview a prepared variable")
def preview_prepared(meta: Dataset, step: PreparedStep, file: str | None = None):
    """The variable a step would make, over one data file (default: the first): statistics, a downsampled series
    and a histogram. Nothing is saved."""
    steps = _recipe(meta)["prepared"]
    checked = _checked(meta, step, steps)
    stem = file or meta.files[0]
    if stem not in meta.files:
        raise HTTPException(404, f"File '{stem}' not found")
    raw = _raw(meta, stem)
    try:
        col = prepare.compute_step(checked, raw.join(prepare.compute(raw, steps)))
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, str(exc)) from exc
    values = col.to_numpy(dtype=float)
    finite = values[np.isfinite(values)]
    idx = np.arange(len(values)) * min(len(values), MAX_POINTS) // max(len(values), 1)
    counts, edges = histogram(finite)
    return PreparedPreview(
        name=checked["name"],
        inputs=checked["inputs"],
        count=int(len(finite)),
        missing=int(len(values) - len(finite)),
        mean=float(finite.mean()) if len(finite) else None,
        std=float(finite.std()) if len(finite) else None,
        min=float(finite.min()) if len(finite) else None,
        max=float(finite.max()) if len(finite) else None,
        time=raw["time"].groupby(idx).first().dt.strftime(TIME_FORMAT).tolist() if "time" in raw else [],
        values=col.groupby(idx).mean().tolist(),
        histogram={"edges": edges.tolist(), "counts": counts.tolist()},
    )


@router.post("/{dataset_id}/prepared", response_model=PreparedChange, summary="Add a prepared variable")
def add_prepared(meta: Dataset, step: PreparedStep, registry: Registry):
    """Add the step to the recipe and write the new variable for every data file, in silver (the delivered data stays
    as it is). It is then a variable like the others: in the graph, the equations, the P&ID and the models."""
    recipe = _recipe(meta)
    checked = _checked(meta, step, recipe["prepared"])
    recipe["prepared"].append(checked)
    try:
        written = _write_prepared(meta, recipe["prepared"], meta.files)
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, str(exc)) from exc
    written.append(_save_recipe(meta, recipe))
    registry.discover()
    return PreparedChange(
        did=f"added {checked['name']} ({prepare.describe(checked['op'])} {', '.join(checked['inputs'])})".rstrip(),
        step=PreparedStep(**checked),
        recipe=[PreparedStep(**s) for s in recipe["prepared"]],
        files=written,
    )


@router.delete("/{dataset_id}/prepared/{prepared}", response_model=PreparedChange, summary="Remove a prepared variable")
def remove_prepared(meta: Dataset, prepared: str, registry: Registry):
    """Remove a prepared variable (not one other prepared variables are made from: remove those first)."""
    recipe = _recipe(meta)
    steps = recipe["prepared"]
    if prepared not in {s["name"] for s in steps}:
        raise HTTPException(404, f"No prepared variable '{prepared}'")
    users = prepare.dependents(steps, prepared)
    if users:
        raise HTTPException(
            400, f"{', '.join(users)} {'is' if len(users) == 1 else 'are'} made from {prepared}: remove them first"
        )
    recipe["prepared"] = [s for s in steps if s["name"] != prepared]
    try:
        written = _write_prepared(meta, recipe["prepared"], meta.files)
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, str(exc)) from exc
    written.append(_save_recipe(meta, recipe))
    registry.discover()
    return PreparedChange(
        did=f"removed {prepared}", step=None, recipe=[PreparedStep(**s) for s in recipe["prepared"]], files=written
    )


@router.post("/{dataset_id}/resampled", response_model=PreparedChange, summary="Aggregate a data file")
def add_resampled(meta: Dataset, body: ResampleRequest, registry: Registry):
    """Bring a delivered data file to a coarser time step, each variable by its method (mean, median, sum, min, max,
    last, or drop), as a new data file in silver; the prepared variables are made on it too. The delivered file is
    never changed. A file of the same name is replaced."""
    recipe = _recipe(meta)
    made = {r["name"] for r in recipe["resampled"]}
    source = body.source or next((f for f in meta.files if f not in made), meta.files[0])  # the first delivered
    if source not in meta.files or source in made:
        raise HTTPException(404, f"No delivered data file '{source}' (aggregate a delivered file, not an aggregated one)")
    name = body.name or f"{source}__{body.step}"
    if not resample.NAME.fullmatch(name) or (name in meta.files and name not in made):
        raise HTTPException(400, f"Invalid or taken file name '{name}': letters, digits, _ and -")
    try:
        out = _resampled(meta, source, body)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    path = meta.storage.resampled_file(meta.id, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_atomic(path, out.to_parquet(index=False))
    entry = {"name": name, "source": source, "step": body.step, "default": body.default, "methods": body.methods}
    recipe["resampled"] = [r for r in recipe["resampled"] if r["name"] != name] + [entry]
    written, note = [_rel(meta, path)], ""
    if recipe["prepared"]:  # the prepared variables of the new file
        try:
            written += _write_prepared(meta, recipe["prepared"], [name])
        except (ValueError, KeyError) as exc:  # e.g. a step needs a variable the aggregated file left out
            note = f"; its prepared variables could not be made ({exc})"
    written.append(_save_recipe(meta, recipe))
    registry.discover()
    return PreparedChange(
        did=f"aggregated {source} to one row every {body.step} as {name} ({len(out)} rows, {len(out.columns) - 1} "
        f"variables){note}",
        step=None,
        recipe=[PreparedStep(**s) for s in recipe["prepared"]],
        files=written,
    )


def _time(text: str) -> pd.Timestamp:
    """A window bound as the data's times are (core/resample.py time_bound), else 400."""
    try:
        return resample.time_bound(text)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@router.post("/{dataset_id}/window", response_model=PreparedChange, summary="Keep a time window of a data file")
def add_window(meta: Dataset, body: WindowRequest, registry: Registry):
    """The rows of one period (a day, a week) of a delivered data file, with all or some of its variables, as a new
    data file in silver: the way to look at a file too big to load (a big CSV is read in chunks, never whole). The
    delivered file is never changed; the prepared variables are made on it too. A file of the same name is replaced."""
    recipe = _recipe(meta)
    made = {r["name"] for r in recipe["resampled"]}
    source = body.source or next((f for f in meta.files if f not in made), meta.files[0])  # the first delivered
    if source not in meta.files or source in made:
        raise HTTPException(404, f"No delivered data file '{source}'")
    start, end = _time(body.start), _time(body.end)
    if start >= end:
        raise HTTPException(400, f"The window's start ({start}) must be before its end ({end})")
    name = body.name or f"{source}__{start:%Y%m%d}-{end:%Y%m%d}"
    if not resample.NAME.fullmatch(name) or (name in meta.files and name not in made):
        raise HTTPException(400, f"Invalid or taken file name '{name}': letters, digits, _ and -")
    try:
        big = _too_big(meta, source)
        if big is not None:
            out = csv_data.window(big, start, end, body.columns or None)
        else:
            out = resample.window(_raw(meta, source), start, end, body.columns or None)
    except KeyError as exc:
        raise HTTPException(400, f"Not a variable of {source}: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    path = meta.storage.resampled_file(meta.id, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_atomic(path, out.reset_index(drop=True).to_parquet(index=False))
    entry = {"name": name, "source": source, "step": "window", "start": str(start), "end": str(end), "columns": body.columns}
    recipe["resampled"] = [r for r in recipe["resampled"] if r["name"] != name] + [entry]
    written, note = [_rel(meta, path)], ""
    if recipe["prepared"]:
        try:
            written += _write_prepared(meta, recipe["prepared"], [name])
        except (ValueError, KeyError) as exc:
            note = f"; its prepared variables could not be made ({exc})"
    written.append(_save_recipe(meta, recipe))
    registry.discover()
    return PreparedChange(
        did=f"kept {source} from {start} to {end} as {name} ({len(out)} rows, {len(out.columns) - 1} variables){note}",
        step=None,
        recipe=[PreparedStep(**s) for s in recipe["prepared"]],
        files=written,
    )


@router.delete("/{dataset_id}/resampled/{resampled}", response_model=PreparedChange, summary="Remove an aggregated data file")
def remove_resampled(meta: Dataset, resampled: str, registry: Registry):
    """Remove an aggregated data file and its prepared variables."""
    recipe = _recipe(meta)
    if resampled not in {r["name"] for r in recipe["resampled"]}:
        raise HTTPException(404, f"No aggregated data file '{resampled}'")
    written = []
    for path in (meta.storage.resampled_file(meta.id, resampled), meta.storage.prepared_file(meta.id, resampled)):
        if path.exists():
            path.unlink()
            written.append(f"{_rel(meta, path)} (removed)")
    recipe["resampled"] = [r for r in recipe["resampled"] if r["name"] != resampled]
    written.append(_save_recipe(meta, recipe))
    registry.discover()
    return PreparedChange(
        did=f"removed the aggregated file {resampled}",
        step=None,
        recipe=[PreparedStep(**s) for s in recipe["prepared"]],
        files=written,
    )
