"""MCP server: the app as tools for an LLM agent (Claude Code, Claude Desktop, any MCP client).

Model Context Protocol over stdio (JSON-RPC, one message per line), stdlib only. Every HTTP route becomes a tool,
generated from the app's own OpenAPI schema, so a new endpoint is a new tool without a change here. Calls go to
the running app (env IDT_URL, default http://127.0.0.1:7600): one process holds the data and models within the
2 GB budget, and the page and the agent see the same files. Tools added for working with an LLM:

  ui_snapshot the page the user has open: images, controls, text, its details and commands (ui_do acts on it)
  pid_view    the P&ID as an image with a coordinate grid, the placed variables and the drawing's components;
              a region zooms in to read small text
  pid_place   put variables on the P&ID (fractions of the image) or on one of its components
  read_docs   the technical documentation (equation language, components, models, ...)
  wiki_search the agent wiki (app_idz/wiki/: how to do things in the app), best pages for a query
  wiki_read   one wiki page, or its index

Run from app/:  .venv/bin/python -m backend.mcp_server     (the repository's .mcp.json does this for Claude Code)
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import sys
import tempfile
from collections.abc import Callable
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from backend.core.limits import MCP_CALL_TIMEOUT_S, MCP_PID_VIEW_MAX_PX, MCP_TEXT_MAX_CHARS
from backend.core.live import COMPUTE_ONLY  # POSTs that only compute: tools that read

BASE_URL = os.environ.get("IDT_URL", "http://127.0.0.1:7600").rstrip("/")
DOCS_DIR = Path(__file__).resolve().parents[2] / "docs"
WIKI_DIR = Path(__file__).resolve().parents[2] / "wiki"  # the agent wiki: markdown with title / tags / summary
PROTOCOL_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")  # newest first

INSTRUCTIONS = """\
Intelligent Digital Twin (DC2HEAT): a causal digital twin of a data center learned from its measurements, the heat
distribution that takes its waste heat, and the district that needs it. You can do everything the user does in the
app: every page, button and setting, through the open page (ui_do), and the data, graphs and models through the
API tools (one per route; [writes] marks the ones that change files).

Where to look things up: wiki_search {query} and wiki_read {page} are the agent wiki (the domain: data centers,
cooling, temperatures, heat recovery, district heating, modelling, profiles, the example datasets, and where each is in
the app and how to do it there; wiki_read without a page is its index): search it before a task you have not done.
read_docs is the technical documentation (equation language: "concepts/models", components, causal graphs,
"concepts/datacenter-variables").

Data: one project (a data folder version: list_data_versions; switch_data_version [writes]) with many datasets (data
centers): list_datasets, then get_summary / get_graph / get_equations of one. Each part has its own structure,
graphs, site, equations and models: pass scope "heat" or "district" to those tools (default the data center's), and
so do pid_view and pid_place.

Working live with the user: they watch the app in a browser. First ask them to press Connect AI in the top bar and
tell you the six-digit code, then call connect_app with it (until then ui_state, ui_snapshot and ui_do are refused).
Then work in a loop: ui_state (page, data center), ui_snapshot (what the page shows: images of its drawings and
charts, every control with name, value and ref, the visible text, `detail` with the page's numbers and selections,
`commands` with its own gestures), ui_do (act), ui_snapshot again to see the result. On a big page ask only for
parts, e.g. ui_snapshot parts ["heat_matching"], ["instruments", "links"] or ["controls"]: the whole snapshot fills your
context. ui_do click {control} / fill {control, value} work on every control of every page, by name, ref, or
"<in> › <name>" when a name repeats (three cards' "More options"); a folded panel ("More options", "Settings",
"What if…", the Variables menu, the Site map's cards, the top bar's Systems) is a control too (`on` when open): click it
open first, its controls appear then. Systems (right of the sub-tabs) holds the three systems' dataset selects, Case
beside it picks all three with their models. Changes on a page are
unsaved and stay in the browser until the user's Save; press Save, Train, Use as P&ID or Save project only when the user
asks, and call [writes] tools only for a change the user wants. Tell the user what you did.

The pages, in the order the work goes (ui_do navigate {route}):
1. home/start: what each page is for, links to them.
2. dc/dashboard, Visualization and Scenarios: look at the data first. detail.dashboard has the KPIs of the period
   chosen (value + unit), the overview (rows, span, completeness, gaps), mode and view. Controls: Mode (Historical |
   Scenarios, top left of the KPI card), under the KPIs the tabs "More figures (n)" (only beyond five KPIs), "Choose the
   KPI variables" and "Data overview" (each opens below, a second click closes it), Data file, Period and Month (the
   panel left of the charts), the variable chips with All / None, View (Time series with Layout Rows | Tiles, Daily
   profile, Weekly and monthly, Autocorrelation, Correlation, Distributions (a click on one opens it large),
   Variables, Missing data, Recommendations (n), and the data center's Edit data: Prepare variables (add_prepared) and
   Aggregate data write to silver).
   Scenarios mode: the levers (sliders) and the twin's KPIs (detail.dashboard.kpis: measured, twin_no_change,
   twin_with_levers), the replay and the test-period simulation. heat/dashboard and district/dashboard: the same for
   that part.
3. dc/pid, Structure and Modelling: the P&ID and the causal graph (below), then Modelling under it (it loads once
   scrolled near: ui_do scroll {to: "Modelling"}). The page opens to view (the drawing, the slider, the variables):
   click Edit for the tools that change it (Causal discovery, "+ Variable", Save as, the construct's tools), "Done
   editing" hides them again; the page commands below work in both. detail.modelling:
   each variable's approach (data, physics, profile, off: fill "Approach of <variable>"), what Train would fit with its
   time estimate, the equations, the saved models and, once evaluated, the best model per variable (nMAE). Causal
   discovery: click "Causal discovery", choose Refine the drawn graph or Blind, no links, fill Method (PCMCI | PC),
   Significance level (alpha), Smallest lag / Largest lag, click Run: the lags it finds are suggestions on the
   drawing, saved only by Save. "+ Variable" opens the add box; the Variables menu's chips filter by approach.
   heat/structure and district/structure: the same for those parts; a profile variable's generator is drawn with
   ui_do set_profile_shape (detail "profile: <title>").
4. twin/map, Site Map: the data center, its heat sinks and the Wärmeatlas buildings on a map
   (map_focus, map_click, pick_atlas_building; the tiles are not in the images: use detail map_centre and sinks).
   The floating panel on the left has folded cards (click the title to open): Data center, "Heat sinks (n)" (the
   sinks, "Show list", + Buildings, + Area, the Wärmeatlas's "Load heat demand in view" and radius) and Quick
   analysis (On the map | As in Heat Matching; detail.quick_analysis.results: heat recovered, demand covered, CO2,
   electricity, per month);
   "Open in Heat Matching →" saves the map's edits first; the map's zoom and layers are in the panel too.
5. twin/matching, Heat Matching: the waste heat against the demand, step by step. detail.heat_matching:
   the KPIs over the period (coverage %, heat delivered MWh, HP electricity, SPF, unmet, surplus, CO2 t), each part's
   chosen and running way with the reason a way cannot run, the units on, the inputs, the what-if levers, the window
   and its mean flows. ui_do set_part_way {part: dc | heat | district, way: model | calculation}; set_window {number |
   date} for the year picker's band; each part's model and system select at the top of its column ("Data center:
   model and system", "Heat distribution: model and system", "District: demand and system": a trained model, the heat
   pump's component, the demand's source, or another dataset); the Data center card's More options (Scale, the
   Calculation's sliders), the heat distribution card's (units, physical formulas, numbers), "What if…" (Outdoor
   temperature shift, Weather from, Heat demand from: fill with a dataset id or the option's text; IT load, Heat
   pump, Heat demand sliders; "Weather…", also a click on the diagram's weather band, opens the Weather window: Weather
   source From a system | Generated (Mean, Over the year, Over the day, "Use it") | From a file, and the shift).
   "More details" under the KPIs opens the balance, the data center's heat, the heat pump, storage and CO2. Nothing
   here is saved; read the KPIs again after each change.
6. twin/planning, Operation: plant variants and how the plant runs (its KPIs in the visible text).
help/about, help/guide (the walkthrough), help/assistant (connecting an agent).

The P&ID (Structure and Modelling): pid_view shows the drawing with a 0..1 grid and the variables already placed;
read small text with region=[x0, y0, x1, y1]. Placing a data center's variables and linking them: first read_docs
"concepts/datacenter-variables" and list_documents (the user's documents: equipment and sensor lists, schematics;
read them from their path with your own file tools and say which you used). ui_snapshot gives the drawing's texts and
shapes with positions (parts ["construct.drawing_texts", "construct.shapes"]); place everything in one ui_do
place_instruments [{variable, x, y}] (only placed ones are drawn); then the links in one ui_do set_links [{from, to,
lags?}]; check with ui_snapshot; mark each with annotate_variables (kind, confidence: the user sees where you
guessed); many similar variables: group_variables (only a mark). Work rough first, then refine group by group. The
page logs your changes; save_draft / discard_draft keep or drop the unsaved work. Views: areas of the P&ID with a
picture of their own (ui_snapshot views; pid_view(view=id) with its own grid; place_instruments with view: id, or
component: a label of the view's construct, e.g. "TT1"); add_view / edit_view / remove_view write site.json at once
(ask first); open_view / close_view zoom the user's screen; set_layers sets the level of detail. The digital construct
(shapes read from the drawing): add_shape / edit_shape / delete_shape / match_variable, or get_construct /
save_construct whole; view_construct / save_view_construct / copy_view for a view; extract {file_path, summary: true}
is a dry run of what a drawing would hold. Names shown: set_variable_names (written at once; tools keep the own names).
A variable without data is ui_do add_variable; a new column from the data is add_prepared; delete_variable deletes
either (delivered data never). set_kpi says which are IT, cooling, other facility power and reused heat [writes];
import_data_center adds a data center from a folder (scan_folder first) [writes]. Equations use the app's language:
check_equation before save_equations. Components (heat pumps, HEX, storage): list_components, check_component,
simulate_component, fit_component. A trained model's what-if: simulate {start, steps, interventions, drivers} (drivers:
another weather or demand series for the model's drivers, get_model lists them).

Real data centers: everything a tool returns (P&ID images, time series) is sent to the model provider. Lags in graph
files are negative; discovered lags are suggestions and are saved only when the user asks."""


class ToolError(Exception):
    """A tool failed in a way the model should read (returned as isError, not as a protocol error)."""


@dataclass
class Route:
    """One API operation as a tool."""

    method: str
    path: str
    path_params: list[str]
    query_params: list[str]
    body: str | None  # "json", "file" (raw bytes of a local file) or None
    tool: dict


# ---------------------------------------------------------------- HTTP to the running app (tests swap `fetch`)


# The token connect_app got for the user's code: sent with every call, so the page tools (ui_state, ui_snapshot,
# ui_do) work; kept in this process only, for as long as it runs. Over stdio one for the process (AGENT); over HTTP
# (routers/mcp.py) one per MCP session, and the app's own address, set for each request.
AGENT: dict[str, str] = {}
SESSION: ContextVar[dict[str, str] | None] = ContextVar("mcp_session", default=None)


def _agent() -> dict[str, str]:
    """This session's token holder (over stdio: the process's)."""
    own = SESSION.get()
    return AGENT if own is None else own


BASE: ContextVar[str | None] = ContextVar("mcp_base", default=None)  # over HTTP: the app's own port
PAIR_PATH = "/api/live/pair"


def http_fetch(method: str, path: str, body: bytes | None = None, content_type: str | None = None) -> tuple[str, bytes]:
    """(content type, body) of one request to the app; ToolError with FastAPI's detail on an error status."""
    headers = {"Content-Type": content_type} if content_type else {}
    agent = _agent()
    if "token" in agent:
        headers["X-Agent-Token"] = agent["token"]
    base = BASE.get() or BASE_URL
    request = Request(base + path, data=body, method=method, headers=headers)
    try:
        with urlopen(request, timeout=MCP_CALL_TIMEOUT_S) as response:
            return response.headers.get_content_type(), response.read()
    except HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            detail = json.loads(raw).get("detail", raw)
        except (ValueError, AttributeError):
            detail = raw
        raise ToolError(f"HTTP {e.code}: {json.dumps(detail) if not isinstance(detail, str) else detail}") from None
    except URLError as e:
        raise ToolError(
            f"The app is not reachable at {base} ({e.reason}). Start it from app/: bash scripts/guard.sh ./start.sh"
        ) from None


fetch: Callable[..., tuple[str, bytes]] = http_fetch


def get_json(path: str) -> Any:
    """GET a JSON route."""
    return json.loads(fetch("GET", path)[1])


# ---------------------------------------------------------------- tools from the OpenAPI schema


def _refs(node: Any) -> set[str]:
    """Names of the schemas a JSON-schema fragment refers to (#/components/schemas/<name>)."""
    if isinstance(node, dict):
        found = {node["$ref"].rsplit("/", 1)[-1]} if "$ref" in node else set()
        return found.union(*(_refs(v) for v in node.values()))
    if isinstance(node, list):
        return set().union(*(_refs(v) for v in node))
    return set()


def _with_defs(schema: dict, defs: dict) -> dict:
    """Rewrite $refs to #/$defs/... and attach only the definitions the schema reaches."""
    todo, seen = _refs(schema), set()
    while todo:
        name = todo.pop()
        if name not in seen and name in defs:
            seen.add(name)
            todo |= _refs(defs[name])
    out = json.loads(json.dumps(schema).replace("#/components/schemas/", "#/$defs/"))
    if seen:
        out["$defs"] = json.loads(json.dumps({n: defs[n] for n in sorted(seen)}).replace("#/components/schemas/", "#/$defs/"))
    return out


def routes_from_openapi(spec: dict) -> dict[str, Route]:
    """One tool per operation, named after the route function (FastAPI's operationId minus path and method)."""
    defs = spec.get("components", {}).get("schemas", {})
    routes: dict[str, Route] = {}
    for path, ops in spec["paths"].items():
        for method, op in ops.items():
            name = op["operationId"].removesuffix(re.sub(r"\W", "_", path) + "_" + method)
            props: dict[str, Any] = {}
            required: list[str] = []
            params = op.get("parameters", [])
            for p in params:
                props[p["name"]] = {**p.get("schema", {}), "description": p.get("description", p["name"])}
                if p.get("required"):
                    required.append(p["name"])
            content = op.get("requestBody", {}).get("content", {})
            body = "json" if "application/json" in content else "file" if content else None
            reads = method == "get" or (method == "post" and COMPUTE_ONLY.search(path) is not None)
            if body == "json":
                schema = content["application/json"]["schema"]
                # the body's own schema inline (type "object" at the top): some clients send a bare $ref as a string
                if "$ref" in schema and schema["$ref"].rsplit("/", 1)[-1] in defs:
                    schema = defs[schema["$ref"].rsplit("/", 1)[-1]]
                if reads and "store" in schema.get("properties", {}):  # a read never stores (call_route drops it too)
                    schema = {**schema, "properties": {k: v for k, v in schema["properties"].items() if k != "store"}}
                props["body"] = {**schema, "description": "The request body (JSON)"}
                if op["requestBody"].get("required"):
                    required.append("body")
            elif body == "file":
                props["file_path"] = {"type": "string", "description": "Path of a local file to send (PDF, SVG or PNG drawing)"}
                required.append("file_path")
            about = " ".join(filter(None, [op.get("summary", name) + ".", op.get("description", "")]))
            tool = {
                "name": name,
                "description": (about if reads else "[writes] " + about).strip(),
                "inputSchema": _with_defs({"type": "object", "properties": props, "required": required}, defs),
                "annotations": {"readOnlyHint": reads, "destructiveHint": not reads, "openWorldHint": "open-meteo" in path},
            }
            routes[name if name not in routes else op["operationId"]] = Route(
                method.upper(),
                path,
                [p["name"] for p in params if p["in"] == "path"],
                [p["name"] for p in params if p["in"] == "query"],
                body,
                tool,
            )
    return routes


def app_openapi() -> dict:
    """The app's OpenAPI schema, from the code (an empty data folder): the tool list needs no running app."""
    from backend.app import create_app

    with tempfile.TemporaryDirectory() as empty:
        return create_app(Path(empty), None).openapi()


def call_route(route: Route, args: dict) -> list[dict]:
    """Call one API route and turn its answer into MCP content."""
    path = route.path
    for p in route.path_params:
        if p not in args:
            raise ToolError(f"missing argument {p!r}")
        path = path.replace("{" + p + "}", quote(str(args[p]), safe=""))
    query = {
        k: str(v).lower() if isinstance(v, bool) else v for k, v in args.items() if k in route.query_params and v is not None
    }
    if query:
        path += "?" + urlencode(query, doseq=True)
    body, ctype = None, None
    if route.body == "json" and "body" in args:
        value = args["body"]
        if isinstance(value, str):  # a client that sent the object as JSON text
            try:
                value = json.loads(value)
            except ValueError as e:
                raise ToolError(f"body is not JSON: {e}") from None
        if route.tool["annotations"]["readOnlyHint"] and isinstance(value, dict):
            # evaluate's store writes models/evaluation.json: a tool marked read-only never asks for that (default false)
            value = {k: v for k, v in value.items() if k != "store"}
        body, ctype = json.dumps(value).encode(), "application/json"
    elif route.body == "file":
        file = Path(str(args.get("file_path", ""))).expanduser()
        if not file.is_file():
            raise ToolError(f"no such file: {file}")
        body, ctype = file.read_bytes(), "application/octet-stream"
    content_type, data = fetch(route.method, path, body, ctype)
    if route.path == PAIR_PATH and route.method == "POST":  # connect_app: keep the token, the model needs not see it
        _agent()["token"] = json.loads(data)["token"]
        return [_text("Connected to the user's open app: ui_state, ui_snapshot and ui_do work now.")]
    if content_type.startswith("image/"):
        return [{"type": "image", "data": base64.b64encode(data).decode(), "mimeType": content_type}]
    text = data.decode(errors="replace")
    if content_type == "application/json":
        text = json.dumps(json.loads(text), ensure_ascii=False, separators=(",", ":"))
    return [_text(text)]


def _text(text: str) -> dict:
    """Text content, cut to what a model should read at once."""
    if len(text) > MCP_TEXT_MAX_CHARS:
        text = (
            text[:MCP_TEXT_MAX_CHARS]
            + f"\n… cut at {MCP_TEXT_MAX_CHARS} of {len(text)} characters: ask for less (columns, a file, a shorter period)."
        )
    return {"type": "text", "text": text}


# ---------------------------------------------------------------- P&ID tools

PAPER, PLANT = "paper:", "plant:"  # pid_layout keys, as in web/src/pages/datacenter/structure/layout.ts


def _columns(dataset_id: str) -> list[str]:
    for d in get_json("/api/datasets")["datasets"]:
        if d["id"] == dataset_id:
            return d["columns"]
    raise ToolError(f"unknown dataset {dataset_id!r}; list_datasets shows the ids")


def _ds(dataset_id: str) -> str:
    return "/api/datasets/" + quote(dataset_id, safe="")


# Whose structure (the routes' `scope`): the data center's, the heat distribution's or the district's, and its page
SCOPES = {"dc": "dc/pid", "heat": "heat/structure", "district": "district/structure"}


def _sq(scope: str) -> str:
    """The `scope` query of a structure's routes ("" for the data center's own)."""
    if scope not in SCOPES:
        raise ToolError(f"scope must be one of {', '.join(SCOPES)}")
    return "" if scope == "dc" else "?" + urlencode({"scope": scope})


def _variables(dataset_id: str, scope: str) -> list[str]:
    """What can sit on a structure: the data's columns, and the variables of its saved graph (also those without
    data, e.g. the heat distribution's)."""
    graph = get_json(_ds(dataset_id) + "/graph" + _sq(scope)).get("targets", {})
    drawn = {v for t, ps in graph.items() for v in (t, *(p["parent"] for p in ps))}
    columns = _columns(dataset_id)
    return columns + sorted(drawn - set(columns))


def pid_state(dataset_id: str, scope: str = "dc") -> dict:
    """Variables, their places on the paper P&ID, their components, and the drawing's components."""
    columns = _variables(dataset_id, scope)
    site = get_json(_ds(dataset_id) + "/site" + _sq(scope))
    layout = site.get("pid_layout", {})
    plant = get_json(_ds(dataset_id) + "/pid/plant" + _sq(scope))
    placed = {v: layout[PAPER + v] for v in columns if PAPER + v in layout and layout[PAPER + v]["x"] >= 0}
    on_component = {v: layout[PLANT + v]["tag"] for v in columns if layout.get(PLANT + v, {}).get("tag")}
    return {
        "coordinates": "x, y are fractions of the whole drawing's width and height, (0, 0) = top left",
        "placed": {v: [round(p["x"], 4), round(p["y"], 4), p["tag"]] for v, p in placed.items()},
        "not_placed": [v for v in columns if v not in placed],
        "variable_component": on_component,
        "components": [{k: c[k] for k in ("id", "label", "x", "y")} for c in plant.get("components", [])],
        "views": site.get("pid_views", []),  # areas with a picture of their own; pid_view(view=id) shows one
    }


def view_state(state: dict, view_id: str, shapes: list[dict] = ()) -> dict:
    """pid_state seen from one view: the variables inside its area, and the components and instruments recognised
    in its picture (its construct's `shapes`), as fractions of the view's own picture."""
    v = next((x for x in state["views"] if x["id"] == view_id), None)
    if v is None:
        raise ToolError(f"no view {view_id!r}; the views: {', '.join(x['id'] for x in state['views']) or 'none'}")
    inside = {
        name: [round((x - v["x"]) / v["w"], 4), round((y - v["y"]) / v["h"], 4), tag]
        for name, (x, y, tag) in state["placed"].items()
        if v["x"] <= x <= v["x"] + v["w"] and v["y"] <= y <= v["y"] + v["h"]
    }
    return {
        **state,
        "coordinates": f"x, y are fractions of the view {v['name']!r}'s own picture; place there with ui_do "
        f'place_instruments [{{variable, x, y, view: "{view_id}"}}]',
        "view": v,
        "placed": inside,
        "components": [
            {"id": s["label"], "shape": s["id"], "label": s["label"], "x": s.get("x", 0), "y": s.get("y", 0)}
            for s in shapes
            if s.get("role") in ("component", "instrument") and s.get("label")
        ],
    }


def _grid_step(span: float) -> float:
    return next(s for s in (0.01, 0.02, 0.05, 0.1) if span / s <= 12) if span <= 1.2 else 0.1


def render_pid(png: bytes, state: dict, region: tuple[float, float, float, float]) -> bytes | None:
    """The drawing (or a region of it) with a labelled 0..1 grid, the placed variables (red) and the components
    (blue); None without Pillow (it comes with matplotlib, not a dependency of its own)."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return None
    x0, y0, x1, y1 = region
    img = Image.open(io.BytesIO(png)).convert("RGB")
    w0, h0 = img.size
    img = img.crop(
        (round(x0 * w0), round(y0 * h0), max(round(x1 * w0), round(x0 * w0) + 1), max(round(y1 * h0), round(y0 * h0) + 1))
    )
    long = max(img.size)
    scale = min(MCP_PID_VIEW_MAX_PX / long, max(1.0, 800 / long))  # zoomed regions are enlarged to be readable
    img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.Resampling.LANCZOS)
    w, h = img.size
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=max(11, round(long * scale / 110)))

    def px(fx: float, fy: float) -> tuple[float, float]:
        return (fx - x0) / (x1 - x0) * w, (fy - y0) / (y1 - y0) * h

    step = _grid_step(min(x1 - x0, y1 - y0))
    for k in range(int(1 / step) + 1):
        f = round(k * step, 4)
        if x0 <= f <= x1:
            x = px(f, 0)[0]
            draw.line([(x, 0), (x, h)], fill=(120, 160, 230), width=1)
            draw.text((x + 2, 2), f"{f:g}", fill=(30, 80, 200), font=font)
        if y0 <= f <= y1:
            y = px(0, f)[1]
            draw.line([(0, y), (w, y)], fill=(120, 160, 230), width=1)
            draw.text((2, y + 2), f"{f:g}", fill=(30, 80, 200), font=font)
    for c in state["components"]:
        x, y = px(c["x"], c["y"])
        draw.rectangle([x - 3, y - 3, x + 3, y + 3], outline=(20, 90, 220), width=2)
        draw.text((x + 5, y + 3), c["id"], fill=(20, 90, 220), font=font)
    for v, (fx, fy, tag) in state["placed"].items():
        x, y = px(fx, fy)
        draw.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(220, 30, 30))
        label = f"{tag} {v}"
        box = draw.textbbox((x + 7, y - 7), label, font=font)
        draw.rectangle(box, fill=(255, 255, 255))
        draw.text((x + 7, y - 7), label, fill=(200, 20, 20), font=font)
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue()


SNAPSHOT_TOP = ("images", "controls", "text")


def snapshot_parts(snap: dict, parts: list[str]) -> dict:
    """Only the asked parts of a page snapshot, so a big page (hundreds of variables) does not fill the model's
    context: "images", "controls", "text", or a key of the page's details ("instruments", "links", "construct",
    "draft", ...; "construct.shapes" for one key inside). Always the route, the data center and the detail keys
    there are, and the page's commands, so the next call knows what it can ask for and do."""
    detail = snap.get("detail") or {}
    out = {k: snap[k] for k in ("route", "dataset", "commands") if k in snap}
    picked: dict = {}
    for p in parts:
        if p in SNAPSHOT_TOP:
            out[p] = snap.get(p, [])
            continue
        head, _, sub = p.partition(".")
        value = detail.get(head)
        picked[p] = value.get(sub) if sub and isinstance(value, dict) else (None if sub else value)
    return {**out, "detail": picked, "detail_keys": sorted(detail)}


def ui_snapshot(images: bool = True, parts: list[str] | None = None) -> list[dict]:
    """The page the user has open, as the page describes itself: its images, then everything else as JSON (only
    `parts` of it when given)."""
    if parts:
        images = "images" in parts
    snap = get_json("/api/live/snapshot" + ("" if images else "?images=false"))
    if parts:
        snap = snapshot_parts(snap, parts)
    pictures = snap.pop("images", [])
    content = []
    for p in pictures:
        content.append(_text(f"Image: {p.get('label', '')}" + (" (0..1 grid: x right, y down)" if p.get("grid") else "")))
        content.append({"type": "image", "data": p["png"], "mimeType": "image/png"})
    return content + [_text(json.dumps(snap, ensure_ascii=False))]


def _drawn_pid(dataset_id: str, scope: str = "dc") -> list[dict]:
    """The app-drawn P&ID (no drawing file): as the open Structure and Modelling page renders it, with its 0..1 grid."""
    state = get_json("/api/live/ui-state").get("state") or {}
    route = SCOPES[scope]
    if state.get("route") != route or state.get("dataset") != dataset_id:
        raise ToolError(
            f"{dataset_id} has no P&ID drawing file here: its diagram is drawn by the page. Open it first with ui_do "
            f'navigate {{"route": "{route}"}} (and open_dataset {{"dataset": "{dataset_id}"}}), then call pid_view again.'
        )
    snap = get_json("/api/live/snapshot")
    grid = [p for p in snap.get("images", []) if p.get("grid")]
    if not grid:
        raise ToolError("The Structure and Modelling page did not render its drawing: is the tab in front?")
    return [
        {"type": "image", "data": grid[0]["png"], "mimeType": "image/png"},
        _text(json.dumps({"drawn_by_the_app": True, **snap.get("detail", {})}, ensure_ascii=False)),
    ]


def pid_view(
    dataset_id: str, region: list[float] | None = None, annotate: bool = True, view: str | None = None, scope: str = "dc"
) -> list[dict]:
    """The P&ID image, annotated, and the placement state as JSON; for an app-drawn diagram, the page's rendering."""
    r = tuple(region or (0.0, 0.0, 1.0, 1.0))
    if len(r) != 4 or not (0 <= r[0] < r[2] <= 1 and 0 <= r[1] < r[3] <= 1):
        raise ToolError("region must be [x0, y0, x1, y1] with 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1")
    q = _sq(scope)
    if view:  # one view's own picture, its variables in its coordinates
        shapes = get_json(_ds(dataset_id) + f"/pid/views/{view}/construct" + q)["shapes"]
        state = view_state(pid_state(dataset_id, scope), view, shapes)
        png = fetch("GET", _ds(dataset_id) + f"/pid/views/{view}.png" + q)[1]
    else:
        try:
            png = fetch("GET", _ds(dataset_id) + "/pid.png" + q)[1]
        except ToolError:
            return _drawn_pid(dataset_id, scope)
        state = pid_state(dataset_id, scope)
    image = render_pid(png, state, r) if annotate or r != (0.0, 0.0, 1.0, 1.0) else None
    note = {"region": r} if image else {"region": (0, 0, 1, 1), "note": "plain image (annotate=false or Pillow missing)"}
    return [
        {"type": "image", "data": base64.b64encode(image or png).decode(), "mimeType": "image/png"},
        _text(json.dumps({**note, **state}, ensure_ascii=False)),
    ]


def pid_place(dataset_id: str, placements: list[dict], scope: str = "dc") -> list[dict]:
    """Write variables' places into site.json pid_layout, like the Structure and Modelling page's Save."""
    q = _sq(scope)
    columns = set(_variables(dataset_id, scope))
    site = get_json(_ds(dataset_id) + "/site" + q)
    plant = {c["id"]: c for c in get_json(_ds(dataset_id) + "/pid/plant" + q).get("components", [])}
    layout = dict(site.get("pid_layout", {}))
    done = []
    for p in placements:
        v = p.get("variable")
        if v not in columns:
            raise ToolError(f"unknown variable {v!r}: not a data column nor in the structure's saved graph (nothing was saved)")
        old = layout.get(PAPER + v, {})
        tag = str(p.get("tag") or old.get("tag") or "?")
        if p.get("remove"):
            layout[PAPER + v] = {"x": -1, "y": -1, "tag": tag}
            layout[PLANT + v] = {"x": -1, "y": -1, "tag": ""}
            done.append(f"{v}: removed")
            continue
        comp = p.get("component")
        if comp is not None and comp not in plant:
            raise ToolError(f"unknown component {comp!r}; pid_view lists them (nothing was saved)")
        x, y = (
            (p.get("x"), p.get("y"))
            if p.get("x") is not None
            else ((plant[comp]["x"], plant[comp]["y"]) if comp else (None, None))
        )
        if not (isinstance(x, int | float) and isinstance(y, int | float) and 0 <= x <= 1 and 0 <= y <= 1):
            raise ToolError(f"{v}: give x and y in 0..1 or a component (nothing was saved)")
        layout[PAPER + v] = {"x": float(x), "y": float(y), "tag": tag}
        if comp:
            layout[PLANT + v] = {"x": plant[comp]["x"], "y": plant[comp]["y"], "tag": comp}
        done.append(f"{v}: {tag} at ({x:.3f}, {y:.3f})" + (f" on {comp}" if comp else ""))
    site["pid_layout"] = layout
    fetch("PUT", _ds(dataset_id) + "/site" + q, json.dumps(site).encode(), "application/json")
    return [_text(f"Saved in site.json; reload {SCOPES[scope]} (Structure and Modelling) to see them.\n" + "\n".join(done))]


# ---------------------------------------------------------------- docs


def read_docs(page: str | None = None) -> list[dict]:
    """A page of the technical documentation (MyST Markdown), or the list of pages."""
    pages = sorted(str(p.relative_to(DOCS_DIR).with_suffix("")) for p in DOCS_DIR.rglob("*.md") if "_build" not in p.parts)
    if not page:
        return [_text("Pages: " + ", ".join(pages))]
    if page.removesuffix(".md") not in pages:
        raise ToolError(f"no page {page!r}. Pages: {', '.join(pages)}")
    return [_text((DOCS_DIR / (page.removesuffix(".md") + ".md")).read_text())]


# ---------------------------------------------------------------- the agent wiki

WIKI_CONTEXT = 1  # lines shown around a matching line
WIKI_HITS = 3  # matching lines shown per page


def _front_matter(text: str) -> tuple[dict, str]:
    """The page's front matter (title, tags, summary; the simple YAML the wiki uses) and the body after it."""
    meta: dict = {}
    if not text.startswith("---"):
        return meta, text
    head, sep, body = text[3:].partition("\n---")
    if not sep:
        return meta, text
    for line in head.splitlines():
        key, colon, value = line.partition(":")
        if not colon:
            continue
        value = value.strip()
        if value.startswith("[") and value.endswith("]"):
            meta[key.strip()] = [t.strip().strip("'\"") for t in value[1:-1].split(",") if t.strip()]
        else:
            meta[key.strip()] = value.strip("'\"")
    return meta, body.partition("\n")[2]


def _wiki_pages() -> list[tuple[str, dict, str]]:
    """(path, front matter, body) of every wiki page, the path relative to the wiki, sorted."""
    if not WIKI_DIR.is_dir():
        raise ToolError(f"No agent wiki at {WIKI_DIR} yet: use read_docs")
    pages = []
    for f in sorted(WIKI_DIR.rglob("*.md")):
        meta, body = _front_matter(f.read_text(errors="replace"))
        pages.append((f.relative_to(WIKI_DIR).as_posix(), meta, body))
    return pages


def wiki_search(query: str, limit: int = 5) -> list[dict]:
    """The wiki pages that match the query best: a word in the title counts most, then the tags, the summary and the
    body (each occurrence, capped); with the matching lines and a line around each."""
    words = {w for w in re.findall(r"\w+", query.lower()) if len(w) > 1}
    if not words:
        raise ToolError("query needs a word")
    found = []
    for path, meta, body in _wiki_pages():
        title, summary = str(meta.get("title", path)), str(meta.get("summary", ""))
        tags = " ".join(meta.get("tags", [])) if isinstance(meta.get("tags"), list) else str(meta.get("tags", ""))
        low = body.lower()
        score = sum(
            5 * (w in title.lower()) + 3 * (w in tags.lower()) + 2 * (w in summary.lower()) + min(low.count(w), 5) for w in words
        )
        if not score:
            continue
        lines = body.splitlines()
        hits = [i for i, line in enumerate(lines) if any(w in line.lower() for w in words)][:WIKI_HITS]
        matches = [
            {"line": i + 1, "text": "\n".join(lines[max(0, i - WIKI_CONTEXT) : i + WIKI_CONTEXT + 1]).strip()} for i in hits
        ]
        found.append({"title": title, "path": path, "summary": summary, "score": score, "matches": matches})
    found.sort(key=lambda p: (-p["score"], p["path"]))
    result = {"query": query, "results": found[: max(1, int(limit))]}
    if not found:
        result["note"] = "Nothing matched: try other words, or wiki_read for the index"
    return [_text(json.dumps(result, ensure_ascii=False))]


def wiki_read(page: str | None = None) -> list[dict]:
    """One wiki page (its path as wiki_search gives it, .md optional), or the index with the list of pages."""
    pages = [p for p, _, _ in _wiki_pages()]
    name = (page or "index.md").strip().lstrip("/")
    name = name if name.endswith(".md") else name + ".md"
    root = WIKI_DIR.resolve()
    file = (root / name).resolve()
    if not file.is_relative_to(root) or not file.is_file():  # outside the wiki (../): not a page
        raise ToolError(f"no wiki page {page!r}. Pages: {', '.join(pages)}")
    text = file.read_text(errors="replace")
    if not page:
        text += "\n\nPages: " + ", ".join(pages)
    return [_text(text)]


EXTRA_TOOLS: dict[str, tuple[dict, Callable[..., list[dict]]]] = {
    "ui_snapshot": (
        {
            "description": "See the page the user has open, as they see it: images of its drawings and charts (the P&ID "
            "with a 0..1 grid), every control with its name, kind, value, ref, whether it is on (pressed, selected, a "
            "folded panel open) or disabled, and `in` (its card) when the name repeats (use the name, the ref or "
            '"<in> › <name>" with ui_do click / fill), the visible text, `commands` (the page\'s own ui_do gestures) and '
            "`detail`, what the page knows as numbers: dashboard (KPIs of the period with units, overview, mode, view), "
            "modelling (approaches, train plan and estimate, saved models, best model per variable), heat_matching "
            "(KPIs, each part's way, inputs, what-if levers, window and its mean flows), quick_analysis (Site map: "
            "results per year and month), profile: <title> (a profile generator), and on Structure and Modelling every "
            "instrument with x/y as fractions, every causal link with its lags, the construct, the views, the draft. "
            "Call it before acting and again after, to see the result. images=false for text only. On a big page "
            'ask only for what you need with parts, e.g. ["heat_matching"], ["instruments", "links"], '
            '["construct.drawing_texts", "construct.shapes"] (the P&ID\'s texts and recognised symbols with positions: '
            'anchors for placing), ["controls"] or ["images"]; the answer lists the detail keys there are.',
            "inputSchema": {
                "type": "object",
                "properties": {
                    "images": {
                        "type": "boolean",
                        "description": "Include images (default true; with parts: only if parts has images)",
                    },
                    "parts": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": 'Only these: "images", "controls", "text", or keys of the page details '
                        '("instruments", "links", "construct", "construct.shapes", "draft", "layers", ...)',
                    },
                },
            },
            "annotations": {"readOnlyHint": True, "openWorldHint": False},
        },
        ui_snapshot,
    ),
    "pid_view": (
        {
            "description": "See a structure's P&ID drawing (scope: the data center's, the heat distribution's or the "
            "district's) with a labelled 0..1 coordinate grid, the variables already placed (red, with their "
            "ISA tag) and the components read from the drawing (blue ids). Also returns the placement state "
            "as JSON. Use region to zoom in and read small text. A diagram the app draws itself (simulations,"
            " no drawing file) comes from the open Structure and Modelling page: same 0..1 grid, and ui_do "
            "move_instrument places a variable at those fractions. view: the id of one of the P&ID's views "
            "(areas with a picture of their own, listed in the JSON as views) shows that picture instead, "
            "with its own 0..1 grid.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "dataset_id": {"type": "string"},
                    "region": {"type": "array", "items": {"type": "number"}, "description": "[x0, y0, x1, y1], fractions 0..1"},
                    "annotate": {"type": "boolean", "description": "Draw grid and markers (default true)"},
                    "view": {"type": "string", "description": "A view's id: its own picture and grid"},
                    "scope": {
                        "type": "string",
                        "enum": list(SCOPES),
                        "description": "Whose structure: dc (the data center's, default), heat or district",
                    },
                },
                "required": ["dataset_id"],
            },
            "annotations": {"readOnlyHint": True, "openWorldHint": False},
        },
        pid_view,
    ),
    "pid_place": (
        {
            "description": "[writes] Place variables on a structure's P&ID drawing (site.json pid_layout of its scope), as "
            "on its Structure and Modelling page: x, y as fractions of the drawing (as in pid_view), or a "
            "component id from the drawing (its spot, and the variable is linked to it), with an ISA tag (TT "
            "temperature, FT flow, PT pressure, MT humidity, EQ energy, ST speed, ...). remove=true takes a "
            "variable off the drawing. All or nothing.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "dataset_id": {"type": "string"},
                    "placements": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "variable": {"type": "string"},
                                "x": {"type": "number"},
                                "y": {"type": "number"},
                                "component": {"type": "string"},
                                "tag": {"type": "string"},
                                "remove": {"type": "boolean"},
                            },
                            "required": ["variable"],
                        },
                    },
                    "scope": {
                        "type": "string",
                        "enum": list(SCOPES),
                        "description": "Whose structure: dc (the data center's, default), heat or district",
                    },
                },
                "required": ["dataset_id", "placements"],
            },
            "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False},
        },
        pid_place,
    ),
    "read_docs": (
        {
            "description": "Read the app's technical documentation: without page, the list of pages. Useful pages: "
            "concepts/models (equation language), concepts/components, concepts/causal-graph, concepts/heat-distribution.",
            "inputSchema": {"type": "object", "properties": {"page": {"type": "string"}}},
            "annotations": {"readOnlyHint": True, "openWorldHint": False},
        },
        read_docs,
    ),
    "wiki_search": (
        {
            "description": "Search the agent wiki: domain knowledge (data centers, cooling, temperatures, heat recovery, "
            "district heating, modelling, profiles, the example datasets) and where each is in the app and how to do it "
            "there (buttons, ui_do commands, page details). Returns the best pages with title, path, summary and the "
            "matching lines with a line around each; read one whole with wiki_read. Search before a task you have not "
            "done in this app.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Words to look for, e.g. 'heat matching what if'"},
                    "limit": {"type": "integer", "description": "How many pages at most (default 5)"},
                },
                "required": ["query"],
            },
            "annotations": {"readOnlyHint": True, "openWorldHint": False},
        },
        wiki_search,
    ),
    "guide": (
        {
            "description": "Start here: what this app is, how to connect to the page the user has open (Connect AI's "
            "code) and how to work with it, page by page. Call it first, also to check that the server works.",
            "inputSchema": {"type": "object", "properties": {}},
            "annotations": {"readOnlyHint": True, "openWorldHint": False},
        },
        lambda: [_text(INSTRUCTIONS)],
    ),
    "wiki_read": (
        {
            "description": "Read a page of the agent wiki by its path (as wiki_search gives it, e.g. "
            "'recovery/heat-matching.md'); without page, the index: where to start, and the list of pages.",
            "inputSchema": {"type": "object", "properties": {"page": {"type": "string"}}},
            "annotations": {"readOnlyHint": True, "openWorldHint": False},
        },
        wiki_read,
    ),
}


# ---------------------------------------------------------------- JSON-RPC over stdio


class Server:
    """The protocol state: the tool list, built once from the code's OpenAPI schema."""

    def __init__(self, spec: dict | None = None) -> None:
        self.routes = routes_from_openapi(spec or app_openapi())

    def tools(self) -> list[dict]:
        """tools/list: one tool per API route, then the extra tools."""
        return [r.tool for r in self.routes.values()] + [{"name": n, **t} for n, (t, _) in EXTRA_TOOLS.items()]

    def call(self, name: str, args: dict) -> dict:
        """tools/call of a known tool: a failing tool is a result with isError, which the model reads."""
        try:
            content = EXTRA_TOOLS[name][1](**args) if name in EXTRA_TOOLS else call_route(self.routes[name], args)
            return {"content": content, "isError": False}
        except ToolError as e:
            return {"content": [_text(str(e))], "isError": True}
        except TypeError as e:  # wrong arguments for an extra tool
            return {"content": [_text(f"bad arguments: {e}")], "isError": True}
        except (KeyError, ValueError) as e:  # an answer of the app the tool did not expect: report it, keep serving
            return {"content": [_text(f"unexpected answer from the app: {e!r}")], "isError": True}

    def handle(self, message: dict) -> dict | None:
        """The reply to one JSON-RPC message (None for a notification)."""
        if "id" not in message:
            return None
        method, params = message.get("method"), message.get("params") or {}
        reply: dict[str, Any] = {"jsonrpc": "2.0", "id": message["id"]}
        if method == "initialize":
            asked = params.get("protocolVersion")
            reply["result"] = {
                "protocolVersion": asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0],
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "intelligent-digital-twin", "version": "1.3.0"},
                "instructions": INSTRUCTIONS,
            }
        elif method == "ping":
            reply["result"] = {}
        elif method == "tools/list":
            reply["result"] = {"tools": self.tools()}
        elif method == "tools/call" and isinstance(params.get("name"), str):
            # checked here, not by catching KeyError around the call: a KeyError inside a tool is not an unknown tool
            if params["name"] in EXTRA_TOOLS or params["name"] in self.routes:
                reply["result"] = self.call(params["name"], params.get("arguments") or {})
            else:
                reply["error"] = {"code": -32602, "message": f"unknown tool {params['name']!r}"}
        else:
            reply["error"] = {"code": -32601, "message": f"method not found: {method}"}
        return reply


def main() -> None:
    """Serve on stdin/stdout until the client closes stdin; nothing else may write to stdout."""
    server = Server()
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
        except ValueError:
            print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}), flush=True)
            continue
        reply = server.handle(message) if isinstance(message, dict) else None
        if reply is not None:
            print(json.dumps(reply, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
