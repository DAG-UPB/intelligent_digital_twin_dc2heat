"""Every route: the OpenAPI reference is complete, and each answers good and bad input with the right status.

ROUTES lists every API route once; test_every_route_is_listed fails when a route is added
without a smoke case here.
"""

import json
from pathlib import Path

import pytest
from conftest import connect_agent
from fastapi.testclient import TestClient
from synthetic import DATASET

from backend.app import create_app
from backend.core import weather
from backend.routers import pid as pid_router

PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63f8ffff3f0005fe02fea7d6a4f30000000049454e44ae426082"
)
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L10 10" stroke="red"/></svg>'
LINK = {"source": "u", "target": "y"}
COMP = {"id": "c", "name": "c", "kind": "custom", "inputs": [{"name": "u"}], "nodes": [{"name": "y", "equation": "a*u[t]"}]}
COMP_OK = {**COMP, "params": [{"name": "a", "value": 1, "fixed": False}]}

FOUNDATION_NO_WEATHER = (
    "POST",
    "/api/datasets/{d}/foundation/demand",
    {"json": {"column": "y", "start_time": 0, "steps": 24, "mode": "rolling"}},
    400,
)
COMPARE = ("POST", "/api/datasets/{d}/models/compare", {"json": {"column": "y", "models": ["{m}"], "mode": "free"}}, 200)

# (method, path template, good request, expected status for it); {d} = the dataset, {m} = a trained model
ROUTES: list = [
    ("GET", "/health", {}, 200),
    ("GET", "/api/datasets", {}, 200),
    ("POST", "/api/datasets/refresh", {}, 200),
    ("GET", "/api/data-versions", {}, 200),
    ("GET", "/api/live/ui-state", {}, 200),
    ("POST", "/api/live/pair", {"json": {"code": "000000"}}, 403),
    # no page is listening in the test: 409 "ask the user to open it"
    ("POST", "/api/live/command", {"json": {"action": "message", "args": {"text": "hi"}}}, 409),
    ("GET", "/api/data-versions/browse", {"params": {"path": "/"}}, 200),
    # the OS folder dialog is off in tests: it would open on the screen
    ("POST", "/api/data-versions/pick", {}, 501),
    ("PUT", "/api/data-versions/current", {"json": {"version": "local"}}, 200),
    # the test app has no data-folder link
    ("PUT", "/api/data-versions/root", {"json": {"path": "/"}}, 400),
    ("GET", "/api/data-versions/scan", {"params": {"path": "/no/such/folder"}}, 400),
    # the test app is on the examples: nothing is imported into the repo's folder
    ("POST", "/api/data-versions/import", {"json": {"path": "/no/such", "id": "dc_x", "name": "x"}}, 400),
    ("GET", "/api/datasets/{d}/pid.png", {}, 200),
    ("GET", "/api/datasets/{d}/data", {"params": {"columns": "u,y"}}, 200),
    ("GET", "/api/datasets/{d}/summary", {}, 200),
    ("PUT", "/api/datasets/{d}/kpi", {"json": {}}, 200),
    ("POST", "/api/datasets/{d}/prepared/preview", {"json": {"name": "uy", "op": "mean", "inputs": ["u", "y"]}}, 200),
    ("POST", "/api/datasets/{d}/prepared", {"json": {"name": "uy", "op": "mean", "inputs": ["u", "y"]}}, 200),
    ("DELETE", "/api/datasets/{d}/prepared/{prepared}", {}, 200),
    ("POST", "/api/datasets/{d}/resampled", {"json": {"step": "1d"}}, 200),
    ("DELETE", "/api/datasets/{d}/resampled/{resampled}", {}, 200),
    ("POST", "/api/datasets/{d}/window", {"json": {"start": "2000-01-01", "end": "2100-01-01", "columns": ["u"]}}, 200),
    ("GET", "/api/datasets/{d}/graph/files", {}, 200),
    ("GET", "/api/datasets/{d}/graph", {}, 200),
    ("POST", "/api/datasets/{d}/graph/save", {"json": {"file_name": "causal_graph_x.json", "targets": {}}}, 200),
    ("GET", "/api/datasets/{d}/graph/drivers", {}, 200),
    # tigramite: slow
    pytest.param("POST", "/api/datasets/{d}/graph/discover-lags", {"json": {"links": [LINK]}}, 200, marks=pytest.mark.slow),
    ("GET", "/api/datasets/{d}/equations", {}, 200),
    ("PUT", "/api/datasets/{d}/equations", {"json": {"y": "a*y[t-1]"}}, 200),
    ("POST", "/api/datasets/{d}/equations/check", {"json": {"target": "y", "expr": "a*y[t-1]"}}, 200),
    ("GET", "/api/datasets/{d}/models", {}, 200),
    ("GET", "/api/datasets/{d}/models/evaluation", {}, 200),
    ("GET", "/api/datasets/{d}/models/{m}", {}, 200),
    ("POST", "/api/datasets/{d}/models/estimate", {"json": {"model": "xgboost"}}, 200),
    ("POST", "/api/datasets/{d}/models/train", {"json": {"name": "smoke"}}, 200),
    ("POST", "/api/datasets/{d}/models/evaluate", {"json": {"names": ["{m}"], "levers": ["s"]}}, 200),
    # the synthetic data has no outdoor temperature: answered before the model loads (routers/foundation.py)
    FOUNDATION_NO_WEATHER,
    COMPARE,
    ("POST", "/api/datasets/{d}/models/{m}/simulate", {"json": {"start": 400, "steps": 5}}, 200),
    ("GET", "/api/datasets/{d}/site", {}, 200),
    ("PUT", "/api/datasets/{d}/site", {"json": {}}, 200),
    ("GET", "/api/datasets/{d}/site/streets", {}, 404),  # the synthetic dataset has none (an example's own)
    ("GET", "/api/datasets/{d}/weather/open-meteo", {"params": {"start": "2023-01-01", "end": "2023-01-02"}}, 200),
    ("GET", "/api/datasets/{d}/project", {}, 200),
    ("POST", "/api/datasets/{d}/project/save", {}, 200),
    ("POST", "/api/datasets/{d}/project", {"json": {"format": "dc-twin-project", "dataset": "{d}", "files": {}}}, 200),
    ("POST", "/api/pid/extract", {"content": SVG}, 200),
    ("POST", "/api/pid/preview", {"content": SVG}, 200),
    ("POST", "/api/datasets/{d}/pid", {"content": PNG_1PX}, 200),
    ("GET", "/api/datasets/{d}/pid/plant", {}, 200),
    ("GET", "/api/datasets/{d}/pid/construct", {}, 200),
    ("PUT", "/api/datasets/{d}/pid/construct", {"json": {"shapes": [{"id": "a", "kind": "text", "x": 0.5, "y": 0.5}]}}, 200),
    ("DELETE", "/api/datasets/{d}/pid", {}, 200),
    ("POST", "/api/datasets/{d}/pid/views/{view}", {"content": PNG_1PX}, 200),
    ("GET", "/api/datasets/{d}/pid/views/{view}.png", {}, 200),
    ("GET", "/api/datasets/{d}/pid/views/{view}/construct", {}, 200),
    (
        "PUT",
        "/api/datasets/{d}/pid/views/{view}/construct",
        {"json": {"shapes": [{"id": "a", "kind": "text", "x": 0.5, "y": 0.5}]}},
        200,
    ),
    ("POST", "/api/datasets/{d}/pid/views/{view}/copy", {"params": {"source": "unit-0"}}, 200),
    ("PUT", "/api/datasets/{d}/names", {"json": {"names": {"u": "Valve 3"}}}, 200),
    ("GET", "/api/datasets/{d}/documents", {}, 200),
    ("POST", "/api/datasets/{d}/documents/{doc}", {"content": b"rack notes"}, 200),
    ("PUT", "/api/datasets/{d}/documents/{doc}/text", {"json": {"text": "rack notes"}}, 200),
    ("GET", "/api/datasets/{d}/documents/{doc}", {}, 200),
    ("PUT", "/api/datasets/{d}/documents/{doc}/info", {"json": {"note": "racks", "view": "rack-1"}}, 200),
    ("DELETE", "/api/datasets/{d}/documents/{doc}", {}, 200),
    ("DELETE", "/api/datasets/{d}/pid/views/{view}", {}, 200),
    # no Wärmeatlas import in the synthetic data dir: 404 "run scripts/import_waermeatlas.py" (200 in test_waermeatlas.py)
    ("GET", "/api/district/buildings", {"params": {"bbox": "50.11,8.668,50.116,8.676"}}, 404),
    ("GET", "/api/district/heat-lines", {"params": {"bbox": "50.11,8.668,50.116,8.676"}}, 404),
    ("GET", "/api/district/heat-sources", {"params": {"bbox": "50.0,8.5,50.2,8.9"}}, 404),
    ("GET", "/api/market/hourly", {"params": {"start": 1704067200, "end": 1704153600}}, 404),
    ("GET", "/api/district/examples", {}, 200),
    # {component_id} = smoke_c, saved by the smoke fixture
    ("GET", "/api/components", {}, 200),
    ("GET", "/api/components/{component_id}", {}, 200),
    ("PUT", "/api/components/{component_id}", {"json": COMP_OK}, 200),
    ("DELETE", "/api/components/{component_id}", {}, 200),
    ("POST", "/api/components/check", {"json": COMP}, 200),
    ("POST", "/api/components/simulate", {"json": {"component": COMP_OK, "steps": 3}}, 200),
    (
        "POST",
        "/api/components/fit",
        {"json": {"component": COMP_OK, "csv": "u,y\n1,2\n2,4", "mapping": {"u": "u", "y": "y"}}},
        200,
    ),
]


def _values(case: object) -> tuple:
    return case.values if hasattr(case, "values") else case  # pytest.param or plain tuple


# (method, path template, bad request, expected status, part of the detail)
BAD: list[tuple[str, str, dict, int, str]] = [
    ("POST", "/api/datasets/{d}/resampled", {"json": {"step": "1week"}}, 400, "Unknown time step"),
    ("DELETE", "/api/datasets/{d}/resampled/nope", {}, 404, "No aggregated"),
    ("POST", "/api/datasets/{d}/models/estimate", {"json": {"model": "magic"}}, 422, ""),
    ("POST", "/api/datasets/{d}/prepared", {"json": {"name": "u", "op": "mean", "inputs": ["u", "y"]}}, 400, "already exists"),
    (
        "POST",
        "/api/datasets/{d}/prepared/preview",
        {"json": {"name": "a", "op": "log", "inputs": ["nope"]}},
        400,
        "Not variables",
    ),
    ("DELETE", "/api/datasets/{d}/prepared/nope", {}, 404, "No prepared variable"),
    ("PUT", "/api/data-versions/current", {"json": {"version": "../x"}}, 404, "not found"),
    ("PUT", "/api/data-versions/current", {"json": {}}, 422, ""),
    ("POST", "/api/live/command", {"json": {"action": "dance"}}, 400, "Unknown action"),
    ("POST", "/api/live/pair", {"json": {"code": ""}}, 422, "at least 1"),
    ("POST", "/api/live/command", {"json": {"action": "navigate"}}, 400, "needs route"),
    ("POST", "/api/live/command", {"json": {"action": "map_focus", "args": {"lat": 50}}}, 400, "lat and lon"),
    ("POST", "/api/live/command", {"json": {"action": "place_instruments", "args": {"placements": []}}}, 400, "list of"),
    ("POST", "/api/live/command", {"json": {"action": "set_links", "args": {"links": "A->B"}}}, 400, "list of"),
    ("POST", "/api/live/command", {"json": {"action": "group_variables", "args": {"variables": "A"}}}, 400, "list of"),
    ("POST", "/api/live/command", {"json": {"action": "ungroup_variable", "args": {}}}, 400, "variable"),
    ("POST", "/api/live/command", {"json": {"action": "add_view", "args": {"name": "U"}}}, 400, "needs h, w, x, y"),
    ("POST", "/api/live/command", {"json": {"action": "edit_view", "args": {"name": "U"}}}, 400, "needs view"),
    ("POST", "/api/live/command", {"json": {"action": "annotate_variables", "args": {"annotations": []}}}, 400, "list of"),
    ("PUT", "/api/data-versions/root", {"json": {"path": ""}}, 422, ""),
    ("GET", "/api/data-versions/browse", {"params": {"path": "/no/such/folder"}}, 400, "Not a folder"),
    ("GET", "/api/datasets/{d}/data", {"params": {"columns": "nope"}}, 400, "Unknown columns"),
    ("GET", "/api/datasets/{d}/data", {"params": {"file": "../x"}}, 404, "not found"),
    ("GET", "/api/datasets/{d}/summary", {"params": {"file": "../x"}}, 404, "not found"),
    ("GET", "/api/datasets/{d}/graph", {"params": {"source": "../site.json"}}, 400, "Invalid file_name"),
    ("GET", "/api/datasets/{d}/graph", {"params": {"source": "missing.json"}}, 404, "not found"),
    ("POST", "/api/datasets/{d}/graph/save", {"json": {"file_name": "site.json", "targets": {}}}, 400, "not a graph file"),
    ("POST", "/api/datasets/{d}/graph/save", {"json": {"targets": "x"}}, 422, ""),
    ("GET", "/api/datasets/{d}/graph/drivers", {"params": {"source": "missing.json"}}, 404, "not found"),
    ("POST", "/api/datasets/{d}/graph/discover-lags", {"json": {"links": [LINK], "max_lag": 99}}, 422, ""),
    ("PUT", "/api/datasets/{d}/equations", {"json": {"nope": "1"}}, 400, "Not data columns"),
    ("POST", "/api/datasets/{d}/equations/check", {"json": {"target": "y"}}, 422, ""),
    ("GET", "/api/datasets/{d}/models/missing", {}, 404, "train it first"),
    ("GET", "/api/datasets/{d}/models/bad name", {}, 400, "model name"),
    ("POST", "/api/datasets/{d}/models/train", {"json": {"name": "../x"}}, 400, "model name"),
    ("POST", "/api/datasets/{d}/models/train", {"json": {"model": "magic"}}, 422, ""),
    ("POST", "/api/datasets/{d}/models/evaluate", {"json": {"names": []}}, 422, ""),
    ("POST", "/api/datasets/{d}/models/evaluate", {"json": {"names": ["missing"]}}, 404, "train it first"),
    ("POST", "/api/datasets/{d}/models/{m}/simulate", {"json": {"start": 400, "columns": ["nope"]}}, 400, "Not in the model"),
    ("POST", "/api/datasets/{d}/models/{m}/simulate", {"json": {"start": 400, "steps": 0}}, 422, ""),
    (  # an intervention before the run (B-W5)
        "POST",
        "/api/datasets/{d}/models/{m}/simulate",
        {"json": {"start": 400, "interventions": [{"variable": "s", "kind": "set", "value": 1, "start": -1}]}},
        422,
        "",
    ),
    ("POST", "/api/datasets/{d}/models/compare", {"json": {"column": "y", "models": ["{m}"], "start": -1}}, 422, ""),
    ("PUT", "/api/datasets/{d}/site", {"json": {"sinks": [{"id": "a"}]}}, 422, ""),
    ("GET", "/api/datasets/{d}/weather/open-meteo", {"params": {"start": "2023-01-02", "end": "2023-01-01"}}, 400, "before"),
    ("GET", "/api/datasets/{d}/weather/open-meteo", {"params": {"start": "x", "end": "2023-01-01"}}, 422, ""),
    (
        "POST",
        "/api/datasets/{d}/project",
        {"json": {"format": "other", "dataset": "{d}", "files": {}}},
        400,
        "Not a project file",
    ),
    ("POST", "/api/pid/extract", {"content": b"hello"}, 422, "Not a PDF, SVG or DEXPI"),
    ("POST", "/api/pid/preview", {"content": b"hello"}, 422, "Not a PDF, SVG or DEXPI"),
    ("POST", "/api/datasets/{d}/pid", {"content": b"hello"}, 422, "Not a PDF, SVG or DEXPI"),
    ("POST", "/api/datasets/{d}/pid/views/Bad%20Id", {"content": PNG_1PX}, 400, "view id"),
    ("POST", "/api/datasets/{d}/pid/views/unit-1", {"content": b"hello"}, 422, "Not a PDF, SVG or DEXPI"),
    ("GET", "/api/datasets/{d}/pid/views/none.png", {}, 404, "No picture"),
    ("PUT", "/api/datasets/{d}/names", {"json": {"names": {"nope": "x"}}}, 422, "Not variables"),
    ("POST", "/api/datasets/{d}/documents/documents.json", {"content": b"x"}, 400, "A document name"),
    ("GET", "/api/datasets/{d}/documents/none.txt", {}, 404, "No document"),
    ("PUT", "/api/datasets/{d}/documents/none.txt/info", {"json": {"note": "x"}}, 404, "No document"),
    ("DELETE", "/api/datasets/{d}/documents/none.txt", {}, 404, "No document"),
    ("PUT", "/api/datasets/{d}/documents/a.pdf/text", {"json": {"text": "x"}}, 400, "A text document"),
    ("POST", "/api/datasets/{d}/pid/views/unit-1/copy", {"params": {"source": "none"}}, 404, "no picture to copy"),
    ("POST", "/api/datasets/{d}/pid/views/unit-1/copy", {"params": {"source": "unit-1"}}, 400, "onto itself"),
    ("PUT", "/api/datasets/{d}/pid/views/none/construct", {"json": {"shapes": []}}, 404, "has no picture"),
    (
        "PUT",
        "/api/datasets/{d}/pid/views/unit-1/construct",
        {"json": {"shapes": [{"id": "a", "kind": "line", "points": []}]}},
        422,
        "2 to",
    ),
    ("PUT", "/api/datasets/{d}/pid/construct", {"json": {"shapes": [{"id": "a", "kind": "line", "points": []}]}}, 422, "2 to"),
    ("PUT", "/api/datasets/{d}/kpi", {"json": {"it_power": "nope"}}, 422, "Not variables"),
    ("POST", "/api/datasets/{d}/window", {"json": {"start": "2100-01-01", "end": "2100-01-02"}}, 400, "No rows"),
    ("POST", "/api/datasets/{d}/window", {"json": {"start": "garbage", "end": "2100-01-02"}}, 400, "Not a date"),
    ("POST", "/api/datasets/{d}/window", {"json": {"start": "", "end": "2100-01-02"}}, 400, "Not a date"),
    ("POST", "/api/datasets/{d}/window", {"json": {"start": "2024-01-01T00:00Z", "end": "2100-01-02"}}, 400, "time zone"),
    ("POST", "/api/datasets/{d}/window", {"json": {"start": "2100-01-02", "end": "2100-01-01"}}, 400, "before its end"),
    ("GET", "/api/district/buildings", {"params": {"bbox": "50,8.6,50.1,8.7"}}, 400, "Zoom in"),
    ("GET", "/api/district/buildings", {"params": {"bbox": "50,8.6"}}, 400, "four numbers"),
    ("GET", "/api/district/buildings", {}, 422, ""),
    ("GET", "/api/district/buildings", {"params": {"bbox": "1" * 101}}, 422, ""),
    ("GET", "/api/district/heat-lines", {"params": {"bbox": "50,8.6"}}, 400, "four numbers"),
    ("GET", "/api/district/heat-lines", {}, 422, ""),
    ("GET", "/api/district/heat-sources", {"params": {"bbox": "49,8,51,9"}}, 400, "Zoom in"),
    ("GET", "/api/district/heat-sources", {}, 422, ""),
    ("GET", "/api/market/hourly", {"params": {"start": 3600, "end": 0}}, 400, "after start"),
    ("GET", "/api/market/hourly", {"params": {"start": 0, "end": 10 * 8784 * 3600}}, 400, "hours at once"),
    ("GET", "/api/market/hourly", {"params": {"start": "x", "end": 0}}, 422, ""),
    ("GET", "/api/components/missing", {}, 404, "not found"),
    ("GET", "/api/components/bad name", {}, 422, ""),
    ("PUT", "/api/components/hp_2mw", {"json": COMP_OK}, 400, "is a preset"),
    ("PUT", "/api/components/x", {"json": COMP}, 400, "not a parameter: a"),
    ("PUT", "/api/components/x", {"json": {"name": "x"}}, 422, ""),
    ("DELETE", "/api/components/hp_2mw", {}, 400, "is a preset"),
    ("DELETE", "/api/components/missing", {}, 404, "not found"),
    ("POST", "/api/components/simulate", {"json": {"component": COMP, "steps": 3}}, 400, "not a parameter"),
    ("POST", "/api/components/simulate", {"json": {"component": COMP_OK, "steps": 0}}, 422, ""),
    (
        "POST",
        "/api/components/fit",
        {"json": {"component": COMP_OK, "csv": "u,y\n1,2", "mapping": {"y": "z"}}},
        400,
        "Not columns",
    ),
    ("POST", "/api/components/check", {"json": {"name": "x"}}, 422, ""),
    (
        "POST",
        "/api/components/fit",
        {"json": {"component": COMP_OK, "csv": "", "mapping": {"y": "y"}}},
        400,
        "Not a readable CSV",
    ),
    (
        "POST",
        "/api/components/fit",
        {"json": {"component": COMP_OK, "csv": "u,y\nx,z", "mapping": {"y": "y"}}},
        400,
        "with numbers",
    ),
    (
        "POST",
        "/api/components/fit",
        {"json": {"component": COMP_OK, "csv": "u,y\n1,2", "mapping": {"u": "u"}}},
        400,
        "map at least one node",
    ),
]


@pytest.fixture
def smoke(client: TestClient, dataset_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """The synthetic app with a trained linear model, a P&ID image, a site location; no external renderer or weather service."""
    assert client.post(f"/api/datasets/{dataset_dir.name}/models/train", json={"name": "linear"}).status_code == 200
    (dataset_dir / "pid.png").write_bytes(PNG_1PX)
    (dataset_dir / "pid_views").mkdir()
    (dataset_dir / "pid_views" / "unit-1.png").write_bytes(PNG_1PX)
    (dataset_dir / "pid_views" / "unit-0.png").write_bytes(PNG_1PX)
    client.post(f"/api/datasets/{dataset_dir.name}/documents/notes.txt", content=b"rack notes")
    monkeypatch.setattr(pid_router, "_render_png", lambda data, suffix, dpi=150: PNG_1PX)
    site = {"source": {"id": "dc", "name": "DC", "lat": 50, "lon": 8, "temp_c": 30, "power_kw": 1}}
    (dataset_dir / "site.json").write_text(json.dumps(site))
    smoke_p = {"name": "smoke_p", "op": "scale", "inputs": ["u"], "params": {"factor": 2}}
    assert client.post(f"/api/datasets/{dataset_dir.name}/prepared", json=smoke_p).status_code == 200
    smoke_r = {"step": "1d", "name": "smoke_r"}
    assert client.post(f"/api/datasets/{dataset_dir.name}/resampled", json=smoke_r).status_code == 200
    (dataset_dir.parent / "_components").mkdir()
    (dataset_dir.parent / "_components" / "smoke_c.json").write_text(json.dumps({**COMP_OK, "id": "smoke_c"}))
    monkeypatch.setattr(weather, "_get_json", lambda url, params: {"hourly": {"time": [1672531200], "temperature_2m": [1.0]}})
    connect_agent(client)  # the page tools (ui_state, ui_do, ui_snapshot) need a connected agent
    return client


def _fill(value: object, dataset: str) -> object:
    """Put the dataset and model names into a request template."""
    if isinstance(value, str):
        return (
            value.replace("{d}", dataset)
            .replace("{m}", "linear")
            .replace("{component_id}", "smoke_c")
            .replace("{prepared}", "smoke_p")
            .replace("{resampled}", "smoke_r")
            .replace("{view}", "unit-1")
            .replace("{doc}", "notes.txt")
        )
    if isinstance(value, dict):
        return {k: _fill(v, dataset) for k, v in value.items()}
    if isinstance(value, list):
        return [_fill(v, dataset) for v in value]
    return value


def _call(client: TestClient, method: str, path: str, request: dict, dataset: str):
    return client.request(method, _fill(path, dataset), **_fill(request, dataset))


def test_every_route_is_listed(client: TestClient) -> None:
    paths = client.get("/api/openapi.json").json()["paths"]
    routes = {
        (
            m.upper(),
            p.replace("{dataset_id}", "{d}")
            .replace("/documents/{name}", "/documents/{doc}")
            .replace("{name}", "{m}")
            .replace("{view_id}", "{view}"),
        )
        for p, ops in paths.items()
        for m in ops
    }
    assert routes == {_values(c)[:2] for c in ROUTES}


def test_openapi_reference_is_complete(client: TestClient) -> None:
    """Every operation has a summary, a description and a tag, so /api/docs is a usable reference."""
    spec = client.get("/api/openapi.json").json()
    for path, operations in spec["paths"].items():
        for method, op in operations.items():
            assert op.get("summary") and op.get("description") and op.get("tags"), f"{method.upper()} {path}"
    # request fields the frontend sends are described
    schemas = spec["components"]["schemas"]
    for name in (
        "TrainRequest",
        "SimulateRequest",
        "EvaluateRequest",
        "LagDiscoveryRequest",
        "Site",
        "HeatPoint",
        "Component",
        "ComponentSimulateRequest",
        "ComponentFitRequest",
    ):
        undocumented = [f for f, s in schemas[name]["properties"].items() if not s.get("description") and "$ref" not in s]
        assert not undocumented, (name, undocumented)


@pytest.mark.parametrize(("method", "path", "request_", "status"), ROUTES, ids=[" ".join(_values(c)[:2]) for c in ROUTES])
def test_good_input(smoke: TestClient, method: str, path: str, request_: dict, status: int) -> None:
    r = _call(smoke, method, path, request_, DATASET)
    assert r.status_code == status, r.text


@pytest.mark.parametrize(("method", "path", "request_", "status", "detail"), BAD, ids=[f"{m} {p} {s}" for m, p, _, s, _ in BAD])
def test_bad_input(smoke: TestClient, method: str, path: str, request_: dict, status: int, detail: str) -> None:
    r = _call(smoke, method, path, request_, DATASET)
    assert r.status_code == status, r.text
    assert detail in str(r.json()["detail"])


DATASET_ROUTES = [_values(c)[:3] for c in ROUTES if "{d}" in _values(c)[1]]


@pytest.mark.parametrize(("method", "path", "request_"), DATASET_ROUTES, ids=[f"{m} {p}" for m, p, _ in DATASET_ROUTES])
def test_unknown_dataset(smoke: TestClient, method: str, path: str, request_: dict) -> None:
    r = _call(smoke, method, path, request_, "nope")
    assert r.status_code == 404 and r.json()["detail"] == "Dataset 'nope' not found"


def test_create_app_on_an_empty_data_dir(tmp_path: Path) -> None:
    client = TestClient(create_app(tmp_path / "missing"))
    assert client.get("/api/datasets").json() == {"datasets": []}
