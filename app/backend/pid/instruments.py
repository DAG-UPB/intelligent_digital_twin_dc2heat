"""Instrument bubbles of a drawing: the small circles with an ISA code inside (TI, PT 101, FIC ...).

They are where the plant is measured, so each one is a candidate variable. Ported from the facility-graph step of
the earlier P&ID prototype, with the sizes made relative to the sheet (the prototype's 8-14 pt bounds fitted one
CAD exporter). Pure function over the readers' output, in the drawing's own space (y up).
"""

from __future__ import annotations

import math
import re
from collections import Counter

# the first letter is the measured quantity (pressure, temperature, flow, level, quality, power, ...), then up to
# three readout / function letters; a lone P, T, F or L is how some sheets label a gauge
ISA = re.compile(r"(?:[PTFLQEJSZKWDAHM][DFQ]?[ICTERAYSVHLZ]{1,3}|[PTFL])")
LABEL = re.compile(r"([A-Z]{1,5})(?:[\s.-]?(\d{1,5}[A-Z]?(?:\.\d{1,3})?))?")
LOOP = re.compile(r"\d{1,5}[A-Z]?(?:\.\d{1,3})?")

MIN_POINTS = 12  # a flattened circle; a square or an L has 2-5
SIZE = (0.002, 0.03)  # bubble diameter as a fraction of the sheet's diagonal
ROUND = 1.15  # farthest / nearest outline point from the centre (a square reads 1.41)
PAD = 0.6  # text anchors are baseline-left, not the glyph centre: look this many diameters around the circle


def _code(text: str) -> tuple[str, str]:
    """(ISA code, loop number) of one text item; ("", number) for a bare loop number, ("", "") for anything else."""
    t = text.strip().upper()
    if LOOP.fullmatch(t):
        return "", t
    m = LABEL.fullmatch(t)
    if m and ISA.fullmatch(m.group(1)):
        return m.group(1), m.group(2) or ""
    return "", ""


def instrument_bubbles(polylines: list, texts: list[dict], box: tuple, sheet: tuple | None = None) -> list[dict]:
    """[{tag, x, y, d}]: each round closed outline of bubble size with an ISA code inside (d: its diameter).

    The size bounds are relative to `sheet` (default `box`): when only an area of the sheet is read, a bubble
    keeps the size it has on the whole sheet.

    A legend draws its example bubbles on a lattice (same row and same column as another one); real instruments
    follow the pipes, so those are left out. The same circle drawn twice (stroke and fill) counts once.
    """
    x0, y0, x1, y1 = sheet or box
    diag = math.hypot(x1 - x0, y1 - y0)
    lo, hi = SIZE[0] * diag, SIZE[1] * diag
    found: dict[tuple[int, int], dict] = {}
    for pts in polylines:
        if len(pts) < MIN_POINTS:
            continue
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        if not (lo <= w <= hi and h > 0 and 0.8 <= w / h <= 1.2):
            continue
        if math.dist(pts[0], pts[-1]) > 0.1 * w:  # an arc, not a closed circle
            continue
        cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
        r = [math.hypot(x - cx, y - cy) for x, y in pts]
        if min(r) <= 0 or max(r) / min(r) > ROUND:
            continue
        pad = PAD * w
        code, loop = "", ""
        for t in texts:
            if abs(t["x"] - cx) <= w / 2 + pad and abs(t["y"] - cy) <= h / 2 + pad:
                c, n = _code(t["text"])
                code, loop = code or c, loop or n
        if code:
            tag = f"{code} {loop}" if loop else code
            found.setdefault((round(cx), round(cy)), {"tag": tag, "x": cx, "y": cy, "d": (w + h) / 2})
    bubbles = list(found.values())
    rows, cols = Counter(round(b["y"]) for b in bubbles), Counter(round(b["x"]) for b in bubbles)
    # ponytail: exact-coordinate lattice test; a tolerance if an exporter ever jitters legend rows
    return [b for b in bubbles if not (rows[round(b["y"])] >= 2 and cols[round(b["x"])] >= 2)]


def demo() -> None:
    """Self-check: two bubbles (one with a loop number below), a legend lattice, a square and an unlabelled circle."""

    def circle(cx, cy, r=5, n=24):
        return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]

    polys = [circle(100, 100), circle(200, 100), circle(300, 300), circle(20, 20), circle(40, 20), circle(20, 40), circle(40, 40)]
    polys.append([(150, 150), (160, 150), (160, 160), (150, 160), (150, 150)])
    texts = [{"text": "TI", "x": 97, "y": 101}, {"text": "101", "x": 96, "y": 96}, {"text": "PT 7", "x": 196, "y": 99}]
    texts += [{"text": "FT", "x": 18, "y": 19}, {"text": "LT", "x": 38, "y": 19}, {"text": "TT", "x": 18, "y": 39}]
    texts += [{"text": "PI", "x": 38, "y": 39}, {"text": "M", "x": 299, "y": 299}]
    got = sorted(b["tag"] for b in instrument_bubbles(polys, texts, (0, 0, 600, 400)))
    assert got == ["PT 7", "TI 101"], got


if __name__ == "__main__":
    demo()
    print("ok")
