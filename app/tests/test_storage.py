"""Storage layouts: a structured version folder (version_2 on) keeps each kind of file in its own folder, and the
whole app reads and writes there; the flat layout (examples, version_1) is unchanged."""

import json
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from synthetic import DATASET, write_dataset

from backend.app import create_app
from backend.core.storage import Storage

COMP = {
    "id": "my_hex",
    "name": "My HEX",
    "kind": "custom",
    "inputs": [{"name": "u"}],
    "nodes": [{"name": "y", "equation": "a*u[t]"}],
    "params": [{"name": "a", "value": 1, "fixed": False}],
}


def _structured(tmp_path: Path, frame: pd.DataFrame) -> Path:
    root = tmp_path / "version_2"
    write_dataset(root / "datacenter_data" / DATASET, frame)
    return root


def test_flat_layout_keeps_everything_in_the_data_center_folder(tmp_path: Path) -> None:
    s = Storage.of(tmp_path)
    assert not s.structured and s.datasets_dir == tmp_path
    assert s.file("dc", "site.json") == tmp_path / "dc" / "site.json"
    assert s.file("dc", "models/xgb.json") == tmp_path / "dc" / "models" / "xgb.json"
    assert s.components_dir == tmp_path / "_components" and s.status_dir("dc") == tmp_path / "_status" / "dc"


def test_structured_layout_places_each_kind_of_file(tmp_path: Path, frame: pd.DataFrame) -> None:
    root = _structured(tmp_path, frame)
    s = Storage.of(root)
    assert s.structured and s.datasets_dir == root / "datacenter_data"
    assert s.file(DATASET, "causal_graph.json") == root / "datacenter_data" / DATASET / "causal_graph.json"
    assert s.file(DATASET, "equations.json") == root / "models" / DATASET / "physics" / "equations.json"
    assert s.file(DATASET, "models/xgb.boosters/y.json") == root / "models" / DATASET / "trained" / "xgb.boosters" / "y.json"
    assert s.file(DATASET, "site.json") == root / "district_data" / DATASET / "site.json"
    assert s.components_dir == root / "heat_distribution_data" / "components"
    assert s.waermeatlas_db == root / "district_data" / "waermeatlas" / "buildings.sqlite"
    assert s.map_examples_file == root / "district_data" / "map_examples.json"


def test_the_app_reads_and_writes_the_structured_folders(tmp_path: Path, frame: pd.DataFrame) -> None:
    root = _structured(tmp_path, frame)
    client = TestClient(create_app(root))
    api = f"/api/datasets/{DATASET}"
    assert [d["id"] for d in client.get("/api/datasets").json()["datasets"]] == [DATASET]

    assert client.put(f"{api}/site", json={}).status_code == 200
    assert client.put(f"{api}/equations", json={"y": "a*y[t-1]"}).status_code == 200
    assert client.post(f"{api}/models/train", json={"name": "lin"}).status_code == 200
    assert client.put("/api/components/my_hex", json=COMP).status_code == 200
    assert (root / "district_data" / DATASET / "site.json").is_file()
    assert (root / "models" / DATASET / "physics" / "equations.json").is_file()
    assert (root / "models" / DATASET / "trained" / "lin.json").is_file()
    assert (root / "heat_distribution_data" / "components" / "my_hex.json").is_file()
    assert not (root / "datacenter_data" / DATASET / "site.json").exists()
    assert client.get(f"{api}/models/lin").status_code == 200

    # every save is a new file in status/<dc>/, holding the files under their project names
    saved = client.post(f"{api}/project/save").json()
    assert saved["path"].startswith(f"status/{DATASET}/{DATASET}-project-")
    project = json.loads((root / saved["path"]).read_text())
    assert {"site.json", "equations.json", "models/lin.json", "causal_graph.json", "dataset.json"} <= set(project["files"])

    # with the Site map's unsaved edits: they go into the file as its site.json, the data center's own is untouched
    site_file = root / "district_data" / DATASET / "site.json"
    before = site_file.read_text()
    draft = {
        "building": None,
        "source": None,
        "sinks": [{"id": "s1", "name": "Mine", "lat": 50.1, "lon": 8.7, "temp_c": 70, "power_kw": 5}],
    }
    with_draft = client.post(f"{api}/project/save", json={"site": draft}).json()
    assert json.loads(json.loads((root / with_draft["path"]).read_text())["files"]["site.json"]["text"]) == draft
    assert site_file.read_text() == before

    # opening it puts every file back in its own folder
    (root / "models" / DATASET / "physics" / "equations.json").write_text("{}")
    assert client.post(f"{api}/project", json=project).status_code == 200
    assert json.loads((root / "models" / DATASET / "physics" / "equations.json").read_text()) == {"y": "a*y[t-1]"}
    assert (root / "district_data" / DATASET / "site.json").is_file()


def test_structure_version_copies_a_flat_folder_into_the_structured_layout(tmp_path: Path, frame: pd.DataFrame) -> None:
    import structure_version

    src = tmp_path / "version_1"
    dc = write_dataset(src / DATASET, frame)
    (dc / "site.json").write_text("{}")
    (dc / "equations.json").write_text("{}")
    (dc / "models" / "lin.boosters").mkdir(parents=True)
    (dc / "models" / "lin.json").write_text("{}")
    (src / "_external" / "waermeatlas").mkdir(parents=True)
    (src / "_external" / "waermeatlas" / "buildings.sqlite").write_text("db")
    (src / "_local").mkdir()
    (src / "_local" / "map_examples.json").write_text("[]")
    before = sorted(p.relative_to(src).as_posix() for p in src.rglob("*"))

    dst = tmp_path / "version_2"
    structure_version.structure(src, dst)
    s = Storage.of(dst)
    assert s.structured
    for rel in ("site.json", "equations.json", "models/lin.json", "causal_graph.json", "dataset.json"):
        assert s.file(DATASET, rel).is_file(), rel
    assert s.file(DATASET, "models/lin.boosters").is_dir()
    assert not (s.dataset_dir(DATASET) / "site.json").exists() and not (s.dataset_dir(DATASET) / "models").exists()
    assert s.waermeatlas_db.read_text() == "db" and s.map_examples_file.read_text() == "[]"
    assert s.components_dir.is_dir() and (dst / "status").is_dir()
    assert sorted(p.relative_to(src).as_posix() for p in src.rglob("*")) == before  # the source is untouched
    with pytest.raises(ValueError, match="already has files"):
        structure_version.structure(src, dst)


def test_bronze_silver_version_splits_a_structured_one(tmp_path: Path, frame: pd.DataFrame) -> None:
    import bronze_silver_version
    import structure_version

    flat = tmp_path / "version_1"
    dc = write_dataset(flat / DATASET, frame)
    (dc / "site.json").write_text("{}")
    (dc / "models").mkdir()
    (dc / "models" / "lin.json").write_text("{}")
    (flat / "_external" / "waermeatlas").mkdir(parents=True)
    (flat / "_external" / "waermeatlas" / "buildings.sqlite").write_text("db")
    v2, v3 = tmp_path / "version_2", tmp_path / "version_3"
    structure_version.structure(flat, v2)
    before = sorted((p.relative_to(v2).as_posix(), p.stat().st_mtime) for p in v2.rglob("*"))

    counts = bronze_silver_version.split(v2, v3)
    s = Storage.of(v3)
    assert s.bronze == v3 / "bronze" and counts["bronze"] == 2  # the data file and the Wärmeatlas
    assert s.data_files(DATASET) == [v3 / "bronze" / "datacenter_data" / DATASET / f"df_{DATASET}.parquet"]
    assert s.waermeatlas_db.read_text() == "db"
    for rel in ("site.json", "models/lin.json", "causal_graph.json", "dataset.json"):
        assert s.file(DATASET, rel).is_file() and str(s.file(DATASET, rel)).startswith(str(v3 / "silver")), rel
    assert not list((v3 / "silver").rglob("*.parquet"))  # no data in silver until something is prepared
    assert sorted((p.relative_to(v2).as_posix(), p.stat().st_mtime) for p in v2.rglob("*")) == before
    with pytest.raises(ValueError, match="already has files"):
        bronze_silver_version.split(v2, v3)
    with pytest.raises(ValueError, match="already has bronze"):
        bronze_silver_version.split(v3, tmp_path / "version_4")
    client = TestClient(create_app(v3))  # and the app works on it
    assert [d["id"] for d in client.get("/api/datasets").json()["datasets"]] == [DATASET]


def test_dataset_json_names_the_default_data_file(tmp_path: Path, frame: pd.DataFrame) -> None:
    # bronze holds the delivery as it came; the data the app works on is prepared in silver and named the default
    v = tmp_path / "version_1"
    delivered = v / "bronze" / "datacenter_data" / DATASET
    write_dataset(delivered, frame)
    made = v / "silver" / "datacenter_data" / DATASET / "resampled"
    made.mkdir(parents=True)
    frame.to_parquet(made / "hourly.parquet", index=False)
    s = Storage.of(v)
    assert [p.stem for p in s.data_files(DATASET)] == [f"df_{DATASET}", "hourly"]  # no choice: the delivery first
    (v / "silver" / "datacenter_data" / DATASET / "dataset.json").write_text(json.dumps({"data_file": "hourly"}))
    assert [p.stem for p in s.data_files(DATASET)] == ["hourly", f"df_{DATASET}"]
    (v / "silver" / "datacenter_data" / DATASET / "dataset.json").write_text(json.dumps({"data_file": "gone"}))
    assert [p.stem for p in s.data_files(DATASET)] == [f"df_{DATASET}", "hourly"]  # a name that is not there: as before
