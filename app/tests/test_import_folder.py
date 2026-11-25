"""A new data center from a folder: its data (CSV to parquet), P&ID, settings and graphs into the open version."""

import json
import sys
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core import import_folder as imp
from backend.routers import pid as pid_router

sys.path.insert(0, str(Path(__file__).parent / "pid"))
from pid_drawings import PNG_1PX, dexpi_xml  # noqa: E402


def _source(tmp_path: Path) -> Path:
    """A delivered folder: a German CSV (; separated, "Zeit"), a parquet one folder down, a DEXPI P&ID, settings."""
    src = tmp_path / "Neues RZ (Halle 2)"
    (src / "hourly").mkdir(parents=True)
    (src / "messdaten.csv").write_text("Zeit;IT_kW;Kuehlung_kW\n2024-01-01 01:00;10;3\n2024-01-01 00:00;11;4\n")
    times = pd.date_range("2024-01-01", periods=3, freq="h")
    pd.DataFrame({"timestamp": times, "IT_kW": [1.0, 2, 3]}).to_parquet(src / "hourly" / "h.parquet")
    (src / "anlage.xml").write_bytes(dexpi_xml())
    (src / "dataset.json").write_text(json.dumps({"kpi": {"it_power": "IT_kW"}, "pid_image": "old.png"}))
    return src


def _app(tmp_path: Path):
    root = tmp_path / "shared"
    for part in ("bronze", "silver"):
        (root / "version_3" / part / "datacenter_data").mkdir(parents=True)
    link = tmp_path / "data_versions"
    link.symlink_to(root)
    (tmp_path / "data").mkdir()
    return TestClient(create_app(tmp_path / "data", versions_dir=link, version_file=tmp_path / ".v")), root / "version_3"


def test_scan_names_what_the_folder_brings(tmp_path):
    got = imp.scan(_source(tmp_path))
    assert got == {
        "id": "neues_rz_halle_2",
        "name": "Neues RZ (Halle 2)",
        "kind": "real",
        "data": ["messdaten.csv", "hourly/h.parquet"],
        "drawing": "anlage.xml",
        "graphs": [],
        "settings": "dataset.json",
    }


def test_a_folder_becomes_a_data_center_with_its_structure(tmp_path, monkeypatch):
    src = _source(tmp_path)
    before = sorted(p.name for p in src.rglob("*"))
    c, version = _app(tmp_path)
    monkeypatch.setattr(pid_router, "_render_png", lambda data, suffix, dpi=150: PNG_1PX)
    r = c.post("/api/data-versions/import", json={"path": str(src), "id": "dc_new", "name": "Neues RZ"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["data"] == ["messdaten.parquet", "h.parquet"] and body["pid"]["components"] == 2

    bronze, silver = version / "bronze" / "datacenter_data" / "dc_new", version / "silver" / "datacenter_data" / "dc_new"
    csv = pd.read_parquet(bronze / "messdaten.parquet")
    assert list(csv.columns) == ["time", "IT_kW", "Kuehlung_kW"] and csv["IT_kW"].tolist() == [11, 10]  # sorted by time
    config = json.loads((silver / "dataset.json").read_text())
    assert config == {"kpi": {"it_power": "IT_kW"}, "name": "Neues RZ", "kind": "real", "pid_image": "pid.png"}
    assert json.loads((silver / "causal_graph.json").read_text())["targets"] == {"IT_kW": [], "Kuehlung_kW": []}
    assert (silver / "pid.png").exists() and (silver / "pid_construct.json").exists()
    assert "dc_new" in [d["id"] for d in c.get("/api/datasets").json()["datasets"]]
    assert sorted(p.name for p in src.rglob("*")) == before  # the folder is only read

    again = c.post("/api/data-versions/import", json={"path": str(src), "id": "dc_new", "name": "x"})
    assert again.status_code == 400 and "already" in again.json()["detail"]


@pytest.mark.parametrize(
    ("files", "message"),
    [({}, "No data files"), ({"a.csv": "x;y\n1;2\n"}, "no time column")],
)
def test_a_folder_without_usable_data_leaves_nothing_behind(tmp_path, files, message):
    src = tmp_path / "src"
    src.mkdir()
    for name, text in files.items():
        (src / name).write_text(text)
    c, version = _app(tmp_path)
    r = c.post("/api/data-versions/import", json={"path": str(src), "id": "dc_bad", "name": "x"})
    assert r.status_code == 400 and message in r.json()["detail"]
    assert not (version / "bronze" / "datacenter_data" / "dc_bad").exists()


def test_not_into_the_examples(tmp_path):
    c, _ = _app(tmp_path)
    c.put("/api/data-versions/current", json={"version": "local"})
    r = c.post("/api/data-versions/import", json={"path": str(_source(tmp_path)), "id": "dc_x", "name": "x"})
    assert r.status_code == 400 and "examples" in r.json()["detail"]


def test_scan_of_a_folder_whose_settings_are_no_object_is_a_400(tmp_path):
    # B-C6: dataset.json = [] answered 500 (fixed with B-D4: read_json names such a file)
    src = _source(tmp_path)
    (src / "dataset.json").write_text("[]")
    c, _ = _app(tmp_path)
    r = c.get("/api/data-versions/scan", params={"path": str(src)})
    assert r.status_code == 400 and "dataset.json" in r.json()["detail"]


def test_a_drawing_above_the_upload_limit_is_not_read_on_import(tmp_path, monkeypatch):
    # B-R3: the folder import read a drawing of any size (an upload of it is capped at PID_MAX_BYTES)
    from backend.routers import data_versions as dv_router

    monkeypatch.setattr(dv_router, "PID_MAX_BYTES", 100)
    monkeypatch.setattr(pid_router, "_render_png", lambda data, suffix, dpi=150: pytest.fail("the drawing was read"))
    src = _source(tmp_path)
    c, _ = _app(tmp_path)
    r = c.post("/api/data-versions/import", json={"path": str(src), "id": "dc_big", "name": "Big"})
    assert r.status_code == 200 and "too large" in r.json()["pid"]["error"]
