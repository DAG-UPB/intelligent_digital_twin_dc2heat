"""The digital construct of a P&ID: the drawing as shapes the user and the assistant edit (pid_construct.json).

Physical structure shows three levels: the picture (pid.png), this construct over it, and the variables on top.
A shape is a rectangle, circle, line or text; positions are fractions of the drawing (0..1, y down), so they sit on
the picture at any size:
    rect / circle  x, y = centre, w, h = size          line  points = [[x, y], ...]          text  x, y = anchor
    label          the tag or name shown              role  component | instrument | pipe | note | drawing | ""
    color          a "drawing" shape's own colour (#rrggbb), as on the sheet
    props          its values (design data), name -> number or text, e.g. {"capacity_kW": 50}
construct_of seeds it from an extraction in two layers. First the drawing itself, all digital: every stroked line of
the sheet (in its colour) and every text, role "drawing", so the P&ID is complete without its picture. Then what is
recognised in it: named components as rectangles, instrument bubbles (pid/instruments.py) as circles, pipe runs as
lines. A component's box is its symbol's outline found in those lines, never a size made up. The recognition is a
first guess, meant to be corrected by hand or by an agent.
"""

from __future__ import annotations

import math
import re

from ..core.limits import PID_CONSTRUCT_MAX_POINTS, PID_CONSTRUCT_MAX_SHAPES
from .plant import components_of

KINDS = {"rect", "circle", "line", "text"}
ROLES = {"component", "instrument", "pipe", "note", "drawing", ""}
COLOR = re.compile(r"#[0-9a-fA-F]{6}")
COMPONENT_SIZE = (0.04, 0.03)  # a component's box in an old plant graph (no drawing to measure it on)
SYMBOL = (0.003, 0.04)  # a symbol's size as a fraction of the sheet's diagonal: a dot is smaller, a frame around a group bigger
REACH = 0.02  # a tag is written beside its symbol: this far (of the diagonal) from its outline at most
MAX_LABEL = 80
DRAWING_STEP = 1e-5  # the drawing's lines: only points that coincide are merged
MAX_PROPS = 30
PROP_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_ .%/-]{0,39}")
SPAN = (-0.5, 1.5)  # a little off the sheet is fine (dragged to the edge), far off is a mistake


def _page(payload: dict) -> tuple[float, float]:
    try:
        _, _, w, h = (float(v) for v in payload["viewBox"].split())
    except (KeyError, ValueError) as exc:
        raise ValueError("drawing has no page size") from exc
    if not (w > 0 and h > 0):
        raise ValueError("drawing has no page size")
    return w, h


def _thin(points: list, w: float, h: float, step: float = 1e-3) -> list[list[float]]:
    """A run as fractions, without the points closer than `step` of the sheet (0.1 %) to the one before (bezier
    steps). The drawing's own lines use a finer step: an arrowhead or a tick is shorter than 0.1 % of a sheet."""
    out: list[list[float]] = []
    for x, y in points:
        p = [round(x / w, 6), round(y / h, 6)]
        if not out or math.dist(p, out[-1]) >= step:
            out.append(p)
    if len(out) > PID_CONSTRUCT_MAX_POINTS:
        step = math.ceil(len(out) / PID_CONSTRUCT_MAX_POINTS)
        out = out[::step] + ([out[-1]] if (len(out) - 1) % step else [])
    return out


def _box(sid: str, kind: str, x: float, y: float, size: tuple[float, float], label: str, role: str) -> dict:
    return {"id": sid, "kind": kind, "x": x, "y": y, "w": size[0], "h": size[1], "label": label, "role": role}


def _drawing(payload: dict, w: float, h: float) -> list[dict]:
    """The sheet as it is: every stroked line (in its colour) and every text, as "drawing" shapes."""
    shapes = []
    for i, line in enumerate(payload.get("lines", [])):
        points = _thin(line["points"], w, h, DRAWING_STEP)
        if len(points) >= 2:
            color = line.get("color") if COLOR.fullmatch(str(line.get("color"))) else "#000000"
            shapes.append({"id": f"draw:{i}", "kind": "line", "points": points, "label": "", "role": "drawing", "color": color})
    for i, t in enumerate(payload.get("texts", [])):
        label = str(t["text"]).strip()[:MAX_LABEL]
        shapes.append({"id": f"text:{i}", "kind": "text", "x": t["x"] / w, "y": t["y"] / h, "label": label, "role": "drawing"})
    return shapes


def _symbols(payload: dict) -> list[tuple[float, float, float, float]]:
    """The boxes of the closed outlines in the drawing's lines that are symbol-sized (pump circles, tank and
    exchanger outlines), in screen space."""
    w, h = _page(payload)
    diag = math.hypot(w, h)
    boxes = []
    for line in payload.get("lines", []):
        pts = line["points"]
        if len(pts) < 4:
            continue
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        bw, bh = max(xs) - min(xs), max(ys) - min(ys)
        closed = math.dist(pts[0], pts[-1]) <= 0.1 * max(bw, bh)
        if closed and SYMBOL[0] * diag <= max(bw, bh) <= SYMBOL[1] * diag and min(bw, bh) > 0.2 * max(bw, bh):
            boxes.append((min(xs), min(ys), max(xs), max(ys)))
    return boxes


def _symbol_at(x: float, y: float, boxes: list, diag: float) -> tuple[float, float, float, float] | None:
    """The symbol nearest to a tag's point (0 inside its outline; the smaller one when two are as near), within
    REACH; None when there is none."""

    def gap(b):
        return math.hypot(max(b[0] - x, 0, x - b[2]), max(b[1] - y, 0, y - b[3]))

    near = [b for b in boxes if gap(b) <= REACH * diag]
    return min(near, key=lambda b: (gap(b), (b[2] - b[0]) * (b[3] - b[1]))) if near else None


def construct_of(payload: dict) -> dict:
    """The construct of a read_drawing payload: the drawing itself (all lines and texts), then the components,
    instruments and pipes recognised in it. When the sheet has more lines than fit, the recognised shapes are kept
    and the drawing's lines beyond the limit are left out."""
    w, h = _page(payload)
    shapes = []
    instruments = payload.get("instruments", [])
    tags = {b["tag"] for b in instruments}
    # a DEXPI file gives each piece of equipment its size; a drawing read from its geometry does not
    sizes = {n["id"]: (n["w"] / w, n["h"] / h) for n in payload.get("colorNodes", []) if n.get("w") and n.get("h")}
    # a component is the symbol drawn where its tag meets the pipe: its outline found in the drawing's own lines;
    # a tag with no symbol there gets no box (its text is in the drawing, and pid_plant.json still lists it)
    bubble = [(b["x"], b["y"], b["d"]) for b in instruments]  # an instrument's circle is its own shape, not equipment
    boxes = [
        b
        for b in _symbols(payload)
        if not any(math.dist(((b[0] + b[2]) / 2, (b[1] + b[3]) / 2), (x, y)) < d / 2 for x, y, d in bubble)
    ]
    diag = math.hypot(w, h)
    for c in components_of(payload)["components"]:
        if c["label"] in tags:  # the tag reader also takes a bubble's "PT 7" for equipment: it is the instrument
            continue
        if c["id"] in sizes:
            size = tuple(min(1.0, max(0.001, v)) for v in sizes[c["id"]])
            shapes.append(_box(f"comp:{c['id']}", "rect", c["x"] / w, c["y"] / h, size, c["label"], "component"))
        elif (b := _symbol_at(c["x"], c["y"], boxes, diag)) is not None:
            centre, size = ((b[0] + b[2]) / 2 / w, (b[1] + b[3]) / 2 / h), ((b[2] - b[0]) / w, (b[3] - b[1]) / h)
            size = tuple(min(1.0, max(0.001, v)) for v in size)
            shapes.append(_box(f"comp:{c['id']}", "rect", *centre, size, c["label"], "component"))
    for i, b in enumerate(instruments):
        size = (b["d"] / w, b["d"] / h)
        shapes.append(_box(f"inst:{i}", "circle", b["x"] / w, b["y"] / h, size, b["tag"], "instrument"))
    runs = [r["points"] for r in payload.get("colorRuns", [])] or [e["route"] for e in payload.get("edges", [])]
    for i, run in enumerate(runs):
        points = _thin(run, w, h)
        if len(points) >= 2:
            shapes.append({"id": f"pipe:{i}", "kind": "line", "points": points, "label": "", "role": "pipe"})
    shapes = shapes[:PID_CONSTRUCT_MAX_SHAPES]
    drawing = _drawing(payload, w, h)[: PID_CONSTRUCT_MAX_SHAPES - len(shapes)]
    return {"shapes": drawing + shapes}  # drawn bottom to top: the sheet, then what was recognised on it


def from_plant(plant: dict) -> dict:
    """A construct from an older pid_plant.json (components and pipes, no instruments: they were not read then)."""
    shapes = [
        _box(f"comp:{c['id']}", "rect", c["x"], c["y"], COMPONENT_SIZE, c["label"], "component")
        for c in plant.get("components", [])
    ]
    shapes += [
        {"id": f"pipe:{i}", "kind": "line", "points": [[x, y] for x, y in p], "label": "", "role": "pipe"}
        for i, p in enumerate(plant.get("pipes", []))
        if len(p) >= 2
    ]
    return {"shapes": shapes[:PID_CONSTRUCT_MAX_SHAPES]}


def _num(shape: dict, key: str, lo: float, hi: float) -> float:
    v = shape.get(key)
    if not isinstance(v, int | float) or isinstance(v, bool) or not math.isfinite(v) or not lo <= v <= hi:
        raise ValueError(f"shape {shape.get('id')!r}: {key} must be a number from {lo} to {hi}")
    return float(v)


def _props(sid: str, props: object) -> dict:
    """A shape's values, checked: names of letters, digits and _ .%/- (up to 40), numbers or short texts."""
    if not isinstance(props, dict) or len(props) > MAX_PROPS:
        raise ValueError(f"shape {sid!r}: props is an object of up to {MAX_PROPS} values")
    out = {}
    for name, value in props.items():
        if not PROP_NAME.fullmatch(str(name)):
            raise ValueError(f"shape {sid!r}: value name {name!r} must start with a letter (up to 40 characters)")
        if isinstance(value, bool) or not isinstance(value, int | float | str):
            raise ValueError(f"shape {sid!r}: {name} must be a number or a text")
        if isinstance(value, str) and len(value) > MAX_LABEL:
            raise ValueError(f"shape {sid!r}: {name} is longer than {MAX_LABEL} characters")
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(f"shape {sid!r}: {name} must be a finite number")
        out[str(name)] = value
    return out


def check(construct: dict) -> dict:
    """The construct, cleaned (only the keys its kind uses); ValueError naming the first bad shape."""
    shapes = construct.get("shapes")
    if not isinstance(shapes, list):
        raise ValueError("shapes must be a list")
    if len(shapes) > PID_CONSTRUCT_MAX_SHAPES:
        raise ValueError(f"at most {PID_CONSTRUCT_MAX_SHAPES} shapes")
    out, seen = [], set()
    for s in shapes:
        sid, kind = str(s.get("id", "")).strip(), s.get("kind")
        if not sid or len(sid) > 64:
            raise ValueError("every shape needs an id (up to 64 characters)")
        if sid in seen:
            raise ValueError(f"two shapes have the id {sid!r}")
        seen.add(sid)
        if kind not in KINDS:
            raise ValueError(f"shape {sid!r}: kind must be one of {', '.join(sorted(KINDS))}")
        label, role = str(s.get("label") or ""), str(s.get("role") or "")
        if len(label) > MAX_LABEL:
            raise ValueError(f"shape {sid!r}: label longer than {MAX_LABEL} characters")
        if role not in ROLES:
            raise ValueError(f"shape {sid!r}: role must be one of {', '.join(r or '(none)' for r in sorted(ROLES))}")
        clean: dict = {"id": sid, "kind": kind, "label": label, "role": role}
        if s.get("color") is not None:
            if not COLOR.fullmatch(str(s["color"])):
                raise ValueError(f"shape {sid!r}: color is #rrggbb")
            clean["color"] = str(s["color"])
        if s.get("props"):
            clean["props"] = _props(sid, s["props"])
        if kind == "line":
            points = s.get("points")
            if not isinstance(points, list) or not 2 <= len(points) <= PID_CONSTRUCT_MAX_POINTS:
                raise ValueError(f"shape {sid!r}: a line needs 2 to {PID_CONSTRUCT_MAX_POINTS} points")
            if not all(isinstance(p, list | tuple) and len(p) == 2 for p in points):
                raise ValueError(f"shape {sid!r}: each point is [x, y]")
            clean["points"] = [[_num({"id": sid, "x": x}, "x", *SPAN), _num({"id": sid, "y": y}, "y", *SPAN)] for x, y in points]
        else:
            clean["x"], clean["y"] = _num(s, "x", *SPAN), _num(s, "y", *SPAN)
            if kind != "text":
                clean["w"], clean["h"] = _num(s, "w", 0.001, 1.0), _num(s, "h", 0.001, 1.0)
        out.append(clean)
    return {"shapes": out}
