"""FastAPI dependencies and HTTP helpers shared by the routers.

The registry lives on ``app.state.registry`` (see backend/app.py). Every dataset-scoped route
takes ``meta: Dataset``, which answers 404 "Dataset '<id>' not found" for an unknown id.
"""

from dataclasses import replace
from pathlib import Path
from typing import Annotated, Literal

import pandas as pd
from fastapi import Depends, HTTPException, Query, Request

from .core import dataset_files as files
from .core.derived import derived_of
from .core.prepare import read_recipe
from .core.registry import DatasetMeta, DatasetRegistry
from .core.summary import TIME_FORMAT


def dataset_config(meta: DatasetMeta) -> dict:
    """dataset.json with the recipe of what was made from the data (silver recipe.json: prepared, resampled; only
    the parts that hold something, so a data center nothing was made from reads as its dataset.json)."""
    made = {k: v for k, v in read_recipe(meta.storage.recipe_file(meta.id)).items() if v}
    return {**files.read_json(meta.own_directory / files.DATASET_CONFIG), **made}


def derived_columns(meta: DatasetMeta) -> dict[str, dict]:
    """The dataset's calculated columns (dataset.json "derived"): never modelled, computed from their parts."""
    return derived_of(files.read_json(meta.own_directory / files.DATASET_CONFIG))


def get_registry(request: Request) -> DatasetRegistry:
    """The app's dataset registry."""
    return request.app.state.registry


def get_dataset(dataset_id: str, request: Request) -> DatasetMeta:
    """The dataset of the path, or 404."""
    meta = get_registry(request).datasets.get(dataset_id)
    if meta is None:
        raise HTTPException(404, f"Dataset '{dataset_id}' not found")
    return meta


Registry = Annotated[DatasetRegistry, Depends(get_registry)]
Dataset = Annotated[DatasetMeta, Depends(get_dataset)]

STRUCTURES = {"heat": "heat_structure", "district": "district_structure"}  # besides the data center's own: folder in silver


def get_structure(
    meta: Dataset,
    request: Request,
    scope: Literal["dc", "heat", "district"] = Query(
        default="dc", description="Whose structure: the data center's (dc), the heat distribution's (heat) or the district's"
    ),
) -> DatasetMeta:
    """The data center (scope dc), or another structure of it (the heat distribution's, the district's): its P&ID,
    graph files and layout (site.json) in a folder of its own in silver, made on the first write."""
    if scope == "dc":
        return meta
    folder = meta.storage.work_dir(meta.id) / STRUCTURES[scope]
    if request.method != "GET":
        folder.mkdir(parents=True, exist_ok=True)
    return replace(meta, directory=folder, scope_dir=folder, home=meta.directory)


Structure = Annotated[DatasetMeta, Depends(get_structure)]


def dataframe(registry: DatasetRegistry, meta: DatasetMeta, file: str | None) -> tuple[str, pd.DataFrame]:
    """(file id, data) of one of the dataset's data files (default: the first), or 404; 422 for a delivered CSV
    too big to load (core/csv_data.py) or a file without a "time" column (every page and model reads its times)."""
    file = file or meta.files[0]
    try:
        df = registry.get_dataframe(meta.id, file)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if "time" not in df.columns:
        raise HTTPException(422, f"The data file {file} has no 'time' column")
    return file, df


async def read_body(request: Request, limit: int, shown: int | None = None) -> bytes:
    """A raw upload, or 413 above `limit` bytes (`shown`: the limit the message names, if another): refused by its
    Content-Length before it is read, and, without one, as soon as the bytes that arrived pass the limit (not after
    the whole body sits in memory)."""
    too_big = HTTPException(413, f"File too large (limit {(shown or limit) // 2**20} MB)")
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > limit:
        raise too_big
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise too_big
        chunks.append(chunk)
    return b"".join(chunks)


def times(series: pd.Series) -> list[str]:
    """Timestamps as the frontend reads them (ISO, seconds, no zone)."""
    return series.dt.strftime(TIME_FORMAT).tolist()


def values(series: pd.Series) -> list:
    """A column as a JSON-safe list: gaps (NaN) become null."""
    return series.astype(object).where(series.notna(), None).tolist() if series.isna().any() else series.tolist()


def png_file(path: Path, request: Request, missing: str):
    """A PNG of a data folder, never reused unasked from the browser's cache (a new picture keeps the name, and a
    stale one would sit shifted under what was placed on the new one); 304 when the browser has this one; 404."""
    from fastapi.responses import FileResponse, Response

    if not path.exists():
        raise HTTPException(404, missing)
    st = path.stat()
    tag = f'"{st.st_mtime_ns:x}-{st.st_size:x}"'
    headers = {"Cache-Control": "no-cache", "ETag": tag}
    if request.headers.get("if-none-match") == tag:  # the browser's copy is this picture: nothing to send
        return Response(status_code=304, headers=headers)
    return FileResponse(path, media_type="image/png", headers=headers)


def graph_path(meta: DatasetMeta, name: str) -> Path:
    """An existing graph file of the dataset: 400 for an invalid name, 404 if it does not exist."""
    try:
        name = files.graph_name(name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not (meta.directory / name).exists():
        raise HTTPException(404, f"Graph file '{name}' not found")
    return meta.directory / name


def read_graph(path: Path) -> tuple[files.Graph, list[dict]]:
    """A graph file, or 422 if it is not one."""
    try:
        return files.read_graph(path)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def model_file(meta: DatasetMeta, name: str) -> Path:
    """The dataset's models/<name>.json, or 400 for an invalid name."""
    try:
        return files.model_file(meta.file(files.MODELS_DIR), name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
