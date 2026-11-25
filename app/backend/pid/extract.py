"""Read a drawing file (PDF or SVG) into the screen-space graph payload.

read_drawing(path) runs both extractors and returns plain JSON-able dicts, flipped into
screen coordinates (y down), with the quality warnings attached:

- the geometric one (geometric.py) always: equipment tags + junction clusters, chained pipes;
- the colour one (color_runs.py + color_graph.py) when the drawing colour-codes its pipework:
  named components, pipe segments and the component-to-component connections traced through
  them. The plant graph (plant.components_of) prefers it when it found named components.

No HTTP here: failures raise ValueError with a message meant for a human to read, and the
caller decides what status code that is.
"""

from __future__ import annotations

import time
from pathlib import Path

from ..core.limits import PID_READ_TIMEOUT_S
from . import pdf_reader, svg_reader
from .color_graph import build as build_color_graph
from .color_runs import CHROMA_MIN, applies, chroma, colored_runs
from .crop import crop
from .dexpi import is_dexpi, read_dexpi
from .geometric import assemble_topology
from .geometry import time_limit
from .instruments import instrument_bubbles

_READERS = {".pdf": pdf_reader, ".svg": svg_reader}

# Shown in the import dialog on every extraction; kept verbatim. Symbol-template matching
# was removed (no template library was ever shipped), so it is always true.
_NO_TEMPLATES = "no template library given -- symbol detection skipped; nodes are equipment tags + junction clusters only"


def sniff(header: bytes) -> str:
    """Return ".pdf", ".svg" or ".xml" (a DEXPI P&ID, pid/dexpi.py) from the first bytes of a file.

    Content, not filename: the extension picks the reader downstream, so a
    mislabelled file would reach the wrong parser and fail with something
    unreadable instead of this.
    """
    if header[:5] == b"%PDF-":
        return ".pdf"
    if is_dexpi(header):
        return ".xml"
    if b"<svg" in header[:1024].lower() or header.lstrip()[:5] == b"<?xml":
        return ".svg"
    raise ValueError("Not a PDF, SVG or DEXPI file (no %PDF- header, no <svg> and no <PlantModel> element).")


def _reader(path: str):
    ext = Path(path).suffix.lower()
    if ext not in _READERS:
        raise ValueError(f"unsupported drawing format '{ext}'; expected one of " + ", ".join(sorted(_READERS)))
    return _READERS[ext]


def _extract(box, polylines, styled, texts, sheet=None) -> dict:
    """Both extractors on one drawing's geometry (PDF space, y up); `sheet`: the whole page when `box` is an area."""
    warnings = [_NO_TEMPLATES]
    topo = assemble_topology(box, polylines, texts)

    # The colour graph is reported alongside the geometric one, never merged into it:
    # on a drawing that does not use colour, applies() is false and this adds nothing.
    runs = []
    color_graph = {}
    is_colored, frac = applies(styled)
    if is_colored:
        runs = colored_runs(styled)
        try:
            # Achromatic strokes are equipment outlines and frame. The symbols among them
            # are where pipes stop, so they carry connectivity the runs alone are missing.
            shapes = [d for d in styled if chroma(d.get("color")) < CHROMA_MIN and len(d["points"]) >= 2]
            color_graph = build_color_graph(runs, texts, page_box=box, shapes=shapes)
            warnings.extend(color_graph.get("warnings", []))
        except Exception as exc:  # a colour-graph bug must not cost the geometric result
            warnings.append(f"colour topology failed: {exc}")

    return {
        "nodes": topo["nodes"],
        "edges": topo["edges"],
        "colorRuns": runs,
        "colorNodes": color_graph.get("nodes", []),
        "colorEdges": color_graph.get("edges", []),
        # Component to component, traced through the pipe network. colorEdges are pipe
        # segments and mostly end on unnamed junctions; this is the plant-level graph.
        "colorConnections": color_graph.get("connections", []),
        # instrument bubbles (a circle with an ISA code): where the plant is measured, candidate variables
        "instruments": instrument_bubbles(polylines, texts, box, sheet),
        "colorCoded": is_colored,
        "coloredFraction": round(frac, 3),
        "warnings": warnings,
    }


def _hex(color) -> str:
    return "#" + "".join(f"{int(255 * max(0.0, min(1.0, c))):02x}" for c in color)


def _payload(result, n_polylines, box, elapsed, warnings) -> dict:
    """Flip to screen space (y' = page height - y) and shape the response."""
    x0, y0, x1, y1 = box
    page_width, page_height = x1 - x0, y1 - y0

    def flip(y):
        return page_height - y

    def flip_route(points):
        return [[p[0], flip(p[1])] for p in points]

    nodes = [{**n, "y": flip(n["y"])} for n in result["nodes"]]
    edges = [{**e, "route": flip_route(e["route"])} for e in result["edges"]]
    color_runs = [
        {"color": _hex(r["color"]), "points": flip_route(r["points"]), "length": round(r["length"], 1)}
        for r in result["colorRuns"]
    ]
    # label_y is a second y in the same space: flip it too, or a component's tag is
    # drawn mirrored across the sheet from its symbol.
    color_nodes = [
        {**n, "y": flip(n["y"]), **({"label_y": flip(n["label_y"])} if "label_y" in n else {})} for n in result["colorNodes"]
    ]
    color_edges = [{**e, "color": _hex(e["color"]), "route": flip_route(e["route"])} for e in result["colorEdges"]]
    instruments = [{**b, "y": flip(b["y"])} for b in result["instruments"]]
    by_source: dict[str, int] = {}
    for n in result["nodes"]:
        by_source[n["source"]] = by_source.get(n["source"], 0) + 1

    return {
        "viewBox": f"0 0 {page_width} {page_height}",
        "pageBox": [x0, y0, x1, y1],
        "nodes": nodes,
        "edges": edges,
        "colorRuns": color_runs,
        "colorNodes": color_nodes,
        "colorEdges": color_edges,
        "colorConnections": result["colorConnections"],
        "instruments": instruments,
        "colorCoded": result["colorCoded"],
        "coloredFraction": result["coloredFraction"],
        "stats": {
            "nodes": len(nodes),
            "edges": len(edges),
            "bySource": by_source,
            "colorRuns": len(color_runs),
            "components": sum(1 for n in color_nodes if n["kind"] != "terminal"),
            # pipeSegments counts drawn runs between junctions; connections counts the
            # component-to-component links traced through them (the plant-level figure).
            "pipeSegments": len(color_edges),
            "connections": len(result["colorConnections"]),
            "instruments": len(instruments),
            "polylines": n_polylines,
            "elapsedSeconds": round(elapsed, 3),
        },
        "warnings": warnings,
    }


def read_drawing(path: str | Path, area: tuple | None = None) -> dict:
    """Extract the graph from one drawing file (.pdf or .svg) and shape it for display.

    `area` (x0, y0, x1, y1 as fractions of the page, y down; pid/crop.py): read only that part, as if it were the
    page. A DEXPI file is read whole: it holds no legend to leave out.

    Blocking CPU work, seconds of it: an async caller runs this in a thread.
    Raises ValueError("Extraction failed: ...") when the file cannot be read.
    """
    path = str(path)
    if Path(path).suffix.lower() == ".xml":  # DEXPI: read, not recognised from the geometry
        return read_dexpi(Path(path).read_bytes())
    t0 = time.monotonic()
    try:
        with time_limit(PID_READ_TIMEOUT_S):  # the geometric steps check it (pid/geometry.py in_time)
            reader = _reader(path)
            # each read once: the PDF reader re-parses the whole file per call
            box = reader.page_box(path)
            polylines, styled, texts = reader.polylines(path), reader.styled_polylines(path), reader.text_items(path)
            sheet = None
            if area:
                sheet = box
                box, polylines, styled, texts = crop(box, polylines, styled, texts, area)
            result = _extract(box, polylines, styled, texts, sheet)
    except Exception as exc:
        raise ValueError(f"Extraction failed: {exc}") from exc
    elapsed = time.monotonic() - t0

    warnings = list(result["warnings"])
    # Geometry that lands off the sheet is the symptom of a misread transform.
    x0, y0, x1, y1 = box
    pts = [pt for pl in polylines for pt in pl]
    if pts:
        off = sum(1 for x, y in pts if not (x0 - 1 <= x <= x1 + 1 and y0 - 1 <= y <= y1 + 1))
        if off / len(pts) > 0.02:
            warnings.append(
                f"{100 * off / len(pts):.0f}% of the drawing falls outside the page "
                "box, so coordinates are unreliable for this file."
            )
    if len(polylines) < 10:
        warnings.append(
            f"only {len(polylines)} vector paths found; this may be a scanned/raster "
            "or raster file, which this pipeline cannot read (it needs vector geometry)."
        )
    if not result["edges"]:
        warnings.append("extraction produced 0 edges.")
    payload = _payload(result, len(polylines), box, elapsed, warnings)
    payload["lines"], payload["texts"] = _digital(styled, texts, box)
    return payload


def _digital(styled: list[dict], texts: list[dict], box: tuple) -> tuple[list[dict], list[dict]]:
    """Every stroked line (colour, width) and every text of the drawing, in screen space: the drawing as it is,
    before anything is recognised in it (the digital construct's "drawing" shapes, pid/construct.py)."""
    height = box[3] - box[1]
    lines = [
        {
            "points": [[round(x, 2), round(height - y, 2)] for x, y in d["points"]],
            "color": _hex(d.get("color") or (0, 0, 0)),
            "width": d.get("width", 1.0),
        }
        for d in styled
        if len(d["points"]) >= 2
    ]
    words = [
        {"text": t["text"], "x": round(t["x"], 2), "y": round(height - t["y"], 2)}
        for t in texts
        if str(t.get("text", "")).strip()
    ]
    return lines, words
