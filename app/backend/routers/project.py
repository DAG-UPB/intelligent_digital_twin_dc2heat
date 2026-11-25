"""Save / open a whole project as one JSON file.

A project is everything built on top of a dataset: site (map, heat sinks, areas, P&ID layout),
causal graphs, physics equations and trained models (XGBoost boosters and TabPFN rows included).
The data itself (parquet / csv) is not in the file: the project names its dataset.

Opening a project replaces those files; the current ones are moved to .backup/<time>/ first.
Saving one writes it into the data folder's status folder (core/storage.py), one file per save, so the states
are kept as a history next to the data.
"""

import base64
import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from ..core.dataset_files import (
    BACKUP_DIR,
    NOT_GRAPHS,
    RECIPE,
    SITE,
    WEATHER,
    backup_stamp,
    migrate_legacy_graph,
    parse_graph,
    write_atomic,
)
from ..core.registry import DatasetMeta
from ..deps import Dataset
from ..schemas import Project, SavedProject, SaveProjectRequest, Site

router = APIRouter(prefix="/api/datasets", tags=["project"])

FORMAT = "dc-twin-project"
# what a project may contain, relative to the dataset folder: the data center's files, and the same for each of its
# other structures (the heat distribution's, the district's, in their own folders: deps.STRUCTURES), so a project keeps
# all three systems, each with its graph, site and models
ALLOWED = re.compile(
    r"(?:(?:silver/)?(?:heat|district)_structure/)?"
    r"(?:[A-Za-z0-9_.-]+\.json|models/[A-Za-z0-9_-]+\.json|models/[A-Za-z0-9_-]+\.boosters/[A-Za-z0-9_-]+\.(json|npz))"
)

# a structure's file, named with silver/ (flat and structured versions) or without (bronze / silver: silver is the
# data center's folder there): either way it belongs in that structure's folder of this version (deps.get_structure)
STRUCTURE_FILE = re.compile(r"(?:silver/)?((?:heat|district)_structure/.+)")


def _project_files(meta: DatasetMeta) -> dict[str, Path]:
    """The project's files by project name -> their place (not the weather cache: it is derived; not the prepared
    variables' recipe: their values are not in a project, so the recipe stays with them)."""
    found = meta.storage.project_files(meta.id)
    return {rel: found[rel] for rel in sorted(found) if Path(rel).name not in (WEATHER, RECIPE) and ALLOWED.fullmatch(rel)}


def _export(meta: DatasetMeta) -> dict:
    files = {}
    for rel, path in _project_files(meta).items():
        raw = path.read_bytes()
        files[rel] = {"base64": base64.b64encode(raw).decode()} if rel.endswith(".npz") else {"text": raw.decode()}
    return {
        "format": FORMAT,
        "version": 1,
        "dataset": meta.id,
        "saved": datetime.now().isoformat(timespec="seconds"),
        "files": files,
    }


@router.get("/{dataset_id}/project", summary="Export the project")
def export_project(meta: Dataset):
    """Every project file of the dataset in one JSON document (.npz as base64)."""
    return _export(meta)


NOTHING_ELSE = SaveProjectRequest()  # a save with no body: the files as they are


@router.post("/{dataset_id}/project/save", response_model=SavedProject, summary="Save the project state")
def save_project(meta: Dataset, body: SaveProjectRequest = NOTHING_ELSE):
    """Write the project (as the export) into the data folder's status folder; every save is a new file. With `site`,
    the Site map's unsaved edits go into the file as its site.json; the data center's own site.json is not touched."""
    folder = meta.storage.status_dir(meta.id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{meta.id}-project-{datetime.now().strftime('%Y-%m-%d_%H%M%S')}.json"
    project = _export(meta)
    if body.site is not None:
        project["files"]["site.json"] = {"text": json.dumps(body.site, indent=2, ensure_ascii=False)}
    write_atomic(path, json.dumps(project))
    return SavedProject(path=path.relative_to(meta.storage.version_root).as_posix(), files=len(project["files"]))


def _check(rel: str, raw: bytes) -> None:
    """ValueError when a project's file would break the app once written: a JSON file that does not parse or is no
    object, a site.json the Site page could not read, a graph file that is no graph (an .npz is taken as it is)."""
    if rel.endswith(".npz"):
        return
    try:
        doc = json.loads(raw.decode("utf-8"))
    except ValueError as exc:  # UnicodeDecodeError and JSONDecodeError are ValueErrors
        raise ValueError(f"not JSON ({exc})") from exc
    if not isinstance(doc, dict):
        raise ValueError("not a JSON object")
    name = Path(rel).name.casefold()
    if name == SITE:
        try:
            Site.model_validate(doc)
        except ValidationError as exc:
            raise ValueError(f"not a site.json ({exc.errors()[0]['msg']})") from exc
    elif "models/" not in rel and name not in NOT_GRAPHS and not name.endswith(".canvas.json"):
        parse_graph(doc)  # every other JSON file of a structure's folder is a causal graph


@router.post("/{dataset_id}/project", summary="Open a project (replaces its files)")
def open_project(meta: Dataset, body: Project):
    """Replace the project files with the document's; the current ones move to .backup/{time}/."""
    d = meta.directory
    if body.format != FORMAT:
        raise HTTPException(400, "Not a project file of this app")
    if body.dataset != meta.id:
        raise HTTPException(400, f"This project belongs to dataset '{body.dataset}', not '{meta.id}'")
    bad = [p for p in body.files if not ALLOWED.fullmatch(p) or ".." in p]
    if bad:
        raise HTTPException(400, f"Unexpected files in the project: {bad[:5]}")
    decoded = {}
    for rel, content in body.files.items():
        if Path(rel).name == RECIPE:  # an older export's recipe: the prepared values it describes are not in it
            continue
        try:
            decoded[rel] = base64.b64decode(content["base64"], validate=True) if "base64" in content else content["text"].encode()
        except (KeyError, ValueError) as exc:
            raise HTTPException(400, f"Unreadable file in the project: {rel}") from exc
        try:
            _check(rel, decoded[rel])  # every file before any is written: a bad one leaves the folder as it was
        except ValueError as exc:
            raise HTTPException(400, f"{rel} in the project: {exc}") from exc

    # back up what is there now, then replace it with the project's files
    backup = d / BACKUP_DIR / backup_stamp()
    for rel, path in _project_files(meta).items():
        (backup / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(backup / rel))
    for rel, raw in decoded.items():
        structure = STRUCTURE_FILE.fullmatch(rel)
        target = meta.storage.work_dir(meta.id) / structure[1] if structure else meta.file(rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        write_atomic(target, raw)
    migrate_legacy_graph(d)  # a project from an old folder may hold only graph_manual.json
    return {"files": len(decoded), "backup": backup.relative_to(d).as_posix()}
