"""GET /api/datasets, /data, /pid.png, /refresh and /health."""

from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from synthetic import make_frame, write_dataset

from backend.app import create_app

ROUTES = [
    ("get", "/pid.png"),
    ("get", "/data"),
    ("get", "/summary"),
    ("get", "/graph/files"),
    ("get", "/graph"),
    ("post", "/graph/save"),
    ("get", "/graph/drivers"),
    ("post", "/graph/discover-lags"),
    ("get", "/equations"),
    ("put", "/equations"),
    ("post", "/equations/check"),
    ("get", "/models"),
    ("get", "/models/linear"),
    ("post", "/models/train"),
    ("post", "/models/evaluate"),
    ("post", "/models/linear/simulate"),
    ("get", "/site"),
    ("put", "/site"),
    ("get", "/project"),
    ("post", "/project"),
    ("get", "/pid/plant"),
]


def test_list_datasets(client: TestClient) -> None:
    [d] = client.get("/api/datasets").json()["datasets"]
    assert d == {
        "id": "sim_x",
        "name": "Sim X",
        "files": ["df_sim_x"],
        "columns": ["u", "s", "y", "z"],
        "time_range": {"start": "2024-01-01T00:00:00", "end": "2024-01-25T23:00:00"},
        "row_count": 600,
        "resolution_seconds": 3600,
        "config": {"name": "Synthetic X", "kind": "simulation", "levers": ["s"], "actuators": ["s"], "heat": []},
    }


def test_config_defaults_to_empty(client: TestClient, dataset_dir: Path) -> None:
    (dataset_dir / "dataset.json").unlink()
    assert client.get("/api/datasets").json()["datasets"][0]["config"] == {}


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_unknown_dataset_is_404(client: TestClient, method: str, path: str) -> None:
    body = {"json": {}} if method in ("post", "put") else {}
    r = getattr(client, method)(f"/api/datasets/nope{path}", **body)
    assert r.status_code == 404 and r.json()["detail"] == "Dataset 'nope' not found", (path, r.text)


def test_data(client: TestClient, api: str) -> None:
    r = client.get(f"{api}/data", params={"columns": "y, s"})
    d = r.json()
    assert r.status_code == 200 and d["count"] == 600 and list(d["columns"]) == ["y", "s"]
    assert d["time"][:2] == ["2024-01-01T00:00:00", "2024-01-01T01:00:00"] and len(d["columns"]["y"]) == 600
    assert list(client.get(f"{api}/data").json()["columns"]) == ["u", "s", "y", "z"]
    assert client.get(f"{api}/data", params={"file": "df_sim_x", "columns": "u"}).status_code == 200


def test_data_unknown_column(client: TestClient, api: str) -> None:
    r = client.get(f"{api}/data", params={"columns": "y,nope"})
    assert r.status_code == 400 and r.json()["detail"] == "Unknown columns: ['nope']"


@pytest.mark.parametrize("file", ["nope", "../other/df_other", "/etc/passwd", "df_sim_x.parquet"])
def test_data_only_files_of_the_dataset(client: TestClient, data_dir: Path, api: str, file: str) -> None:
    write_dataset(data_dir / "other", make_frame(30))
    r = client.get(f"{api}/data", params={"file": file})
    assert r.status_code == 404 and r.json()["detail"] == f"File '{file}' not found"


def test_data_gaps_are_null(tmp_path: Path) -> None:
    from backend.app import create_app

    df = make_frame(30)
    df.loc[3, "y"] = np.nan
    df.loc[4, "y"] = np.inf
    write_dataset(tmp_path / "gappy", df)
    r = TestClient(create_app(tmp_path)).get("/api/datasets/gappy/data", params={"columns": "y"})
    assert r.status_code == 200 and r.json()["columns"]["y"][3:5] == [None, None]


def test_pid_image(client: TestClient, dataset_dir: Path, api: str) -> None:
    r = client.get(f"{api}/pid.png")
    assert r.status_code == 404 and r.json()["detail"] == "No P&ID image for this data center"
    (dataset_dir / "pid.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    r = client.get(f"{api}/pid.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content.startswith(b"\x89PNG")
    assert r.headers["cache-control"] == "no-cache"  # a new drawing keeps the name: the browser must ask again
    assert client.get(f"{api}/pid.png", headers={"If-None-Match": r.headers["etag"]}).status_code == 304


def test_refresh_and_health(client: TestClient, data_dir: Path) -> None:
    assert client.get("/health").json() == {"status": "ok", "datasets": 1}
    write_dataset(data_dir / "sim_y", make_frame(30))
    assert client.post("/api/datasets/refresh").json() == {"status": "ok", "datasets": 2}
    assert [d["id"] for d in client.get("/api/datasets").json()["datasets"]] == ["sim_x", "sim_y"]


def test_a_cut_off_dataset_json_is_named_and_the_others_still_listed(client: TestClient, dataset_dir: Path) -> None:
    # B-D4: the whole list answered 500, so the app listed nothing
    (dataset_dir / "dataset.json").write_text('{"name": "Synth')
    r = client.get("/api/datasets")
    assert r.status_code == 200 and r.json()["datasets"][0]["config"] == {}
    r = client.put("/api/datasets/sim_x/kpi", json={})
    assert r.status_code == 422 and "dataset.json" in r.json()["detail"]
    assert (dataset_dir / "dataset.json").read_text() == '{"name": "Synth'  # not overwritten


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/data?columns=u", None),
        ("POST", "/models/m/simulate", {"start": 5}),
        ("POST", "/models/evaluate", {"names": ["m"]}),
        ("POST", "/models/compare", {"column": "y", "models": ["m"], "start": 5, "steps": 24}),
    ],
)
def test_a_data_file_without_time_is_named_not_a_500(tmp_path: Path, method: str, path: str, body: dict | None) -> None:
    # B-C3: KeyError 'time' on the data, simulate, evaluate and compare
    write_dataset(tmp_path / "sim_x", make_frame(100))
    client = TestClient(create_app(tmp_path, None), raise_server_exceptions=False)
    api = "/api/datasets/sim_x"
    assert client.post(f"{api}/models/train", json={"name": "m", "model": "linear"}).status_code == 200
    make_frame(100).drop(columns="time").to_parquet(tmp_path / "sim_x" / "df_sim_x.parquet")  # then the time goes
    client.post("/api/datasets/refresh")
    r = client.request(method, f"{api}{path}", json=body)
    assert r.status_code == 422 and "time" in r.json()["detail"], r.text
