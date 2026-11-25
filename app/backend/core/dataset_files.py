"""The layout of a dataset folder, and reading/writing the files in it.

A dataset is a folder under app/data/ with at least one parquet file::

    <id>/
      *.parquet                    the data (the stem is the file id; a "time" column)
      causal_graph.json            the default causal graph
      causal_graph_<variant>.json  other graphs (manual, pcmci, pc, ...)
      graph_manual.json            legacy name of causal_graph.json (renamed at discovery)
      dataset.json                 display name, kind, actuators, heat variables, levers, pid_image
      site.json                    map, heat sinks, P&ID layout (routers/site.py)
      streets.json                 the Site map's streets for the heat network's pipes (OpenStreetMap; examples)
      equations.json               physics equations {variable: right-hand side}
      models/<name>.json           a trained model; models/<name>.boosters/<var>.json|.npz
      models/evaluation.json       the last evaluation asked for, while its models are unchanged (not a model)
      pid.png, pid_plant.json      the P&ID drawing and its plant graph
      pid_construct.json           the drawing as editable shapes (pid/construct.py)
      weather_open_meteo.json      cached Open-Meteo temperatures (core/weather.py; derived, git-ignored)
      .backup/<time>/              files replaced by opening a project

This is the flat layout; from version_2 on, models, site and weather live in their own folders of the data folder
(core/storage.py). Code asks `DatasetMeta.file(name)` for a file's place instead of joining paths.

Graph files hold ``{"targets": {target: [[parent, lag], ...]}, "link_strengths": [...]}`` with
negative lags (-1 = one step back, 0 = same step). The legacy shape ``{target: [[parent, lag]]}``
is still read.
"""

import json
import os
import re
import uuid
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path

CAUSAL_GRAPH = "causal_graph.json"
LEGACY_GRAPH = "graph_manual.json"
DATASET_CONFIG = "dataset.json"
SITE = "site.json"
STREETS = "streets.json"  # the streets and paths a heat network can run along (routers/site.py; an example's only)
EQUATIONS = "equations.json"
PID_IMAGE = "pid.png"
PID_PLANT = "pid_plant.json"
PID_CONSTRUCT = "pid_construct.json"
PID_VIEWS_DIR = "pid_views"  # the pictures of the views inside the P&ID, <view id>.png (site.json pid_views)
WEATHER = "weather_open_meteo.json"  # derived: Open-Meteo cache (core/weather.py), never committed
RECIPE = "recipe.json"  # the prepared variables' recipe (core/prepare.py); beside the graphs in a bronze / silver version
MODELS_DIR = "models"
EVALUATION = "evaluation.json"  # in models/: the last evaluation stored (routers/training.py), not a model
BACKUP_DIR = ".backup"
# JSON files of a dataset that are not causal graphs
NOT_GRAPHS = {SITE, STREETS, DATASET_CONFIG, EQUATIONS, PID_PLANT, PID_CONSTRUCT, WEATHER, RECIPE}

MODEL_NAME = re.compile(r"[A-Za-z0-9_-]{1,64}")

Graph = dict[str, list[tuple[str, int]]]  # target -> [(parent, lag)]


def backup_stamp() -> str:
    """When a backup is made, to the microsecond: two backups in one second must not overwrite each other."""
    return datetime.now().strftime("%Y%m%d-%H%M%S-%f")


def graph_name(file_name: str | None) -> str:
    """A graph file name that is safe to open in the dataset folder; ValueError otherwise."""
    clean = (file_name or "").strip()
    if not clean:
        raise ValueError("file_name must not be empty")
    if "/" in clean or "\\" in clean or ".." in clean:
        raise ValueError("Invalid file_name")
    if not clean.lower().endswith(".json"):
        raise ValueError("file_name must end with .json")
    if clean.lower().endswith(".canvas.json"):
        raise ValueError("graph file_name cannot end with .canvas.json")
    if clean.casefold() in NOT_GRAPHS:  # "DATASET.json" is dataset.json on a disk that ignores case (macOS, Windows)
        raise ValueError(f"{clean} is not a graph file of this dataset; pick another name")
    return clean


def graph_files(directory: Path) -> list[str]:
    """The causal-graph files of a dataset folder, sorted (old *.canvas.json layouts are not graphs)."""
    skip = {LEGACY_GRAPH, *NOT_GRAPHS}
    return sorted(
        p.name for p in directory.glob("*.json") if not p.name.lower().endswith(".canvas.json") and p.name.casefold() not in skip
    )


def parse_graph(raw: object) -> tuple[Graph, list[dict]]:
    """Graph JSON (either shape) -> (targets, link strengths). Names are stripped; ValueError if malformed."""
    if isinstance(raw, dict) and "targets" in raw:
        targets_raw, strengths_raw = raw.get("targets") or {}, raw.get("link_strengths") or []
    else:
        targets_raw, strengths_raw = raw, []
    try:
        if not isinstance(targets_raw, dict):
            raise TypeError
        targets = {str(t).strip(): [(str(p).strip(), int(lag)) for p, lag in ps] for t, ps in targets_raw.items()}
    except (TypeError, ValueError) as exc:
        raise ValueError("not a causal graph") from exc
    strengths = []
    for item in strengths_raw if isinstance(strengths_raw, list) else []:
        try:
            strengths.append(_strength(item))
        except (KeyError, TypeError, ValueError):
            continue  # a broken strength entry is only a label; skip it
    return targets, strengths


def read_graph(path: Path) -> tuple[Graph, list[dict]]:
    """A graph file -> (targets, link strengths); ValueError if it is not a graph."""
    try:
        return parse_graph(json.loads(path.read_text(encoding="utf-8")))
    except ValueError as exc:  # json.JSONDecodeError is a ValueError too
        raise ValueError(f"Invalid graph JSON format in '{path.name}'") from exc


def write_graph(path: Path, targets: Graph, link_strengths: Iterable[dict] = ()) -> int:
    """Write a graph file in the current shape; returns the number of links."""
    doc = {
        "targets": {t: [[p, int(lag)] for p, lag in ps] for t, ps in targets.items()},
        "link_strengths": [_strength(s) for s in link_strengths],
    }
    write_atomic(path, json.dumps(doc, indent=2))
    return sum(len(ps) for ps in targets.values())


def _strength(item: dict) -> dict:
    return {"source": str(item["source"]), "target": str(item["target"]), "lag": int(item["lag"]), "value": float(item["value"])}


def migrate_legacy_graph(directory: Path) -> None:
    """Old folders have graph_manual.json: it becomes causal_graph.json (if that is missing)."""
    legacy, modern = directory / LEGACY_GRAPH, directory / CAUSAL_GRAPH
    if legacy.exists() and not modern.exists():
        legacy.rename(modern)


class BrokenFile(ValueError):
    """A file of a data folder that cannot be read (cut off, not JSON, not the shape it must have): its name and what
    to do, answered as 422 (backend/app.py) instead of a 500, and never overwritten by a write that read it first."""


def read_json(path: Path) -> dict:
    """A JSON object file, or {} if it does not exist; BrokenFile when it is no JSON object."""
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BrokenFile(f"{path.name} cannot be read ({exc}): restore it from .backup or fix it by hand") from exc
    if not isinstance(raw, dict):
        raise BrokenFile(f"{path.name} holds a {type(raw).__name__}, not a JSON object: restore it from .backup")
    return raw


def write_atomic(path: Path, data: str | bytes) -> None:
    """Write a whole file so that a reader finds the old one or the new one, never a cut-off one (a crash, a full
    disk): a temporary file in the same folder, then os.replace (atomic on one file system). Every write of the app
    to a data folder goes through here."""
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        with tmp.open("xb") as f:
            f.write(data.encode("utf-8") if isinstance(data, str) else data)
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def model_file(models_dir: Path, name: str) -> Path:
    """<name>.json in the models folder (`DatasetMeta.file(MODELS_DIR)`); ValueError for a name that is not a plain
    identifier."""
    if not MODEL_NAME.fullmatch(name):
        raise ValueError("model name: letters, digits, _ and - only")
    if f"{name}.json".casefold() == EVALUATION:
        raise ValueError("'evaluation' is the stored evaluation, not a model name")
    return models_dir / f"{name}.json"


def booster_dir(models_dir: Path, name: str) -> Path:
    """<name>.boosters/ in the models folder: XGBoost boosters (<var>.json) or TabPFN training rows (<var>.npz)."""
    return models_dir / f"{name}.boosters"
