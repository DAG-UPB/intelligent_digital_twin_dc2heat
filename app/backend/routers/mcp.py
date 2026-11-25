"""MCP over HTTP ("Streamable HTTP") at /mcp: the same server as backend/mcp_server.py, served by the app itself, so an
agent is set up with an address only (no command to run, nothing to install): "add the MCP server at
http://localhost:7600/mcp". Answers are plain JSON (no server-sent stream: every tool answers once); each initialize
opens a session (Mcp-Session-Id) that keeps its agent's token from connect_app. Not in the API reference (it is
not a tool). Host and same-site checks are the app's (app.py), which also keep a web page elsewhere from calling it.
"""

import threading
import uuid

import anyio.to_thread
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from .. import mcp_server
from ..core.limits import MCP_SESSIONS_MAX

router = APIRouter()

_sessions: dict[str, dict[str, str]] = {}  # session id -> its agent's token holder (lost on a restart, as the pairing;
# at most MCP_SESSIONS_MAX, the oldest dropped)
_server: mcp_server.Server | None = None
_lock = threading.Lock()


def _the_server(request: Request) -> mcp_server.Server:
    """The tool list, built once from the running app's own OpenAPI schema."""
    global _server
    with _lock:
        if _server is None:
            _server = mcp_server.Server(request.app.openapi())
    return _server


def _replies(server: mcp_server.Server, messages: list, agent: dict[str, str], base: str) -> list[dict]:
    """The replies to these JSON-RPC messages, for this session and this app (in a worker thread: tools call the app)."""
    mcp_server.SESSION.set(agent)
    mcp_server.BASE.set(base)
    return [r for m in messages if isinstance(m, dict) and (r := server.handle(m)) is not None]


@router.post("/mcp", include_in_schema=False)
async def mcp_post(request: Request):
    """One JSON-RPC message or a batch; notifications only: 202."""
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}, status_code=400)
    messages = body if isinstance(body, list) else [body]
    headers = {}
    if any(isinstance(m, dict) and m.get("method") == "initialize" for m in messages):
        sid = uuid.uuid4().hex
        with _lock:
            _sessions[sid] = {}
            while len(_sessions) > MCP_SESSIONS_MAX:  # the oldest go first (a client that never says DELETE)
                _sessions.pop(next(iter(_sessions)))
        headers["Mcp-Session-Id"] = sid
    else:
        sid = request.headers.get("mcp-session-id") or ""
        if not sid:  # no holder shared between clients: each keeps its own agent's token in its session
            need = {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "send the Mcp-Session-Id of initialize"}}
            return JSONResponse(need, status_code=400)
        if sid not in _sessions:  # after a restart of the app: the client starts a new session
            gone = {"jsonrpc": "2.0", "id": None, "error": {"code": -32001, "message": "unknown session"}}
            return JSONResponse(gone, status_code=404)
    base = f"http://127.0.0.1:{request.url.port or 80}"
    replies = await anyio.to_thread.run_sync(_replies, _the_server(request), messages, _sessions[sid], base)
    if not replies:
        return Response(status_code=202, headers=headers)
    return JSONResponse(replies if isinstance(body, list) else replies[0], headers=headers)


@router.get("/mcp", include_in_schema=False)
def mcp_get():
    """No stream from the server: every answer comes with its request."""
    return Response(status_code=405, headers={"Allow": "POST, DELETE"})


@router.delete("/mcp", include_in_schema=False)
def mcp_delete(request: Request):
    """The client ends its session."""
    _sessions.pop(request.headers.get("mcp-session-id") or "", None)
    return Response(status_code=200)
