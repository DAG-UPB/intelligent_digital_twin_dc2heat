"""P&ID reading: the plant graph (components, connections, pipes) of a vector PDF or SVG drawing.

Ported from an earlier P&ID prototype. The drawing is read locally only (no network calls); the router
deletes uploads right after reading. Modules:

- extract.py      read_drawing (both extractors, screen-space payload, warnings), sniff
- crop.py         read only an area of the page (the user's selection, without the legend)
- dexpi.py        DEXPI / Proteus XML: the standard machine-readable P&ID, read exactly
- plant.py        components_of, plant_fractions (the plant graph stored as pid_plant.json)
- pdf_reader.py   PDF content streams -> page box, polylines, stroked polylines, text
- svg_reader.py   the same four functions for SVG
- geometric.py    graph from tags + junction clusters + chained pipe paths (any drawing)
- color_runs.py   pipe runs from chromatic strokes (colour-coded drawings)
- color_graph.py  components + pipe segments + traced connections from those runs
- geometry.py     shared primitives (distances, matrices, Bezier, union-find)
"""

from .extract import read_drawing, sniff
from .plant import components_of, plant_fractions

__all__ = ["components_of", "plant_fractions", "read_drawing", "sniff"]
