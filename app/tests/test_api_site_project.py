"""Site (site.json) and whole-project export / import."""

import base64
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SITE = {
    "building": {"name": "DC", "osm_id": 7, "outline": [[52.0, 13.0], [52.1, 13.1], [52.0, 13.1]]},
    "source": {"id": "dc", "name": "DC", "lat": 52.0, "lon": 13.0, "temp_c": 30.0, "power_kw": 500.0},
    "sinks": [
        {
            "id": "s1",
            "name": "Pool",
            "lat": 52.01,
            "lon": 13.01,
            "temp_c": 28.0,
            "power_kw": 100.0,
            "area": True,
            "demand": {"k": 1},
        }
    ],
    "pid_layout": {"y": {"x": 0.5, "y": 0.25, "tag": "TT-1"}},
    "pid_notes": {
        "y": {"kind": "sensor", "confidence": "likely", "note": "return temperature"},
        "rack_mean": {"group": {"method": "mean", "members": ["y", "x"]}},
    },
    "pid_views": [{"id": "unit-1", "name": "Cooling unit 1", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.25}],
    "hex_option": "hall",
    "district": {"buildings": 3},
    "heat_source_map": {"y": "dc"},
    "heat_parts": {"hex": True, "hp": False},
    "heat_components": {"hp": "hp_2mw"},
}


def test_site_defaults(client: TestClient, api: str) -> None:
    assert client.get(f"{api}/site").json() == {
        "building": None,
        "source": None,
        "sinks": [],
        "pid_layout": {},
        "pid_notes": {},
        "pid_views": [],
        "hex_option": "condenser",
        "district": None,
        "heat_source_map": None,
        "outdoor": "data",
        "heat_parts": None,
        "heat_components": None,
        "twin_model": None,
        "network_station": None,
    }


def test_site_round_trip(client: TestClient, dataset_dir: Path, api: str) -> None:
    saved = client.put(f"{api}/site", json=SITE).json()
    assert saved["hex_option"] == "hall" and saved["sinks"][0]["outline"] is None
    assert json.loads((dataset_dir / "site.json").read_text()) == saved
    assert client.get(f"{api}/site").json() == saved


def test_site_keeps_the_heat_network_station_placed_by_hand(client: TestClient, api: str) -> None:
    assert client.put(f"{api}/site", json=SITE).json()["network_station"] is None  # none: where the plan puts it
    saved = client.put(f"{api}/site", json={**SITE, "network_station": {"lat": 52.005, "lon": 13.004}}).json()
    assert saved["network_station"] == {"lat": 52.005, "lon": 13.004}
    assert client.put(f"{api}/site", json={**SITE, "network_station": {"lat": 91, "lon": 0}}).status_code == 422


def test_old_site_with_blocks_still_loads(client: TestClient, dataset_dir: Path, api: str) -> None:
    old = {**SITE, "blocks": [{"id": "b", "name": "B", "kind": "physical", "temp_c": 40, "power_kw": 10}]}
    (dataset_dir / "site.json").write_text(json.dumps(old))
    got = client.get(f"{api}/site")
    assert got.status_code == 200 and "blocks" not in got.json() and got.json()["pid_layout"] == SITE["pid_layout"]
    assert client.put(f"{api}/site", json=old).status_code == 200
    assert "blocks" not in json.loads((dataset_dir / "site.json").read_text())


@pytest.mark.parametrize(
    "change",
    [
        {"source": {**SITE["source"], "lat": 91}},
        {"hex_option": "roof"},
        {"sinks": [{"id": "x"}]},
        {"pid_notes": {"y": {"kind": "magic"}}},
        {"pid_notes": {"y": {"confidence": "maybe"}}},
        {"pid_notes": {"g": {"group": {"method": "median", "members": ["a", "b"]}}}},
        {"pid_notes": {"g": {"group": {"method": "mean", "members": ["a"]}}}},
        {"pid_views": [{"id": "Unit 1", "name": "U", "x": 0, "y": 0, "w": 0.5, "h": 0.5}]},
        {"pid_views": [{"id": "u", "name": "U", "x": 0, "y": 0, "w": 0, "h": 0.5}]},
        {"pid_views": [{"id": "u", "name": "U", "x": 0, "y": 0, "w": 0.5, "h": 0.5, "show": "thumbnail"}]},
    ],
)
def test_site_validation(client: TestClient, api: str, change: dict) -> None:
    assert client.put(f"{api}/site", json={**SITE, **change}).status_code == 422


def test_streets(client: TestClient, dataset_dir: Path, api: str) -> None:
    """An example's streets (streets.json) are served as stored; without them 404; never taken for a graph file."""
    assert client.get(f"{api}/site/streets").status_code == 404
    ways = [
        {"kind": "road", "line": [[50.0, 8.0], [50.05, 8.05]]},
        {"kind": "sidewalk", "line": [[50.0, 8.0001], [50.05, 8.0501]]},
    ]
    streets = {"about": "", "source": "© OSM", "bbox": [50, 8, 50.1, 8.1], "ways": ways}
    (dataset_dir / "streets.json").write_text(json.dumps(streets))
    assert client.get(f"{api}/site/streets").json() == streets
    assert "streets.json" not in client.get(f"{api}/graph/files").json()["files"]


def test_no_waermeatlas_building_into_an_example(client: TestClient, dataset_dir: Path, api: str) -> None:
    """sim_* is committed and the Wärmeatlas (© LEA Hessen) never is: its sinks are refused, nothing is written."""
    wah = {**SITE["sinks"][0], "id": "wah-7"}
    r = client.put(f"{api}/site", json={**SITE, "sinks": [wah]})
    assert r.status_code == 422 and "project file" in r.json()["detail"]
    assert not (dataset_dir / "site.json").exists()


def test_blank_stays_blank(client: TestClient, dataset_dir: Path, api: str, monkeypatch: pytest.MonkeyPatch) -> None:
    """The Blank example takes nothing on its map (a project file does); the rest of its site is saved."""
    from backend.routers import site as site_router

    monkeypatch.setattr(site_router, "BLANK", dataset_dir.name)
    r = client.put(f"{api}/site", json=SITE)
    assert r.status_code == 422 and "project file" in r.json()["detail"]
    assert client.put(f"{api}/site", json={**SITE, "building": None, "source": None, "sinks": []}).status_code == 200


def test_project_round_trip_with_backup(client: TestClient, dataset_dir: Path, api: str) -> None:
    client.put(f"{api}/site", json=SITE)
    client.put(f"{api}/equations", json={"y": "a*y[t-1]"})
    client.post(f"{api}/models/train", json={"name": "xgb", "model": "xgboost"})
    boosters = dataset_dir / "models" / "xgb.boosters"
    (boosters / "rows.npz").write_bytes(b"\x00\x01binary")
    (dataset_dir / "pid.png").write_bytes(b"png")
    (dataset_dir / ".backup").mkdir()
    (dataset_dir / ".backup" / "old.json").write_text("{}")

    doc = client.get(f"{api}/project").json()
    assert doc["format"] == "dc-twin-project" and doc["version"] == 1 and doc["dataset"] == "sim_x" and doc["saved"]
    assert sorted(doc["files"]) == [
        "causal_graph.json",
        "dataset.json",
        "equations.json",
        "models/xgb.boosters/rows.npz",
        "models/xgb.boosters/y.json",
        "models/xgb.boosters/z.json",
        "models/xgb.json",
        "site.json",
    ]
    assert base64.b64decode(doc["files"]["models/xgb.boosters/rows.npz"]["base64"]) == b"\x00\x01binary"

    # open a smaller project: the current files go to the backup, the project's are written
    small = {
        **doc,
        "files": {
            "site.json": doc["files"]["site.json"],
            "models/xgb.boosters/rows.npz": doc["files"]["models/xgb.boosters/rows.npz"],
        },
    }
    r = client.post(f"{api}/project", json=small).json()
    assert r["files"] == 2 and r["backup"].startswith(".backup/")
    backup = dataset_dir / r["backup"]
    assert (backup / "models" / "xgb.json").exists() and (backup / "causal_graph.json").exists()
    assert (
        not (dataset_dir / "models" / "xgb.json").exists()
        and (dataset_dir / "models/xgb.boosters/rows.npz").read_bytes() == b"\x00\x01binary"
    )
    assert (dataset_dir / "pid.png").exists() and (dataset_dir / "df_sim_x.parquet").exists()  # not project files
    assert client.get(f"{api}/site").json()["hex_option"] == "hall"

    # and back
    assert client.post(f"{api}/project", json=doc).json()["files"] == len(doc["files"])
    assert client.get(f"{api}/models/xgb").status_code == 200


def test_project_keeps_all_three_systems(client: TestClient, dataset_dir: Path, api: str) -> None:
    """The heat distribution's and the district's structures travel with the data center's: each its own site and models."""
    for scope in ("heat", "district"):
        assert client.put(f"{api}/site?scope={scope}", json={**SITE, "twin_model": f"{scope}-model"}).status_code == 200
    doc = client.get(f"{api}/project").json()
    scoped = sorted(f for f in doc["files"] if "_structure/" in f)
    assert scoped == ["silver/district_structure/site.json", "silver/heat_structure/site.json"]
    # opened again, each lands in its own structure
    for f in scoped:
        (dataset_dir / f).unlink()
    assert client.post(f"{api}/project", json=doc).status_code == 200
    assert client.get(f"{api}/site?scope=heat").json()["twin_model"] == "heat-model"
    assert client.get(f"{api}/site?scope=district").json()["twin_model"] == "district-model"
    # a project from a bronze / silver version names them without silver/: they land in the same place
    bronze = {**doc, "files": {f.removeprefix("silver/"): v for f, v in doc["files"].items()}}
    assert client.post(f"{api}/project", json=bronze).status_code == 200
    assert not (dataset_dir / "heat_structure").exists()
    assert client.get(f"{api}/site?scope=heat").json()["twin_model"] == "heat-model"


def test_project_with_legacy_graph_is_migrated(client: TestClient, dataset_dir: Path, api: str) -> None:
    graph = (dataset_dir / "causal_graph.json").read_text()
    doc = {"format": "dc-twin-project", "version": 1, "dataset": "sim_x", "files": {"graph_manual.json": {"text": graph}}}
    assert client.post(f"{api}/project", json=doc).status_code == 200
    assert not (dataset_dir / "graph_manual.json").exists()
    assert client.get(f"{api}/graph/files").json()["files"] == ["causal_graph.json"]


@pytest.mark.parametrize(
    "change",
    [
        {"format": "other"},
        {"dataset": "sim_y"},
        {"files": {"../x.json": {"text": "{}"}}},
        {"files": {"df_sim_x.parquet": {"text": ""}}},
        {"files": {"pid.png": {"base64": ""}}},
        {"files": {"models/x.boosters/y.npz": {"base64": "not base64!"}}},
        {"files": {"site.json": {}}},
        # B-D3: content that would break the app once written (dataset.json = [] made the dataset list 500)
        {"files": {"dataset.json": {"text": "[]"}}},
        {"files": {"dataset.json": {"text": '{"name": "cut'}}},
        {"files": {"site.json": {"text": '{"sinks": 3}'}}},
        {"files": {"causal_graph.json": {"text": '{"targets": "y"}'}}},
        {"files": {"heat_structure/equations.json": {"text": "[1]"}}},
        {"files": {"models/m.json": {"text": "null"}}},
    ],
)
def test_project_rejected(client: TestClient, dataset_dir: Path, api: str, change: dict) -> None:
    doc = {"format": "dc-twin-project", "version": 1, "dataset": "sim_x", "files": {}} | change
    assert client.post(f"{api}/project", json=doc).status_code == 400
    assert (dataset_dir / "causal_graph.json").exists() and not (dataset_dir / ".backup").exists()
