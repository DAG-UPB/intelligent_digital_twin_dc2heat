"""Components (core/components.py): the presets and the user's saved components; check, run and fit one.

Saved components are <data folder>/_components/<id>.json (heat_distribution_data/components/ from version_2 on,
core/storage.py): local only (git-ignored like all of app/data but sim_*), as a
fitted component carries numbers learned from the user's data. A fit's CSV is read in memory and never stored.
"""

import csv
import io
from pathlib import Path
from typing import Annotated

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi import Path as PathParam

from ..core import components as core
from ..core.component_library import PRESET_IDS, PRESETS
from ..core.dataset_files import write_atomic
from ..core.limits import COMPONENT_FIT_MAX_ROWS
from ..deps import Registry
from ..schemas import COMPONENT_ID, Component, ComponentFitRequest, ComponentSimulateRequest, ComponentsResponse

router = APIRouter(prefix="/api/components", tags=["components"])

ComponentId = Annotated[str, PathParam(pattern=COMPONENT_ID, description="Preset or saved component id")]


def _folder(registry: Registry) -> Path:
    return registry.storage.components_dir


def _saved(registry: Registry) -> list[Component]:
    """The user's components; a file that is not one is skipped."""
    out = []
    for path in sorted(_folder(registry).glob("*.json")):
        try:
            c = Component.model_validate_json(path.read_text(encoding="utf-8"))
        except ValueError:
            continue
        out.append(c.model_copy(update={"id": path.stem, "preset": False}))
    return out


def _presets() -> list[Component]:
    return [Component.model_validate({**p, "preset": True}) for p in PRESETS]


def _dump(c: Component) -> dict:
    return c.model_dump(exclude={"preset"})


@router.get("", response_model=ComponentsResponse, summary="List the components")
def list_components(registry: Registry):
    """The built-in presets (preset = true), then the user's saved components."""
    return {"components": _presets() + _saved(registry)}


@router.get("/{component_id}", response_model=Component, summary="Get a component")
def get_component(component_id: ComponentId, registry: Registry):
    """A preset or a saved component; 404 if there is none with this id."""
    for c in _presets() + _saved(registry):
        if c.id == component_id:
            return c
    raise HTTPException(404, f"Component '{component_id}' not found")


@router.put("/{component_id}", response_model=Component, summary="Save a component")
def save_component(component_id: ComponentId, component: Component, registry: Registry):
    """Check and save as the user's component `component_id` (400: a preset id or a component that does not check)."""
    if component_id in PRESET_IDS:
        raise HTTPException(400, f"'{component_id}' is a preset: save under another id")
    component = component.model_copy(update={"id": component_id, "preset": False})
    try:
        core.compile_component(_dump(component))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    _folder(registry).mkdir(parents=True, exist_ok=True)
    write_atomic(_folder(registry) / f"{component_id}.json", component.model_dump_json(indent=2, exclude={"preset"}))
    return component


@router.delete("/{component_id}", summary="Delete a component")
def delete_component(component_id: ComponentId, registry: Registry):
    """Delete the user's component (400 for a preset, 404 if there is none)."""
    if component_id in PRESET_IDS:
        raise HTTPException(400, f"'{component_id}' is a preset and cannot be deleted")
    path = _folder(registry) / f"{component_id}.json"
    if not any(c.id == component_id for c in _saved(registry)):
        raise HTTPException(404, f"Component '{component_id}' not found")
    path.unlink()
    return {"deleted": component_id}


@router.post("/check", summary="Check a component")
def check_component(component: Component):
    """Parse every equation: per-node result, names that are not parameters yet (`missing`), the causal links, the order."""
    return core.check(_dump(component))


@router.post("/simulate", summary="Run a component")
def simulate_component(req: ComponentSimulateRequest):
    """The component's inputs and nodes over the steps (nothing is saved). 400 when it does not check or the inputs do not fit."""
    try:
        return {"series": core.simulate(_dump(req.component), req.inputs, req.steps, req.outputs)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/fit", summary="Fit a component to data")
def fit_component(req: ComponentFitRequest):
    """Learn the non-fixed parameters from the CSV's mapped columns; R² and nMAE per mapped node. Nothing is saved."""
    import pandas as pd

    try:
        df = pd.read_csv(io.StringIO(req.csv), sep=None, engine="python", nrows=COMPONENT_FIT_MAX_ROWS + 1)
    except (ValueError, pd.errors.ParserError, csv.Error) as exc:  # csv.Error: the sniffer found no delimiter
        raise HTTPException(400, f"Not a readable CSV: {exc}") from exc
    if len(df) > COMPONENT_FIT_MAX_ROWS:
        raise HTTPException(400, f"At most {COMPONENT_FIT_MAX_ROWS} rows")
    if missing := sorted(set(req.mapping.values()) - set(df.columns)):
        raise HTTPException(400, f"Not columns of the CSV: {', '.join(missing)}")
    data = {name: pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=float) for name, col in req.mapping.items()}
    if not data or not any(np.isfinite(a).any() for a in data.values()):
        raise HTTPException(400, "Map at least one column with numbers")
    try:
        return core.fit(_dump(req.component), data)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
