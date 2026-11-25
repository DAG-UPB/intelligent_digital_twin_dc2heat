"""Datasets: the list (with dataset.json), their time series, their P&ID image, and a re-scan."""

import json

from fastapi import APIRouter, HTTPException, Request

from ..core import dataset_files as files
from ..core.summary import summarize
from ..deps import Dataset, Registry, Structure, dataframe, dataset_config, png_file, times, values
from ..schemas import DatasetInfo, DatasetsResponse, KpiMapping, TimeRange, VariableNames

router = APIRouter(prefix="/api/datasets", tags=["datasets"])

# Dashboard summaries, one per data file, recomputed when the parquet file, dataset.json or site.json changes (mtimes)
_summaries: dict[tuple[str, str], tuple[tuple[float, ...], dict]] = {}


def _listed_config(meta) -> dict:
    """Its dataset.json for the list; {} for a broken one, so the others are still listed (its own routes name it)."""
    try:
        return dataset_config(meta)
    except files.BrokenFile:
        return {}


@router.get("", response_model=DatasetsResponse, summary="List datasets")
def list_datasets(registry: Registry):
    """Every dataset with its schema and its dataset.json (display name, kind, levers, ...)."""
    return DatasetsResponse(
        datasets=[
            DatasetInfo(
                id=meta.id,
                name=meta.name,
                files=meta.files,
                columns=meta.columns,
                time_range=TimeRange(start=meta.time_range[0], end=meta.time_range[1]),
                row_count=meta.row_count,
                resolution_seconds=meta.resolution_seconds,
                config=_listed_config(meta),
            )
            for meta in registry.datasets.values()
        ]
    )


@router.post("/refresh", summary="Re-scan the data directory")
def refresh_datasets(registry: Registry):
    """Re-scan the data directory and update the dataset registry."""
    registry.discover()
    return {"status": "ok", "datasets": len(registry.datasets)}


@router.get("/{dataset_id}/pid.png", summary="Get the P&ID image")
def pid_image(meta: Structure, request: Request):
    """The data center's P&ID drawing, if it has one. Never reused unasked from the browser's cache: a new drawing
    (another area of the sheet) keeps the name, and a stale picture would sit shifted under the new construct."""
    return png_file(meta.directory / files.PID_IMAGE, request, "No P&ID image for this data center")


@router.get("/{dataset_id}/data", summary="Get time series")
def get_data(meta: Dataset, registry: Registry, file: str | None = None, columns: str | None = None):
    """Time series of some columns (default: all) of one data file (default: the first)."""
    _, df = dataframe(registry, meta, file)
    cols = [c.strip() for c in columns.split(",")] if columns else meta.columns
    bad = [c for c in cols if c not in df.columns]
    if bad:
        raise HTTPException(400, f"Unknown columns: {bad}")
    return {"time": times(df["time"]), "columns": {c: values(df[c]) for c in cols}, "count": len(df)}


@router.get("/{dataset_id}/summary", summary="Summarize a data file")
def get_summary(meta: Dataset, registry: Registry, file: str | None = None):
    """The Dashboard of one data file (default: the first): rows, time span, completeness, gaps, statistics
    and histogram per variable, Pearson correlations, every variable downsampled to <= 600 points, and the
    data-center KPIs the columns support (dataset.json "kpi", or the simulations' column names; the reused heat of
    the heat_source point site.json hex_option picks)."""
    file, df = dataframe(registry, meta, file)
    config_path, site_path = meta.directory / files.DATASET_CONFIG, meta.file(files.SITE)
    recipe_path = meta.storage.recipe_file(meta.id)
    paths = (meta.data_file(file), meta.storage.prepared_file(meta.id, file), config_path, recipe_path, site_path)
    mtimes = tuple(p.stat().st_mtime if p.exists() else 0.0 for p in paths)
    key = (str(meta.directory), file)
    if key not in _summaries or _summaries[key][0] != mtimes:
        try:
            hex_option = files.read_json(site_path).get("hex_option")
            _summaries[key] = (mtimes, {"file": file, **summarize(df, dataset_config(meta), hex_option=hex_option)})
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    return _summaries[key][1]


@router.put("/{dataset_id}/names", summary="Give variables the names shown")
def set_variable_names(meta: Dataset, body: VariableNames):
    """Names shown for variables in place of their own (one or many at once): {variable: name}, "" gives a variable
    its own name back. Saved as dataset.json "names" (in silver): the data, the graph files and the models keep the
    variables' own names, so nothing that refers to them changes. A name shown must be unique, and not another
    variable's own name. Answers all names now set."""
    known = {*meta.columns, *(dataset_config(meta).get("derived") or {})}
    unknown = [v for v in body.names if v not in known]
    if unknown:
        raise HTTPException(422, f"Not variables of this data center: {', '.join(unknown[:20])}")
    path = meta.directory / files.DATASET_CONFIG
    config = files.read_json(path)
    names = {**(config.get("names") or {}), **{v: n.strip() for v, n in body.names.items()}}
    names = {v: n for v, n in names.items() if n and n != v}
    long = [n for n in names.values() if len(n) > 80]
    if long:
        raise HTTPException(422, f"A name shown has at most 80 characters: {long[0][:40]}…")
    shown = list(names.values())
    twice = sorted({n for n in shown if shown.count(n) > 1})
    if twice:
        raise HTTPException(422, f"Each name shown once: {', '.join(twice[:10])} would be shown for several variables")
    taken = sorted({n for v, n in names.items() if n in known and n != v})
    if taken:
        raise HTTPException(422, f"Already the own name of another variable: {', '.join(taken[:10])}")
    if names:
        config["names"] = dict(sorted(names.items()))
    else:
        config.pop("names", None)
    files.write_atomic(path, json.dumps(config, indent=2))
    return {"names": config.get("names", {})}


@router.put("/{dataset_id}/kpi", response_model=KpiMapping, summary="Choose the variables of the KPIs")
def set_kpi(meta: Dataset, body: KpiMapping):
    """Say which variables are the IT power, the cooling power, the facility's other electricity (UPS and
    distribution losses, lighting, building, summed: with it and the cooling PUE is the full one; not the IT, cooling
    or reused heat again), the reused heat and the heat demand, and their unit, when the data does not name them:
    saved as dataset.json "kpi" (in silver, never the delivered data), so the Dashboard shows PUE, ERF, ERE and the
    energies. An empty mapping removes it (back to the default names)."""
    known = {*meta.columns, *(dataset_config(meta).get("derived") or {})}  # a calculated heat (Q) counts too
    other = list(dict.fromkeys([body.other_power] if isinstance(body.other_power, str) else body.other_power or []))
    named = [body.it_power, body.cooling_power, body.heat_demand, *other, *body.heat_power, *(body.reuse or {}).values()]
    unknown = [c for c in named if c and c not in known]
    if unknown:
        raise HTTPException(422, f"Not variables of this data center: {', '.join(unknown)}")
    twice = [c for c in other if c in {body.it_power, body.cooling_power, *body.heat_power, *(body.reuse or {}).values()}]
    if twice:
        raise HTTPException(422, f"A variable counts once: {', '.join(twice)} is already the IT, cooling or reused heat")
    if body.heat_power and not body.it_power:
        raise HTTPException(422, "Choose the IT power first: every KPI is relative to it")
    path = meta.directory / files.DATASET_CONFIG
    config = files.read_json(path)
    mapping = body.model_dump(exclude_none=True, exclude_defaults=True)
    if other:
        mapping["other_power"] = other  # always a list in dataset.json
    else:
        mapping.pop("other_power", None)  # an empty list is no mapping (else it would hide the default names)
    if mapping:
        config["kpi"] = mapping
    else:
        config.pop("kpi", None)
    files.write_atomic(path, json.dumps(config, indent=2))
    return body
