"""Names shown for variables: set one or many, give the own name back; the data keeps its own names."""

import json
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient


def _config(client: TestClient, dataset: str) -> dict:
    return next(d for d in client.get("/api/datasets").json()["datasets"] if d["id"] == dataset)["config"]


def test_names_are_shown_in_place_of_the_own_and_the_data_keeps_its_own(client: TestClient, dataset_dir: Path, api: str):
    before = pd.read_parquet(next(dataset_dir.glob("*.parquet")))
    r = client.put(f"{api}/names", json={"names": {"u": "Valve 3 position", "y": "Rack 1 return T"}})
    assert r.status_code == 200 and r.json()["names"] == {"u": "Valve 3 position", "y": "Rack 1 return T"}
    assert _config(client, dataset_dir.name)["names"] == {"u": "Valve 3 position", "y": "Rack 1 return T"}
    # many at once: added to the others; "" (or the own name) gives a variable its own name back
    r = client.put(f"{api}/names", json={"names": {"s": " Supply T ", "y": "", "z": "z"}})
    assert r.json()["names"] == {"s": "Supply T", "u": "Valve 3 position"}
    assert list(pd.read_parquet(next(dataset_dir.glob("*.parquet"))).columns) == list(before.columns)  # untouched
    assert set(client.get(f"{api}/data", params={"columns": "u"}).json()["columns"]) == {"u"}  # read by its own name
    client.put(f"{api}/names", json={"names": {"s": "", "u": ""}})
    assert "names" not in json.loads((dataset_dir / "dataset.json").read_text())


@pytest.mark.parametrize(
    ("names", "detail"),
    [
        ({"nope": "x"}, "Not variables of this data center: nope"),
        ({"u": "Same", "y": "Same"}, "would be shown for several variables"),
        ({"u": "y"}, "Already the own name of another variable: y"),
        ({"u": "x" * 81}, "at most 80 characters"),
    ],
)
def test_a_name_that_would_confuse_is_refused(client: TestClient, api: str, names: dict, detail: str):
    r = client.put(f"{api}/names", json={"names": names})
    assert r.status_code == 422 and detail in r.json()["detail"]
