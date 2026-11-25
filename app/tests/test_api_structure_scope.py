"""The heat distribution's structure (?scope=heat): its own graph files, layout and construct, apart from the data center's."""

from pathlib import Path

from fastapi.testclient import TestClient

GRAPH = {"file_name": "causal_graph.json", "targets": {"Q_hp": [{"parent": "T_source", "lag": 1}]}, "link_strengths": []}


def test_the_heat_structure_is_kept_apart_from_the_data_centers(client: TestClient, dataset_dir: Path, api: str):
    dc_files = client.get(f"{api}/graph/files").json()["files"]
    dc_graph = client.get(f"{api}/graph").json()
    # nothing yet: no folder made by reading
    assert client.get(f"{api}/graph/files", params={"scope": "heat"}).json()["files"] == []
    assert client.get(f"{api}/site", params={"scope": "heat"}).json()["pid_layout"] == {}
    assert not (dataset_dir / "silver" / "heat_structure").exists()
    assert client.get(f"{api}/pid/construct", params={"scope": "heat"}).json()["picture"] is False  # nothing to load

    assert client.post(f"{api}/graph/save", params={"scope": "heat"}, json=GRAPH).status_code == 200
    layout = {"pid_layout": {"Q_hp": {"tag": "TT", "x": 100, "y": 50}}}
    assert client.put(f"{api}/site", params={"scope": "heat"}, json=layout).status_code == 200
    assert client.put(f"{api}/pid/construct", params={"scope": "heat"}, json={"shapes": []}).status_code == 200

    folder = dataset_dir / "silver" / "heat_structure"  # silver: never next to the delivered data
    assert {p.name for p in folder.iterdir()} >= {"causal_graph.json", "site.json", "pid_construct.json"}
    heat = client.get(f"{api}/graph", params={"scope": "heat"}).json()
    assert heat["targets"] == {"Q_hp": [{"parent": "T_source", "lag": 1}]}
    assert client.get(f"{api}/site", params={"scope": "heat"}).json()["pid_layout"]["Q_hp"]["x"] == 100
    # the data center's own are untouched
    assert client.get(f"{api}/graph/files").json()["files"] == dc_files
    assert client.get(f"{api}/graph").json() == dc_graph
    assert "Q_hp" not in client.get(f"{api}/site").json()["pid_layout"]


def test_an_unknown_scope_is_refused(client: TestClient, api: str):
    assert client.get(f"{api}/graph/files", params={"scope": "nope"}).status_code == 422


def test_the_heat_structure_is_modelled_on_its_own_graph_equations_and_models(client: TestClient, dataset_dir: Path, api: str):
    heat = {"scope": "heat"}
    # its graph: y from u, and a variable without data (only on the drawing)
    graph = {
        "file_name": "causal_graph.json",
        "targets": {"y": [{"parent": "u", "lag": -1}], "Q_hp": [], "u": []},
        "link_strengths": [],
    }
    assert client.post(f"{api}/graph/save", params=heat, json=graph).status_code == 200
    assert client.put(f"{api}/equations", params=heat, json={"y": "a*u[t-1]"}).status_code == 200
    r = client.post(f"{api}/models/train", params=heat, json={"name": "linear"})
    assert r.status_code == 200, r.text
    assert r.json()["order"] == ["y"] and r.json()["graph_file"] == "causal_graph.json"
    folder = dataset_dir / "silver" / "heat_structure"
    assert (folder / "models" / "linear.json").exists() and (folder / "equations.json").exists()
    assert client.get(f"{api}/models", params=heat).json()["models"] == ["linear"]
    ev = client.post(f"{api}/models/evaluate", params=heat, json={"names": ["linear"], "levers": [], "horizon": 24})
    assert ev.status_code == 200 and "y" in ev.json()["models"]["linear"]["free_r2"]
    # the data center's own are untouched
    assert client.get(f"{api}/models").json()["models"] == []
    assert client.get(f"{api}/equations").json() == {"equations": {}}
