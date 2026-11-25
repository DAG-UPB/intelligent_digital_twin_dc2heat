"""The FastAPI app: every route under /api, the built web page at /, the documentation at /docs."""

import logging
import math
from collections.abc import Sequence
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import ALLOWED_HOSTS
from .core import data_versions as dv
from .core import dataset_files as files
from .core import live as live_core
from .core.limits import REQUEST_MAX_BYTES
from .core.registry import DatasetRegistry
from .routers import (
    components,
    data_versions,
    datasets,
    documents,
    foundation,
    graphs,
    live,
    market,
    mcp,
    pid,
    prepare,
    project,
    site,
    training,
    waermeatlas,
)


class SafeJSONResponse(JSONResponse):
    """JSON where NaN and ±inf become null (plain JSON has no NaN; the default response fails with a 500)."""

    def render(self, content: Any) -> bytes:
        """The JSON bytes; only a payload with NaN/inf pays for the extra walk."""
        try:
            return super().render(content)
        except ValueError:  # only when a NaN/inf is in there: walk it once
            return super().render(_finite(content))


def _finite(x: Any) -> Any:
    """`x` with every non-finite float replaced by None (dicts, lists and tuples walked)."""
    if isinstance(x, float):
        return x if math.isfinite(x) else None
    if isinstance(x, dict):
        return {k: _finite(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_finite(v) for v in x]
    return x


API_DESCRIPTION = """\
Every dataset-scoped route answers **404** `Dataset '<id>' not found` for an unknown dataset id.
Invalid request bodies answer **422** with FastAPI's validation `detail`; other errors carry a
plain-text `detail` meant for the user. NaN and infinity in any response are `null`.

Lag convention: graph files and saved models store `lag = -k` (-1 = one step back, 0 = same step).
"""

TAGS = [
    {"name": "datasets", "description": "The datasets in app/data, their time series and P&ID image"},
    {"name": "graphs", "description": "Causal graphs: which variables drive which, at which lag"},
    {"name": "training", "description": "Physics equations; train, evaluate and simulate the twin's models"},
    {"name": "site", "description": "The heat-reuse site: map, heat source and sinks, P&ID layout"},
    {"name": "project", "description": "Save / open everything built on a dataset as one JSON file"},
    {"name": "pid", "description": "P&ID drawings: extract the plant graph, preview, use as a data center's P&ID"},
    {"name": "documents", "description": "The user's documents about a data center's physical structure, read as text"},
    {"name": "district", "description": "Buildings and their modelled heat demand (Wärmeatlas Hessen, local import)"},
    {"name": "components", "description": "Plant components (heat exchanger, heat pump, storage, ...) as small causal models"},
    {"name": "app", "description": "The app itself"},
]


def _origin_host(origin: str) -> str | None:
    """The host name of an Origin header ("::1" for "http://[::1]:7601"); None for "null" or garbage."""
    try:
        return urlsplit(origin).hostname
    except ValueError:
        return None


WRITES = ("POST", "PUT", "PATCH", "DELETE")


class SameSiteWrites:
    """413 for a body above REQUEST_MAX_BYTES (by its Content-Length, before it is read), 403 for a write sent by a
    page of another site (browsers always send Origin on a cross-site POST), and every successful write announced to
    the open pages, so they show it live (not the page's own reports).

    A plain ASGI middleware, not @app.middleware("http"): that one buffers streaming responses and never tells the
    live event stream that its page closed, so closed tabs stayed listening for good.
    """

    def __init__(self, app, origins: set[str], hub: live_core.Hub) -> None:
        self.app, self.origins, self.hub = app, origins, hub

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request = Request(scope)
        method, path = request.method, request.url.path
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > REQUEST_MAX_BYTES:
            # ponytail: by its Content-Length only (a browser always sends one); a chunked body is bounded per route
            too_big = {"detail": f"Request too large (limit {REQUEST_MAX_BYTES // 2**20} MB)"}
            return await JSONResponse(too_big, status_code=413)(scope, receive, send)
        origin = request.headers.get("origin")
        cross_site = origin is not None and "*" not in self.origins and _origin_host(origin) not in self.origins
        if cross_site and method in WRITES:
            return await JSONResponse({"detail": "Cross-site request refused"}, status_code=403)(scope, receive, send)
        status = 500

        async def send_status(message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        await self.app(scope, receive, send_status)
        if (
            method in WRITES
            and status < 400
            and path.startswith("/api/")
            and not path.startswith("/api/live/")
            and not live_core.COMPUTE_ONLY.search(path)
        ):
            self.hub.publish({"type": "changed", "method": method, "path": path, "client": request.headers.get("x-client-id")})


def create_app(
    data_dir: Path,
    web_dist: Path | None = None,
    docs_html: Path | None = None,
    allowed_hosts: Sequence[str] = ALLOWED_HOSTS,
    *,
    versions_dir: Path | None = None,
    version_file: Path | None = None,
    native_picker: bool = False,
    market_dir: Path | None = None,
) -> FastAPI:
    """The app over the datasets in `data_dir`; serves `web_dist` and `docs_html` if they exist.

    `versions_dir` holds alternative data folders (version_1, ...) the app can switch to; `version_file` remembers
    the choice; `native_picker` lets the data-folder dialog open the OS's own folder dialog (only the real app: it
    would pop up on the screen in tests). A remembered version that is gone (link missing on this machine) falls
    back to `data_dir`. `market_dir` holds SMARD's electricity market files (core/market.py; none: no market data).
    Only requests to one of `allowed_hosts` are answered, and writes only from a page on one of them.
    """
    version = dv.read_choice(version_file) or dv.default_version(versions_dir)
    try:
        directory = dv.data_dir_of(version, data_dir, versions_dir)
    except ValueError:
        version, directory = dv.LOCAL, data_dir
    registry = DatasetRegistry(directory, examples_dir=data_dir)  # the examples are in every project
    registry.discover()

    app = FastAPI(
        title="Intelligent Digital Twin",
        summary="Local digital twin of a data center: causal graphs, learned models, what-if scenarios and heat reuse.",
        description=API_DESCRIPTION,
        openapi_tags=TAGS,
        docs_url="/api/docs",
        swagger_ui_oauth2_redirect_url="/api/docs/oauth2-redirect",  # /docs is the documentation site
        redoc_url=None,
        openapi_url="/api/openapi.json",
        default_response_class=SafeJSONResponse,
    )
    app.state.registry = registry
    app.state.local_dir, app.state.versions_dir = data_dir, versions_dir
    app.state.version_file, app.state.data_version = version_file, version
    app.state.native_picker = native_picker
    app.state.market_dir = market_dir
    app.state.live = live_core.Hub()

    # Binding to 127.0.0.1 does not stop a website whose name resolves to 127.0.0.1 (DNS rebinding), or a
    # cross-site "simple" POST (text/plain, no preflight) to the raw-body P&ID routes: check Host and Origin.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(allowed_hosts))
    origins = {h.strip("[]").lower() for h in allowed_hosts}

    app.add_middleware(SameSiteWrites, origins=origins, hub=app.state.live)

    @app.exception_handler(Exception)
    async def server_error(request: Request, exc: Exception) -> JSONResponse:
        """A bug: logged with its traceback and the request (uvicorn's own line names neither the route's work)."""
        logging.getLogger("backend").error("%s %s failed", request.method, request.url.path, exc_info=exc)
        return JSONResponse({"detail": "Internal error: the app's log has the details"}, status_code=500)

    @app.exception_handler(files.BrokenFile)
    async def broken_file(request: Request, exc: files.BrokenFile) -> JSONResponse:
        """A broken file of a data folder: its name and what to do, not a 500."""
        return JSONResponse({"detail": str(exc)}, status_code=422)

    for module in (
        datasets,
        prepare,
        data_versions,
        live,
        mcp,
        graphs,
        training,
        site,
        project,
        pid,
        documents,
        waermeatlas,
        components,
        foundation,
        market,
    ):
        app.include_router(module.router)

    @app.get("/health", tags=["app"], summary="Health check")
    def health() -> dict:
        """The app is up; how many datasets it found (and which it could not read, if any)."""
        unreadable = {"unreadable": registry.unreadable} if registry.unreadable else {}
        return {"status": "ok", "datasets": len(registry.datasets), **unreadable}

    # static sites last: a mount at "/" would shadow every route after it
    if docs_html and docs_html.exists():

        @app.get("/docs", include_in_schema=False)
        def docs_redirect() -> RedirectResponse:
            """The mount below only matches /docs/..., so the bare path would 404."""
            return RedirectResponse("/docs/")

        app.mount("/docs", StaticFiles(directory=docs_html, html=True), name="docs")
    if web_dist and web_dist.exists():
        app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")
    return app
