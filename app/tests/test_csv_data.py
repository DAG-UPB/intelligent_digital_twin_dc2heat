"""Delivered CSV data in bronze: listed from its header and ends only; loaded only when small enough."""

from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core import csv_data
from backend.core.storage import Storage


def _version(tmp_path: Path, rows: int = 50) -> Path:
    """A version holding only its delivery: bronze/datacenter_data/dc_x with one CSV and a P&ID PDF, no silver."""
    dc = tmp_path / "version_4" / "bronze" / "datacenter_data" / "dc_x"
    dc.mkdir(parents=True)
    lines = ["time,IT_kW,T_supply,status"] + [
        f"2024-01-01 {h // 60:02d}:{h % 60:02d}:00,{h},{20 + h % 5},ok" for h in range(rows)
    ]
    (dc / "merged_export.csv").write_text("\n".join(lines) + "\n")
    (dc / "drawing.pdf").write_bytes(b"%PDF-1.4 not read here")
    return tmp_path / "version_4"


def test_the_self_check(tmp_path):
    csv_data.demo(tmp_path)


def test_a_version_with_only_bronze_lists_its_csv_without_loading_it(tmp_path, monkeypatch):
    version = _version(tmp_path)
    assert Storage.of(version).root == version / "silver"
    monkeypatch.setattr(csv_data.pd, "read_csv", _counting(csv_data.pd.read_csv))
    c = TestClient(create_app(version))
    (dc,) = c.get("/api/datasets").json()["datasets"]
    assert dc["id"] == "dc_x" and dc["files"] == ["merged_export"]
    assert dc["columns"] == ["IT_kW", "T_supply"]  # numeric only, without the time column
    assert dc["time_range"] == {"start": "2024-01-01T00:00:00", "end": "2024-01-01T00:49:00"}
    assert dc["resolution_seconds"] == 60
    assert all(kw.get("nrows") for kw in _counting.calls)  # only the first rows were parsed
    assert (version / "silver" / "datacenter_data" / "dc_x").is_dir()  # its own folder, for the P&ID and graphs
    assert not any((version / "bronze" / "datacenter_data" / "dc_x").glob("*.json"))  # bronze untouched


def test_a_csv_too_big_to_load_says_so_and_a_small_one_loads(tmp_path, monkeypatch):
    c = TestClient(create_app(_version(tmp_path)))
    assert c.get("/api/datasets/dc_x/summary").status_code == 200  # 50 rows: loaded
    monkeypatch.setattr(csv_data, "CSV_LOAD_MAX_BYTES", 100)
    c.post("/api/datasets/refresh")
    r = c.get("/api/datasets/dc_x/summary")
    assert r.status_code == 422 and "too big to load" in r.json()["detail"]
    assert c.get("/api/datasets/dc_x/data", params={"columns": "IT_kW"}).status_code == 422


def _counting(read_csv):
    def wrapped(*args, **kwargs):
        _counting.calls.append(kwargs)
        return read_csv(*args, **kwargs)

    return wrapped


_counting.calls = []


def test_a_big_csv_is_aggregated_or_cut_to_a_window_while_read_in_chunks(tmp_path, monkeypatch):
    import pandas as pd

    from backend.core import resample

    version = _version(tmp_path, rows=300)  # 5 hours of minutes
    src = version / "bronze" / "datacenter_data" / "dc_x" / "merged_export.csv"
    monkeypatch.setattr(csv_data, "CSV_LOAD_MAX_BYTES", 100)  # too big to load
    monkeypatch.setattr(csv_data, "CSV_CHUNK_ROWS", 7)  # chunks that cut through the hours
    monkeypatch.setattr(csv_data.chunks, "__defaults__", (None, 7))
    c = TestClient(create_app(version))
    assert c.get("/api/datasets/dc_x/summary").status_code == 422

    r = c.post("/api/datasets/dc_x/resampled", json={"step": "1h", "source": "merged_export", "methods": {"T_supply": "median"}})
    assert r.status_code == 200, r.text
    whole = pd.read_csv(src, parse_dates=["time"])[["time", "IT_kW", "T_supply"]]
    expected = resample.resample(whole, "1h", {"T_supply": "median"})
    got = pd.read_parquet(version / "silver" / "datacenter_data" / "dc_x" / "resampled" / "merged_export__1h.parquet")
    pd.testing.assert_frame_equal(got, expected, check_dtype=False)  # chunked = whole, median included

    # the aggregated file is now the one the pages open; all of the CSV's variables stay listed
    (dc,) = c.get("/api/datasets").json()["datasets"]
    assert dc["files"] == ["merged_export__1h", "merged_export"] and dc["columns"] == ["IT_kW", "T_supply"]
    assert c.get("/api/datasets/dc_x/summary").status_code == 200

    r = c.post("/api/datasets/dc_x/window", json={"start": "2024-01-01 01:00", "end": "2024-01-01 02:00", "columns": ["IT_kW"]})
    assert r.status_code == 200, r.text
    got = pd.read_parquet(
        version / "silver" / "datacenter_data" / "dc_x" / "resampled" / "merged_export__20240101-20240101.parquet"
    )
    assert list(got.columns) == ["time", "IT_kW"] and len(got) == 60 and got["IT_kW"].tolist() == list(range(60, 120))
    assert c.post("/api/datasets/dc_x/window", json={"start": "2030-01-01", "end": "2030-01-02"}).status_code == 400
    assert c.post("/api/datasets/dc_x/window", json={"start": "2024-01-02", "end": "2024-01-01"}).status_code == 400


def test_a_variable_prepared_from_a_big_csv_skips_it_and_is_made_on_its_aggregated_file(tmp_path, monkeypatch):
    version = _version(tmp_path, rows=300)
    monkeypatch.setattr(csv_data, "CSV_LOAD_MAX_BYTES", 100)  # too big to load
    c = TestClient(create_app(version))
    r = c.post("/api/datasets/dc_x/prepared", json={"name": "both_mean", "op": "mean", "inputs": ["IT_kW", "T_supply"]})
    assert r.status_code == 200, r.text
    assert any("skipped, too big" in f for f in r.json()["files"])
    r = c.post("/api/datasets/dc_x/resampled", json={"step": "1h", "source": "merged_export"})
    assert r.status_code == 200, r.text
    assert "both_mean" in c.get("/api/datasets").json()["datasets"][0]["columns"]


def test_in_a_bronze_version_the_recipe_is_neither_a_graph_nor_a_project_file(tmp_path):
    # silver holds the graphs and the prepared variables' recipe.json side by side here
    version = _version(tmp_path)
    c = TestClient(create_app(version))
    api = "/api/datasets/dc_x"
    step = {"name": "it2", "op": "scale", "inputs": ["IT_kW"], "params": {"factor": 2}}
    assert c.post(f"{api}/prepared", json=step).status_code == 200
    recipe = version / "silver" / "datacenter_data" / "dc_x" / "recipe.json"
    assert recipe.is_file()
    assert "recipe.json" not in c.get(f"{api}/graph/files").json()["files"]
    assert c.post(f"{api}/graph/save", json={"file_name": "recipe.json", "targets": {}}).status_code == 400
    doc = c.get(f"{api}/project").json()
    assert "recipe.json" not in doc["files"]
    old = {**doc, "files": {**doc["files"], "recipe.json": {"text": '{"prepared": [], "resampled": []}'}}}
    assert c.post(f"{api}/project", json=old).status_code == 200  # an older export's recipe is not taken
    assert "it2" in recipe.read_text()  # the recipe stays with its prepared values


def test_a_project_from_a_flat_version_opens_its_structures_in_a_bronze_one(tmp_path):
    c = TestClient(create_app(_version(tmp_path)))
    api = "/api/datasets/dc_x"
    site = '{"sinks": [], "twin_model": "m"}'
    files = {"silver/heat_structure/site.json": {"text": site}}
    doc = {"format": "dc-twin-project", "version": 1, "dataset": "dc_x", "files": files}
    assert c.post(f"{api}/project", json=doc).status_code == 200
    assert c.get(f"{api}/site?scope=heat").json()["twin_model"] == "m"


# B-W1: a German export (; separated, decimal comma, thousands dot, day first) is read as it is meant
GERMAN = "Zeit;Temp;Leistung;Zaehler;Status\n" + "".join(
    f"{d:02d}.{m:02d}.2024 00:00;20,{d % 10};{d}.{d:03d},5;{d};ok\n" for m in (1, 2) for d in range(1, 29)
)


def test_a_german_csv_keeps_every_row_and_variable(tmp_path):
    p = tmp_path / "messung.csv"
    p.write_text(GERMAN)
    df = csv_data.read_csv_data(p)
    assert len(df) == 56  # 13. to 28. of each month too, not only the days a month-first reading allows
    assert df["time"].iloc[0] == pd.Timestamp("2024-01-01") and df["time"].iloc[-1] == pd.Timestamp("2024-02-28")
    assert df["time"].is_monotonic_increasing and df["time"].dt.month.value_counts().to_dict() == {1: 28, 2: 28}
    first = df.iloc[0]
    assert (first["Temp"], first["Leistung"], first["Zaehler"]) == (20.1, 1001.5, 1)  # "20,1" and "1.001,5"
    meta = csv_data.csv_meta(p)
    assert meta["columns"] == ["Temp", "Leistung", "Zaehler"]
    assert (meta["start"], meta["end"]) == ("2024-01-01T00:00:00", "2024-02-28T00:00:00")
    assert meta["resolution_seconds"] == 86400
    got = pd.concat(csv_data.chunks(p, rows=10))
    assert len(got) == 56 and got["Leistung"].iloc[-1] == 28028.5


def test_a_german_csv_is_imported_with_every_row(tmp_path):
    from backend.core import import_folder as imp

    src = tmp_path / "delivery"
    src.mkdir()
    (src / "messung.csv").write_text(GERMAN)
    df = imp._read(src / "messung.csv")
    assert len(df) == 56 and list(df.columns) == ["time", "Temp", "Leistung", "Zaehler", "Status"]
    assert df["Leistung"].dtype.kind == "f"


def test_unreadable_times_are_refused_not_dropped(tmp_path):
    p = tmp_path / "d.csv"
    p.write_text("time,a\n2024-01-01 00:00,1\n2024-01-01 01:00,2\nsoon,3\n")
    with pytest.raises(ValueError, match="soon"):
        csv_data.read_csv_data(p)


def test_times_with_offsets_across_a_clock_change_are_read_as_utc(tmp_path):
    p = tmp_path / "d.csv"
    p.write_text(
        "time,a\n2024-10-27T01:00:00+02:00,1\n2024-10-27T02:00:00+02:00,2\n2024-10-27T02:00:00+01:00,3\n2024-10-27T03:00:00+01:00,4\n"
    )
    df = csv_data.read_csv_data(p)
    assert df["time"].dt.tz is None
    assert list(df["time"].dt.strftime("%H:%M")) == ["23:00", "00:00", "01:00", "02:00"] and list(df["a"]) == [1, 2, 3, 4]
    assert csv_data.csv_meta(p)["start"] == "2024-10-26T23:00:00"
