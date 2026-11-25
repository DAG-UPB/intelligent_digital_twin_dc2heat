"""Data folders: the version folders of the user's data root (default: the newest) and the examples (app/data)."""

import json
from pathlib import Path

import pandas as pd
from fastapi.testclient import TestClient
from synthetic import DATASET, write_dataset

from backend.app import create_app
from backend.core import data_versions as dv


def _layout(tmp_path: Path, frame: pd.DataFrame) -> tuple[Path, Path, Path]:
    """app/data with sim_x; a data root linked like app/data_versions, holding version_2 (sim_x and a named real
    plant_y) and version_10 (empty), plus _local; the remembered-choice file (not written yet)."""
    local, target = tmp_path / "data", tmp_path / "shared" / "data_app_idz"
    write_dataset(local / DATASET, frame)
    write_dataset(target / "version_2" / DATASET, frame)
    write_dataset(target / "version_2" / "plant_y", frame)
    (target / "version_2" / "plant_y" / "dataset.json").write_text(json.dumps({"name": "Plant Y", "kind": "real"}))
    (target / "version_10").mkdir()
    (target / "version_10" / "project.json").write_text(json.dumps({"name": "Project A"}))
    (target / "_local").mkdir()
    link = tmp_path / "app" / "data_versions"
    link.parent.mkdir()
    link.symlink_to(target)
    return local, link, tmp_path / ".data_version"


def _ids(client: TestClient) -> list[str]:
    return [d["id"] for d in client.get("/api/datasets").json()["datasets"]]


def test_versions_natural_order_without_hidden_folders(tmp_path: Path, frame: pd.DataFrame) -> None:
    _, root, _ = _layout(tmp_path, frame)
    assert dv.versions(root) == ["version_2", "version_10"]
    assert dv.default_version(root) == "version_10"
    assert dv.versions(tmp_path / "not_linked") == [] and dv.default_version(None) == dv.LOCAL


def test_default_is_the_users_folder_and_every_folder_is_listed(tmp_path: Path, frame: pd.DataFrame) -> None:
    local, root, choice = _layout(tmp_path, frame)
    client = TestClient(create_app(local, versions_dir=root, version_file=choice))
    state = client.get("/api/data-versions").json()
    assert state["current"] == "version_10" and state["linked"] and state["root"].endswith("data_app_idz")
    assert state["names"] == {"version_10": "Project A"}  # project.json's name; version_2 has none
    # a project's own copy of an example comes first; a project without one gets the example, marked
    assert state["folders"]["version_2"] == [
        {"id": "plant_y", "name": "Plant Y", "kind": "real", "example": False},
        {"id": DATASET, "name": "Synthetic X", "kind": "simulation", "example": False},
    ]
    assert state["folders"]["version_10"] == [{"id": DATASET, "name": "Synthetic X", "kind": "simulation", "example": True}]
    assert [d["id"] for d in state["folders"]["local"]] == [DATASET]
    assert _ids(client) == [DATASET]  # version_10 is empty: the example is there to open, from app/data
    assert client.get(f"/api/datasets/{DATASET}/graph").status_code == 200


def test_switch_reads_that_folder_and_is_remembered(tmp_path: Path, frame: pd.DataFrame) -> None:
    local, root, choice = _layout(tmp_path, frame)
    client = TestClient(create_app(local, versions_dir=root, version_file=choice))
    assert client.put("/api/data-versions/current", json={"version": "version_2"}).json()["current"] == "version_2"
    assert _ids(client) == ["plant_y", DATASET]
    client.put("/api/data-versions/current", json={"version": "local"})
    assert _ids(client) == [DATASET]

    restarted = TestClient(create_app(local, versions_dir=root, version_file=choice))
    assert restarted.get("/api/data-versions").json()["current"] == "local"


def test_unknown_version_refused_and_missing_link_falls_back_to_examples(tmp_path: Path, frame: pd.DataFrame) -> None:
    local, root, choice = _layout(tmp_path, frame)
    client = TestClient(create_app(local, versions_dir=root, version_file=choice))
    for bad in ("../data", "_local", "version_3"):
        assert client.put("/api/data-versions/current", json={"version": bad}).status_code == 404

    choice.write_text("version_2")  # remembered, but the folder is not linked on this machine
    client = TestClient(create_app(local, versions_dir=tmp_path / "not_linked", version_file=choice))
    state = client.get("/api/data-versions").json()
    assert (state["current"], state["linked"], state["root"]) == ("local", False, None)
    assert _ids(client) == [DATASET]


def test_change_data_root_relinks_and_opens_the_newest_version(tmp_path: Path, frame: pd.DataFrame) -> None:
    local, root, choice = _layout(tmp_path, frame)
    other = tmp_path / "colleague" / "data"
    write_dataset(other / "version_1" / "sim_z", frame)
    client = TestClient(create_app(local, versions_dir=root, version_file=choice))

    state = client.put("/api/data-versions/root", json={"path": str(other)}).json()
    assert root.is_symlink() and root.resolve() == other.resolve()
    assert (state["current"], state["versions"]) == ("version_1", ["version_1"])
    assert _ids(client) == ["sim_z", DATASET]  # and the examples

    assert client.put("/api/data-versions/root", json={"path": str(tmp_path / "nope")}).status_code == 400
    assert client.put("/api/data-versions/root", json={"path": "relative/path"}).status_code == 400
    assert root.resolve() == other.resolve()  # a refused path leaves the link as it was


def test_browse_lists_folders_only(tmp_path: Path, frame: pd.DataFrame) -> None:
    local, root, choice = _layout(tmp_path, frame)
    (tmp_path / "shared" / "notes.txt").write_text("not listed")
    (tmp_path / "shared" / ".hidden").mkdir()
    client = TestClient(create_app(local, versions_dir=root, version_file=choice))

    start = client.get("/api/data-versions/browse").json()  # the current data folder
    assert start["path"].endswith("data_app_idz") and start["versions"] == ["version_2", "version_10"]
    up = client.get("/api/data-versions/browse", params={"path": start["parent"]}).json()
    assert up["folders"] == ["data_app_idz"] and up["versions"] == []
    assert client.get("/api/data-versions/browse", params={"path": str(tmp_path / "nope")}).status_code == 400


def test_native_picker_command_per_os_and_cancel(monkeypatch) -> None:
    import subprocess

    assert dv.native_picker_command("darwin")[0] == "osascript"
    assert dv.native_picker_command("win32")[0] == "powershell"

    def run(stdout: str, code: int):
        return lambda *a, **k: subprocess.CompletedProcess(a, code, stdout=stdout, stderr="")

    monkeypatch.setattr(dv, "native_picker_command", lambda: ["sh"])  # any command that exists
    monkeypatch.setattr(subprocess, "run", run("/home/me/data/\n", 0))
    assert dv.pick_folder_natively() == "/home/me/data/"
    monkeypatch.setattr(subprocess, "run", run("", 1))  # macOS: "User canceled", exit 1
    assert dv.pick_folder_natively() is None
    monkeypatch.setattr(dv, "native_picker_command", lambda: None)
    try:
        dv.pick_folder_natively()
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "No folder dialog" in str(exc)
