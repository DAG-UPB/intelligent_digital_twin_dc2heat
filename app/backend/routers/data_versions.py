"""Data folders: the version folders of the user's data root and the examples; switch between them, or re-link the root."""

from pathlib import Path

import anyio.to_thread
from fastapi import APIRouter, HTTPException, Request

from ..core import data_versions as dv
from ..core import import_folder as imp
from ..core.limits import PID_MAX_BYTES
from ..deps import Registry
from ..schemas import (
    DataRootRequest,
    DataVersionRequest,
    DataVersionsResponse,
    FolderListing,
    FolderScan,
    ImportFolderRequest,
    PickedFolder,
)
from .pid import store_drawing

router = APIRouter(prefix="/api/data-versions", tags=["datasets"])


def _state(request: Request) -> DataVersionsResponse:
    s = request.app.state
    root: Path | None = s.versions_dir if s.versions_dir is not None and s.versions_dir.is_dir() else None
    found = dv.versions(root)
    examples = dv.catalog(s.local_dir)
    folders = {v: dv.with_examples(dv.catalog(root / v), examples) for v in found} if root else {}
    folders[dv.LOCAL] = examples
    return DataVersionsResponse(
        current=s.data_version,
        versions=found,
        names=dv.version_names(root, found),
        linked=root is not None,
        root=str(root.resolve()) if root else None,
        folders=folders,
    )


def _switch(request: Request, registry, version: str) -> None:
    s = request.app.state
    old, registry.data_dir = registry.data_dir, dv.data_dir_of(version, s.local_dir, s.versions_dir)
    try:
        registry.discover()
    except Exception:
        registry.data_dir = old  # the scan failed: stay in the version that works (discover changed nothing)
        raise
    s.data_version = version
    dv.write_choice(s.version_file, version)


@router.get("", response_model=DataVersionsResponse, summary="List the data versions")
def list_data_versions(request: Request):
    """The data folder in use, the version folders of the user's data root and the examples, with their data centers."""
    return _state(request)


@router.put("/current", response_model=DataVersionsResponse, summary="Switch the data version")
def switch_data_version(body: DataVersionRequest, request: Request, registry: Registry):
    """Read and save every dataset in another data folder from now on (re-scans; remembered across restarts)."""
    try:
        _switch(request, registry, body.version)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return _state(request)


@router.get("/browse", response_model=FolderListing, summary="Browse the folders of this computer")
def browse_folders(request: Request, path: str | None = None):
    """The sub-folders of `path` (default: the current data folder, else the home folder), to pick a data folder.

    Folder names only: the app runs on this computer for its user, and no file is listed or read.
    """
    root = request.app.state.versions_dir
    start = Path(path) if path else (root if root is not None and root.is_dir() else Path.home())
    try:
        folder, names = dv.subfolders(start)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return FolderListing(
        path=str(folder),
        parent=str(folder.parent) if folder.parent != folder else None,
        folders=names,
        versions=[n for n in names if dv.is_version_name(n)],
    )


@router.post("/pick", response_model=PickedFolder, summary="Choose a folder in the system's folder dialog")
def pick_folder(request: Request):
    """Open this computer's own folder dialog (Finder on macOS) and wait for the user; nothing is changed yet.

    The app runs on the user's computer, so the dialog appears on their screen. Off in tests (501).
    """
    if not request.app.state.native_picker:
        raise HTTPException(501, "The system folder dialog is off in this app")
    try:
        return PickedFolder(path=dv.pick_folder_natively())
    except ValueError as exc:
        raise HTTPException(501, str(exc)) from exc


@router.put("/root", response_model=DataVersionsResponse, summary="Change the data folder")
def change_data_root(body: DataRootRequest, request: Request, registry: Registry):
    """Point the app at another person's data folder (re-links app/data_versions), then open its newest version."""
    s = request.app.state
    if s.versions_dir is None:
        raise HTTPException(400, "This app has no data folder link")
    try:
        dv.link_root(s.versions_dir, Path(body.path.strip()).expanduser())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    _switch(request, registry, dv.default_version(s.versions_dir))
    return _state(request)


@router.get("/scan", response_model=FolderScan, summary="See what a folder would bring as a data center")
def scan_folder(path: str):
    """Its data files (.parquet, .csv), its P&ID (a DEXPI .xml, .svg or .pdf), dataset.json and causal graphs,
    by name; nothing is read or copied yet."""
    try:
        return imp.scan(Path(path).expanduser())
    except (ValueError, OSError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/import", summary="Add a data center from a folder")
async def import_data_center(body: ImportFolderRequest, request: Request, registry: Registry):
    """Copy a folder in as a new data center of the data version open: the data (CSV becomes parquet) where
    delivered data goes (bronze), dataset.json and the graphs (or a starter graph of every variable) into its own
    folder (silver), and its P&ID read like Import P&ID. The folder itself is not changed, and an existing data
    center is never overwritten. Not into the examples folder (the repo's)."""
    if request.app.state.data_version == dv.LOCAL:
        raise HTTPException(400, "Open one of your data folder's versions first: the examples belong to the repo")
    folder = Path(body.path).expanduser()
    try:
        made = await anyio.to_thread.run_sync(imp.import_folder, folder, registry.storage, body.id, body.name, body.kind)
    except (ValueError, OSError) as exc:
        raise HTTPException(400, str(exc)) from exc
    registry.discover()
    pid = None
    if body.read_pid and made["drawing"] and body.id in registry.datasets:
        try:
            if Path(made["drawing"]).stat().st_size > PID_MAX_BYTES:  # as an upload of it would be
                raise HTTPException(413, f"File too large (limit {PID_MAX_BYTES // 2**20} MB)")
            pid = await store_drawing(registry.datasets[body.id], Path(made["drawing"]).read_bytes())
        except HTTPException as exc:  # the data is in; the drawing could not be read or rendered
            pid = {"error": str(exc.detail)}
    return {**{k: v for k, v in made.items() if k != "drawing"}, "pid": pid}
