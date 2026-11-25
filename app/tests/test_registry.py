"""Dataset discovery and the data-frame cache."""

from pathlib import Path

import pandas as pd
import pytest
from synthetic import make_frame, write_dataset

from backend.core.registry import DatasetRegistry


def test_discovery(data_dir: Path) -> None:
    (data_dir / "empty_folder").mkdir()
    (data_dir / "loose.parquet").write_bytes(b"")
    reg = DatasetRegistry(data_dir)
    reg.discover()
    assert list(reg.datasets) == ["sim_x"]
    meta = reg.datasets["sim_x"]
    assert meta.name == "Sim X" and meta.files == ["df_sim_x"] and meta.columns == ["u", "s", "y", "z"]
    assert meta.time_range == ("2024-01-01T00:00:00", "2024-01-25T23:00:00")
    assert meta.row_count == 600 and meta.resolution_seconds == 3600


def test_dataframe_cache_and_file_check(data_dir: Path) -> None:
    reg = DatasetRegistry(data_dir)
    reg.discover()
    df = reg.get_dataframe("sim_x", "df_sim_x")
    assert pd.api.types.is_datetime64_any_dtype(df["time"]) and reg.get_dataframe("sim_x", "df_sim_x") is df
    for bad in ["../sim_x/df_sim_x", "nope"]:
        with pytest.raises(FileNotFoundError):
            reg.get_dataframe("sim_x", bad)


def test_refresh_drops_removed_datasets_and_migrates_legacy_graphs(tmp_path: Path) -> None:
    write_dataset(tmp_path / "a", make_frame(30))
    old = write_dataset(tmp_path / "b", make_frame(30))
    (old / "causal_graph.json").rename(old / "graph_manual.json")
    reg = DatasetRegistry(tmp_path)
    reg.discover()
    assert set(reg.datasets) == {"a", "b"} and (old / "causal_graph.json").exists()
    for f in (tmp_path / "a").iterdir():
        f.unlink()
    reg.discover()
    assert set(reg.datasets) == {"b"}


def test_missing_data_dir(tmp_path: Path) -> None:
    reg = DatasetRegistry(tmp_path / "nope")
    reg.discover()
    assert reg.datasets == {}


def test_the_examples_are_in_every_project(tmp_path: Path) -> None:
    """A project gets the examples it has no data center of the same id for; its own copy of one comes first. An
    example keeps its own folder: its files are read and written where it lives."""
    frame = make_frame(48)
    examples, project = tmp_path / "data", tmp_path / "version_1"
    for dc in ("sim_a", "sim_b"):
        write_dataset(examples / dc, frame)
    write_dataset(project / "sim_b", frame)
    write_dataset(project / "plant", frame)
    reg = DatasetRegistry(project, examples_dir=examples)
    reg.discover()
    assert sorted(reg.datasets) == ["plant", "sim_a", "sim_b"]
    assert reg.datasets["sim_a"].example and not reg.datasets["sim_b"].example
    assert reg.datasets["sim_a"].file("site.json") == examples / "sim_a" / "site.json"
    assert reg.datasets["sim_b"].file("site.json") == project / "sim_b" / "site.json"
    assert len(reg.get_dataframe("sim_a", reg.datasets["sim_a"].files[0])) == 48
    # the examples' own folder open as the project: no doubles
    same = DatasetRegistry(examples, examples_dir=examples)
    same.discover()
    assert sorted(same.datasets) == ["sim_a", "sim_b"] and not any(m.example for m in same.datasets.values())


def test_unix_times_are_read_as_dates_not_1970(tmp_path: Path) -> None:
    # B-W2: a numeric time column (unix seconds, or milliseconds) in a parquet or a CSV
    df = make_frame(30)
    seconds = (df["time"] - pd.Timestamp("1970-01-01")) // pd.Timedelta("1s")
    write_dataset(tmp_path / "s", df.assign(time=seconds))
    write_dataset(tmp_path / "ms", df.assign(time=seconds * 1000))
    reg = DatasetRegistry(tmp_path)
    reg.discover()
    for dc in ("s", "ms"):
        assert reg.datasets[dc].time_range == ("2024-01-01T00:00:00", "2024-01-02T05:00:00"), dc
        assert reg.get_dataframe(dc, f"df_{dc}")["time"].iloc[1] == pd.Timestamp("2024-01-01 01:00")
    from backend.core import csv_data

    p = tmp_path / "u.csv"
    p.write_text("time,a\n1704067200,1\n1704070800,2\n1704074400,3\n")
    assert csv_data.read_csv_data(p)["time"].iloc[-1] == pd.Timestamp("2024-01-01 02:00")
    meta = csv_data.csv_meta(p)
    assert (meta["start"], meta["end"], meta["resolution_seconds"]) == ("2024-01-01T00:00:00", "2024-01-01T02:00:00", 3600)
    p.write_text("time,a\n1,1\n2,2\n")  # a row number is not a time
    with pytest.raises(ValueError, match="no readable dates"):
        csv_data.read_csv_data(p)


def test_unsorted_rows_are_read_in_time_order_and_the_step_is_the_median(tmp_path: Path) -> None:
    # B-W8: a shuffled parquet trained as if its rows were time steps; the first two rows gave the step
    df = make_frame(30)
    df.loc[0, "time"] = df.loc[1, "time"] - pd.Timedelta("1min")  # an odd first step
    write_dataset(tmp_path / "x", df.sample(frac=1, random_state=1))
    reg = DatasetRegistry(tmp_path)
    reg.discover()
    got = reg.get_dataframe("x", "df_x")
    assert got["time"].is_monotonic_increasing and got["y"].tolist() == df["y"].tolist()
    assert reg.datasets["x"].resolution_seconds == 3600


def test_times_with_a_time_zone_are_read_as_utc(tmp_path: Path) -> None:
    # B-C4: a parquet with zone-aware times answered 500 on .../window (and compared badly with naive bounds)
    from fastapi.testclient import TestClient

    from backend.app import create_app

    df = make_frame(48)
    write_dataset(tmp_path / "tz", df.assign(time=df["time"].dt.tz_localize("Europe/Berlin")))
    reg = DatasetRegistry(tmp_path)
    reg.discover()
    times = reg.get_dataframe("tz", "df_tz")["time"]
    assert times.dt.tz is None and times.iloc[0] == pd.Timestamp("2023-12-31 23:00")  # 00:00 in Berlin, UTC
    r = TestClient(create_app(tmp_path, None)).post("/api/datasets/tz/window", json={"start": "2024-01-01", "end": "2024-01-02"})
    assert r.status_code == 200, r.text
