"""The two extractors: colour runs + colour graph, and the geometric graph."""

import math

from backend.pid import color_graph, color_runs, geometric

RED, BLUE, GREY = (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.2, 0.2, 0.2)


def _stroke(color, *points):
    return {"color": color, "points": list(points), "width": 1}


def _pairs(links):
    return {tuple(sorted((c["source"], c["target"]))) for c in links}


# --- colour runs -------------------------------------------------------------------


def test_dashes_chain_into_one_run_and_grey_is_dropped():
    styled = [
        _stroke(RED, (0, 0), (10, 0)),
        _stroke(RED, (15, 0), (25, 0)),
        _stroke(RED, (30, 0), (40, 0)),
        _stroke(BLUE, (0, 50), (40, 50)),
        _stroke(GREY, (0, 99), (40, 99)),
    ]
    runs = color_runs.colored_runs(styled)
    assert len(runs) == 2
    (red,) = [r for r in runs if r["color"] == RED]
    assert len(red["points"]) == 6
    assert red["length"] == 30  # drawn ink only: the two 5 pt gaps are not pipe


def test_short_runs_are_dropped_and_runs_sorted_longest_first():
    runs = color_runs.colored_runs(
        [_stroke(RED, (0, 0), (20, 0)), _stroke(BLUE, (0, 9), (90, 9)), _stroke(RED, (0, 50), (30, 50))]
    )
    assert [r["length"] for r in runs] == [90, 30]


def test_applies_needs_three_percent_chromatic_strokes():
    grey = [_stroke(GREY, (0, 0), (1, 0))] * 97
    assert color_runs.applies(grey + [_stroke(RED, (0, 0), (1, 0))] * 3) == (True, 0.03)
    assert color_runs.applies(grey + [_stroke(RED, (0, 0), (1, 0))] * 2)[0] is False
    assert color_runs.applies([]) == (False, 0.0)


# --- colour graph ------------------------------------------------------------------


def test_tags_typed_and_non_equipment_rejected():
    runs = [
        {"color": (0.5, 0.5, 0.0), "points": [(10, 0), (90, 0)], "length": 80.0},
        {"color": (0.5, 0.5, 0.0), "points": [(110, 0), (190, 0)], "length": 80.0},
        {"color": RED, "points": [(200, 0), (400, 0)], "length": 200.0},
    ]
    text = [
        {"text": "P4711", "x": 5, "y": 0},
        {"text": "H1007", "x": 100, "y": 0},
        {"text": "P4712", "x": 195, "y": 0},
        {"text": "P4711", "x": 5, "y": 900},  # the datasheet repeat
        {"text": "1", "x": 0, "y": 500},
        {"text": "A", "x": 0, "y": 520},
        {"text": "DN 800", "x": 50, "y": 520},
    ]
    g = color_graph.build(runs, text)
    kinds = {n["id"]: n["kind"] for n in g["nodes"]}
    assert kinds["P4711"] == "pump" and kinds["H1007"] == "exchanger"
    assert not {"1", "A", "DN 800"} & set(kinds)
    assert [n["occurrences"] for n in g["nodes"] if n["id"] == "P4711"] == [2]  # one node, nearest the pipes
    assert {("P4711", "H1007"), ("H1007", "P4712")} <= {(e["source"], e["target"]) for e in g["edges"]}
    assert any(k == "terminal" for k in kinds.values())  # a run ending in open space
    assert all(e["length"] > 0 for e in g["edges"])


def test_tee_joins_three_components_through_one_terminal():
    runs = [
        {"color": BLUE, "points": [(0, 0), (200, 0)], "length": 200.0},
        {"color": BLUE, "points": [(100, 0), (100, 80)], "length": 80.0},
    ]
    text = [{"text": "P4711", "x": 3, "y": 0}, {"text": "T4750", "x": 197, "y": 0}, {"text": "H1007", "x": 100, "y": 83}]
    g = color_graph.build(runs, text)
    assert len(g["edges"]) == 3  # the main was cut at the tee
    (hub,) = [n for n in g["nodes"] if n["kind"] == "terminal"]
    assert sum(hub["id"] in (e["source"], e["target"]) for e in g["edges"]) == 3
    assert _pairs(g["connections"]) == {("H1007", "P4711"), ("H1007", "T4750"), ("P4711", "T4750")}
    assert all(c["hops"] >= 1 and c["source"] != c["target"] for c in g["connections"])


def test_walk_stops_at_the_first_component():
    runs = [
        {"color": BLUE, "points": [(0, 0), (100, 0)], "length": 100.0},
        {"color": BLUE, "points": [(100, 0), (200, 0)], "length": 100.0},
    ]
    text = [{"text": "P1", "x": 0, "y": 0}, {"text": "V2", "x": 100, "y": 0}, {"text": "T3", "x": 200, "y": 0}]
    assert _pairs(color_graph.build(runs, text)["connections"]) == {("P1", "V2"), ("T3", "V2")}


def test_pump_body_bridges_two_runs_but_a_frame_does_not():
    pump = [(95, -5), (105, -5), (105, 5), (95, 5), (95, -5)]
    frame = [(0, -400), (400, -400), (400, 400), (0, 400), (0, -400)]
    runs = [
        {"color": BLUE, "points": [(0, 0), (95, 0)], "length": 95.0},
        {"color": BLUE, "points": [(105, 0), (200, 0)], "length": 95.0},
    ]
    shapes = [{"color": GREY, "points": pump}, {"color": GREY, "points": frame}]
    tags = [{"text": "P4711", "x": 40, "y": 4}, {"text": "T4750", "x": 160, "y": 4}]
    assert ("P4711", "T4750") in _pairs(color_graph.build(runs, tags, shapes=shapes)["connections"])
    assert not color_graph.build(runs, tags)["connections"]  # without shapes the break remains
    bridges = color_graph._symbol_bridges(runs, shapes, 5.0, 200 * 0.20)
    assert bridges and all(math.dist(*b["points"]) < 50 for b in bridges)


def test_pipe_shorter_than_merge_radius_survives():
    # span 1000 -> merge radius 25; the middle pipe is 20 long
    runs = [
        {"color": BLUE, "points": [(0, 0), (400, 0)], "length": 400.0},
        {"color": BLUE, "points": [(400, 0), (420, 0)], "length": 20.0},
        {"color": BLUE, "points": [(420, 0), (1000, 0)], "length": 580.0},
    ]
    g = color_graph.build(runs, [{"text": "P4711", "x": 0, "y": 0}, {"text": "T4750", "x": 1000, "y": 0}])
    assert [e["route"] for e in g["edges"]].count([[400, 0], [420, 0]]) == 1
    assert _pairs(g["connections"]) == {("P4711", "T4750")}


def _three_pipes(mid_end):
    return [
        {"color": BLUE, "points": [(0, 0), (1000, 0)], "length": 1000.0},
        {"color": BLUE, "points": [(1000, 0), (mid_end, 0)], "length": mid_end - 1000.0},
        {"color": BLUE, "points": [(mid_end, 0), (2000, 0)], "length": 2000.0 - mid_end},
    ]


def test_claim_handover_when_one_tag_would_take_both_ends():
    # span 2000 -> claim 74, merge 50. M1.1 is nearest both ends of the 60-long pipe.
    tags = [
        {"text": "P4711", "x": 0, "y": 0},
        {"text": "T4750", "x": 2000, "y": 0},
        {"text": "M1.1", "x": 1000, "y": 24},
        {"text": "WT 4a", "x": 1060, "y": 69},
    ]
    g = color_graph.build(_three_pipes(1060), tags)
    assert ("M1.1", "WT 4a") in _pairs(g["connections"])
    # the component moves onto its pipework; label_x/label_y keep the text spot
    (wt,) = [n for n in g["nodes"] if n["id"] == "WT 4a"]
    assert (wt["x"], wt["y"], wt["label_x"], wt["label_y"]) == (1060, 0, 1060.0, 69.0)


def test_cad_hairline_is_not_a_pipe_between_two_components():
    tags = [
        {"text": "P4711", "x": 0, "y": 0},
        {"text": "T4750", "x": 2000, "y": 0},
        {"text": "M1.1", "x": 1000, "y": 24},
        {"text": "WT 4a", "x": 1001, "y": 69},
    ]
    assert ("M1.1", "WT 4a") not in _pairs(color_graph.build(_three_pipes(1001), tags)["connections"])


def test_tags_off_page_or_far_from_pipes_are_dropped():
    runs = [{"color": BLUE, "points": [(0, 0), (100, 0)], "length": 100.0}]
    text = [{"text": "P1", "x": 0, "y": 2}, {"text": "P2", "x": 50, "y": 90}, {"text": "P3", "x": 50, "y": -500}]
    g = color_graph.build(runs, text, page_box=(-10, -10, 200, 200))
    assert {n["id"] for n in g["nodes"] if n["kind"] != "terminal"} == {"P1"}
    assert any("1 tag(s) sit impossibly far" in w for w in g["warnings"])


def test_no_runs_gives_an_empty_graph_with_a_warning():
    assert color_graph.build([], []) == {
        "nodes": [],
        "edges": [],
        "warnings": ["no colour runs; nothing to build a graph from"],
    }


# --- geometric graph ---------------------------------------------------------------


def _star(center, n, length=40):
    """n paths ending at `center`, their far ends spread around it."""
    cx, cy = center
    angles = [2 * math.pi * k / n for k in range(n)]
    return [[(cx + length * math.cos(a), cy + length * math.sin(a)), (cx, cy)] for a in angles]


def test_junction_needs_five_ends():
    assert geometric._junction_clusters(_star((100, 100), 4)) == []
    assert geometric._junction_clusters(_star((100, 100), 5)) == [(100.0, 100.0)]


def test_split_path_mid_run_but_not_near_its_ends():
    pl = [(0, 0), (100, 0)]
    assert geometric._split_path_at_nodes(pl, [(50, 5)]) == [[(0, 0), (50, 5)], [(50, 5), (100, 0)]]
    assert geometric._split_path_at_nodes(pl, [(10, 0)]) == [pl]  # within the 12 pt end guard
    assert geometric._split_path_at_nodes(pl, [(50, 20)]) == [pl]  # too far from the pipe


def test_chain_walks_through_bends_and_emits_each_pair_once():
    nodes = [{"id": "a"}, {"id": "b"}]
    paths = [[(0, 0), (100, 0)], [(100, 0), (100, 100)], [(100, 100), (200, 100)]]
    edges = geometric._chain_edges(paths, [(0, 0), (200, 100)], nodes)
    assert edges == [{"from": "a", "to": "b", "route": [[0, 0], [100, 0], [100, 100], [200, 100]]}]


def test_chain_picks_the_straightest_continuation():
    nodes = [{"id": "a"}, {"id": "straight"}, {"id": "side"}]
    paths = [[(0, 0), (100, 0)], [(100, 0), (100, 100)], [(100, 0), (200, 0)]]
    edges = geometric._chain_edges(paths, [(0, 0), (200, 0), (100, 100)], nodes)
    assert ("a", "straight") in {(e["from"], e["to"]) for e in edges}
    assert ("a", "side") not in {(e["from"], e["to"]) for e in edges}


def test_content_floor_drops_a_dense_title_block():
    box = (0, 0, 100, 200)  # 20 buckets of 10
    title = [[(0, 5), (50, 5)]] * 5 + [[(0, 25), (50, 25)]] * 5  # buckets 0 and 2; bucket 1 empty
    drawing = [[(0, y), (50, y)] for y in range(105, 200, 10)] + [[(0, y), (50, y)] for y in range(35, 100, 10)]
    assert geometric._content_floor(title + drawing, box) == 20


def test_tag_wins_over_a_junction_at_the_same_spot():
    star = _star((100, 100), 5)
    topo = geometric.assemble_topology((0, 0, 500, 500), star, [{"text": "P4711", "x": 105, "y": 100}])
    assert [(n["id"], n["class"]) for n in topo["nodes"]] == [("tag0", "P4711")]
