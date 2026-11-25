"""The plant graph of a drawing: named components and which ones the pipes join.

Pure functions over the read_drawing payload. pid_plant.json (what the P&ID page loads) is
plant_fractions(payload): the same graph with positions as fractions of the page.
"""

from __future__ import annotations

import math


def _colour_graph(payload: dict, named: list[dict]) -> tuple[list[dict], set[tuple[str, str]]]:
    comps = [{"id": n["id"], "label": n.get("tag") or n["id"], "x": n["x"], "y": n["y"]} for n in named]
    links = {tuple(sorted((c["source"], c["target"]))) for c in payload.get("colorConnections", []) if c["source"] != c["target"]}
    return comps, links


def _tag_graph(payload: dict) -> tuple[list[dict], set[tuple[str, str]]]:
    nodes = payload.get("nodes", [])
    tags = {n["id"]: n for n in nodes if n.get("source") == "tag"}
    comps = [{"id": i, "label": n.get("class") or i, "x": n["x"], "y": n["y"]} for i, n in tags.items()]
    adjacent: dict[str, set[str]] = {}
    for e in payload.get("edges", []):
        adjacent.setdefault(e["from"], set()).add(e["to"])
        adjacent.setdefault(e["to"], set()).add(e["from"])

    # A tag is written beside its symbol, not on the pipe: attach it to the nearest piped node.
    # ponytail: nearest-point attach within 5% of the page diagonal; colour-coded drawings trace properly
    x0, y0, x1, y1 = payload.get("pageBox", [0, 0, 1, 1])
    reach = 0.05 * math.hypot(x1 - x0, y1 - y0)
    piped = [n for n in nodes if n["id"] in adjacent and n["id"] not in tags and "x" in n]
    for i, t in tags.items():
        if i in adjacent or not piped:
            continue
        near = min(piped, key=lambda n: (n["x"] - t["x"]) ** 2 + (n["y"] - t["y"]) ** 2)
        if math.hypot(near["x"] - t["x"], near["y"] - t["y"]) <= reach:
            adjacent.setdefault(i, set()).add(near["id"])
            adjacent[near["id"]].add(i)

    links = set()
    for start in tags:  # walk through unnamed junctions, stop at the first named component
        seen, stack = {start}, list(adjacent.get(start, ()))
        while stack:
            n = stack.pop()
            if n in seen:
                continue
            seen.add(n)
            if n in tags:
                links.add(tuple(sorted((start, n))))
            else:
                stack.extend(adjacent.get(n, ()))
    return comps, links


def components_of(payload: dict) -> dict:
    """One plant graph from either extractor: {components: [{id, label, x, y}], links: [[a, b]]}.

    Colour-coded drawings give components and traced connections directly (colorNodes /
    colorConnections). Otherwise the components are the geometric equipment tags, and two
    are linked when drawn pipe runs between them through unnamed junctions only.
    Links are sorted pairs, sorted; positions are in the payload's (screen) space.
    """
    named = [n for n in payload.get("colorNodes", []) if n.get("kind") != "terminal"]
    comps, links = _colour_graph(payload, named) if named else _tag_graph(payload)
    return {"components": comps, "links": [list(p) for p in sorted(links)]}


def plant_fractions(payload: dict) -> dict:
    """pid_plant.json content: components_of(payload) plus pipes, positions as page fractions.

    Pipes are the colour runs, or the geometric edge routes when there are none.
    Raises ValueError when the payload has no usable page size.
    """
    try:
        _, _, w, h = (float(v) for v in payload["viewBox"].split())
    except (KeyError, ValueError) as exc:
        raise ValueError("drawing has no page size") from exc
    if not (w > 0 and h > 0):
        raise ValueError("drawing has no page size")
    graph = components_of(payload)
    pipes = [r["points"] for r in payload.get("colorRuns", [])] or [e["route"] for e in payload.get("edges", [])]
    return {
        "components": [{**c, "x": c["x"] / w, "y": c["y"] / h} for c in graph["components"]],
        "links": graph["links"],
        "pipes": [[[x / w, y / h] for x, y in p] for p in pipes],
    }
