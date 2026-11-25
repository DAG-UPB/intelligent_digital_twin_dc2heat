"""Recover pipe runs from stroke colour.

A schematic that colour-codes its circuits states something the geometry
alone does not: which lines belong to the same system. On a drawing that
uses the convention, filtering to chromatic strokes drops the frames,
title block, room outlines and symbol bodies in one step -- the signal
stroke width was never able to give (three mixed weights carried 94% of
paths on the DEXPI reference).

Two things make this harder than grouping by RGB. A dashed line is
emitted as one polyline per dash, so runs must be stitched back together
before anything downstream sees them. And a drawing may not use colour at
all: the DEXPI reference has 17 chromatic strokes against this one's 916,
so this is a strategy that reports whether it applies, never a
replacement for the geometric path.
"""

import math
from collections.abc import Sequence

from .geometry import path_length

# Chroma = max(rgb) - min(rgb). Greys and near-blacks sit at 0; every
# legend colour on the test schematic exceeds 0.5. The gap is wide, so
# the threshold is not delicate.
CHROMA_MIN = 0.15

# Colours are quantised before grouping: the same circuit can be stroked
# as (1.0, 0.0, 0.0) and (1.0, 0.0, 0.25) by different CAD layers.
COLOR_BUCKET = 0.30

# Endpoint gap that still counts as the same run. Dash gaps on the test
# drawing are ~5pt; the median dash is 11pt, so joining across 14pt links
# dashes without bridging genuinely separate parallel pipes.
JOIN_TOL = 14.0

# A chain must survive this to be reported. Below it, a "run" is one
# stray dash or a leader line, not piping.
MIN_RUN_LENGTH = 25.0

# Colour is only trusted as a pipe/furniture separator when enough of the
# drawing is coloured to be a deliberate convention rather than a few
# highlighted annotations.
MIN_COLORED_FRACTION = 0.03


def chroma(color: Sequence[float] | None) -> float:
    """max(rgb) - min(rgb): 0 for greys and black (and for no colour at all)."""
    if not color:
        return 0.0
    return max(color) - min(color)


def _bucket(color):
    return tuple(round(c / COLOR_BUCKET) for c in color)


def colored_runs(styled: list[dict]) -> list[dict]:
    """Chain chromatic strokes into runs, grouped by quantised colour.

    Returns [{color, points, length}], longest first. Chaining is greedy
    nearest-endpoint within one colour bucket: a dashed line is a sequence
    of collinear 2-point pieces, so the nearest unused endpoint is the
    next dash of the same pipe far more often than it is another pipe.
    """
    runs = []
    by_color = {}
    for d in styled:
        c = d.get("color")
        if chroma(c) < CHROMA_MIN or len(d["points"]) < 2:
            continue
        by_color.setdefault(_bucket(c), []).append(d)

    for items in by_color.values():
        # Representative colour: the one actually stroked most in this
        # bucket, so the reported value is a real drawing colour rather
        # than a quantised average of several.
        rep = max(
            {tuple(d["color"]) for d in items},
            key=lambda c: sum(1 for d in items if tuple(d["color"]) == c),
        )
        pieces = [list(d["points"]) for d in items]
        used = [False] * len(pieces)

        for i in range(len(pieces)):
            if used[i]:
                continue
            used[i] = True
            chain = list(pieces[i])
            gaps = []
            # Extend from both ends: a dash picked up mid-run still
            # recovers the whole pipe.
            for _ in range(2):
                while True:
                    tail = chain[-1]
                    best, best_d, flip = None, JOIN_TOL, False
                    for j, pc in enumerate(pieces):
                        if used[j]:
                            continue
                        d0 = math.dist(tail, pc[0])
                        if d0 < best_d:
                            best, best_d, flip = j, d0, False
                        d1 = math.dist(tail, pc[-1])
                        if d1 < best_d:
                            best, best_d, flip = j, d1, True
                    if best is None:
                        break
                    used[best] = True
                    nxt = pieces[best][::-1] if flip else pieces[best]
                    # Record the join so its gap is not billed as drawn ink:
                    # the connector is inferred, the dashes are measured.
                    gaps.append(math.dist(chain[-1], nxt[0]))
                    chain.extend(nxt)
                chain.reverse()

            # Length counts drawn ink only. Summing the chain would bill
            # every inferred dash-gap connector as pipe: ~600 joins at ~4pt
            # added 2254pt, reporting 121% of the ink actually on the page.
            ln = path_length(chain) - sum(gaps)
            if ln >= MIN_RUN_LENGTH:
                runs.append({"color": rep, "points": chain, "length": ln})

    runs.sort(key=lambda r: -r["length"])
    return runs


def applies(styled: list[dict]) -> tuple[bool, float]:
    """Whether this drawing colour-codes its circuits.

    Reported rather than assumed: a drawing with almost no chromatic ink
    is not using the convention, and filtering to colour there would
    discard the whole drawing. Returns (applies, chromatic fraction of strokes).
    """
    if not styled:
        return False, 0.0
    n = sum(1 for d in styled if chroma(d.get("color")) >= CHROMA_MIN)
    frac = n / len(styled)
    return frac >= MIN_COLORED_FRACTION, frac
