"""DEXPI P&IDs: the standard, machine-readable P&ID exchange format (Proteus XML, ISO 15926 based).

A DEXPI file says what a PDF only shows: every piece of equipment with its tag, every pipe with its centre line
and the nozzles it connects, every instrument function with its ISA letters and loop number, and all of it with
coordinates on the sheet. read_dexpi shapes that like read_drawing's payload (the same keys the PDF / SVG readers
give), so the plant graph, the digital construct and the import preview take it unchanged:

    equipment                 -> colorNodes (tag, centre, and its size from <Extent>)
    PipingNetworkSegment      -> colorRuns (centre lines); its <Connection>s join two pieces of equipment
    ProcessInstrumentationFunction -> instruments (tag "TIC 4750", centre, bubble diameter)

picture() draws the sheet as SVG from the file's own graphics (lines, polylines, shapes, circles, ellipses, texts,
catalogue symbols placed at their <Position>), for the picture level. Coordinates in a DEXPI file run y up from
the sheet's <Extent> minimum; here, as in the other readers, y runs down from the top.
"""

from __future__ import annotations

import math
from html import escape
from itertools import combinations
from xml.etree import ElementTree as ET

PRIMITIVES = {"Line", "PolyLine", "Shape", "CenterLine", "Circle", "Ellipse", "Text"}
DEFAULT_BUBBLE = 10.0  # mm: an instrument bubble without a drawn circle
PIPE_COLOUR = "#2563eb"


def is_dexpi(header: bytes) -> bool:
    """True when the bytes start a DEXPI / Proteus file (its root element is <PlantModel>)."""
    return b"<PlantModel" in header[:4096]


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _kids(el: ET.Element, name: str) -> list[ET.Element]:
    return [c for c in el if _local(c.tag) == name]


def _kid(el: ET.Element, name: str) -> ET.Element | None:
    found = _kids(el, name)
    return found[0] if found else None


def _xy(el: ET.Element | None) -> tuple[float, float] | None:
    try:
        return (float(el.get("X")), float(el.get("Y"))) if el is not None else None
    except (TypeError, ValueError):
        return None


def _attributes(el: ET.Element) -> dict[str, str]:
    """The element's own generic attributes (not those of the components inside it), name -> value."""
    return {
        ga.get("Name", ""): ga.get("Value", "")
        for gas in _kids(el, "GenericAttributes")
        for ga in _kids(gas, "GenericAttribute")
        if ga.get("Value")
    }


def _ending(attrs: dict[str, str], *suffixes: str) -> str:
    return next((v for k, v in attrs.items() if k.endswith(suffixes)), "")


def _parse(data: bytes) -> ET.Element:
    # a P&ID needs no DTD: refusing one rules out entity expansion (billion laughs) and external entities
    if b"<!DOCTYPE" in data or b"<!ENTITY" in data:
        raise ValueError("A DEXPI file with a DOCTYPE or ENTITY is not read")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise ValueError(f"Not readable XML: {exc}") from exc
    if _local(root.tag) != "PlantModel":
        raise ValueError("Not a DEXPI file (no <PlantModel> root)")
    return root


def _extent(root: ET.Element) -> tuple[float, float, float, float]:
    """(x0, y0, x1, y1) of the sheet: the drawing's <Extent>, else the plant model's, else of all coordinates."""
    for holder in [*_kids(root, "Drawing"), root]:
        ext = _kid(holder, "Extent")
        lo, hi = (_xy(_kid(ext, "Min")), _xy(_kid(ext, "Max"))) if ext is not None else (None, None)
        if lo and hi and hi[0] > lo[0] and hi[1] > lo[1]:
            return (*lo, *hi)
    pts = [p for el in root.iter() if _local(el.tag) in ("Coordinate", "Location") and (p := _xy(el))]
    if not pts:
        raise ValueError("The DEXPI file has no coordinates to place anything")
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


class _Sheet:
    """Coordinates of the file -> the sheet's, y down from the top (as read_drawing gives them)."""

    def __init__(self, box: tuple[float, float, float, float]):
        self.x0, self.y0, self.x1, self.y1 = box

    def __call__(self, p: tuple[float, float]) -> list[float]:
        return [round(p[0] - self.x0, 3), round(self.y1 - p[1], 3)]

    @property
    def size(self) -> tuple[float, float]:
        return self.x1 - self.x0, self.y1 - self.y0


def _centre(el: ET.Element, box_first: bool = False) -> tuple[float, float] | None:
    """Where a component sits: its <Position> location, else the middle of its <Extent> (that first when
    `box_first`: a symbol's location is its insertion point, often a corner, the extent is what is drawn)."""
    ext = _kid(el, "Extent")
    lo, hi = (_xy(_kid(ext, "Min")), _xy(_kid(ext, "Max"))) if ext is not None else (None, None)
    middle = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2) if lo and hi else None
    pos = _kid(el, "Position")
    at = _xy(_kid(pos, "Location") if pos is not None else None)
    return (middle or at) if box_first else (at or middle)


def _size(el: ET.Element) -> tuple[float, float] | None:
    ext = _kid(el, "Extent")
    lo, hi = (_xy(_kid(ext, "Min")), _xy(_kid(ext, "Max"))) if ext is not None else (None, None)
    return (abs(hi[0] - lo[0]), abs(hi[1] - lo[1])) if lo and hi and hi != lo else None


def _equipment(root: ET.Element, sheet: _Sheet) -> tuple[list[dict], dict[str, str]]:
    """The equipment as named nodes, and nozzle id -> its equipment's id (for the pipe connections)."""
    nodes, owner = [], {}
    for el in root.iter():
        if _local(el.tag) != "Equipment" or not el.get("ID") or (at := _centre(el, box_first=True)) is None:
            continue
        eid = el.get("ID")
        attrs = _attributes(el)
        tag = _ending(attrs, "TagNameAssignmentClass", "TagName") or el.get("TagName") or el.get("ComponentName") or eid
        x, y = sheet(at)
        node = {"id": eid, "kind": "equipment", "x": x, "y": y, "tag": tag, "class": el.get("ComponentClass", "")}
        if size := _size(el):
            node["w"], node["h"] = size
        nodes.append(node)
        for nozzle in el.iter():
            if _local(nozzle.tag) == "Nozzle" and nozzle.get("ID"):
                owner[nozzle.get("ID")] = eid
        owner[eid] = eid
    return nodes, owner


def _pipes(root: ET.Element, sheet: _Sheet, owner: dict[str, str]) -> tuple[list[dict], list[dict]]:
    """Centre lines of every pipe, and which equipment each piping system joins (all pairs of its ends)."""
    runs, connections = [], []
    for system in (el for el in root.iter() if _local(el.tag) == "PipingNetworkSystem"):
        ends = set()
        for seg in (el for el in system.iter() if _local(el.tag) == "PipingNetworkSegment"):
            for line in (el for el in seg.iter() if _local(el.tag) == "CenterLine"):
                pts = [sheet(p) for c in _kids(line, "Coordinate") if (p := _xy(c))]
                if len(pts) >= 2:
                    length = sum(math.dist(a, b) for a, b in zip(pts, pts[1:], strict=False))
                    runs.append({"color": PIPE_COLOUR, "points": pts, "length": round(length, 1)})
            for conn in _kids(seg, "Connection"):
                ends |= {owner[i] for i in (conn.get("FromID"), conn.get("ToID")) if i in owner}
        connections += [{"source": a, "target": b} for a, b in combinations(sorted(ends), 2)]
    return runs, connections


def _instruments(root: ET.Element, sheet: _Sheet) -> list[dict]:
    """Every process instrumentation function: its ISA tag ("TIC 4750"), centre and bubble diameter."""
    out = []
    for el in root.iter():
        if _local(el.tag) != "ProcessInstrumentationFunction":
            continue
        attrs = _attributes(el)
        letters = _ending(attrs, "CategoryAssignmentClass") + _ending(attrs, "FunctionsAssignmentClass")
        number = _ending(attrs, "NumberAssignmentClass")
        texts = [t.get("String", "") for lab in _kids(el, "Label") for t in lab.iter() if _local(t.tag) == "Text"]
        tag = " ".join(filter(None, [letters, number])) or " ".join(filter(None, texts)) or el.get("ID", "")
        circle = next((c for c in el.iter() if _local(c.tag) == "Circle"), None)
        at = _centre(el) or (_centre(circle) if circle is not None else None)
        if at is None or not tag:
            continue
        d = 2 * float(circle.get("Radius", DEFAULT_BUBBLE / 2)) if circle is not None else DEFAULT_BUBBLE
        x, y = sheet(at)
        out.append({"tag": tag, "x": x, "y": y, "d": d})
    return out


def read_dexpi(data: bytes) -> dict:
    """A read_drawing-shaped payload of a DEXPI file. Raises ValueError when it cannot be read."""
    root = _parse(data)
    sheet = _Sheet(_extent(root))
    w, h = sheet.size
    nodes, owner = _equipment(root, sheet)
    runs, connections = _pipes(root, sheet, owner)
    instruments = _instruments(root, sheet)
    lines, texts = _digital(_graphics(root, sheet))
    warnings = [] if nodes else ["No equipment with a position in this DEXPI file."]
    return {
        "viewBox": f"0 0 {w} {h}",
        "pageBox": [0, 0, w, h],
        "format": "dexpi",
        "nodes": [],
        "edges": [],
        "colorRuns": runs,
        "colorNodes": nodes,
        "colorEdges": [],
        "colorConnections": connections,
        "instruments": instruments,
        "colorCoded": True,
        "coloredFraction": 1.0,
        "stats": {
            "components": len(nodes),
            "connections": len(connections),
            "pipeSegments": len(runs),
            "colorRuns": len(runs),
            "nodes": len(nodes),
            "edges": 0,
            "instruments": len(instruments),
            "elapsedSeconds": 0,
        },
        "warnings": warnings,
        "lines": lines,
        "texts": texts,
    }


# --- the picture -------------------------------------------------------------------------------------------------


def _placement(el: ET.Element):
    """Local symbol coordinates -> the file's: rotated by the <Reference> direction, mirrored when the <Axis>
    points down, moved to the <Location>."""
    pos = _kid(el, "Position")
    at = _xy(_kid(pos, "Location")) if pos is not None else None
    if at is None:
        return None
    rx, ry = _xy(_kid(pos, "Reference")) or (1.0, 0.0)
    norm = math.hypot(rx, ry) or 1.0
    rx, ry = rx / norm, ry / norm
    axis = _kid(pos, "Axis")
    flip = -1.0 if axis is not None and float(axis.get("Z", "1") or 1) < 0 else 1.0
    return lambda p: (at[0] + p[0] * rx - flip * p[1] * ry, at[1] + p[0] * ry + flip * p[1] * rx)


def _style(el: ET.Element) -> tuple[str, float]:
    """(colour #rrggbb, line weight) of a primitive's <Presentation>."""
    pres = _kid(el, "Presentation")
    weight, colour = 0.25, "#111111"
    if pres is not None:
        try:
            weight = float(pres.get("LineWeight") or weight)
            r, g, b = (float(pres.get(c) or 0) for c in "RGB")
            colour = f"#{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}"
        except ValueError:
            pass
    return colour, max(weight, 0.18)


def _primitive(el: ET.Element, sheet: _Sheet, place) -> dict | None:
    """One graphic primitive in sheet coordinates (y down): a line, a circle / ellipse or a text; None when it has
    no usable coordinates."""
    name, to = _local(el.tag), (lambda p: sheet(place(p) if place else p))
    colour, weight = _style(el)
    if name in ("Line", "PolyLine", "Shape", "CenterLine"):
        pts = [to(p) for c in _kids(el, "Coordinate") if (p := _xy(c))]
        return (
            {"type": "line", "points": pts, "closed": name == "Shape", "color": colour, "width": weight}
            if len(pts) >= 2
            else None
        )
    centre = _centre(el)
    if centre is None:
        return None
    cx, cy = to(centre)
    if name in ("Circle", "Ellipse"):
        r = float(el.get("Radius", 1)) if name == "Circle" else None
        rx, ry = (r, r) if r is not None else (float(el.get("PrimaryAxis", 1)), float(el.get("SecondaryAxis", 1)))
        return {"type": "circle", "cx": cx, "cy": cy, "rx": rx, "ry": ry, "color": colour, "width": weight}
    text = el.get("String", "")
    return {"type": "text", "x": cx, "y": cy, "size": float(el.get("Height") or 2.5), "text": text} if text else None


def _graphics(root: ET.Element, sheet: _Sheet) -> list[dict]:
    """Every graphic primitive of the sheet, catalogue symbols placed at their <Position>."""
    catalogue = {
        sym.get("ComponentName"): sym
        for cat in root.iter()
        if _local(cat.tag) == "ShapeCatalogue"
        for sym in cat
        if sym.get("ComponentName")
    }
    out: list[dict | None] = []

    def walk(el: ET.Element) -> None:
        for child in el:
            name = _local(child.tag)
            if name == "ShapeCatalogue":
                continue
            if name in PRIMITIVES:
                out.append(_primitive(child, sheet, None))
                continue
            symbol = catalogue.get(child.get("ComponentName"))
            own = any(_local(c.tag) in PRIMITIVES for c in child)
            if symbol is not None and not own and (place := _placement(child)):
                out.extend(_primitive(p, sheet, place) for p in symbol.iter() if _local(p.tag) in PRIMITIVES)
            walk(child)

    walk(root)
    return [g for g in out if g]


def _digital(graphics: list[dict]) -> tuple[list[dict], list[dict]]:
    """The graphics as read_drawing's lines and texts (a circle as a closed polyline), for the digital construct."""
    lines, texts = [], []
    for g in graphics:
        if g["type"] == "line":
            pts = g["points"] + (g["points"][:1] if g["closed"] else [])
            lines.append({"points": pts, "color": g["color"], "width": g["width"]})
        elif g["type"] == "circle":
            n = 24
            pts = [
                [
                    round(g["cx"] + g["rx"] * math.cos(2 * math.pi * i / n), 3),
                    round(g["cy"] + g["ry"] * math.sin(2 * math.pi * i / n), 3),
                ]
                for i in range(n + 1)
            ]
            lines.append({"points": pts, "color": g["color"], "width": g["width"]})
        else:
            texts.append({"text": g["text"], "x": g["x"], "y": g["y"]})
    return lines, texts


def _svg(g: dict) -> str:
    if g["type"] == "line":
        joined = " ".join(f"{x},{y}" for x, y in g["points"])
        stroke = f'stroke="{g["color"]}" stroke-width="{g["width"]}"'
        return f'<{"polygon" if g["closed"] else "polyline"} points="{joined}" fill="none" {stroke}/>'
    if g["type"] == "circle":
        stroke = f'stroke="{g["color"]}" stroke-width="{g["width"]}"'
        return f'<ellipse cx="{g["cx"]}" cy="{g["cy"]}" rx="{g["rx"]}" ry="{g["ry"]}" fill="none" {stroke}/>'
    return (
        f'<text x="{g["x"]}" y="{g["y"]}" font-size="{g["size"]}" font-family="sans-serif" fill="#111">{escape(g["text"])}</text>'
    )


def picture(data: bytes) -> str:
    """The sheet as SVG, drawn from the file's graphics, for rendering to the P&ID picture."""
    root = _parse(data)
    sheet = _Sheet(_extent(root))
    w, h = sheet.size
    body = "\n".join(_svg(g) for g in _graphics(root, sheet))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w * 4}" height="{h * 4}">'
        f'<rect width="{w}" height="{h}" fill="#fff"/>\n{body}\n</svg>'
    )
