"""Machine-local map examples: read from `_local/map_examples.json`, invalid entries skipped, [] without the file."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core.limits import MAP_EXAMPLES_MAX_BYTES
from backend.core.map_examples import EXAMPLES_FILE, map_examples

GOOD = {
    "name": "Plant A",
    "address": "Somewhere 1",
    "lat": 50.11,
    "lon": 8.67,
    "heatKw": 600,
    "basis": "a public figure",
    "source": "https://example.org/a",
    "buildings": [[[50.11, 8.67], [50.111, 8.67], [50.111, 8.671], [50.11, 8.67]]],
    "labelLeft": True,
    "appDataset": True,  # not passed on: local examples are never the app's datasets
}


def _write(data_dir: Path, content: object) -> None:
    path = data_dir / EXAMPLES_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content if isinstance(content, str) else json.dumps(content))


def test_missing_or_broken_file_gives_no_examples(tmp_path: Path) -> None:
    assert map_examples(tmp_path / EXAMPLES_FILE) == []
    _write(tmp_path, "{not json")
    assert map_examples(tmp_path / EXAMPLES_FILE) == []
    _write(tmp_path, {"name": "not a list"})
    assert map_examples(tmp_path / EXAMPLES_FILE) == []
    _write(tmp_path, " " * (MAP_EXAMPLES_MAX_BYTES + 1))
    assert map_examples(tmp_path / EXAMPLES_FILE) == []


def test_valid_entries_are_kept_and_invalid_ones_skipped(tmp_path: Path) -> None:
    bad_source = {**GOOD, "name": "Plant B", "source": "javascript:alert(1)", "buildings": [[["x", 1]]]}
    _write(tmp_path, [GOOD, bad_source, {**GOOD, "lat": "50"}, {**GOOD, "heatKw": True}, {"name": "no position"}, 3])
    got = map_examples(tmp_path / EXAMPLES_FILE)
    assert [d["name"] for d in got] == ["Plant A", "Plant B"]
    assert got[0] == {k: v for k, v in GOOD.items() if k != "appDataset"}
    assert got[1]["source"] == "" and "buildings" not in got[1]


def test_route_answers_the_local_examples(tmp_path: Path) -> None:
    client = TestClient(create_app(tmp_path, None))
    assert client.get("/api/district/examples").json() == []
    _write(tmp_path, [GOOD])
    assert [d["name"] for d in client.get("/api/district/examples").json()] == ["Plant A"]
