"""P&ID drawings: extract the component graph from a PDF, SVG or DEXPI file, preview it, use it as a data center's P&ID.

The drawing comes as the raw request body (no multipart). It may be confidential: it is read
locally only, never sent anywhere; extraction and preview keep it in memory or in a temp file
that is deleted right after. Only "use as P&ID" stores something: the rendered PNG and the
plant graph in the data center's own folder (ignored by git, see .gitignore).
"""

import json
import shutil
import subprocess
import tempfile
from collections import Counter
from pathlib import Path

import anyio.to_thread
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from ..core import dataset_files as files
from ..core.limits import PID_MAX_BYTES
from ..deps import Structure, png_file, read_body
from ..pid import components_of, plant_fractions, read_drawing, sniff, views
from ..pid.construct import check, construct_of, from_plant
from ..pid.crop import parse as parse_crop
from ..pid.dexpi import picture
from ..schemas import PidConstruct

MAX_BYTES = PID_MAX_BYTES  # module name kept: tests patch it
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


async def _body(request: Request) -> bytes:
    """The request body, or 413 above MAX_BYTES (cut off while it arrives)."""
    return await read_body(request, MAX_BYTES, PID_MAX_BYTES)


def _suffix(data: bytes) -> str:
    """The file type, ".pdf" or ".svg", from the first bytes; 422 for anything else."""
    try:
        return sniff(data[:4096])
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def _area(crop: str | None) -> tuple | None:
    """The `crop` query (x0,y0,x1,y1, fractions of the page, y down) as an area, or None; 422 when malformed."""
    try:
        return parse_crop(crop)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def _check_png(png: bytes) -> None:
    """422 unless the bytes are a PNG with a picture's header (IHDR with a size): the signature alone would be stored
    as the P&ID, and a view's size read from nothing (`_png_size`)."""
    if len(png) < 33 or png[12:16] != b"IHDR" or 0 in views.png_size(png):
        raise HTTPException(422, "Not a readable PNG: its header has no picture size")


def _crop_png(png: bytes, area: tuple | None) -> bytes:
    """The rendered page cut to the area (the picture shows what was read)."""
    if not area:
        return png
    import io

    from PIL import Image

    with Image.open(io.BytesIO(png)) as im:
        w, h = im.size
        x0, y0, x1, y1 = area
        out = io.BytesIO()
        left, top = min(w - 1, round(x0 * w)), min(h - 1, round(y0 * h))
        im.crop((left, top, max(left + 1, round(x1 * w)), max(top + 1, round(y1 * h)))).save(out, "PNG")
    return out.getvalue()


async def _read(data: bytes, suffix: str, area: tuple | None = None) -> dict:
    """read_drawing on the bytes, through a temp file that is always deleted. Raises ValueError."""
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        path = Path(tmp.name)
    try:
        files.write_atomic(path, data)
        # seconds of blocking CPU work: in a thread so the app keeps answering
        return await anyio.to_thread.run_sync(read_drawing, path, area)
    finally:
        path.unlink(missing_ok=True)


def _render_png(data: bytes, suffix: str, dpi: int = 150) -> bytes:
    """First page as PNG, streamed through stdin/stdout so the drawing is not written to disk again.
    A DEXPI file is drawn from its own graphics first (pid/dexpi.py picture)."""
    if suffix == ".xml":
        try:
            data, suffix = picture(data).encode(), ".svg"
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    if suffix == ".pdf":
        cmd = ["pdftoppm", "-png", "-r", str(dpi), "-f", "1", "-l", "1", "-"]
    else:
        cmd = ["rsvg-convert", "-f", "png", "-z", "2"]
    if shutil.which(cmd[0]) is None:
        raise HTTPException(503, f"{cmd[0]} is not installed")
    try:
        proc = subprocess.run(cmd, input=data, capture_output=True, timeout=60)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "Rendering timed out") from exc
    if proc.returncode != 0 or not proc.stdout:
        raise HTTPException(422, "Could not render this drawing")
    return proc.stdout


# the drawing is the raw request body, not JSON: say so in /api/docs
DRAWING_BODY = {
    "requestBody": {
        "required": True,
        "description": "The drawing file as the raw request body",
        "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}},
    }
}

router = APIRouter(prefix="/api", tags=["pid"])


@router.post("/pid/extract", summary="Extract the component graph of a drawing", openapi_extra=DRAWING_BODY)
async def extract(request: Request, crop: str | None = None, summary: bool = False):
    """Components, traced connections and pipe geometry of a PDF, SVG or DEXPI P&ID (nothing is stored).

    `crop` (x0,y0,x1,y1, fractions of the page, y down): read only that area, as if it were the page.
    `summary`: instead, what its construct would hold (as for the P&ID or a view's picture): shapes per role and
    kind, the components and instruments recognised with their labels (tags) and spots, and the drawing's short
    texts, a few kB in place of the whole drawing."""
    data = await _body(request)
    try:
        payload = await _read(data, _suffix(data), _area(crop))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return construct_summary(construct_of(payload)) if summary else {**payload, **components_of(payload)}


def construct_summary(construct: dict) -> dict:
    """A construct told in a few kB: counts per role and kind, its labelled components and instruments, its texts."""
    shapes = construct["shapes"]

    def count(key: str) -> dict:
        return dict(Counter(s.get(key) or "none" for s in shapes))

    texts = [s["label"] for s in shapes if s.get("kind") == "text" and s.get("label") and len(s["label"]) <= 30]
    return {
        "shapes": len(shapes),
        "by_role": count("role"),
        "by_kind": count("kind"),
        "labelled": [
            {k: s.get(k) for k in ("id", "label", "role", "kind", "x", "y")}
            for s in shapes
            if s.get("role") in ("component", "instrument") and s.get("label")
        ],
        "texts": texts[:300],
        "more_texts": max(0, len(texts) - 300),
    }


@router.post(
    "/pid/preview",
    summary="Render a drawing as PNG",
    openapi_extra=DRAWING_BODY,
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
)
async def preview(request: Request):
    """The first page of a PDF or SVG as a PNG, for display only (not stored)."""
    data = await _body(request)
    png = await anyio.to_thread.run_sync(_render_png, data, _suffix(data))
    return Response(png, media_type="image/png")


def _replace_drawing(meta) -> str | None:
    """Before a drawing is replaced or removed: its files (and site.json) copied to .backup/<time>-pid/, and the
    instruments placed on it moved back to the tray (their spots were fractions of the old picture, the plant
    components its ids). The backup folder (relative), or None when there was no drawing."""
    directory, site_path = meta.directory, meta.file(files.SITE)
    old = [directory / n for n in (files.PID_IMAGE, files.PID_PLANT, files.PID_CONSTRUCT) if (directory / n).exists()]
    if not old:
        return None
    backup = directory / files.BACKUP_DIR / f"{files.backup_stamp()}-pid"
    backup.mkdir(parents=True, exist_ok=True)
    for path in [*old, *([site_path] if site_path.exists() else [])]:
        shutil.copy2(path, backup / path.name)
    if site_path.exists():
        site = files.read_json(site_path)
        layout = site.get("pid_layout") or {}
        for key, spot in layout.items():
            if key.startswith(("paper:", "plant:")):
                layout[key] = {**spot, "x": -1, "y": -1, **({"tag": ""} if key.startswith("plant:") else {})}
        files.write_atomic(site_path, json.dumps({**site, "pid_layout": layout}, indent=2))
    return backup.relative_to(directory).as_posix()


@router.post("/datasets/{dataset_id}/pid", summary="Use a drawing as the data center's P&ID", openapi_extra=DRAWING_BODY)
async def use_as_pid(meta: Structure, request: Request, crop: str | None = None):
    """Use a drawing (PDF, SVG or PNG) as this data center's P&ID: stored as pid.png in its folder.

    A PDF/SVG also stores its plant graph as pid_plant.json and its digital construct (components,
    instrument bubbles, pipes as shapes) as pid_construct.json. A PNG, or a drawing whose graph cannot
    be read, removes older ones: they belonged to another drawing. The old drawing is backed up first and
    the instruments placed on it go back to the tray (their spots belonged to it). `crop` (x0,y0,x1,y1,
    fractions of the page, y down): only that area is read and kept, without the legend around it.
    """
    return await store_drawing(meta, await _body(request), _area(crop))


async def _picture_of(data: bytes, area: tuple | None) -> tuple[bytes, dict | None, dict | None]:
    """A drawing (or one area of it) as its PNG, its plant graph and its construct; a PNG, or a drawing that cannot
    be read, has neither (None): it is still usable as a picture."""
    if data[:8] == PNG_MAGIC:
        _check_png(data)
        return await anyio.to_thread.run_sync(_crop_png, data, area), None, None
    suffix = _suffix(data)
    try:
        payload = await _read(data, suffix, area)
        plant, construct = plant_fractions(payload), construct_of(payload)
    except ValueError:
        plant = construct = None
    png = await anyio.to_thread.run_sync(_render_png, data, suffix, 200)
    if suffix != ".xml":  # a DEXPI file is read whole (pid/extract.py read_drawing)
        png = await anyio.to_thread.run_sync(_crop_png, png, area)
    return png, plant, construct


async def store_drawing(meta, data: bytes, area: tuple | None = None) -> dict:
    """use_as_pid on bytes already read (also used when a data center is added from a folder); `area`: only that
    part of the page is read and kept as the picture."""
    directory = meta.directory
    data, plant, construct = await _picture_of(data, area)
    backup = _replace_drawing(meta)
    files.write_atomic(directory / files.PID_IMAGE, data)
    # the plant graph and the construct belong to the drawing: a new one replaces them (or removes the old ones)
    for name, content in ((files.PID_PLANT, plant), (files.PID_CONSTRUCT, construct)):
        if content:
            files.write_atomic(directory / name, json.dumps(content))
        else:
            (directory / name).unlink(missing_ok=True)
    cfg_path = directory / files.DATASET_CONFIG
    files.write_atomic(cfg_path, json.dumps({**files.read_json(cfg_path), "pid_image": files.PID_IMAGE}, indent=2))
    return {
        "pid_image": files.PID_IMAGE,
        "bytes": len(data),
        "components": len(plant["components"]) if plant else 0,
        "backup": backup,
    }


@router.delete("/datasets/{dataset_id}/pid", summary="Remove the data center's P&ID")
def remove_pid(meta: Structure):
    """Remove the P&ID picture, its plant graph and its construct (backed up to .backup/<time>-pid/ first).

    The instruments placed on it go back to the tray; the variables and links stay.
    """
    backup = _replace_drawing(meta)
    for name in (files.PID_IMAGE, files.PID_PLANT, files.PID_CONSTRUCT):
        (meta.directory / name).unlink(missing_ok=True)
    cfg_path = meta.directory / files.DATASET_CONFIG
    if cfg_path.exists():
        cfg = files.read_json(cfg_path)
        cfg.pop("pid_image", None)
        files.write_atomic(cfg_path, json.dumps(cfg, indent=2))
    return {"removed": backup is not None, "backup": backup}


@router.get("/datasets/{dataset_id}/pid/plant", summary="Get the plant graph of the P&ID")
def plant(meta: Structure):
    """The plant graph read from the data center's P&ID drawing (components, links, pipes), if any.

    Positions are fractions of the page (0..1), so they overlay pid.png at any size.
    """
    path = meta.directory / files.PID_PLANT
    return files.read_json(path) if path.exists() else {"components": [], "links": [], "pipes": []}


@router.get(
    "/datasets/{dataset_id}/pid/construct",
    response_model=PidConstruct,
    response_model_exclude_none=True,
    summary="Get the P&ID's digital construct",
)
def get_construct(meta: Structure):
    """The drawing as shapes (components, instruments, pipes, notes) over the P&ID picture, fractions of it.

    Not saved yet: the first guess from an older plant graph (saved False), or no shapes. `picture`: whether there is
    a picture to draw them over (a structure other than the data center's own learns it here).
    """
    path = meta.directory / files.PID_CONSTRUCT
    picture = (meta.directory / files.PID_IMAGE).exists()
    if path.exists():
        return {**files.read_json(path), "saved": True, "picture": picture}
    plant_path = meta.directory / files.PID_PLANT
    seed = from_plant(files.read_json(plant_path)) if plant_path.exists() else {"shapes": []}
    return {**seed, "saved": False, "picture": picture}


@router.put(
    "/datasets/{dataset_id}/pid/construct",
    response_model=PidConstruct,
    response_model_exclude_none=True,
    summary="Save the P&ID's digital construct",
)
def save_construct(meta: Structure, body: PidConstruct):
    """Replace the construct with these shapes (checked: unique ids, sizes and points within the drawing)."""
    try:
        construct = check({"shapes": [s.model_dump(exclude_none=True) for s in body.shapes]})
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    files.write_atomic(meta.directory / files.PID_CONSTRUCT, json.dumps(construct))
    return {**construct, "saved": True}


# --- views: areas of the P&ID with a picture of their own (site.json pid_views holds the areas; files: pid/views.py)


def _view_png(meta, view_id: str) -> Path:
    """Where a view's picture is (pid/views.py view_png), or 400 for an invalid view id."""
    try:
        return views.view_png(meta.directory, view_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


def _shape_view(meta, view_id: str, width: int, height: int) -> dict | None:
    """The view's area in site.json made the shape of its picture (pid/views.py shape_view); None: no such view."""
    return views.shape_view(meta.directory, meta.file(files.SITE), view_id, width, height)


@router.post(
    "/datasets/{dataset_id}/pid/views/{view_id}",
    summary="Use a drawing as the picture of a P&ID view",
    openapi_extra=DRAWING_BODY,
)
async def use_as_view_picture(meta: Structure, view_id: str, request: Request, crop: str | None = None):
    """Use a drawing (PDF, SVG, DEXPI or PNG; a PDF's first page) as the picture of one view of the P&ID, drawn
    inside the view's area (site.json pid_views). Stored as pid_views/<view id>.png; a PDF, SVG or DEXPI file is
    also read like the P&ID itself, and its construct (the drawing's lines and texts, the components and
    instruments recognised, with their tags as labels) stored as pid_views/<view id>.construct.json. An older
    picture and construct are backed up first. `crop` (x0,y0,x1,y1, fractions of the page): only that area.
    The view's area in site.json then takes the picture's shape, so the picture fills it (`area`, or null when the
    view is not in site.json yet)."""
    path = _view_png(meta, view_id)
    data, _, construct = await _picture_of(await _body(request), _area(crop))
    backup = views.backup_view(meta.directory, path)
    path.parent.mkdir(exist_ok=True)
    files.write_atomic(path, data)
    if construct:
        files.write_atomic(views.construct_file(path), json.dumps(construct))
    else:
        views.construct_file(path).unlink(missing_ok=True)  # it belonged to the old picture
    width, height = views.png_size(data)
    area = _shape_view(meta, view_id, width, height)
    shapes = len(construct["shapes"]) if construct else 0
    return {
        "view": view_id,
        "width": width,
        "height": height,
        "bytes": len(data),
        "backup": backup,
        "area": area,
        "shapes": shapes,
        "note": None if shapes else views.NO_CONSTRUCT,
    }


@router.post("/datasets/{dataset_id}/pid/views/{view_id}/copy", summary="Copy another view's picture and construct")
def copy_view(meta: Structure, view_id: str, source: str):
    """Give this view the picture and the construct of the view `source` (e.g. six identical racks, read once).
    An older picture and construct of this view are backed up first; its area takes the picture's shape."""
    path, src = _view_png(meta, view_id), _view_png(meta, source)
    if not src.exists():
        raise HTTPException(404, f"The view {source} has no picture to copy")
    if src == path:
        raise HTTPException(400, "A view cannot be copied onto itself")
    backup = views.backup_view(meta.directory, path)
    shutil.copy2(src, path)
    if views.construct_file(src).exists():
        shutil.copy2(views.construct_file(src), views.construct_file(path))
    else:
        views.construct_file(path).unlink(missing_ok=True)
    width, height = views.png_size(path.open("rb").read(24))
    return {"view": view_id, "source": source, "backup": backup, "area": _shape_view(meta, view_id, width, height)}


@router.put(
    "/datasets/{dataset_id}/pid/views/{view_id}/construct",
    response_model=PidConstruct,
    response_model_exclude_none=True,
    summary="Save the construct of a P&ID view",
)
def save_view_construct(meta: Structure, view_id: str, body: PidConstruct):
    """Replace a view's construct with these shapes (positions: fractions of the view's picture; checked like the
    P&ID's). Written at once, the older one backed up to .backup/ first; the view needs a picture."""
    path = _view_png(meta, view_id)
    if not path.exists():
        raise HTTPException(404, f"The view {view_id} has no picture: give it one first")
    try:
        construct = check({"shapes": [s.model_dump(exclude_none=True) for s in body.shapes]})
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if views.construct_file(path).exists():
        backup = meta.directory / files.BACKUP_DIR / f"{files.backup_stamp()}-pid-view-{views.construct_file(path).name}"
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(views.construct_file(path), backup)
    files.write_atomic(views.construct_file(path), json.dumps(construct))
    return {**construct, "saved": True}


@router.get("/datasets/{dataset_id}/pid/views/{view_id}/construct", summary="Get the construct of a P&ID view")
def view_construct(meta: Structure, view_id: str):
    """The shapes read from a view's picture (positions are fractions of that picture), as /pid/construct gives
    them for the P&ID: its lines and texts, the components and instruments recognised. Empty for a PNG picture."""
    path = views.construct_file(_view_png(meta, view_id))
    return {"shapes": files.read_json(path).get("shapes", [])}


@router.get("/datasets/{dataset_id}/pid/views/{view_id}.png", summary="Get the picture of a P&ID view")
def view_picture(meta: Structure, view_id: str, request: Request):
    """The picture of one view of the P&ID, if it has one."""
    return png_file(_view_png(meta, view_id), request, f"No picture for the view {view_id}")


@router.delete("/datasets/{dataset_id}/pid/views/{view_id}", summary="Remove the picture of a P&ID view")
def remove_view_picture(meta: Structure, view_id: str):
    """Remove the picture of one view and its construct (backed up to .backup/ first). The view's area stays in
    site.json."""
    path = _view_png(meta, view_id)
    backup = views.backup_view(meta.directory, path)
    path.unlink(missing_ok=True)
    views.construct_file(path).unlink(missing_ok=True)
    return {"removed": backup is not None, "backup": backup}
