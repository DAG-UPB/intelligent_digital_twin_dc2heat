"""A new data center from a folder of the user's: its data files, its P&ID, its settings, into the data version open.

The folder is read, never changed. What it holds (top level and one folder down):

    *.parquet / *.csv          the data: one file per resolution or period; a CSV becomes parquet, and the time
                               column (time, timestamp, datetime, date, or the first column that reads as dates)
                               is called "time"
    *.pdf / *.svg / *.xml      the P&ID (a DEXPI .xml first, then SVG, then PDF): read like "Import P&ID"
    dataset.json               its settings (name, kind, kpi, ...), if it has them
    causal_graph*.json         its causal graphs

The data files go where delivered data lives (bronze in a bronze / silver version: added, never an existing file
changed), dataset.json and the graphs to the data center's own folder (silver). Without a graph it gets
causal_graph.json with every numeric variable and no links, so Physical structure shows them, ready to place.
An existing data center is never overwritten.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import pandas as pd

from . import dataset_files as files
from .csv_data import read_csv_data, with_time
from .storage import Storage

DC_ID = re.compile(r"[a-z][a-z0-9_]{0,47}")
DRAWINGS = (".xml", ".svg", ".pdf")  # the order a P&ID is preferred in: DEXPI is read exactly
KINDS = ("real", "simulation", "testbed")
MAX_FILES = 50


def _files(folder: Path) -> list[Path]:
    """The files of the folder and of its sub-folders (one level), hidden ones left out, sorted."""
    found = [p for p in folder.iterdir() if p.is_file()]
    for sub in sorted(d for d in folder.iterdir() if d.is_dir() and not d.name.startswith(".")):
        found += [p for p in sub.iterdir() if p.is_file()]
    return sorted((p for p in found if not p.name.startswith(".")), key=lambda p: (len(p.relative_to(folder).parts), str(p)))


def _is_dexpi(path: Path) -> bool:
    with path.open("rb") as f:
        return b"<PlantModel" in f.read(4096)


def id_from(name: str) -> str:
    """A data-center id from a folder name: "DC 3 (Hall B)" -> "dc_3_hall_b"."""
    clean = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return (clean if clean[:1].isalpha() else f"dc_{clean}")[:48] or "dc"


def scan(folder: Path) -> dict:
    """What the folder would bring: {id, name, kind, data: [names], drawing: name | None, graphs, settings}.
    Names relative to the folder only; nothing is read but a DEXPI file's first bytes."""
    if not folder.is_dir():
        raise ValueError(f"Not a folder: {folder}")
    all_files = _files(folder)
    data = [p for p in all_files if p.suffix.lower() in (".parquet", ".csv")]
    drawings = sorted(
        (p for p in all_files if p.suffix.lower() in DRAWINGS and (p.suffix.lower() != ".xml" or _is_dexpi(p))),
        key=lambda p: DRAWINGS.index(p.suffix.lower()),
    )
    settings = next((p for p in all_files if p.name == files.DATASET_CONFIG), None)
    config = files.read_json(settings) if settings else {}
    rel = lambda p: p.relative_to(folder).as_posix()  # noqa: E731
    return {
        "id": id_from(folder.name),
        "name": str(config.get("name") or folder.name),
        "kind": config.get("kind") if config.get("kind") in KINDS else "real",
        "data": [rel(p) for p in data[:MAX_FILES]],
        "drawing": rel(drawings[0]) if drawings else None,
        "graphs": [rel(p) for p in all_files if p.suffix == ".json" and p.name.startswith("causal_graph")],
        "settings": rel(settings) if settings else None,
    }


def _read(path: Path) -> pd.DataFrame:
    if path.suffix.lower() == ".csv":
        return read_csv_data(path)  # , or ; and German numbers and dates, as a delivered CSV is read
    return with_time(pd.read_parquet(path), path.name)


def import_folder(folder: Path, storage: Storage, dc: str, name: str, kind: str) -> dict:
    """Bring the folder in as data center `dc` (see the module doc). Returns {id, data, variables, graphs,
    drawing: the P&ID file's path or None}. ValueError when the id is taken or the data is not readable; then
    nothing is left behind."""
    if not DC_ID.fullmatch(dc):
        raise ValueError("The id is lower-case letters, digits and _, starting with a letter (up to 48)")
    if kind not in KINDS:
        raise ValueError(f"kind is one of {', '.join(KINDS)}")
    found = scan(folder)
    if not found["data"]:
        raise ValueError("No data files (.parquet or .csv) in this folder or its sub-folders")
    data_dir, own_dir = storage.data_dir(dc), storage.dataset_dir(dc)
    if dc in storage.dataset_ids() or data_dir.exists() or own_dir.exists():
        raise ValueError(f"There already is a data center {dc!r} in this data version: choose another id")

    frames = {}
    for rel in found["data"]:  # read everything first: a bad file stops the import before anything is written
        stem = id_from(Path(rel).stem)
        while stem in frames:
            stem += "_2"
        frames[stem] = _read(folder / rel)
    try:
        data_dir.mkdir(parents=True)
        own_dir.mkdir(parents=True, exist_ok=True)
        for stem, df in frames.items():
            files.write_atomic(data_dir / f"{stem}.parquet", df.to_parquet(index=False))
        config = files.read_json(folder / found["settings"]) if found["settings"] else {}
        config = {k: v for k, v in config.items() if k != "pid_image"}  # the P&ID is read again below
        files.write_atomic(own_dir / files.DATASET_CONFIG, json.dumps({**config, "name": name, "kind": kind}, indent=2))
        for rel in found["graphs"]:
            shutil.copy2(folder / rel, own_dir / Path(rel).name)
        first = next(iter(frames.values()))
        variables = [c for c in first.columns if c != "time" and pd.api.types.is_numeric_dtype(first[c])]
        if not found["graphs"]:
            files.write_graph(own_dir / files.CAUSAL_GRAPH, {v: [] for v in variables})
    except Exception:
        shutil.rmtree(data_dir, ignore_errors=True)
        if own_dir != data_dir:
            shutil.rmtree(own_dir, ignore_errors=True)
        raise
    return {
        "id": dc,
        "data": [f"{s}.parquet" for s in frames],
        "variables": len(variables),
        "graphs": [Path(g).name for g in found["graphs"]] or [files.CAUSAL_GRAPH],
        "drawing": str(folder / found["drawing"]) if found["drawing"] else None,
    }
