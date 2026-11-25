"""Prepared variables: the operations, the checks, the recommendations, and the API that writes them next to the data
(never into it) — in a bronze / silver version the delivered data in bronze stays as it is."""

import json
import shutil
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from synthetic import DATASET, write_dataset

from backend.app import create_app
from backend.core import prepare
from backend.core.recommend import recommend
from backend.core.storage import Storage

COLS = ["u", "s", "y", "z"]


def step(name: str, op: str, inputs: list[str] | None = None, **params) -> dict:
    return prepare.check({"name": name, "op": op, "inputs": inputs or [], "params": params}, COLS, COLS)


def test_combine_transform_and_time_features(frame: pd.DataFrame) -> None:
    out = prepare.compute(
        frame,
        [
            step("ys_mean", "mean", ["y", "s"]),
            step("ys_sum", "sum", ["y", "s"]),
            step("y_minus_s", "difference", ["y", "s"]),
            step("y_kelvin", "unit", ["y"], conversion="°C -> K"),
            step("y_step", "diff", ["y"], steps=1),
            step("y_before", "shift", ["y"], steps=2),
            step("hours", "time_since_start", unit="hours"),
            step("weekend", "is_weekend"),
        ],
    )
    assert np.allclose(out.ys_mean, (frame.y + frame.s) / 2)
    assert np.allclose(out.ys_sum, frame.y + frame.s)
    assert np.allclose(out.y_minus_s, frame.y - frame.s)
    assert np.allclose(out.y_kelvin, frame.y + 273.15)
    assert np.allclose(out.y_step[1:], np.diff(frame.y))
    assert np.allclose(out.y_before[2:], frame.y[:-2]) and np.isnan(out.y_before[0])
    assert out.hours.iloc[0] == 0 and out.hours.iloc[5] == 5  # hourly data
    assert set(out.weekend.unique()) == {0.0, 1.0}


def test_a_formula_and_a_step_using_an_earlier_one(frame: pd.DataFrame) -> None:
    first = step("z_half", "scale", ["z"], factor=0.5)
    formula = prepare.check({"name": "f", "op": "formula", "params": {"expr": "z_half[t] - y[t-1]"}}, [*COLS, "z_half"], COLS)
    assert formula["inputs"] == ["y", "z_half"]
    out = prepare.compute(frame, [first, formula])
    assert np.allclose(out.f[1:], (frame.z * 0.5)[1:].to_numpy() - frame.y[:-1].to_numpy())


@pytest.mark.parametrize(
    ("bad", "message"),
    [
        ({"name": "2x", "op": "mean", "inputs": ["u", "y"]}, "must start with a letter"),
        ({"name": "y", "op": "mean", "inputs": ["u", "y"]}, "already exists"),
        ({"name": "a", "op": "fly", "inputs": ["u"]}, "Unknown operation"),
        ({"name": "a", "op": "mean", "inputs": ["u"]}, "at least 2"),
        ({"name": "a", "op": "log", "inputs": ["nope"]}, "Not variables"),
        ({"name": "a", "op": "unit", "inputs": ["u"], "params": {"conversion": "furlongs"}}, "Pick a conversion"),
        ({"name": "a", "op": "rolling_mean", "inputs": ["u"], "params": {"window": 0}}, "whole number"),
        ({"name": "a", "op": "formula", "params": {"expr": "k * u[t]"}}, "no coefficients"),
        ({"name": "a", "op": "scale", "inputs": ["u"], "params": {"factr": 0}}, "no setting factr"),
        ({"name": "a", "op": "log", "inputs": ["u"], "params": {"factor": 2}}, r"settings in params: none"),
        # B-C2: settings of the wrong type were a 500
        ({"name": "a", "op": "rolling_mean", "inputs": ["u"], "params": {"window": None, "steps": 3}}, "whole number"),
        ({"name": "a", "op": "rolling_mean", "inputs": ["u"], "params": {"window": 0, "steps": 3}}, "whole number"),
        ({"name": "a", "op": "unit", "inputs": ["u"], "params": {"conversion": ["K -> °C"]}}, "Pick a conversion"),
        ({"name": "a", "op": "fill_gaps", "inputs": ["u"], "params": {"method": ["zero"]}}, "method must be"),
        ({"name": "a", "op": "time_since_start", "params": {"unit": ["hours"]}}, "unit must be"),
        ({"name": "a", "op": "scale", "inputs": ["u"], "params": {"factor": True}}, "factor must be a number"),
        ({"name": "a", "op": "scale", "inputs": ["u"], "params": {"factor": float("nan")}}, "factor must be a number"),
    ],
)
def test_bad_steps_are_refused_with_a_reason(bad: dict, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        prepare.check(bad, COLS, COLS)


@pytest.mark.filterwarnings("ignore:overflow encountered")  # numpy on values near the float range
def test_a_preview_of_huge_values_is_not_a_500(client: TestClient) -> None:
    # B-C2: factor and offset 1e308: numpy found no finite bins for the histogram
    body = {"name": "p", "op": "scale", "inputs": ["u"], "params": {"factor": 1e308, "offset": 1e308}}
    r = client.post(f"/api/datasets/{DATASET}/prepared/preview", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["histogram"] == {"edges": [], "counts": []}


def test_dependents_follow_the_chain() -> None:
    recipe = [
        {"name": "a", "inputs": ["u"]},
        {"name": "b", "inputs": ["a"]},
        {"name": "c", "inputs": ["b", "s"]},
        {"name": "d", "inputs": ["s"]},
    ]
    assert prepare.dependents(recipe, "a") == ["b", "c"]


def test_a_file_makes_the_steps_its_columns_allow() -> None:
    recipe = [
        {"name": "a", "inputs": ["u"]},
        {"name": "b", "inputs": ["a"]},
        {"name": "d", "inputs": ["s"]},
        {"name": "t", "inputs": []},
    ]
    kept, left = prepare.doable(recipe, ["s", "y"])  # u was dropped: a and b (made from a) cannot be made
    assert [k["name"] for k in kept] == ["d", "t"] and left == ["a", "b"]


def test_recommendations_find_what_to_fix(frame: pd.DataFrame) -> None:
    df = frame.copy()
    df["meter"] = np.cumsum(np.abs(frame.u))  # only rises
    df["flat"] = 3.0
    df.loc[df.index[::20], "y"] = np.nan  # 5 % missing
    df["T_supply"] = 300 + frame.u  # kelvin
    df["z2"] = df.z * 1.0001
    found = {(f["kind"], tuple(f["variables"])) for f in recommend(df, {})}
    assert ("counter", ("meter",)) in found
    assert ("constant", ("flat",)) in found
    assert ("gaps", ("y",)) in found
    assert ("kelvin", ("T_supply",)) in found
    assert any(k == "duplicate" and set(v) == {"z", "z2"} for k, v in found)
    meter = next(f for f in recommend(df, {}) if f["kind"] == "counter")
    assert meter["step"]["op"] == "diff" and meter["step"]["name"] == "meter_per_step"


def _medallion(tmp_path: Path, frame: pd.DataFrame) -> Path:
    """version_3: the data in bronze, the data center's own files in silver."""
    version = tmp_path / "version_3"
    src = write_dataset(tmp_path / "flat" / DATASET, frame)
    bronze = version / "bronze" / "datacenter_data" / DATASET
    silver = version / "silver" / "datacenter_data" / DATASET
    bronze.mkdir(parents=True)
    silver.mkdir(parents=True)
    for f in src.iterdir():
        shutil.copy2(f, (bronze if f.suffix == ".parquet" else silver) / f.name)
    return version


def test_bronze_silver_layout(tmp_path: Path, frame: pd.DataFrame) -> None:
    version = _medallion(tmp_path, frame)
    s = Storage.of(version)
    assert s.bronze == version / "bronze" and s.root == version / "silver" and s.version_root == version
    assert s.dataset_ids() == [DATASET]
    assert s.data_files(DATASET) == [version / "bronze" / "datacenter_data" / DATASET / f"df_{DATASET}.parquet"]
    assert s.file(DATASET, "site.json") == version / "silver" / "district_data" / DATASET / "site.json"


def test_add_preview_and_remove_a_prepared_variable_in_silver(tmp_path: Path, frame: pd.DataFrame) -> None:
    version = _medallion(tmp_path, frame)
    bronze_file = version / "bronze" / "datacenter_data" / DATASET / f"df_{DATASET}.parquet"
    before = bronze_file.read_bytes()
    client = TestClient(create_app(version))
    api = f"/api/datasets/{DATASET}"
    body = {"name": "uy_mean", "op": "mean", "inputs": ["u", "y"]}

    # a setting beside params instead of in it is refused, not silently ignored
    misplaced = client.post(f"{api}/prepared/preview", json={"name": "u_zero", "op": "scale", "inputs": ["u"], "factor": 0})
    assert misplaced.status_code == 422 and "factor" in misplaced.text
    zero = client.post(
        f"{api}/prepared/preview", json={"name": "u_zero", "op": "scale", "inputs": ["u"], "params": {"factor": 0}}
    )
    assert zero.status_code == 200, zero.text
    assert zero.json()["mean"] == 0

    pre = client.post(f"{api}/prepared/preview", json=body).json()
    assert pre["name"] == "uy_mean" and pre["count"] == len(frame) and len(pre["values"]) > 10
    assert "uy_mean" not in client.get("/api/datasets").json()["datasets"][0]["columns"]  # a preview saves nothing

    added = client.post(f"{api}/prepared", json=body)
    assert added.status_code == 200, added.text
    change = added.json()
    assert change["did"] == "added uy_mean (mean of u, y)"
    assert change["files"] == [
        f"silver/datacenter_data/{DATASET}/prepared/df_{DATASET}.parquet",
        f"silver/datacenter_data/{DATASET}/recipe.json",
    ]
    assert "uy_mean" in client.get("/api/datasets").json()["datasets"][0]["columns"]
    data = client.get(f"{api}/data", params={"columns": "uy_mean"}).json()
    assert np.allclose(np.array(data["columns"]["uy_mean"], dtype=float), (frame.u + frame.y) / 2)
    assert bronze_file.read_bytes() == before  # the delivered data is untouched

    # a variable made from it holds it; the error says why
    client.post(f"{api}/prepared", json={"name": "uy_log", "op": "abs", "inputs": ["uy_mean"]})
    refused = client.delete(f"{api}/prepared/uy_mean")
    assert refused.status_code == 400 and "uy_log" in refused.json()["detail"]
    client.delete(f"{api}/prepared/uy_log")
    assert client.delete(f"{api}/prepared/uy_mean").json()["recipe"] == []
    assert "uy_mean" not in client.get("/api/datasets").json()["datasets"][0]["columns"]
    recipe = json.loads((version / "silver" / "datacenter_data" / DATASET / "recipe.json").read_text())
    assert recipe == {"prepared": [], "resampled": []}


def test_resample_by_method_and_refuse_a_finer_step(frame: pd.DataFrame) -> None:
    from backend.core.resample import resample

    out = resample(frame, "1d", {"u": "sum", "s": "last", "z": "drop"}, default="max")
    assert list(out.columns) == ["time", "u", "s", "y"] and len(out) == int(np.ceil(len(frame) / 24))
    day = frame[frame.time < frame.time[0] + pd.Timedelta("1D")]
    assert out.u[0] == pytest.approx(day.u.sum()) and out.s[0] == day.s.iloc[-1] and out.y[0] == pytest.approx(day.y.max())
    with pytest.raises(ValueError, match="coarser step"):
        resample(frame, "15min", {})  # hourly data: 15 min would invent rows
    with pytest.raises(ValueError, match="Unknown method"):
        resample(frame, "1d", {"u": "mode"})
    # a gap in the data stays a gap: an empty step is no row, not a sum of 0
    q = pd.DataFrame({"time": pd.date_range("2024-01-01", periods=16, freq="15min"), "p": 100.0})
    q = q[(q.time < "2024-01-01 01:00") | (q.time >= "2024-01-01 03:00")]
    hourly = resample(q, "1h", {"p": "sum"})
    assert hourly.p.tolist() == [400.0, 400.0] and hourly.time.dt.hour.tolist() == [0, 3]


def test_everything_made_goes_to_silver_and_the_delivered_files_stay(tmp_path: Path, frame: pd.DataFrame) -> None:
    """The examples' layout (flat): results in <dc>/silver/, the data file and dataset.json untouched."""
    dc = write_dataset(tmp_path / DATASET, frame)
    delivered = {p.name: p.read_bytes() for p in dc.iterdir() if p.is_file()}
    client = TestClient(create_app(tmp_path))
    api = f"/api/datasets/{DATASET}"
    assert client.post(f"{api}/prepared", json={"name": "uy", "op": "sum", "inputs": ["u", "y"]}).status_code == 200
    agg = client.post(f"{api}/resampled", json={"step": "1d", "methods": {"u": "sum"}})
    assert agg.status_code == 200, agg.text
    assert agg.json()["files"] == [
        f"{DATASET}/silver/resampled/df_{DATASET}__1d.parquet",
        f"{DATASET}/silver/prepared/df_{DATASET}__1d.parquet",  # the prepared variables are made on it too
        f"{DATASET}/silver/recipe.json",
    ]
    info = client.get("/api/datasets").json()["datasets"][0]
    assert info["files"] == [f"df_{DATASET}", f"df_{DATASET}__1d"] and info["config"]["prepared"][0]["name"] == "uy"
    daily = client.get(f"{api}/data", params={"file": f"df_{DATASET}__1d", "columns": "u,uy"}).json()
    assert daily["count"] == int(np.ceil(len(frame) / 24)) and len(daily["columns"]["uy"]) == daily["count"]
    assert {p.name: p.read_bytes() for p in dc.iterdir() if p.is_file()} == delivered  # nothing delivered changed
    assert client.post(f"{api}/resampled", json={"step": "1h"}).status_code == 400  # not coarser than hourly
    removed = client.delete(f"{api}/resampled/df_{DATASET}__1d").json()
    assert removed["files"][0].endswith("(removed)")
    assert client.get("/api/datasets").json()["datasets"][0]["files"] == [f"df_{DATASET}"]


def test_an_aggregated_file_without_an_input_keeps_every_change_whole(tmp_path: Path, frame: pd.DataFrame) -> None:
    """u dropped from the daily file: u2 cannot be made there, but adding and removing other steps still works."""
    write_dataset(tmp_path / DATASET, frame)
    client = TestClient(create_app(tmp_path))
    api = f"/api/datasets/{DATASET}"
    u2 = {"name": "u2", "op": "scale", "inputs": ["u"], "params": {"factor": 2}}
    assert client.post(f"{api}/prepared", json=u2).status_code == 200
    agg = client.post(f"{api}/resampled", json={"step": "1d", "methods": {"u": "drop"}})
    assert agg.status_code == 200 and f"df_{DATASET}__1d: without u2" in " ".join(agg.json()["files"])
    y2 = {"name": "y2", "op": "scale", "inputs": ["y"], "params": {"factor": 2}}
    added = client.post(f"{api}/prepared", json=y2)
    assert added.status_code == 200, added.text
    daily = client.get(f"{api}/data", params={"file": f"df_{DATASET}__1d", "columns": "y,y2"})
    assert daily.status_code == 200 and "y2" in daily.json()["columns"]
    assert client.delete(f"{api}/prepared/y2").status_code == 200
    assert client.delete(f"{api}/prepared/u2").status_code == 200
    info = client.get("/api/datasets").json()["datasets"][0]
    assert not info["config"].get("prepared") and "y2" not in info["columns"] and "u2" not in info["columns"]


def test_a_step_keeps_the_part_it_is_made_for() -> None:
    """scope: another part's prepared variable (the district's demand inputs) stays off the data center's structure."""
    step = {"name": "T24", "op": "rolling_mean", "inputs": ["a"], "params": {"window": 24}}
    assert "scope" not in prepare.check(step, ["a"], [])  # none: the data center's, as before
    assert prepare.check({**step, "scope": "district"}, ["a"], [])["scope"] == "district"
    with pytest.raises(ValueError, match="scope"):
        prepare.check({**step, "scope": "elsewhere"}, ["a"], [])


def test_write_prepared_computes_every_file_before_it_writes_any(tmp_path: Path, frame: pd.DataFrame) -> None:
    # roadmap R19: moved out of routers/prepare.py into core (prepare.write_prepared); the routes' answers are unchanged
    storage = Storage(tmp_path, structured=False)
    doubled = step("u2", "scale", ["u"], factor=2.0)
    data = {"a": frame, "b": frame.drop(columns=["u"])}
    written = prepare.write_prepared(storage, "dc", [doubled], ["a", "b", "big"], data.__getitem__, lambda stem: stem == "big")
    assert written == [
        "dc/silver/prepared/a.parquet",
        "b: without u2 (made from variables it does not have)",  # nothing it can make: no file
        "big: skipped, too big to load (its aggregated files get the variable)",
    ]
    assert pd.read_parquet(storage.prepared_file("dc", "a"))["u2"].tolist() == (frame["u"] * 2).tolist()
    # no steps left: the files go; a failing file (a missing one here) writes nothing
    with pytest.raises(KeyError):
        prepare.write_prepared(storage, "dc", [doubled], ["a", "missing"], data.__getitem__, lambda stem: False)
    assert prepare.write_prepared(storage, "dc", [], ["a"], data.__getitem__, lambda stem: False) == [
        "dc/silver/prepared/a.parquet (removed)"
    ]


def test_a_time_window_of_a_loaded_file(frame: pd.DataFrame) -> None:
    from backend.core import resample

    start, end = resample.time_bound("2024-01-01 10:00"), resample.time_bound("2024-01-01 12:00")
    got = resample.window(frame, start, end, ["u"])
    assert list(got.columns) == ["time", "u"] and len(got) == 2 and got["time"].iloc[0] == start
    assert list(resample.window(frame, start, end).columns) == ["time", *COLS]
    for bad, message in [("soon", "Not a date"), ("2024-01-01T10:00+01:00", "without a time zone")]:
        with pytest.raises(ValueError, match=message):
            resample.time_bound(bad)
    with pytest.raises(ValueError, match="No rows"):
        resample.window(frame, resample.time_bound("2030-01-01"), resample.time_bound("2030-01-02"))
    with pytest.raises(KeyError):
        resample.window(frame, start, end, ["nope"])
