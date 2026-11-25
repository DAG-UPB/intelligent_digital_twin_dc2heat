"""SVG reader: the same four functions as pdf_reader, with the same return shapes.

page_box / polylines / styled_polylines / text_items match pdf_reader exactly, so an SVG
goes through both extractors unchanged.

An SVG is the easier source: no content streams, no FlateDecode, no CID
fonts. The work that remains is the same work: flattening nested
transforms, and turning curves into points.

Coordinates are returned in a bottom-left origin to match PDF, since the
callers assume it. SVG's y axis runs down, so y is flipped once on the
way out.
"""

from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from .geometry import IDENTITY, apply, cubic_bezier, mat_mul

_NS = "{http://www.w3.org/2000/svg}"

# Curves are sampled rather than solved: the consumers want points, and a
# P&ID's curves are short symbol arcs where 8 segments is already finer
# than the snap tolerances downstream.
_CURVE_STEPS = 8

_NUMS = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
_TRANSFORM = re.compile(r"(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)")
_CMD = re.compile(r"([MmZzLlHhVvCcSsQqTtAa])([^MmZzLlHhVvCcSsQqTtAa]*)")

# Containers whose contents are never drawn as geometry. clipPath and
# mask outlines are the reason this list exists: pdftocairo emits one per
# symbol, and read as paths they sprawl outside the page. <defs> is NOT
# here -- that exporter puts the drawing itself inside <defs> and pulls
# it in with <use>, so skipping it loses everything.
_NON_RENDERED = {"clipPath", "mask", "marker", "pattern", "metadata", "filter"}


def _nums(s):
    return [float(x) for x in _NUMS.findall(s or "")]


def _parse_transform(s):
    """Fold an SVG transform attribute into one matrix.

    Listed transforms apply left to right, so each is composed onto the
    accumulator in that order.
    """
    m = IDENTITY
    for kind, args in _TRANSFORM.findall(s or ""):
        v = _nums(args)
        if kind == "matrix" and len(v) == 6:
            t = tuple(v)
        elif kind == "translate":
            t = (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0)
        elif kind == "scale":
            sx = v[0] if v else 1
            t = (sx, 0, 0, v[1] if len(v) > 1 else sx, 0, 0)
        elif kind == "rotate" and v:
            a = math.radians(v[0])
            cos, sin = math.cos(a), math.sin(a)
            t = (cos, sin, -sin, cos, 0, 0)
            if len(v) >= 3:  # rotation about a point
                t = mat_mul(mat_mul((1, 0, 0, 1, -v[1], -v[2]), t), (1, 0, 0, 1, v[1], v[2]))
        elif kind == "skewX" and v:
            t = (1, 0, math.tan(math.radians(v[0])), 1, 0, 0)
        elif kind == "skewY" and v:
            t = (1, math.tan(math.radians(v[0])), 0, 1, 0, 0)
        else:
            continue
        m = mat_mul(t, m)
    return m


def _parse_color(value, inherited=None):
    """Stroke colour as an (r, g, b) 0-1 triple, or None.

    'none' means the shape is not stroked at all, which is different from
    absent: absent inherits, none suppresses. Returning None for both is
    fine here because a caller only asks about colour for shapes it has
    already decided are stroked.
    """
    if not value or value in ("none", "transparent"):
        return inherited
    v = value.strip().lower()
    if v.startswith("#"):
        h = v[1:]
        if len(h) == 3:
            h = "".join(ch * 2 for ch in h)
        if len(h) == 6:
            return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    if v.startswith("rgb"):
        n = _nums(v)
        if len(n) >= 3:
            # rgb() takes 0-255 or percentages, and the unit picks the
            # divisor. pdftocairo writes rgb(100%,0%,0%) for red; read as
            # 0-255 that is 0.392, so every colour came out at 39%
            # brightness and the chroma filter lost most of the pipework.
            div = 100.0 if "%" in v else 255.0
            return tuple(min(1.0, c / div) for c in n[:3])
    named = {
        "black": (0, 0, 0),
        "white": (1, 1, 1),
        "red": (1, 0, 0),
        "lime": (0, 1, 0),
        "green": (0, 0.5, 0),
        "blue": (0, 0, 1),
        "yellow": (1, 1, 0),
        "cyan": (0, 1, 1),
        "aqua": (0, 1, 1),
        "magenta": (1, 0, 1),
        "fuchsia": (1, 0, 1),
        "gray": (0.5, 0.5, 0.5),
        "grey": (0.5, 0.5, 0.5),
        "silver": (0.75, 0.75, 0.75),
        "maroon": (0.5, 0, 0),
        "navy": (0, 0, 0.5),
        "olive": (0.5, 0.5, 0),
        "purple": (0.5, 0, 0.5),
        "teal": (0, 0.5, 0.5),
        "orange": (1, 0.65, 0),
    }
    return named.get(v, inherited)


def _style_dict(el):
    """Presentation attributes plus anything in a style="" attribute.

    style wins, per CSS cascade. A <style> stylesheet with selectors is
    not resolved: that needs a CSS engine, and CAD exporters write
    per-element attributes.
    """
    out = {}
    for k in ("stroke", "stroke-width", "fill"):
        if el.get(k) is not None:
            out[k] = el.get(k)
    for part in (el.get("style") or "").split(";"):
        if ":" in part:
            k, v = part.split(":", 1)
            out[k.strip()] = v.strip()
    return out


def _quad(p0, p1, p2, steps=_CURVE_STEPS):
    pts = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        pts.append(
            (
                u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
            )
        )
    return pts


def _parse_path(d):
    """Path data to a list of subpaths in the element's own coordinates.

    Arcs (A/a) are approximated by a straight chord. On a P&ID an arc is
    a symbol detail, and a wrong-shaped 4pt curve does not move any
    endpoint enough to matter downstream.
    """
    subs, cur = [], []
    x = y = 0.0
    start = (0.0, 0.0)
    prev_c2 = None
    prev_q1 = None

    for cmd, argstr in _CMD.findall(d or ""):
        a = _nums(argstr)
        rel = cmd.islower()
        c = cmd.upper()

        if c == "M":
            for i in range(0, len(a) - 1, 2):
                nx, ny = (x + a[i], y + a[i + 1]) if rel else (a[i], a[i + 1])
                if i == 0:
                    if len(cur) >= 2:
                        subs.append(cur)
                    cur = [(nx, ny)]
                    start = (nx, ny)
                else:
                    cur.append((nx, ny))
                x, y = nx, ny
            prev_c2 = prev_q1 = None
        elif c == "Z":
            if cur:
                cur.append(start)
                if len(cur) >= 2:
                    subs.append(cur)
                cur = [start]
                x, y = start
            prev_c2 = prev_q1 = None
        elif c == "L":
            for i in range(0, len(a) - 1, 2):
                x, y = (x + a[i], y + a[i + 1]) if rel else (a[i], a[i + 1])
                cur.append((x, y))
            prev_c2 = prev_q1 = None
        elif c == "H":
            for v in a:
                x = x + v if rel else v
                cur.append((x, y))
            prev_c2 = prev_q1 = None
        elif c == "V":
            for v in a:
                y = y + v if rel else v
                cur.append((x, y))
            prev_c2 = prev_q1 = None
        elif c in ("C", "S"):
            step = 6 if c == "C" else 4
            for i in range(0, len(a) - step + 1, step):
                if c == "C":
                    c1 = (x + a[i], y + a[i + 1]) if rel else (a[i], a[i + 1])
                    c2 = (x + a[i + 2], y + a[i + 3]) if rel else (a[i + 2], a[i + 3])
                    nx, ny = (x + a[i + 4], y + a[i + 5]) if rel else (a[i + 4], a[i + 5])
                else:
                    c1 = (2 * x - prev_c2[0], 2 * y - prev_c2[1]) if prev_c2 else (x, y)
                    c2 = (x + a[i], y + a[i + 1]) if rel else (a[i], a[i + 1])
                    nx, ny = (x + a[i + 2], y + a[i + 3]) if rel else (a[i + 2], a[i + 3])
                cur.extend(cubic_bezier((x, y), c1, c2, (nx, ny)))
                x, y, prev_c2 = nx, ny, c2
            prev_q1 = None
        elif c in ("Q", "T"):
            step = 4 if c == "Q" else 2
            for i in range(0, len(a) - step + 1, step):
                if c == "Q":
                    q1 = (x + a[i], y + a[i + 1]) if rel else (a[i], a[i + 1])
                    nx, ny = (x + a[i + 2], y + a[i + 3]) if rel else (a[i + 2], a[i + 3])
                else:
                    q1 = (2 * x - prev_q1[0], 2 * y - prev_q1[1]) if prev_q1 else (x, y)
                    nx, ny = (x + a[i], y + a[i + 1]) if rel else (a[i], a[i + 1])
                cur.extend(_quad((x, y), q1, (nx, ny)))
                x, y, prev_q1 = nx, ny, q1
            prev_c2 = None
        elif c == "A":
            for i in range(0, len(a) - 6, 7):
                nx, ny = (x + a[i + 5], y + a[i + 6]) if rel else (a[i + 5], a[i + 6])
                cur.append((nx, ny))
                x, y = nx, ny
            prev_c2 = prev_q1 = None

    if len(cur) >= 2:
        subs.append(cur)
    return subs


def _shapes(el):
    """Subpaths for one element, in its own coordinates, or []."""
    tag = el.tag.replace(_NS, "")
    g = el.get
    if tag == "path":
        return _parse_path(g("d"))
    if tag == "line":
        return [[(float(g("x1", 0)), float(g("y1", 0))), (float(g("x2", 0)), float(g("y2", 0)))]]
    if tag in ("polyline", "polygon"):
        v = _nums(g("points"))
        pts = list(zip(v[0::2], v[1::2], strict=False))
        if tag == "polygon" and pts:
            pts.append(pts[0])
        return [pts] if len(pts) >= 2 else []
    if tag == "rect":
        x, y = float(g("x", 0) or 0), float(g("y", 0) or 0)
        w, h = float(g("width", 0) or 0), float(g("height", 0) or 0)
        if w <= 0 or h <= 0:
            return []
        return [[(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)]]
    if tag in ("circle", "ellipse"):
        cx, cy = float(g("cx", 0) or 0), float(g("cy", 0) or 0)
        if tag == "circle":
            rx = ry = float(g("r", 0) or 0)
        else:
            rx, ry = float(g("rx", 0) or 0), float(g("ry", 0) or 0)
        if rx <= 0 or ry <= 0:
            return []
        n = 24
        return [[(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]]
    return []


def _viewbox(root):
    """Page rectangle as (x0, y0, x1, y1) and the height used to flip y."""
    vb = _nums(root.get("viewBox") or "")
    if len(vb) == 4 and vb[2] > 0 and vb[3] > 0:
        return (vb[0], vb[1], vb[0] + vb[2], vb[1] + vb[3]), vb[1] + vb[3]
    w = _nums(root.get("width") or "")
    h = _nums(root.get("height") or "")
    if w and h and w[0] > 0 and h[0] > 0:
        return (0.0, 0.0, w[0], h[0]), h[0]
    return None, None


def _index_ids(root):
    """Map id -> element, so <use href="#x"> can find its definition."""
    return {el.get("id"): el for el in root.iter() if el.get("id")}


def _use_target(el, index):
    """The element a <use> references, via href or xlink:href."""
    ref = el.get("href") or el.get("{http://www.w3.org/1999/xlink}href") or ""
    return index.get(ref[1:]) if ref.startswith("#") else None


# Depth guard for <use> chains: a definition may reference another, and a
# malformed file may reference itself. Real symbol nesting is 1-2 deep.
_MAX_USE_DEPTH = 8


def _walk(root):
    """Yield (element, ctm, style) for every drawable, transforms folded.

    Nested <g transform=...> is the SVG equivalent of the PDF cm stack,
    and the same rule applies: a symbol's local coordinates mean nothing
    until its ancestors' matrices are applied.

    A <symbol> or an element under <defs> is a template: it is drawn at
    its own origin and means nothing until a <use> places it. So the walk
    never descends into a definition directly -- it reaches one only
    through the <use> that references it, carrying that <use>'s transform.
    Reading templates as drawn geometry is what put symbol bodies at
    negative coordinates and lost all 62 placed symbols on the CAD export.
    """
    index = _index_ids(root)
    defined = set()
    for d in root.iter(_NS + "defs"):
        for e in d.iter():
            defined.add(id(e))
    for s in root.iter(_NS + "symbol"):
        for e in s.iter():
            defined.add(id(e))

    # (element, ctm, style, depth, forced) -- forced marks an element
    # reached through <use>, which is drawn even though it is a template.
    stack = [(root, IDENTITY, {}, 0, False)]
    while stack:
        el, ctm, style, depth, forced = stack.pop()
        tag = el.tag.replace(_NS, "")
        if tag in _NON_RENDERED:
            continue
        if not forced and id(el) in defined:
            continue
        # Glyph outlines are font templates, each drawn at its own origin
        # and positioned only when <use> references it. pdftocairo emits
        # 364 of them, putting 30844 points outside the page if read as
        # drawn geometry. Text is recovered from <text>, so skipping them
        # loses nothing. Other id'd groups under <defs> -- this exporter's
        # compositing-group-N -- hold the actual drawing and must stay.
        if tag == "g" and (el.get("id") or "").startswith("glyph"):
            continue
        m = mat_mul(_parse_transform(el.get("transform")), ctm)  # child first, then ancestors
        st = {**style, **_style_dict(el)}

        if tag == "use":
            target = _use_target(el, index)
            if target is not None and depth < _MAX_USE_DEPTH:
                # x/y on <use> translate the instance, on top of its own
                # transform. A <symbol> itself is a container, so its
                # children are placed; any other target is placed directly.
                dx = float(_nums(el.get("x") or "0")[0]) if el.get("x") else 0.0
                dy = float(_nums(el.get("y") or "0")[0]) if el.get("y") else 0.0
                um = mat_mul((1.0, 0.0, 0.0, 1.0, dx, dy), m)
                tm = mat_mul(_parse_transform(target.get("transform")), um)
                ts = {**st, **_style_dict(target)}
                kids = list(target) if target.tag.replace(_NS, "") in ("symbol", "g", "defs") else [target]
                for child in reversed(kids):
                    stack.append((child, tm, ts, depth + 1, True))
            continue

        yield el, m, st
        for child in reversed(list(el)):
            stack.append((child, m, st, depth, forced))


def _placement_offset(root):
    """Inverse of a placement transform left uncancelled on the drawing.

    pdftocairo writes the drawing into id'd groups carrying
    translate(dx, dy) and references them from a <use> inside a <mask>
    that carries translate(-dx, -dy). Executing masks is rendering, not
    geometry, so that reference is never followed and every point lands
    shifted by exactly dx, dy -- measured at 345.6, 259.2 on the test
    drawing, matching the attribute exactly.

    Read the inverse off the referencing group rather than guessing it:
    if a top-level group translates by the negation of what the
    definition groups translate by, that pair is the offset to cancel.
    """
    tops = [c for c in root if c.tag.replace(_NS, "") == "g"]
    defs_groups = [g for d in root.iter(_NS + "defs") for g in d if g.tag.replace(_NS, "") == "g" and g.get("transform")]
    if not tops or not defs_groups:
        return IDENTITY
    for top in tops:
        a = _parse_transform(top.get("transform"))
        for g in defs_groups:
            b = _parse_transform(g.get("transform"))
            if abs(a[4] + b[4]) < 1e-6 and abs(a[5] + b[5]) < 1e-6 and (abs(a[4]) > 1e-6 or abs(a[5]) > 1e-6):
                return a
    return IDENTITY


def _collect(svg_path):
    tree = ET.parse(svg_path)
    root = tree.getroot()
    box, flip_h = _viewbox(root)

    out = []
    cancel = _placement_offset(root)
    for el, m, st in _walk(root):
        if cancel != IDENTITY:
            m = mat_mul(m, cancel)
        for sub in _shapes(el):
            if len(sub) < 2:
                continue
            pts = [apply(m, px, py) for px, py in sub]
            out.append((pts, st))

    if box is None:
        pts = [p for pl, _ in out for p in pl]
        if not pts:
            raise ValueError("SVG has no viewBox, no width/height and no geometry")
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        box, flip_h = (min(xs), min(ys), max(xs), max(ys)), max(ys)

    # SVG y runs down, PDF y runs up. Flip once here so every caller sees
    # the bottom-left origin it already assumes.
    flipped = [([(x, flip_h - y) for x, y in pl], st) for pl, st in out]
    return flipped, (box[0], flip_h - box[3], box[2], flip_h - box[1])


def page_box(svg_path: str | Path) -> tuple[float, float, float, float]:
    """(x0, y0, x1, y1) of the viewBox (or width/height, or the drawn extent), y up."""
    return _collect(svg_path)[1]


def polylines(svg_path: str | Path) -> list[list[tuple[float, float]]]:
    """Every drawn shape as a polyline, transforms applied, y up."""
    return [pl for pl, _ in _collect(svg_path)[0]]


def styled_polylines(svg_path: str | Path) -> list[dict]:
    """Stroked polylines with colour and width, matching pdf_reader's shape.

    A shape with stroke="none" is skipped: it is filled-only, and the
    colour layer reads this to decide which lines are pipes.
    """
    out = []
    for pl, st in _collect(svg_path)[0]:
        stroke = st.get("stroke")
        if stroke in ("none", "transparent"):
            continue
        color = _parse_color(stroke) if stroke else (0.0, 0.0, 0.0)
        try:
            width = float(_nums(st.get("stroke-width", "1"))[0])
        except (IndexError, ValueError):
            width = 1.0
        out.append({"points": pl, "color": color, "width": width})
    return out


def text_items(svg_path: str | Path) -> list[dict]:
    """[{text, x, y}] for <text>, matching pdf_reader.text_items."""
    tree = ET.parse(svg_path)
    root = tree.getroot()
    _, flip_h = _viewbox(root)
    if flip_h is None:
        flip_h = _collect(svg_path)[1][3]

    items = []
    for el, m, _ in _walk(root):
        if el.tag.replace(_NS, "") not in ("text", "tspan"):
            continue
        s = "".join(el.itertext()).strip()
        if not s:
            continue
        try:
            x = float(_nums(el.get("x", "0"))[0])
            y = float(_nums(el.get("y", "0"))[0])
        except (IndexError, ValueError):
            continue
        px, py = apply(m, x, y)
        items.append({"text": s, "x": px, "y": flip_h - py})
    return items
