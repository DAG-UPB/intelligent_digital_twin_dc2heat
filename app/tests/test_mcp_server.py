"""The MCP server: tools from the OpenAPI schema, calls through the app, the P&ID tools, and the stdio protocol."""

import base64
import io
import json
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import connect_agent, page_secret
from fastapi.testclient import TestClient
from PIL import Image
from synthetic import DATASET

from backend import mcp_server
from backend.mcp_server import Server


@pytest.fixture(scope="module")
def server() -> Server:
    return Server()


@pytest.fixture
def app_fetch(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Tool calls go to a TestClient over the synthetic data folder instead of the running app."""

    def fetch(method, path, body=None, content_type=None):
        r = client.request(method, path, content=body, headers={"Content-Type": content_type} if content_type else {})
        if r.status_code >= 400:
            raise mcp_server.ToolError(f"HTTP {r.status_code}: {r.json().get('detail')}")
        return r.headers["content-type"].split(";")[0], r.content

    monkeypatch.setattr(mcp_server, "fetch", fetch)
    return client


@pytest.fixture
def drawing(dataset_dir: Path) -> Path:
    """A synthetic P&ID: a white 400 x 200 image and two components."""
    Image.new("RGB", (400, 200), "white").save(dataset_dir / "pid.png")
    plant = {
        "components": [{"id": "P1", "label": "pump", "x": 0.25, "y": 0.5}, {"id": "HX1", "label": "hex", "x": 0.75, "y": 0.5}]
    }
    (dataset_dir / "pid_plant.json").write_text(json.dumps({**plant, "links": [], "pipes": []}))
    return dataset_dir


def text(result: dict) -> str:
    return next(c["text"] for c in result["content"] if c["type"] == "text")


def test_every_route_is_a_tool_with_a_short_name(server: Server):
    names = {t["name"] for t in server.tools()}
    assert {"list_datasets", "get_equations", "save_equations", "check_equation", "list_components", "fit_component"} <= names
    assert {"pid_view", "pid_place", "read_docs"} <= names
    assert not [n for n in names if "_api_" in n]


def test_the_instructions_name_only_tools_that_exist(server: Server):
    """The instructions tell the model which tools to call: a renamed route must not leave a dead name there."""
    from backend.mcp_server import INSTRUCTIONS

    names = {t["name"] for t in server.tools()}
    for tool in (
        "list_datasets",
        "list_data_versions",
        "switch_data_version",
        "ui_snapshot",
        "ui_do",
        "ui_state",
        "pid_view",
        "pid_place",
        "connect_app",
        "wiki_search",
        "wiki_read",
        "read_docs",
        "get_summary",
        "simulate",
    ):
        assert tool in INSTRUCTIONS and tool in names, tool


def test_reads_and_writes_are_marked(server: Server):
    tools = {t["name"]: t for t in server.tools()}
    assert tools["get_equations"]["annotations"]["readOnlyHint"]
    assert tools["check_equation"]["annotations"]["readOnlyHint"]  # a POST that only computes
    assert not tools["save_equations"]["annotations"]["readOnlyHint"]
    assert tools["save_equations"]["description"].startswith("[writes]")


def test_evaluate_is_a_read_and_never_stores(server: Server, app_fetch, dataset_dir: Path):
    """The page stores its evaluation (models/evaluation.json); the MCP tool, marked read-only, is not offered store and
    drops it when sent anyway."""
    tool = next(t for t in server.tools() if t["name"] == "evaluate")
    assert tool["annotations"]["readOnlyHint"] and "store" not in tool["inputSchema"]["properties"]["body"]["properties"]
    assert app_fetch.post(f"/api/datasets/{DATASET}/models/train", json={}).status_code == 200
    body = {"names": ["linear"], "levers": ["s"], "horizon": 24, "store": True}
    assert json.loads(text(server.call("evaluate", {"dataset_id": DATASET, "body": body})))["models"]["linear"]
    assert not (dataset_dir / "models/evaluation.json").exists()
    assert app_fetch.get(f"/api/datasets/{DATASET}/models/evaluation").json() is None


def test_body_schemas_carry_their_definitions(server: Server):
    schema = next(t for t in server.tools() if t["name"] == "save_component")["inputSchema"]
    assert "#/components/schemas" not in json.dumps(schema)
    refs = {r.rsplit("/", 1)[-1] for r in json.dumps(schema).split('"$ref": "')[1:] for r in [r.split('"')[0]]}
    assert refs <= set(schema["$defs"])


def test_bodies_are_objects_at_the_top(server: Server):
    for tool in server.tools():
        body = tool["inputSchema"]["properties"].get("body")
        if body is not None:
            assert body.get("type") == "object" and "$ref" not in body, tool["name"]


def test_a_body_sent_as_json_text_is_read(server: Server, app_fetch):
    body = json.dumps({"target": "y", "expr": "a*u[t-1] + b"})
    assert json.loads(text(server.call("check_equation", {"dataset_id": DATASET, "body": body})))["ok"]
    assert server.call("check_equation", {"dataset_id": DATASET, "body": "{not json"})["isError"]


def test_calls_go_through_the_app(server: Server, app_fetch):
    assert DATASET in text(server.call("list_datasets", {}))
    ok = json.loads(text(server.call("check_equation", {"dataset_id": DATASET, "body": {"target": "y", "expr": "a*u[t-1] + b"}})))
    assert ok["ok"]
    bad = server.call("get_graph", {"dataset_id": "nope"})
    assert bad["isError"] and "404" in text(bad)


def test_the_app_not_running_says_how_to_start_it(server: Server, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(mcp_server, "BASE_URL", "http://127.0.0.1:9")
    result = server.call("list_datasets", {})
    assert result["isError"] and "start.sh" in text(result)


def test_long_answers_are_cut(server: Server, app_fetch, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(mcp_server, "MCP_TEXT_MAX_CHARS", 1000)
    assert "cut at" in text(server.call("get_data", {"dataset_id": DATASET}))


def test_pid_place_then_view(server: Server, app_fetch, drawing: Path):
    placed = server.call(
        "pid_place",
        {
            "dataset_id": DATASET,
            "placements": [
                {"variable": "y", "x": 0.1, "y": 0.2, "tag": "TT"},
                {"variable": "u", "component": "HX1", "tag": "FT"},
            ],
        },
    )
    assert not placed["isError"], text(placed)
    layout = json.loads((drawing / "site.json").read_text())["pid_layout"]
    assert layout["paper:y"] == {"x": 0.1, "y": 0.2, "tag": "TT"}
    assert layout["paper:u"]["x"] == 0.75 and layout["plant:u"]["tag"] == "HX1"

    view = server.call("pid_view", {"dataset_id": DATASET})
    image = next(c for c in view["content"] if c["type"] == "image")
    assert Image.open(io.BytesIO(base64.b64decode(image["data"]))).width >= 400
    state = json.loads(text(view))
    assert state["placed"]["y"] == [0.1, 0.2, "TT"] and state["variable_component"] == {"u": "HX1"}
    assert "y" not in state["not_placed"] and "s" in state["not_placed"]

    zoom = server.call("pid_view", {"dataset_id": DATASET, "region": [0.5, 0.25, 0.75, 0.75]})
    assert not zoom["isError"]


def test_pid_place_is_all_or_nothing(server: Server, app_fetch, drawing: Path):
    result = server.call(
        "pid_place",
        {"dataset_id": DATASET, "placements": [{"variable": "y", "x": 0.1, "y": 0.2}, {"variable": "nope", "x": 0, "y": 0}]},
    )
    assert result["isError"] and not (drawing / "site.json").exists()
    out_of_range = server.call("pid_place", {"dataset_id": DATASET, "placements": [{"variable": "y", "x": 2, "y": 0.2}]})
    assert out_of_range["isError"]


def test_pid_view_of_a_view_shows_its_picture_and_its_variables_in_its_coordinates(server: Server, app_fetch, drawing: Path):
    site = {
        "pid_layout": {"paper:y": {"x": 0.6, "y": 0.6, "tag": "TT"}, "paper:u": {"x": 0.1, "y": 0.1, "tag": "FT"}},
        "pid_views": [{"id": "unit", "name": "Unit", "x": 0.5, "y": 0.5, "w": 0.4, "h": 0.4}],
    }
    (drawing / "site.json").write_text(json.dumps(site))
    (drawing / "pid_views").mkdir()
    Image.new("RGB", (300, 150), "white").save(drawing / "pid_views" / "unit.png")
    shapes = [
        {"id": "inst:0", "kind": "circle", "x": 0.2, "y": 0.3, "w": 0.02, "h": 0.04, "label": "TT1", "role": "instrument"},
        {"id": "text:0", "kind": "text", "x": 0.5, "y": 0.5, "label": "note", "role": "drawing"},
    ]
    (drawing / "pid_views" / "unit.construct.json").write_text(json.dumps({"shapes": shapes}))
    whole = json.loads(text(server.call("pid_view", {"dataset_id": DATASET})))
    assert [v["id"] for v in whole["views"]] == ["unit"]
    seen = server.call("pid_view", {"dataset_id": DATASET, "view": "unit"})
    assert not seen["isError"], text(seen)
    state = json.loads(text(seen))
    assert state["placed"] == {"y": [0.25, 0.25, "TT"]} and state["view"]["name"] == "Unit"
    assert state["components"] == [{"id": "TT1", "shape": "inst:0", "label": "TT1", "x": 0.2, "y": 0.3}]
    assert 'view: "unit"' in state["coordinates"]
    assert server.call("pid_view", {"dataset_id": DATASET, "view": "nope"})["isError"]


def test_pid_place_on_the_heat_distributions_structure(server: Server, app_fetch, client: TestClient):
    """scope "heat": its own site.json, and a variable of its saved graph without data (Q_hex) can be placed."""
    graph = {"file_name": "causal_graph.json", "targets": {"Q_hex": [{"parent": "y", "lag": -1}]}, "link_strengths": []}
    assert client.post(f"/api/datasets/{DATASET}/graph/save?scope=heat", json=graph).status_code == 200
    placed = server.call(
        "pid_place", {"dataset_id": DATASET, "scope": "heat", "placements": [{"variable": "Q_hex", "x": 0.4, "y": 0.3}]}
    )
    assert not placed["isError"], text(placed)
    heat = client.get(f"/api/datasets/{DATASET}/site?scope=heat").json()["pid_layout"]
    assert heat["paper:Q_hex"]["x"] == 0.4
    assert "paper:Q_hex" not in client.get(f"/api/datasets/{DATASET}/site").json().get("pid_layout", {})  # not the data center's
    assert server.call("pid_place", {"dataset_id": DATASET, "placements": [{"variable": "Q_hex", "x": 0.4, "y": 0.3}]})["isError"]
    assert server.call("pid_view", {"dataset_id": DATASET, "scope": "nope"})["isError"]


def test_pid_view_without_a_drawing(server: Server, app_fetch):
    connect_agent(app_fetch)  # a drawing the page renders is read from the open page: the user connected the agent
    result = server.call("pid_view", {"dataset_id": DATASET})
    assert result["isError"] and "no P&ID" in text(result)


def test_unknown_tool_and_a_failing_tool_are_told_apart(server: Server, app_fetch, drawing: Path):
    """A KeyError inside a tool (here: an old pid_plant.json without labels) is an isError result, not 'unknown tool'."""
    (drawing / "pid_plant.json").write_text(json.dumps({"components": [{"id": "P1", "x": 0.5, "y": 0.5}]}))
    failing = server.handle(
        {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "pid_view", "arguments": {"dataset_id": DATASET}}}
    )
    assert failing["result"]["isError"] and "unexpected answer" in text(failing["result"])
    unknown = server.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "nope"}})
    assert unknown["error"]["code"] == -32602


def test_read_docs_only_reads_doc_pages(server: Server):
    assert "concepts/components" in text(server.call("read_docs", {}))
    assert "component" in text(server.call("read_docs", {"page": "concepts/components"})).lower()
    assert server.call("read_docs", {"page": "../AGENTS"})["isError"]


def test_stdio_protocol():
    """initialize, a notification (no reply), tools/list and an unknown method over a real subprocess."""
    lines = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        {"jsonrpc": "2.0", "id": 3, "method": "nope"},
    ]
    app_dir = Path(__file__).resolve().parents[1]
    out = subprocess.run(
        [sys.executable, "-m", "backend.mcp_server"],
        input="\n".join(json.dumps(m) for m in lines) + "\nnot json\n",
        capture_output=True,
        text=True,
        cwd=app_dir,
        timeout=60,
        check=True,
    ).stdout.splitlines()
    replies = [json.loads(line) for line in out]
    assert [r["id"] for r in replies] == [1, 2, 3, None]
    assert replies[0]["result"]["protocolVersion"] == "2025-06-18"
    assert len(replies[1]["result"]["tools"]) > 30
    assert replies[2]["error"]["code"] == -32601 and replies[3]["error"]["code"] == -32700


def test_a_snapshot_can_be_cut_to_the_parts_asked_for():
    snap = {
        "route": "dc/pid",
        "dataset": "sim_x",
        "controls": [{"name": "Save"}] * 300,
        "text": "long",
        "images": [],
        "detail": {
            "instruments": [{"variable": "A", "x": 0.1, "y": 0.2}],
            "links": [],
            "construct": {"shapes": [1], "drawing_texts": [2]},
        },
    }
    out = mcp_server.snapshot_parts(snap, ["instruments", "construct.drawing_texts", "nope", "construct.nope"])
    assert out == {
        "route": "dc/pid",
        "dataset": "sim_x",
        "detail": {
            "instruments": [{"variable": "A", "x": 0.1, "y": 0.2}],
            "construct.drawing_texts": [2],
            "nope": None,
            "construct.nope": None,
        },
        "detail_keys": ["construct", "instruments", "links"],
    }
    assert mcp_server.snapshot_parts(snap, ["text"])["text"] == "long"
    # the page's own commands always come along: what the next ui_do can do
    assert mcp_server.snapshot_parts({**snap, "commands": ["set_window"]}, ["links"])["commands"] == ["set_window"]


def test_ui_do_describes_the_page_commands_the_backend_accepts(server: Server):
    """Every gesture the backend accepts is in ui_do's description, so the model can find it."""
    from backend.core.live import COMMANDS

    about = next(t for t in server.tools() if t["name"] == "ui_do")["description"]
    assert [a for a in COMMANDS if a not in about] == []


@pytest.fixture
def wiki(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A tiny agent wiki: an index and two pages, one in a subfolder; a secret file next to it."""
    root = tmp_path / "wiki"
    (root / "pages").mkdir(parents=True)
    (root / "index.md").write_text("---\ntitle: Agent wiki\ntags: [start]\nsummary: Where to start.\n---\n# Start here\n")
    (root / "pages" / "heat-matching.md").write_text(
        "---\ntitle: Heat Matching\ntags: [twin, what-if]\nsummary: Match the waste heat against the demand.\n---\n"
        "Open twin/matching.\nThe KPIs are in detail.heat_matching.\nUse set_window for the year picker.\n"
    )
    (root / "dashboard.md").write_text(
        "---\ntitle: Dashboard\ntags: [data]\nsummary: Look at the data.\n---\nPick a period; the heat KPIs follow.\n"
    )
    (tmp_path / "secret.md").write_text("---\ntitle: secret\n---\nnot a wiki page")
    monkeypatch.setattr(mcp_server, "WIKI_DIR", root)
    return root


def test_wiki_search_ranks_by_title_tags_and_body_with_the_matching_lines(server: Server, wiki: Path):
    out = json.loads(text(server.call("wiki_search", {"query": "heat matching KPIs"})))
    first, second = out["results"][0], out["results"][1]
    assert first["path"] == "pages/heat-matching.md" and first["title"] == "Heat Matching"
    assert first["summary"] == "Match the waste heat against the demand."
    assert any("detail.heat_matching" in m["text"] for m in first["matches"])
    assert second["path"] == "dashboard.md" and first["score"] > second["score"]
    assert "index.md" not in [r["path"] for r in out["results"]]
    assert json.loads(text(server.call("wiki_search", {"query": "zeppelin"})))["results"] == []
    assert server.call("wiki_search", {"query": " "})["isError"]


def test_wiki_read_gives_a_page_or_the_index_and_nothing_outside(server: Server, wiki: Path):
    index = text(server.call("wiki_read", {}))
    assert "Start here" in index and "pages/heat-matching.md" in index
    assert "set_window" in text(server.call("wiki_read", {"page": "pages/heat-matching"}))
    for bad in ("../secret.md", "../secret", "/etc/passwd", "pages/../../secret.md", "nope"):
        result = server.call("wiki_read", {"page": bad})
        assert result["isError"] and "not a wiki page" not in text(result), bad


def test_no_wiki_says_so(server: Server, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(mcp_server, "WIKI_DIR", tmp_path / "none")
    result = server.call("wiki_read", {})
    assert result["isError"] and "read_docs" in text(result)


def test_connect_app_keeps_the_token_and_sends_it(server: Server, app_fetch, monkeypatch: pytest.MonkeyPatch):
    """connect_app with the user's code: the model reads "Connected", not the token, which is kept for later calls."""
    monkeypatch.setattr(mcp_server, "AGENT", {})
    hub = app_fetch.app.state.live
    page = hub.stream(heartbeat=0.01, client="p1")
    secret = page_secret(next(page))
    assert server.call("ui_state", {})["isError"]
    result = server.call("connect_app", {"body": {"code": hub.new_code("p1", secret)}})
    assert not result["isError"] and "Connected" in text(result) and mcp_server.AGENT["token"] not in text(result)
    assert hub.authorized(mcp_server.AGENT["token"])
    page.close()
