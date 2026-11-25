"""Causal-graph endpoints: files, read, save, drivers, lag discovery."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from synthetic import GRAPH, make_frame, write_dataset

from backend.app import create_app


def test_graph_files(client: TestClient, dataset_dir: Path, api: str) -> None:
    for name in ["causal_graph_pc.json", "site.json", "equations.json", "pid_plant.json", "x.canvas.json"]:
        (dataset_dir / name).write_text("{}")
    assert client.get(f"{api}/graph/files").json() == {
        "dataset_id": "sim_x",
        "files": ["causal_graph.json", "causal_graph_pc.json"],
    }


def test_get_default_graph(client: TestClient, api: str) -> None:
    g = client.get(f"{api}/graph").json()
    assert g["source"] == "causal_graph.json" and g["link_strengths"] == []
    assert g["targets"] == {t: [{"parent": p, "lag": lag} for p, lag in ps] for t, ps in GRAPH.items()}


def test_missing_graphs(client: TestClient, dataset_dir: Path, api: str) -> None:
    r = client.get(f"{api}/graph", params={"source": "nope.json"})
    assert r.status_code == 404 and r.json()["detail"] == "Graph file 'nope.json' not found"
    (dataset_dir / "causal_graph.json").unlink()
    assert client.get(f"{api}/graph").json() == {"source": None, "targets": {}, "link_strengths": []}
    # asked for by name (what Physical structure does for a data center without graph files): empty as well
    empty = client.get(f"{api}/graph", params={"source": "causal_graph.json"}).json()
    assert empty == {"source": None, "targets": {}, "link_strengths": []}


@pytest.mark.parametrize("name", ["a/b.json", "x.txt", "site.json", "pid_plant.json", "x.canvas.json"])
def test_invalid_graph_names_are_400(client: TestClient, api: str, name: str) -> None:
    assert client.get(f"{api}/graph", params={"source": name}).status_code == 400
    assert client.get(f"{api}/graph/drivers", params={"source": name}).status_code == 400
    assert client.post(f"{api}/graph/save", json={"file_name": name, "targets": {}}).status_code == 400


def test_save_and_read_back(client: TestClient, dataset_dir: Path, api: str) -> None:
    body = {
        "file_name": "mine.json",
        "targets": {"y": [{"parent": "u", "lag": -2}, {"parent": "y", "lag": -1}]},
        "link_strengths": [{"source": "u", "target": "y", "lag": -2, "value": 0.4}],
    }
    r = client.post(f"{api}/graph/save", json=body).json()
    assert r == {"dataset_id": "sim_x", "file_name": "mine.json", "file_path": str(dataset_dir / "mine.json"), "edge_count": 2}
    assert json.loads((dataset_dir / "mine.json").read_text())["targets"] == {"y": [["u", -2], ["y", -1]]}
    g = client.get(f"{api}/graph", params={"source": "mine.json"}).json()
    assert g == {"source": "mine.json", "targets": body["targets"], "link_strengths": body["link_strengths"]}


def test_add_variable_round_trip_keeps_the_file(client: TestClient, dataset_dir: Path, api: str) -> None:
    """AI modelling's + Add variable: GET, add a target without parents, save. Every other byte stays."""
    body = {
        "file_name": "mine.json",
        "targets": {"y": [{"parent": "u", "lag": -2}, {"parent": "y", "lag": -1}]},
        "link_strengths": [{"source": "u", "target": "y", "lag": -2, "value": 0.123456789}],
    }
    client.post(f"{api}/graph/save", json=body)
    before = json.loads((dataset_dir / "mine.json").read_text())
    g = client.get(f"{api}/graph", params={"source": "mine.json"}).json()
    added = {"file_name": "mine.json", "targets": {**g["targets"], "new": []}, "link_strengths": g["link_strengths"]}
    client.post(f"{api}/graph/save", json=added)
    expected = {"targets": {**before["targets"], "new": []}, "link_strengths": before["link_strengths"]}
    assert (dataset_dir / "mine.json").read_text() == json.dumps(expected, indent=2)


def test_legacy_shape_is_read_and_left_alone(client: TestClient, dataset_dir: Path, api: str) -> None:
    legacy = '{"y ": [["u", -1]]}'
    (dataset_dir / "old.json").write_text(legacy)
    g = client.get(f"{api}/graph", params={"source": "old.json"}).json()
    assert g["targets"] == {"y": [{"parent": "u", "lag": -1}]}
    assert (dataset_dir / "old.json").read_text() == legacy  # a GET writes nothing


def test_not_a_graph_is_422(client: TestClient, dataset_dir: Path, api: str) -> None:
    (dataset_dir / "plant.json").write_text('{"components": [{"id": "a", "label": "a", "x": 0, "y": 0}], "links": []}')
    r = client.get(f"{api}/graph", params={"source": "plant.json"})
    assert r.status_code == 422 and "Invalid graph JSON format" in r.json()["detail"]


def test_legacy_graph_manual_is_migrated_at_startup(tmp_path: Path) -> None:
    d = write_dataset(tmp_path / "old", make_frame(30))
    (d / "causal_graph.json").rename(d / "graph_manual.json")
    client = TestClient(create_app(tmp_path))
    assert client.get("/api/datasets/old/graph/files").json()["files"] == ["causal_graph.json"]
    assert client.get("/api/datasets/old/graph").json()["source"] == "causal_graph.json"


def test_drivers(client: TestClient, api: str) -> None:
    assert client.get(f"{api}/graph/drivers").json() == {"drivers": ["u", "s"]}
    r = client.get(f"{api}/graph/drivers", params={"source": "nope.json"})
    assert r.status_code == 404


def test_removed_endpoints(client: TestClient, api: str) -> None:
    assert client.post(f"{api}/graph/discover", json={}).status_code in (404, 405)
    assert client.get(f"{api}/canvas/files").status_code == 404
    assert client.get("/api/demand/profiles").status_code == 404


def test_discover_lags_bad_file_and_bounds(client: TestClient, api: str) -> None:
    r = client.post(f"{api}/graph/discover-lags", json={"links": [], "file": "nope"})
    assert r.status_code == 404
    assert client.post(f"{api}/graph/discover-lags", json={"links": [], "max_lag": 25}).status_code == 422


def test_discover_lags_returns_strengths(client: TestClient, api: str, monkeypatch: pytest.MonkeyPatch) -> None:
    """Fast: discovery stubbed; the response keeps its fields and adds the strengths of the found lags."""
    strength = {"source": "u", "target": "y", "lag": -2, "value": 0.7}
    links = {("u", "y"): {"lags": [2], "p": {1: 0.5, 2: 0.0}}}
    found = {"links": links, "self": {"u": [], "y": []}, "skipped": [], "strengths": [strength]}
    monkeypatch.setattr("backend.routers.graphs.discover_lags", lambda *a, **k: found)
    r = client.post(f"{api}/graph/discover-lags", json={"links": [{"source": "u", "target": "y"}]})
    assert r.json() == {
        "links": [{"source": "u", "target": "y", "lags": [2], "p": {"1": 0.5, "2": 0.0}}],
        "self": {"u": [], "y": []},
        "skipped": [],
        "link_strengths": [strength],
    }


@pytest.mark.slow
def test_discover_lags(client: TestClient, api: str) -> None:
    body = {"links": [{"source": "u", "target": "y"}, {"source": "nope", "target": "y"}], "min_lag": 1, "max_lag": 3}
    r = client.post(f"{api}/graph/discover-lags", json=body).json()
    [link] = r["links"]
    assert link["source"] == "u" and link["target"] == "y" and 1 in link["lags"] and set(link["p"]) == {"1", "2", "3"}
    assert r["skipped"] == [{"source": "nope", "target": "y"}] and set(r["self"]) == {"u", "y"}
    found = {(s["source"], s["target"], s["lag"]) for s in r["link_strengths"]}
    assert {("u", "y", -lag) for lag in link["lags"]} <= found
    r = client.post(f"{api}/graph/discover-lags", json={"links": [], "min_lag": 3, "max_lag": 2})
    assert r.status_code == 400
