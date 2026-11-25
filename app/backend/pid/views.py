"""The files of a P&ID's views (areas of the drawing with a picture of their own; site.json `pid_views` holds the
areas): each picture as pid_views/<view id>.png beside its construct pid_views/<view id>.construct.json, backed up to
.backup/ before it is replaced or removed, and the view's area made the shape of its picture. routers/pid.py serves
them; an invalid view id is a ValueError here (400 there).
"""

import json
import re
import shutil
from pathlib import Path

from ..core import dataset_files as files

VIEW_ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,39}")
NO_CONSTRUCT = "no construct: a PNG, or a PDF with only a scanned image in it, has no lines or texts to read"
DRAWN_FRAME = (1100, 640)  # the page's own drawing when there is no P&ID picture (web structure/geometry.ts W x H)


def png_size(head: bytes) -> tuple[int, int]:
    """A PNG's width and height from its first 24 bytes (its IHDR)."""
    return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")  # the PNG's IHDR


def shape_view(directory: Path, site_path: Path, view_id: str, width: int, height: int) -> dict | None:
    """The view's area in site.json takes its picture's shape (same top-left corner and width; narrower when it would
    run off the P&ID), so the picture fills it and its own 0..1 coordinates are the area's. None: no such view."""
    site = files.read_json(site_path) if site_path.exists() else {}
    view = next((v for v in site.get("pid_views") or [] if v.get("id") == view_id), None)
    if view is None or not width or not height:
        return None
    pid = directory / files.PID_IMAGE
    fw, fh = png_size(pid.open("rb").read(24)) if pid.exists() else DRAWN_FRAME
    ratio = height / width
    w, h = view["w"], view["w"] * fw * ratio / fh
    if view["y"] + h > 1:
        h = 1 - view["y"]
        w = h * fh / (ratio * fw)
    view.update(w=round(w, 6), h=round(h, 6))
    files.write_atomic(site_path, json.dumps(site, indent=2))
    return view


def view_png(directory: Path, view_id: str) -> Path:
    """Where a view's picture is; ValueError for an invalid view id."""
    if not VIEW_ID.fullmatch(view_id):
        raise ValueError("A view id is 1 to 40 lower-case letters, digits, _ or -")
    return directory / files.PID_VIEWS_DIR / f"{view_id}.png"


def construct_file(png: Path) -> Path:
    """Where the construct read from a view's picture is."""
    return png.with_suffix(".construct.json")  # pid_views/<id>.construct.json


def backup_view(directory: Path, path: Path) -> str | None:
    """A view's picture (and its construct) copied to .backup/<time>-pid-view-<id>.* before it is replaced or
    removed; the picture's backup path, or None when there was none."""
    if not path.exists():
        return None
    backup = directory / files.BACKUP_DIR / f"{files.backup_stamp()}-pid-view-{path.name}"
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, backup)
    if construct_file(path).exists():
        shutil.copy2(construct_file(path), construct_file(backup))
    return backup.relative_to(directory).as_posix()
