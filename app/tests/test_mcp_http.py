"""MCP over HTTP at /mcp (routers/mcp.py): an agent set up with the address only; sessions keep their own token."""

import pytest
from conftest import page_secret
from fastapi.testclient import TestClient

from backend import mcp_server
from backend.routers import mcp as mcp_http


@pytest.fixture
def app_fetch(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Tool calls go to the same TestClient instead of the app's own port."""

    def fetch(method, path, body=None, content_type=None):
        r = client.request(method, path, content=body, headers={"Content-Type": content_type} if content_type else {})
        if r.status_code >= 400:
            raise mcp_server.ToolError(f"HTTP {r.status_code}: {r.json().get('detail')}")
        return r.headers["content-type"].split(";")[0], r.content

    monkeypatch.setattr(mcp_server, "fetch", fetch)
    return client


def rpc(client: TestClient, method: str, params: dict | None = None, sid: str | None = None, id: int | None = 1):
    message: dict = {"jsonrpc": "2.0", "method": method, **({"params": params} if params else {})}
    if id is not None:
        message["id"] = id
    return client.post("/mcp", json=message, headers={"Mcp-Session-Id": sid} if sid else {})


def test_initialize_opens_a_session_with_the_guide(client: TestClient):
    r = rpc(client, "initialize", {"protocolVersion": "2025-06-18"})
    assert r.status_code == 200 and r.headers["mcp-session-id"]
    result = r.json()["result"]
    assert result["protocolVersion"] == "2025-06-18" and "Connect AI" in result["instructions"]


def test_tools_and_guide_over_http(client: TestClient):
    sid = rpc(client, "initialize").headers["mcp-session-id"]
    assert rpc(client, "notifications/initialized", sid=sid, id=None).status_code == 202  # a notification: no reply
    names = {t["name"] for t in rpc(client, "tools/list", sid=sid).json()["result"]["tools"]}
    assert {"guide", "connect_app", "ui_do", "list_datasets", "wiki_search"} <= names
    guide = rpc(client, "tools/call", {"name": "guide", "arguments": {}}, sid=sid).json()["result"]
    assert not guide["isError"] and "connect_app" in guide["content"][0]["text"]


def test_a_session_keeps_its_own_token(app_fetch: TestClient):
    hub = app_fetch.app.state.live  # type: ignore[attr-defined]
    page = hub.stream(heartbeat=0.01, client="p1")
    secret = page_secret(next(page))
    one = rpc(app_fetch, "initialize").headers["mcp-session-id"]
    two = rpc(app_fetch, "initialize").headers["mcp-session-id"]
    r = rpc(
        app_fetch, "tools/call", {"name": "connect_app", "arguments": {"body": {"code": hub.new_code("p1", secret)}}}, sid=one
    )
    assert not r.json()["result"]["isError"]
    assert hub.authorized(mcp_http._sessions[one]["token"]) and "token" not in mcp_http._sessions[two]
    assert "token" not in mcp_server.AGENT  # not the process's: the stdio server's stays apart
    page.close()


def test_unknown_session_get_and_end(client: TestClient):
    assert rpc(client, "tools/list", sid="gone").status_code == 404  # after a restart: the client starts again
    assert client.get("/mcp").status_code == 405
    sid = rpc(client, "initialize").headers["mcp-session-id"]
    assert client.delete("/mcp", headers={"Mcp-Session-Id": sid}).status_code == 200
    assert rpc(client, "tools/list", sid=sid).status_code == 404
    assert client.post("/mcp", content=b"{not json", headers={"Content-Type": "application/json"}).status_code == 400


def test_no_session_no_shared_token_and_sessions_are_bounded(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    # B-S6: every client without a session id shared one token holder (the last one's connect_app for all of them)
    r = rpc(client, "tools/list")
    assert r.status_code == 400 and "Mcp-Session-Id" in r.json()["error"]["message"]
    assert "" not in mcp_http._sessions
    monkeypatch.setattr(mcp_http, "MCP_SESSIONS_MAX", 3)
    monkeypatch.setattr(mcp_http, "_sessions", {})
    sids = [rpc(client, "initialize").headers["mcp-session-id"] for _ in range(5)]
    assert list(mcp_http._sessions) == sids[2:]  # the oldest go first
    assert (
        rpc(client, "tools/list", sid=sids[0]).status_code == 404 and rpc(client, "tools/list", sid=sids[-1]).status_code == 200
    )
