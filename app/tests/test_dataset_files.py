"""Dataset folder layout: graph names and files, graph read/write, legacy migration, model names."""

import json
import re
from pathlib import Path

import pytest

from backend.core import dataset_files as files


@pytest.mark.parametrize(
    "name",
    [
        "",
        "  ",
        "a/b.json",
        "a\\b.json",
        "..x.json",
        "x.txt",
        "x.canvas.json",
        "site.json",
        "dataset.json",
        "equations.json",
        "pid_plant.json",
        "DATASET.json",  # B-D1: one file with dataset.json on a disk that ignores case (macOS, Windows)
        "Site.JSON",
        "Equations.json",
    ],
)
def test_invalid_graph_names(name: str) -> None:
    with pytest.raises(ValueError):
        files.graph_name(name)


def test_valid_graph_name() -> None:
    assert files.graph_name(" g.json ") == "g.json"


def test_graph_files_skip_other_json(tmp_path: Path) -> None:
    for name in ["causal_graph.json", "b.json", "graph_manual.json", "x.canvas.json", *files.NOT_GRAPHS]:
        (tmp_path / name).write_text("{}")
    assert files.graph_files(tmp_path) == ["b.json", "causal_graph.json"]


def test_graph_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "g.json"
    strength = {"source": "u", "target": "y", "lag": -1, "value": 0.5}
    assert files.write_graph(path, {"y": [("u", -1), ("y", -1)]}, [strength]) == 2
    raw = json.loads(path.read_text())
    assert raw == {"targets": {"y": [["u", -1], ["y", -1]]}, "link_strengths": [strength]}
    assert files.read_graph(path) == ({"y": [("u", -1), ("y", -1)]}, [strength])


def test_parse_both_shapes_and_strip_names() -> None:
    # the paper's shape, with padded names
    assert files.parse_graph({"temp_in_U4 ": [["fan_U4", -1], ["line_F_G_watt ", -2]]}) == (
        {"temp_in_U4": [("fan_U4", -1), ("line_F_G_watt", -2)]},
        [],
    )
    assert files.parse_graph({"targets": {"a": [["b", -1]]}}) == ({"a": [("b", -1)]}, [])
    # a broken strength entry is skipped, not fatal
    assert files.parse_graph({"targets": {}, "link_strengths": [{"source": "a"}, 3]}) == ({}, [])


@pytest.mark.parametrize(
    "raw", ['{"components": [{"id": "P1", "label": "P1", "x": 0.1, "y": 0.2}], "links": [], "pipes": []}', "[1, 2]", "not json"]
)
def test_not_a_graph(tmp_path: Path, raw: str) -> None:
    path = tmp_path / "pid_plant.json"
    path.write_text(raw)
    with pytest.raises(ValueError, match="Invalid graph JSON format in 'pid_plant.json'"):
        files.read_graph(path)


def test_migrate_legacy_graph(tmp_path: Path) -> None:
    (tmp_path / "graph_manual.json").write_text('{"a": [["b", -1]]}')
    files.migrate_legacy_graph(tmp_path)
    assert not (tmp_path / "graph_manual.json").exists() and (tmp_path / "causal_graph.json").exists()
    # an existing causal_graph.json wins: nothing is overwritten
    (tmp_path / "graph_manual.json").write_text("{}")
    files.migrate_legacy_graph(tmp_path)
    assert (tmp_path / "graph_manual.json").exists() and json.loads((tmp_path / "causal_graph.json").read_text())


def test_model_file(tmp_path: Path) -> None:
    assert files.model_file(tmp_path / "models", "xgb_all-2") == tmp_path / "models" / "xgb_all-2.json"
    for bad in ["", "a b", "../x", "a.json", "x" * 65]:
        with pytest.raises(ValueError, match="letters, digits"):
            files.model_file(tmp_path, bad)
    for stored in ["evaluation", "Evaluation"]:  # the stored evaluation, also in another case (B-D1)
        with pytest.raises(ValueError, match="stored evaluation"):
            files.model_file(tmp_path, stored)


def test_read_json(tmp_path: Path) -> None:
    assert files.read_json(tmp_path / "missing.json") == {}


def test_a_write_is_whole_or_not_at_all(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # B-D4: a write cut off (a crash, a full disk) left a half file that broke the dataset list
    path = tmp_path / "dataset.json"
    files.write_atomic(path, '{"name": "old"}')
    monkeypatch.setattr(files.os, "replace", lambda *a: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(OSError):
        files.write_atomic(path, '{"name": "new"}')
    assert files.read_json(path) == {"name": "old"} and [p.name for p in tmp_path.iterdir()] == ["dataset.json"]
    monkeypatch.undo()
    files.write_atomic(path, b"\x00\x01")
    assert path.read_bytes() == b"\x00\x01"


@pytest.mark.parametrize("text", ['{"name": "cut', "[]", "\xff"])
def test_a_broken_json_file_is_named_not_a_500(tmp_path: Path, text: str) -> None:
    path = tmp_path / "dataset.json"
    path.write_text(text, encoding="latin-1")
    with pytest.raises(files.BrokenFile, match="dataset.json"):
        files.read_json(path)


def test_every_write_in_the_backend_is_atomic() -> None:
    # one helper for every file the app writes in a data folder (csv_data's self-check writes its own test file)
    root = Path(__file__).parents[1] / "backend"
    plain = re.compile(r"\.(write_text|write_bytes)\(|\.to_parquet\((?!index=False\))")  # to bytes is fine
    found = [
        f"{p.relative_to(root)}:{n}"
        for p in root.rglob("*.py")
        for n, line in enumerate(p.read_text().splitlines(), 1)
        if plain.search(line) and p.name not in ("dataset_files.py", "csv_data.py")
    ]
    assert found == []
