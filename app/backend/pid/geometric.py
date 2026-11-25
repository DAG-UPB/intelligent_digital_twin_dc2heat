"""Geometric extractor: a node/edge graph from bare vector geometry and equipment tags.

The fallback for drawings that do not colour-code their pipework. Nodes are equipment
tags (text like P4711) and junctions where 5 or more path ends meet; edges are pipe paths
chained through bends from one node to the next.

Every threshold below was measured on ONE reference sheet (a DEXPI export, about
2900 pt across). They are not general: on a sheet of very different scale or style
expect missing junctions and missing edges. Colour-coded drawings take the far
better color_graph path instead.
"""

from __future__ import annotations

import math
import re

from .geometry import UnionFind, centroid, in_time, path_length, point_seg_distance

# --- path classification (by total length) ---------------------------------
BORDER_LEN_MIN = 1500.0  # page-spanning frame lines; nothing sits in (900, 1500) on the reference
PIPE_LEN_MIN = 15.0
PIPE_LEN_MAX = 900.0
GLYPH_MIN_POINTS = 4  # symbol glyphs (bowties, circle polygons) are >=4-point paths...
GLYPH_MAX_SEG = 25.0  # ...whose every segment is short

# --- node and edge tolerances ----------------------------------------------
# A real fitting has 5+ path ends within 15 pt; the clusters of 2-4 below that
# are noise (reference histogram of cluster sizes: 8,8,7,6,5,5,4,4,4,4,3,3,...).
JUNCTION_CLUSTER_TOL = 15.0
JUNCTION_MIN_ENDPOINTS = 5
DEDUPE_TOL = 10.0  # a new node this close to an existing one is the same node
SNAP_TOL = 25.0  # path end -> node attach distance
MIDRUN_SPLIT_TOL = 12.0  # a node this close to a pipe's body sits on it
MIDRUN_END_GUARD = 12.0  # ...unless it is this close to one of the pipe's own ends
# Path-end gaps on the reference have a trough at [15, 20) pt (2 of 316 gaps), with
# bends below it and unrelated geometry above: 18 pt is "the same drawn bend".
WAYPOINT_CLUSTER_TOL = 18.0
MAX_CHAIN_PATHS = 40  # walk-length guard against runaway loops

_EQUIPMENT_TAG_RE = re.compile(r"^[A-Z]{1,2}\d{3,5}$")


def _pipe_candidates(pls):
    """Pipe-run candidates: mid-length paths that are not frame lines or symbol glyphs."""
    out = []
    for pl in pls:
        length = path_length(pl)
        if length > BORDER_LEN_MIN:
            continue
        if len(pl) >= GLYPH_MIN_POINTS and max(math.dist(pl[i], pl[i + 1]) for i in range(len(pl) - 1)) < GLYPH_MAX_SEG:
            continue
        if PIPE_LEN_MIN <= length <= PIPE_LEN_MAX:
            out.append(pl)
    return out


def _content_floor(pipe_paths, box, n_buckets=20):
    """Y above which the drawing starts: the top of the sparsest bucket of the bottom half.

    A title block or data table sits in its own dense band at the bottom of the sheet,
    separated from the drawing by a gap few pipes cross. A density heuristic, not a
    border detector.
    """
    x0, y0, x1, y1 = box
    bucket_h = (y1 - y0) / n_buckets
    counts = [0] * n_buckets
    for pl in pipe_paths:
        my = (pl[0][1] + pl[-1][1]) / 2
        counts[min(int((my - y0) / bucket_h), n_buckets - 1)] += 1
    sparsest = min(range(n_buckets // 2), key=lambda i: counts[i])
    return y0 + (sparsest + 1) * bucket_h


def _junction_clusters(paths, tol=JUNCTION_CLUSTER_TOL, min_endpoints=JUNCTION_MIN_ENDPOINTS):
    """Centroids of path-end clusters with at least `min_endpoints` ends within `tol`."""
    endpoints = [p for pl in paths for p in (pl[0], pl[-1])]
    uf = UnionFind(len(endpoints))
    for i in range(len(endpoints)):
        in_time()
        for j in range(i + 1, len(endpoints)):
            if math.dist(endpoints[i], endpoints[j]) <= tol:
                uf.union(i, j)
    return [centroid([endpoints[i] for i in idxs]) for idxs in uf.groups() if len(idxs) >= min_endpoints]


def _split_path_at_nodes(pl, node_points, tol=MIDRUN_SPLIT_TOL, end_guard=MIDRUN_END_GUARD):
    """Split `pl` where a node sits ON it mid-run (within tol, not within end_guard of either end)."""
    cum = [0.0]
    for i in range(len(pl) - 1):
        cum.append(cum[-1] + math.dist(pl[i], pl[i + 1]))

    cuts = []  # (distance along the path, node point)
    in_time()
    for np_ in node_points:
        if math.dist(np_, pl[0]) <= end_guard or math.dist(np_, pl[-1]) <= end_guard:
            continue
        best = None
        for i in range(len(pl) - 1):
            d, t = point_seg_distance(np_, pl[i], pl[i + 1])
            if d <= tol:
                along = cum[i] + t * (cum[i + 1] - cum[i])
                if 1e-6 < along < cum[-1] - 1e-6 and (best is None or d < best[0]):
                    best = (d, along)
        if best is not None:
            cuts.append((best[1], np_))
    if not cuts:
        return [pl]

    cuts.sort()
    dedup = []
    for along, xy in cuts:
        if not dedup or along - dedup[-1][0] >= 1e-6:
            dedup.append((along, xy))

    pieces = []
    piece = [pl[0]]
    cut_iter = iter(dedup)
    next_cut = next(cut_iter, None)
    for i in range(len(pl) - 1):
        while next_cut is not None and cum[i] < next_cut[0] <= cum[i + 1]:
            xy = next_cut[1]
            piece.append(xy)
            pieces.append(piece)
            piece = [xy]
            next_cut = next(cut_iter, None)
        piece.append(pl[i + 1])
    pieces.append(piece)
    return [p for p in pieces if len(p) >= 2]


def _heading(a, b):
    return math.atan2(b[1] - a[1], b[0] - a[0])


def _turn_angle(h_in, h_out):
    d = abs(h_in - h_out) % (2 * math.pi)
    return min(d, 2 * math.pi - d)


def _build_waypoints(paths, node_points, tol=WAYPOINT_CLUSTER_TOL, snap_tol=SNAP_TOL):
    """Cluster path ends into waypoints and mark each as a node terminal or a pass-through bend.

    Returns (waypoint_of, terminal_node_of, incident):
      waypoint_of[(path index, end)] -> waypoint id   (end is 0 or -1)
      terminal_node_of[waypoint id] -> node index, or None for a pass-through
      incident[waypoint id] -> [(path index, end), ...]
    """
    ends = []  # (path index, end, point)
    for pi, pl in enumerate(paths):
        ends.append((pi, 0, pl[0]))
        ends.append((pi, -1, pl[-1]))

    # Complete linkage, not single: a dashed line is a ladder of ends ~15 pt apart, and
    # single linkage fused whole ladders into one false branch point. A point joins a
    # cluster only if it is within tol of EVERY member, bounding the cluster's diameter.
    uf = UnionFind(len(ends))
    cluster_members = {}  # root -> member indices
    for i in sorted(range(len(ends)), key=lambda i: ends[i][2]):
        in_time()
        pt = ends[i][2]
        joined = None
        for root, members in cluster_members.items():
            if all(math.dist(pt, ends[m][2]) <= tol for m in members):
                joined = root
                break
        if joined is None:
            cluster_members[i] = [i]
        else:
            uf.union(i, joined)
            members = cluster_members.pop(joined)
            members.append(i)
            cluster_members[uf.find(joined)] = members

    waypoint_of = {}
    incident = []
    terminal_node_of = []
    for group in uf.groups():
        wid = len(incident)
        inc = []
        for i in group:
            pi, end, _ = ends[i]
            waypoint_of[(pi, end)] = wid
            inc.append((pi, end))
        incident.append(inc)
        c = centroid([ends[i][2] for i in group])
        best_node, best_d = None, snap_tol
        for ni, np_ in enumerate(node_points):
            d = math.dist(c, np_)
            if d < best_d:
                best_node, best_d = ni, d
        terminal_node_of.append(best_node)
    return waypoint_of, terminal_node_of, incident


def _chain_edges(paths, node_points, nodes):
    """Walk chains of paths through pass-through waypoints (bends) between two node terminals.

    Each chain becomes one edge whose route concatenates every path walked. At a bend with
    several continuations the straightest one (smallest turn angle) wins: a drawn elbow
    chain never branches for real. Each node pair is emitted once, oriented from the lower
    node index to the higher.
    """
    waypoint_of, terminal_node_of, incident = _build_waypoints(paths, node_points)

    def other_end(end):
        return -1 if end == 0 else 0

    def orient(pi, end):
        """Path pi's points starting from `end`, so a walk reads head to tail."""
        pl = paths[pi]
        return list(pl) if end == 0 else list(reversed(pl))

    edges = []
    seen_pairs = set()
    for start_pi in range(len(paths)):
        in_time()
        for start_end in (0, -1):
            start_node = terminal_node_of[waypoint_of[(start_pi, start_end)]]
            if start_node is None:
                continue
            used = {start_pi}
            route = orient(start_pi, start_end)
            cur_pi, cur_end = start_pi, other_end(start_end)
            end_node = None
            while True:
                cur_wid = waypoint_of[(cur_pi, cur_end)]
                if terminal_node_of[cur_wid] is not None:
                    end_node = terminal_node_of[cur_wid]
                    break
                candidates = [(pi, end) for (pi, end) in incident[cur_wid] if pi != cur_pi and pi not in used]
                if not candidates:
                    break  # dead end
                if len(candidates) > 1 and len(route) >= 2:
                    incoming = _heading(route[-2], route[-1])

                    def turn(cand, incoming=incoming):
                        nxt = orient(*cand)
                        return _turn_angle(incoming, _heading(nxt[0], nxt[1]) if len(nxt) >= 2 else 0.0)

                    candidates.sort(key=turn)
                next_pi, next_end = candidates[0]
                route.extend(orient(next_pi, next_end)[1:])
                used.add(next_pi)
                cur_pi, cur_end = next_pi, other_end(next_end)
                if len(used) > MAX_CHAIN_PATHS:
                    break

            if end_node is None or end_node == start_node or start_node > end_node:
                continue  # the reverse walk emits this pair
            key = frozenset((start_node, end_node))
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            edges.append({"from": nodes[start_node]["id"], "to": nodes[end_node]["id"], "route": [list(p) for p in route]})
    return edges


def assemble_topology(box: tuple[float, float, float, float], polylines: list, texts: list[dict]) -> dict:
    """Nodes from equipment tags and junction clusters, edges from chained pipe paths.

    Returns {"nodes": [{"id", "x", "y", "class", "source"}], "edges": [{"from", "to", "route"}]}.
    Node ids are "tag<i>" / "junction<i>" in insertion order; they end up in pid_plant.json,
    so the order of everything here must stay deterministic.
    """
    pipe_paths = _pipe_candidates(polylines)
    floor = _content_floor(pipe_paths, box)
    pipe_paths = [pl for pl in pipe_paths if max(pl[0][1], pl[-1][1]) >= floor]
    # Junctions are detected over ALL paths above the floor, not just pipe candidates:
    # the short stubs that make a fitting's 5+ end cluster are exactly what the pipe
    # filter removes (0 of 8 true fittings found that way on the reference).
    all_above_floor = [pl for pl in polylines if max(pl[0][1], pl[-1][1]) >= floor]

    nodes = []
    node_points = []

    def add(x, y, cls, source):
        in_time()
        if any(math.dist((x, y), p) <= DEDUPE_TOL for p in node_points):
            return
        nodes.append({"id": f"{source}{len(nodes)}", "x": x, "y": y, "class": cls, "source": source})
        node_points.append((x, y))

    for t in texts:  # tags first: they win over a junction at the same spot
        if t["y"] >= floor and _EQUIPMENT_TAG_RE.match(t["text"].strip()):
            add(t["x"], t["y"], t["text"], "tag")
    for x, y in _junction_clusters(all_above_floor):
        add(x, y, None, "junction")

    split_paths = [piece for pl in pipe_paths for piece in _split_path_at_nodes(pl, node_points)]
    return {"nodes": nodes, "edges": _chain_edges(split_paths, node_points, nodes)}
