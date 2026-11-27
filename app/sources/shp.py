"""A minimal ESRI shapefile reader (stdlib only): each record's .dbf attributes with its .shp shape, one at a time.

Enough for the open heat atlases' downloads (NRW's per-municipality shapefiles): polylines and polygons only (types
3 and 5, their Z and M variants read as x, y). The files are read front to back from any binary file object, so a
member of a downloaded zip is read where it is, without unpacking it; nothing is held for the whole file.
"""

import struct
from collections.abc import Callable, Iterator
from typing import BinaryIO

Parts = list[list[tuple[float, float]]]  # a polygon's rings or a polyline's parts, each [(x, y), ...]
SHAPE_TYPES = (3, 5, 13, 15, 23, 25)  # PolyLine, Polygon, and their Z and M variants


def dbf_records(f: BinaryIO, encoding: str = "utf-8") -> Iterator[dict | None]:
    """Each record of a dBASE file as {field: value} (numbers as float, empty as None); a deleted record as None, so
    the records stay in step with the shapes."""
    n, header_len, record_len = struct.unpack("<IHH", f.read(12)[4:12])
    f.seek(32)
    fields = []
    while (d := f.read(32))[0] != 0x0D:
        fields.append((d[:11].split(b"\0")[0].decode("ascii"), chr(d[11]), d[16]))
    f.seek(header_len)
    for _ in range(n):
        r = f.read(record_len)
        if r[:1] == b"*":
            yield None
            continue
        row, pos = {}, 1
        for name, kind, size in fields:
            raw = r[pos : pos + size].decode(encoding, "replace").strip()
            pos += size
            row[name] = _number(raw) if kind in "NF" else raw or None
        yield row


def _number(raw: str) -> float | None:
    try:
        return float(raw)
    except ValueError:
        return None  # empty, or the "*****" of an overflowing field


def shapes(f: BinaryIO) -> Iterator[Parts | None]:
    """Each record's parts of a .shp file; a null shape as None. ValueError for points and multipatches."""
    f.seek(100)
    while head := f.read(8):
        _, words = struct.unpack(">ii", head)
        body = f.read(words * 2)
        (kind,) = struct.unpack_from("<i", body)
        if kind == 0:
            yield None
            continue
        if kind not in SHAPE_TYPES:
            raise ValueError(f"shape type {kind} is not read (only polylines and polygons)")
        n_parts, n_points = struct.unpack_from("<ii", body, 36)
        starts = [*struct.unpack_from(f"<{n_parts}i", body, 44), n_points]
        xy = struct.unpack_from(f"<{2 * n_points}d", body, 44 + 4 * n_parts)
        points = list(zip(xy[0::2], xy[1::2], strict=True))
        yield [points[a:b] for a, b in zip(starts, starts[1:], strict=False)]


def records(opener: Callable[[str], BinaryIO], stem: str) -> Iterator[tuple[dict, Parts | None]]:
    """(attributes, parts) of every record of the shapefile `stem` (its name without the suffix), its .dbf and .shp
    opened by `opener` (`open(name, "rb")`, or a zip's `open`); deleted records left out."""
    with opener(f"{stem}.dbf") as dbf, opener(f"{stem}.shp") as shp:
        for row, parts in zip(dbf_records(dbf), shapes(shp), strict=True):
            if row is not None:
                yield row, parts


def ring_area(ring: list[tuple[float, float]]) -> float:
    """The ring's area (shoelace; absolute)."""
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1], strict=True))) / 2


def centroid(ring: list[tuple[float, float]]) -> tuple[float, float]:
    """The ring's area centroid (its vertices' mean for a degenerate ring)."""
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1], strict=True):
        c = x1 * y2 - x2 * y1
        a, cx, cy = a + c, cx + (x1 + x2) * c, cy + (y1 + y2) * c
    if abs(a) < 1e-9:
        return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
    return cx / (3 * a), cy / (3 * a)
