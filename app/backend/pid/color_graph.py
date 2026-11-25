"""Build a component graph from colour runs and equipment tags.

The geometric path builds nodes by clustering endpoint density over every
path on the sheet. On a real drawing most paths are the frame, the title
block and the datasheet grid, so it reports 135 nodes against 20 edges:
mostly table corners, connected to nothing.

A colour-coded schematic states two things that make a better graph. The
chromatic strokes are the pipework and nothing else -- 83 runs against 6807
paths. And the drawn tags name the equipment those pipes run between. So:
tags are the components, runs are the connections, and a run joins two
components when its ends land near them.

What this deliberately does NOT do is invent components. A run whose end
sits near nothing gets a terminal node marked as such, rather than a
guessed vessel. The graph says what the drawing says.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence

from .geometry import Point, path_length, point_seg_distance

# A tag is letters then digits. Two conventions, because drawings use
# both. ISA plant style is a long number: P4711, TV4750.03, SV 104.01. Building-services style is short:
# M1.1, T4.2a, WT 4a, PA1a. Accepting only the first found zero tags on a
# German hydraulic schematic whose every pump is "M1.1" -- a whole drawing
# silently reduced to unnamed terminals.
_TAG = re.compile(r"^([A-Z]{1,3}[a-z]?)\s?(\d{1,5}(?:\.\d{1,2})?[a-z]?)$")

# Prefixes that match the tag shape but name a property of a pipe, not a
# thing that sits on one. DN 800 is a nominal diameter; admitting it puts a
# pipe's own size in the graph as a component.
_NOT_EQUIPMENT = {
    "DN",
    "PN",
    "NPS",
    "ND",  # nominal pipe size
    "kW",
    "KW",
    "W",
    "MW",
    "kV",  # duties and ratings
    "OG",
    "UG",
    "EG",  # storey numbers (7.OG = 7th floor)
    "N",  # nozzle labels (N1..N8 around a vessel)
}

# Tags repeat: once on the drawing, once in the datasheet table below it.
# Distance cannot separate the two -- the gap is ~170 units on the test
# sheet, which is also the spacing between neighbouring equipment. So a
# repeated tag collapses to one component, positioned at the occurrence
# nearest the pipework, and the table copy is simply dropped. A real plant
# does not have two pumps with the same tag; a drawing that shows one twice
# is labelling and tabulating the same machine.

# Three different questions were being answered by one number, and that is
# why components came out unconnected. Measured on the DEXPI sheet:
#
#   tag -> nearest point ON its pipe     2.3 - 10.0 units
#   tag -> nearest run END               8.7 - 40.7 units
#   run end -> a coincident run end      1.0 -  4.0 units
#
# A tag sits ON its pipe, not at the pipe's end -- Q80 is 4.0 from pipework
# and 40.7 from any run end, so a single tolerance wide enough to claim it
# by endpoint (>40) also merges genuinely separate junctions 22 units apart
# and manufactures connections. Splitting the constant is what lets the
# claim radius stay small and honest.
#
# Scaled as a fraction of the pipework's own extent rather than the page
# box, which includes margins the drawing does not use.
_CLAIM_FRACTION = 0.037  # tag claims a junction / sits inline on a run
_CLAIM_MIN = 12.0
_MERGE_FRACTION = 0.025  # two run ends are the same point of the network
_MERGE_MIN = 8.0
_TEE_FRACTION = 0.016  # a run's end landing on another run's body
_TEE_MIN = 5.0

# An achromatic shape wider than this fraction of the sheet is frame,
# title block or a room outline, not an equipment symbol. Measured on the
# real hydraulic schematic: the symbols that run ends actually stop on are 9-115
# units across on a 2127-unit sheet (5.4% at the largest), while the sheet
# border is 513 units and is touched by 6 unrelated ends. 20% clears every
# real symbol by 4x and excludes the border by 2x.
_SYMBOL_MAX_SPAN = 0.20

# A run end is "on" a symbol only if it actually touches it. This is not
# the tee tolerance, which scales with the sheet: at 34 units a pipe end
# claims every glyph outline within half an inch, and the real hydraulic schematic
# went from 18 real symbols to 438 invented ones. Touching is absolute --
# the drawing either ends the pipe on the outline or it does not. Between
# 2 and 5 units the count is flat at 18 shapes / 38 ends, so this sits on
# a plateau rather than on a slope.
_SYMBOL_TOUCH = 3.0

# A tag whose coordinates are real sits near pipework; one carrying
# unresolved form-XObject coordinates does not. On the real hydraulic schematic the
# two populations do not overlap at all -- measured as a fraction of the
# pipework's span, the seven real tags are 0.5-11.5% from the nearest pipe
# and the seven broken ones are 50.2-54.3%. 25% sits in the empty middle
# with a wide margin on both sides, so this is a separator, not a knob.
_STRAY_FRACTION = 0.25

# Kind by tag prefix, from ISA-5.1 and common plant practice. Unknown
# prefixes stay "equipment" rather than being guessed into a class.
_KINDS = {
    # ISA / process plant
    "P": "pump",
    "H": "exchanger",
    "T": "tank",
    "V": "vessel",
    "C": "compressor",
    "E": "exchanger",
    "D": "drum",
    "R": "reactor",
    "PV": "valve",
    "TV": "valve",
    "FV": "valve",
    "LV": "valve",
    "SV": "valve",
    "CV": "valve",
    "XV": "valve",
    "HV": "valve",
    "PI": "instrument",
    "TI": "instrument",
    "FI": "instrument",
    "LI": "instrument",
    "PT": "instrument",
    "TT": "instrument",
    # German building services (hydraulic schematics). M is a motor-driven
    # pump group, WT a Waermetauscher, PA a Pumpenaggregat.
    "M": "pump",
    "PA": "pump",
    "WT": "exchanger",
    "TC": "instrument",
    "QC": "instrument",
}


def _kind(prefix):
    return _KINDS.get(prefix, "equipment")


def tag_nodes(text_items: list[dict], run_endpoints: Sequence[Point] = ()) -> list[dict]:
    """Equipment tags as components, de-duplicated across repeats.

    run_endpoints steers which occurrence of a repeated tag is kept: the
    datasheet table repeats every tag, and the table copy is useless for
    attaching pipes.
    """
    found = {}
    for t in text_items:
        s = (t.get("text") or "").strip()
        m = _TAG.match(s)
        if not m or m.group(1) in _NOT_EQUIPMENT:
            continue
        found.setdefault(s, []).append((float(t["x"]), float(t["y"])))

    nodes = []
    for tag, positions in found.items():
        if run_endpoints:
            # Keep the occurrence closest to the pipework.
            positions = sorted(
                positions,
                key=lambda p: min(math.dist(p, e) for e in run_endpoints),
            )
        x, y = positions[0]
        prefix = _TAG.match(tag).group(1)
        nodes.append(
            {
                "id": tag,
                "tag": tag,
                "kind": _kind(prefix),
                "x": x,
                "y": y,
                "source": "tag",
                "occurrences": len(positions),
            }
        )
    return nodes


def _nearest(point, nodes, limit):
    best, best_d = None, limit
    for n in nodes:
        d = math.dist(point, (n["x"], n["y"]))
        if d < best_d:
            best, best_d = n, d
    return best


def _interior_hit(p, pts, tol, margin):
    """(segment index, t) of the point of run `pts` nearest p within tol, or None.

    None too when the hit lies within `margin` (a fraction of the run, counted in
    segments) of either end: a hit there is a termination, handled as a junction.
    """
    best = None
    for i in range(len(pts) - 1):
        d, t = point_seg_distance(p, pts[i], pts[i + 1])
        if d <= tol and (best is None or d < best[0]):
            best = (d, i, t)
    if best is None:
        return None
    _, i, t = best
    at = (i + t) / max(1, len(pts) - 1)
    return (i, t) if margin < at < 1 - margin else None


def _cut_run(r, cuts):
    """Run r cut at sorted (segment index, t) points; [r] when that leaves fewer than 2 pieces."""
    pts = r["points"]
    start_i, start_pt = 0, pts[0]
    pieces = []
    for i, t in cuts:
        foot = (
            pts[i][0] + t * (pts[i + 1][0] - pts[i][0]),
            pts[i][1] + t * (pts[i + 1][1] - pts[i][1]),
        )
        seg = [start_pt] + list(pts[start_i + 1 : i + 1]) + [foot]
        if len(seg) >= 2 and path_length(seg) > 0:
            pieces.append(seg)
        start_i, start_pt = i, foot
    tail = [start_pt] + list(pts[start_i + 1 :])
    if len(tail) >= 2 and path_length(tail) > 0:
        pieces.append(tail)
    if len(pieces) < 2:
        return [r]
    # Each piece reports its own length, not the parent's: an edge claiming the
    # whole run's length at every split would treble the pipework on a run
    # through two valves.
    return [{"color": r["color"], "points": seg, "length": path_length(seg)} for seg in pieces]


def _split_at_inline(runs, nodes, tol):
    """Cut each run where a component sits on it away from either end.

    Only interior hits split: a component at a run's end is already handled
    as a junction, and splitting there would produce a zero-length piece.
    """
    out = []
    for r in runs:
        hits = (_interior_hit((n["x"], n["y"]), r["points"], tol, 0.04) for n in nodes)
        out.extend(_cut_run(r, sorted(h for h in hits if h is not None)))
    return out


def _split_at_tees(runs, tol):
    """Cut a run where another run's END lands on its interior.

    A branch pipe tees into the middle of a main; it does not meet it end to
    end. Merging endpoints alone cannot see that, so the branch stays a
    dead end and the main never learns it was joined. Measured on the DEXPI
    sheet: 8 of 27 isolated run ends sit at distance 0.0 on another run's
    body, and 6 more within 5 units -- that is the connectivity that was
    being thrown away, not symbol outlines as previously suspected.

    Cutting the main at the foot gives both pipes a shared endpoint, which
    the junction pass then merges into one node.
    """
    ends = [tuple(r["points"][0]) for r in runs]
    ends += [tuple(r["points"][-1]) for r in runs]
    out = []
    for r in runs:
        hits = (_interior_hit(e, r["points"], tol, 0.02) for e in ends)
        out.extend(_cut_run(r, sorted(h for h in hits if h is not None)))
    return out


def _symbol_bridges(runs, shapes, tol, max_span):
    """Join run ends that stop on the same equipment symbol.

    Pipes are not drawn through a pump or a valve -- they stop at its
    outline and resume on the far side, so the two sides share no point
    and the network breaks at every symbol. On the real hydraulic schematic 65 of
    166 run ends sit within 2 units of achromatic geometry, and 19 of
    those achromatic pieces are touched by two or more ends: 41.9x41.9
    pump circles, 14x9 valve bodies, 114x59 exchanger boxes. That is not
    frame or title block, it is equipment, and the drawing plainly means
    the pipe to continue through it.

    A shape qualifies only if it is small enough to be a symbol
    (max_span); the sheet border is touched by 6 ends and bridging it
    would wire unrelated circuits together across the whole drawing.

    Returns connector runs, each a straight 2-point link, marked so a
    caller can tell an inferred bridge from measured ink.
    """
    ends = []
    for r in runs:
        ends.append((tuple(r["points"][0]), r))
        ends.append((tuple(r["points"][-1]), r))

    bridges = []
    for shape in shapes:
        pts = shape["points"]
        xs = [q[0] for q in pts]
        ys = [q[1] for q in pts]
        if max(max(xs) - min(xs), max(ys) - min(ys)) > max_span:
            continue
        touching = []
        for point, run in ends:
            for k in range(len(pts) - 1):
                if point_seg_distance(point, pts[k], pts[k + 1])[0] <= tol:
                    touching.append((point, run))
                    break
        if len(touching) < 2:
            continue
        # Chain the touching ends in order rather than joining every pair:
        # a four-port symbol wired all-to-all would claim six connections
        # where the drawing shows a body with four pipes on it.
        hub = (sum(q[0][0] for q in touching) / len(touching), sum(q[0][1] for q in touching) / len(touching))
        for point, run in touching:
            if math.dist(point, hub) < 1e-9:
                continue
            bridges.append({"color": run["color"], "points": [point, hub], "length": 0.0, "inferred": True})
    return bridges


def build(
    runs: list[dict],
    text_items: list[dict],
    page_box: tuple[float, float, float, float] | None = None,
    shapes: Sequence[Sequence[Point]] = (),
) -> dict:
    """Components and connections from colour runs plus drawn tags.

    Returns {"nodes", "edges", "connections", "warnings"}. Nodes are the named
    components (id = tag text) plus unnamed "terminal-<n>" run ends; connections
    are component pairs traced through terminals. An edge carries the run's colour
    and length, so a caller can tell a 6-metre main from a 200mm stub and
    can group edges by circuit.

    shapes, when given, are the drawing's achromatic polylines. Pipes stop
    at equipment outlines rather than crossing them, so these are used to
    rejoin runs that end on the same symbol -- see _symbol_bridges.

    page_box, when given, drops tags that land outside the sheet. Text inside
    a form XObject the reader cannot resolve keeps its local coordinates,
    so those tags pile up near the origin; attaching a pipe to one would
    assert a connection the drawing does not show.
    """
    warnings = []
    endpoints = [tuple(r["points"][0]) for r in runs]
    endpoints += [tuple(r["points"][-1]) for r in runs]
    if not endpoints:
        return {"nodes": [], "edges": [], "warnings": ["no colour runs; nothing to build a graph from"]}

    span = max(
        max(e[0] for e in endpoints) - min(e[0] for e in endpoints),
        max(e[1] for e in endpoints) - min(e[1] for e in endpoints),
    )
    claim = max(_CLAIM_MIN, span * _CLAIM_FRACTION)
    merge = max(_MERGE_MIN, span * _MERGE_FRACTION)
    tee = max(_TEE_MIN, span * _TEE_FRACTION)

    # Tees first: a branch meeting a main partway along it shares no
    # endpoint with it, so without this the branch is a dead end and the
    # main never learns it was joined. Splitting the main at the foot gives
    # them a common end for the junction pass below to merge.
    runs = _split_at_tees(runs, tee)

    # Then bridge the symbols: pipes stop at equipment outlines, so without
    # this every pump and valve is a break in the network.
    if shapes:
        bridges = _symbol_bridges(runs, shapes, _SYMBOL_TOUCH, span * _SYMBOL_MAX_SPAN)
        if bridges:
            runs = list(runs) + bridges
            warnings.append(
                f"{len(bridges)} inferred connector(s) through equipment symbols; pipes stop at symbol outlines and were rejoined"
            )

    endpoints = [tuple(r["points"][0]) for r in runs]
    endpoints += [tuple(r["points"][-1]) for r in runs]

    nodes = tag_nodes(text_items, endpoints)

    # A tag must land on the drawing, and the page box is too generous a
    # test for that: it is the whole sheet including margins, so a tag at
    # the very corner passes. On the real hydraulic schematic seven tags carrying
    # unresolved form-XObject coordinates pile up at (~0, ~2590) while the
    # pipework spans x 218-2345, y 346-2269 -- on-page by the box, and
    # 1066-1155 units from the nearest pipe on a 2127-unit sheet.
    #
    # Equipment sits near pipework by definition, so the pipework's own
    # extent is the honest reference. Dropping these is deliberate: their
    # position is not merely imprecise, it is the wrong coordinate space,
    # and attaching a pipe to one would assert a connection that is not in
    # the drawing. They are reported so the count is visible rather than
    # silently missing.
    if page_box:
        x0, y0, x1, y1 = page_box
        nodes = [n for n in nodes if x0 <= n["x"] <= x1 and y0 <= n["y"] <= y1]

    def _to_pipework(n):
        p = (n["x"], n["y"])
        return min(
            point_seg_distance(p, r["points"][i], r["points"][i + 1])[0] for r in runs for i in range(len(r["points"]) - 1)
        )

    near_pipework = [n for n in nodes if _to_pipework(n) <= span * _STRAY_FRACTION]
    stray = len(nodes) - len(near_pipework)
    if stray:
        warnings.append(
            f"{stray} tag(s) sit impossibly far from any pipe and were "
            "dropped; their position comes from an unresolved form XObject, "
            "so the drawing names equipment this graph cannot place"
        )
    nodes = near_pipework
    if not nodes:
        warnings.append("no equipment tags found; every pipe end becomes a terminal and the graph has no named components")

    # Split runs at inline components before anything else. A valve does not
    # terminate a pipe, it sits on one: PV4712.02 is 3.8 units from a run but
    # 27 from that run's nearest end, so matching ends alone leaves every
    # inline valve and instrument at degree 0 -- present in the graph and
    # connected to nothing. Splitting turns one run through a valve into two
    # runs meeting at it, which is what the drawing shows.
    runs = _split_at_inline(runs, nodes, claim)

    # Every run end becomes a junction: runs whose ends coincide are the
    # same point of the network. Components then attach to junctions rather
    # than to runs, because a pipe stops AT a pump symbol rather than
    # passing through it -- so the pump is what joins its suction run to its
    # discharge run. Treating the run itself as the edge made both of a
    # pump's runs start and end on the pump, which reads as a self-loop and
    # was dropped, losing the connection entirely.
    junctions = []  # [[x, y], [member run-end index, ...]]
    ends = [(tuple(r["points"][0]), i, 0) for i, r in enumerate(runs)]
    ends += [(tuple(r["points"][-1]), i, 1) for i, r in enumerate(runs)]
    end_junction = {}
    for pt, ri, side in ends:
        for j in junctions:
            # A run must not be merged into itself. The merge radius decides
            # that two DIFFERENT pipes' ends are the same point of the
            # network; applied to one pipe's own two ends it deletes the
            # pipe, because the edge pass drops a==b. That is not a rare
            # edge case on a real sheet: the median pipe piece on the
            # real hydraulic schematic is 45.5 units end to end against a 53.2-unit
            # merge radius (0.025 x 2127 span), so 113 of 189 pieces are
            # shorter than the radius meant to separate them -- 91 pieces
            # carrying 2112 of 13553 units of run ink were being thrown
            # away whole. See _MERGE_FRACTION.
            if (ri, 1 - side) in j[1]:
                continue
            if math.dist(pt, j[0]) <= merge:
                j[1].append((ri, side))
                end_junction[(ri, side)] = j
                break
        else:
            j = [pt, [(ri, side)]]
            junctions.append(j)
            end_junction[(ri, side)] = j

    # Name each junction: the nearest tag claims it, otherwise it stays an
    # unnamed terminal. A tag may claim several junctions -- a pump has a
    # suction and a discharge -- and that is exactly what makes it a hub.
    winner = {}
    for k, j in enumerate(junctions):
        hit = _nearest(j[0], nodes, claim)
        if hit is not None:
            winner[k] = hit

    # ...but not both ends of the same pipe. The claim radius decides which
    # component a junction belongs to; applied to both ends of one run it
    # deletes the run, because the edge pass drops a==b -- the same way the
    # merge radius did before the guard above. Measured on the
    # real hydraulic schematic: M4 sits 24.0 and 53.3 from the two junctions of a
    # 146.3-unit run, while WT 4a is 68.8 from the far one and 24.2 from the
    # near one, all inside the 78.7-unit claim radius. M4 took both, the run
    # died, and WT 4a was left at degree 0 beside the pipe that reaches it.
    #
    # The far junction goes to the nearest other component in range, but only
    # when the two junctions are further apart than the merge radius. Below
    # that they are one point of the network by this module's own definition,
    # and handing one over invents a component boundary the drawing does not
    # draw: M2.2's only candidate is 0.5 units from M2.1's across a 0.5-unit
    # CAD hairline, which is a split line, not a pipe between two pumps.
    jindex = {id(j): k for k, j in enumerate(junctions)}
    for i in range(len(runs)):
        ja = jindex[id(end_junction[(i, 0)])]
        jb = jindex[id(end_junction[(i, 1)])]
        if ja == jb:
            continue
        held = winner.get(ja)
        if held is None or winner.get(jb) is not held:
            continue
        if math.dist(junctions[ja][0], junctions[jb][0]) <= merge:
            continue
        held_at = (held["x"], held["y"])
        far = ja if (math.dist(junctions[ja][0], held_at) > math.dist(junctions[jb][0], held_at)) else jb
        alt = _nearest(junctions[far][0], [n for n in nodes if n["id"] != held["id"]], claim)
        if alt is not None:
            winner[far] = alt

    jid = {}
    terminals = []
    claimed = {}
    for k, j in enumerate(junctions):
        hit = winner.get(k)
        if hit is not None:
            jid[id(j)] = hit["id"]
            # Move the component onto its pipework. A tag is drawn beside the
            # symbol it names, so its text position is metres off the pipe;
            # drawn from there, an edge cuts across the sheet instead of
            # following the line it represents. The centroid of the junctions
            # a component claims is where its connections actually meet.
            claimed.setdefault(hit["id"], []).append(j[0])
        else:
            t = {
                "id": f"terminal-{len(terminals) + 1}",
                "tag": None,
                "kind": "terminal",
                "x": j[0][0],
                "y": j[0][1],
                "source": "run-end",
            }
            terminals.append(t)
            jid[id(j)] = t["id"]

    for n in nodes:
        pts = claimed.get(n["id"])
        if pts:
            n["label_x"], n["label_y"] = n["x"], n["y"]
            n["x"] = sum(p[0] for p in pts) / len(pts)
            n["y"] = sum(p[1] for p in pts) / len(pts)

    edges = []
    for i, r in enumerate(runs):
        a = jid[id(end_junction[(i, 0)])]
        b = jid[id(end_junction[(i, 1)])]
        if a == b:
            continue
        edges.append(
            {
                "source": a,
                "target": b,
                "color": r["color"],
                "length": round(r["length"], 1),
                "route": [list(p) for p in r["points"]],
                "kind": "pipe",
            }
        )

    # Trace each component to the next one through the pipework. An edge
    # ending on an unnamed terminal is not a dead end: a pipe from a pump to
    # an exchanger is drawn as several runs meeting at bends and tees, and
    # every one of those junctions is a terminal. Reporting only adjacency
    # therefore counts almost nothing -- 4 of 19 edges on the DEXPI sheet,
    # 0 of 49 on the real hydraulic schematic -- while the drawing plainly connects
    # the equipment.
    #
    # Walking through terminals, and stopping at the first named node in
    # every direction, gives what the drawing actually asserts: 13 pairs on
    # the DEXPI sheet and 1 on the real hydraulic schematic, each traced along drawn
    # pipe rather than assumed from proximity. Reported alongside the edges
    # rather than replacing them, so the pipe-level routes stay available.
    adjacency = {}
    for e in edges:
        adjacency.setdefault(e["source"], []).append(e["target"])
        adjacency.setdefault(e["target"], []).append(e["source"])
    named_ids = {n["id"] for n in nodes}
    links = {}
    for start in named_ids:
        seen = {start}
        stack = [(nb, 1) for nb in adjacency.get(start, ())]
        while stack:
            cur, hops = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            if cur in named_ids:
                key = tuple(sorted((start, cur)))
                if key not in links or hops < links[key]:
                    links[key] = hops
                continue  # stop at the first component, do not pass through it
            for nb in adjacency.get(cur, ()):
                stack.append((nb, hops + 1))
    connections = [{"source": a, "target": b, "hops": h, "kind": "connection"} for (a, b), h in sorted(links.items())]

    all_nodes = nodes + terminals
    named = sum(1 for n in all_nodes if n["kind"] != "terminal")
    if terminals and named:
        warnings.append(
            f"{len(terminals)} of {len(all_nodes)} nodes are unnamed pipe terminals (off-sheet or untagged equipment)"
        )
    return {"nodes": all_nodes, "edges": edges, "connections": connections, "warnings": warnings}
