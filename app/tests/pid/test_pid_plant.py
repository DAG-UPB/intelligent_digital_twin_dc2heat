"""components_of and plant_fractions: the plant graph stored as pid_plant.json."""

import pytest

from backend.pid import components_of, plant_fractions


def _geometric(edges, page=(0, 0, 100, 100)):
    return {
        "pageBox": list(page),
        "nodes": [
            {"id": "t0", "source": "tag", "class": "P1", "x": 0, "y": 0},
            {"id": "t1", "source": "tag", "class": "WT1", "x": 9, "y": 0},
            {"id": "t2", "source": "tag", "class": "V3", "x": 50, "y": 50},
            {"id": "j0", "source": "junction", "x": 1, "y": 0},
            {"id": "j1", "source": "junction", "x": 8, "y": 0},
        ],
        "edges": [{"from": a, "to": b} for a, b in edges],
    }


def test_tags_linked_through_unnamed_junctions():
    g = components_of(_geometric([("t0", "j0"), ("j0", "j1"), ("j1", "t1")]))
    assert [c["label"] for c in g["components"]] == ["P1", "WT1", "V3"]
    assert g["components"][0] == {"id": "t0", "label": "P1", "x": 0, "y": 0}
    assert g["links"] == [["t0", "t1"]]


def test_tag_beside_the_pipe_attaches_to_the_nearest_junction():
    assert components_of(_geometric([("j0", "j1")]))["links"] == [["t0", "t1"]]


def test_attach_radius_is_five_percent_of_the_page_diagonal():
    payload = {
        "pageBox": [0, 0, 300, 400],  # diagonal 500 -> reach 25
        "nodes": [
            {"id": "t0", "source": "tag", "class": "P1", "x": 0, "y": 0},
            {"id": "t1", "source": "tag", "class": "P2", "x": 100, "y": 0},
            {"id": "j0", "source": "junction", "x": 25, "y": 0},
            {"id": "j1", "source": "junction", "x": 90, "y": 0},
        ],
        "edges": [{"from": "j0", "to": "j1"}, {"from": "j1", "to": "t1"}],
    }
    assert components_of(payload)["links"] == [["t0", "t1"]]
    payload["nodes"][2]["x"] = 25.01
    assert components_of(payload)["links"] == []


def test_walk_stops_at_the_first_tag():
    payload = _geometric([("t0", "j0"), ("j0", "t1"), ("t1", "j1"), ("j1", "t2")])
    assert components_of(payload)["links"] == [["t0", "t1"], ["t1", "t2"]]


def test_colour_graph_wins_and_drops_terminals_and_self_links():
    payload = {
        **_geometric([("t0", "t1")]),
        "colorNodes": [
            {"id": "WT 4a", "tag": "WT 4a", "kind": "exchanger", "x": 5, "y": 6},
            {"id": "M1.1", "tag": "M1.1", "kind": "pump", "x": 1, "y": 2},
            {"id": "terminal-1", "tag": None, "kind": "terminal", "x": 0, "y": 0},
        ],
        "colorConnections": [
            {"source": "WT 4a", "target": "M1.1"},
            {"source": "M1.1", "target": "M1.1"},
            {"source": "M1.1", "target": "WT 4a"},
        ],
    }
    assert components_of(payload) == {
        "components": [
            {"id": "WT 4a", "label": "WT 4a", "x": 5, "y": 6},
            {"id": "M1.1", "label": "M1.1", "x": 1, "y": 2},
        ],
        "links": [["M1.1", "WT 4a"]],
    }


def test_only_terminals_falls_back_to_geometric_tags():
    payload = {**_geometric([]), "colorNodes": [{"id": "terminal-1", "kind": "terminal", "x": 0, "y": 0}]}
    assert [c["id"] for c in components_of(payload)["components"]] == ["t0", "t1", "t2"]


def test_plant_fractions_from_colour_runs():
    payload = {
        "viewBox": "0 0 200 100",
        "colorNodes": [{"id": "P1", "tag": "P1", "kind": "pump", "x": 50, "y": 50}],
        "colorConnections": [],
        "colorRuns": [{"color": "#ff0000", "points": [[0, 0], [200, 100]]}],
        "edges": [{"from": "a", "to": "b", "route": [[1, 1], [2, 2]]}],
    }
    assert plant_fractions(payload) == {
        "components": [{"id": "P1", "label": "P1", "x": 0.25, "y": 0.5}],
        "links": [],
        "pipes": [[[0.0, 0.0], [1.0, 1.0]]],
    }


def test_plant_fractions_pipes_from_edges_without_colour_runs():
    payload = {**_geometric([("t0", "t1")]), "viewBox": "0 0 10 20"}
    payload["edges"][0]["route"] = [[0, 0], [10, 20]]
    plant = plant_fractions(payload)
    assert plant["pipes"] == [[[0.0, 0.0], [1.0, 1.0]]]
    assert plant["links"] == [["t0", "t1"]]
    assert plant["components"][1] == {"id": "t1", "label": "WT1", "x": 0.9, "y": 0.0}


@pytest.mark.parametrize("payload", [{}, {"viewBox": "0 0 0 10"}, {"viewBox": "garbage"}])
def test_plant_fractions_needs_a_page_size(payload):
    with pytest.raises(ValueError, match="no page size"):
        plant_fractions(payload)
