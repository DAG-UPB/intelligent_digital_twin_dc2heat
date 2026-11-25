"""Live: the event stream of the open page, the screen state it reports, and the assistant's commands to it.

`ui_state` and `ui_do` are the assistant's tools (MCP), usable once the agent is connected with the code the
page's Connect AI shows (`connect_app`); the stream, the report and the code are the page's and stay out of the API
reference. See core/live.py.
"""

import sys
import time
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from ..core import live
from ..schemas import PairCodeRequest, PairRequest, PairResult, UiCommand, UiCommandResult, UiState, UiStateResponse

router = APIRouter(prefix="/api/live", tags=["live"])


def _hub(request: Request) -> live.Hub:
    return request.app.state.live


def _agent(request: Request) -> live.Hub:
    """The hub, for a connected agent only (its X-Agent-Token): the page is the user's until they connect one."""
    hub = _hub(request)
    if not hub.authorized(request.headers.get("x-agent-token")):
        raise HTTPException(
            403,
            "Not connected to the app: ask the user to press Connect AI in the app's top bar and tell you the code,"
            " then call connect_app with it",
        )
    return hub


@router.get("/events", include_in_schema=False)
async def events(request: Request, max_events: Annotated[int | None, Query(ge=0)] = None, client: str | None = None):
    """Server-Sent Events for the page `client`: a `changed` event after every write, and the assistant's requests.
    On the event loop (`Hub.astream`): an open tab holds no worker thread, and leaves the hub once it closes."""
    return StreamingResponse(
        _hub(request).astream(request.is_disconnected, max_events, client=client),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


@router.put("/ui", include_in_schema=False)
def report_ui(state: UiState, request: Request):
    """The page reports what the user is looking at (replaces the last report); ok false from a page that does not
    listen (no event stream open under its id)."""
    return {"ok": _hub(request).report(state.model_dump())}


@router.get("/connect", include_in_schema=False)
def connection_info(request: Request):
    """How to start the MCP server on this computer, for the assistant page (copy into an MCP client's settings)."""
    app_dir = request.app.state.local_dir.parent
    return {
        "command": sys.executable,
        "args": ["-m", "backend.mcp_server"],
        "cwd": str(app_dir),
        "url": str(request.base_url).rstrip("/"),
        "pages": _hub(request).pages,
        "agent": _hub(request).agent,
    }


@router.post("/pair-code", include_in_schema=False)
def pair_code(request: Request, body: PairCodeRequest | None = None):
    """Connect AI: a new one-time code for the agent, shown by the open page that asks (its X-Client-Id, and the
    secret its event stream gave it)."""
    try:
        code = _hub(request).new_code(request.headers.get("x-client-id"), body.secret if body else None)
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from exc
    return {"code": code, "seconds": live.PAIR_CODE_S}


@router.post("/pair", response_model=PairResult, summary="Connect to the user's open app with their code")
def connect_app(body: PairRequest, request: Request):
    """Connect this agent to the app the user has open, with the six-digit code its Connect AI button shows.

    Ask the user for the code (they press Connect AI in the top bar); it works once, for 10 minutes. Until then
    ui_state, ui_snapshot and ui_do are refused. A new connection replaces an earlier agent's.
    """
    try:
        return PairResult(connected=True, token=_hub(request).pair(body.code))
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from exc


@router.delete("/pair", include_in_schema=False)
def disconnect_agent(request: Request):
    """Disconnect: the agent's page tools are refused again."""
    _hub(request).unpair()
    return {"connected": False}


@router.get("/ui-state", response_model=UiStateResponse, summary="What the user sees in the app")
def ui_state(request: Request):
    """The page, data center and selection the user has open right now, as the page last reported it.

    `state` is null when no page is open. Use it before ui_do, and after a change to check what the user sees.
    """
    hub = _agent(request)
    return UiStateResponse(state=hub.ui, seconds_ago=round(time.time() - hub.ui_at, 1) if hub.ui else None, pages=hub.pages)


@router.post("/command", response_model=UiCommandResult, summary="Do something in the user's open app")
def ui_do(body: UiCommand, request: Request):
    """Act in the page the user has open, exactly as a click or an entry would; waits for the page to answer.

    Generic, on every page: click {control} presses a button, link, tab, radio, checkbox, switch or a folded panel's
    title ("More options", "Settings", "What if…": its `on` in ui_snapshot says open); fill {control, value} types
    into a field, sets a slider or chooses a menu option (by its text or its value). The control is its name as
    ui_snapshot lists it, its ref (c12), or "<in> › <name>" for a name the page has more than once (the control's
    `in`, e.g. "Data center › More options"). A control inside a closed panel is not there: open the panel first.
    navigate {route}: home/start, dc/dashboard | heat/dashboard | district/dashboard (Visualization and Scenarios:
    Historical or Scenarios mode), dc/pid | heat/structure | district/structure (Structure and Modelling: the P&ID,
    and Modelling under it), twin/map (Site Map), twin/matching (Heat Matching),
    twin/planning (Operation), help/about | help/guide | help/assistant. open_dataset {dataset}: the data center of
    the page on screen (each page has its own; the page reloads). message {text}: a note to the user. scroll {to:
    top | bottom | a section's name, e.g. "Modelling"}: some parts load only once scrolled near ("… below: scroll on").

    Page gestures (ui_snapshot `commands` lists the ones the open page has):
    Heat Matching: set_window {number | date} (the year picker's band: window 1..count as the page shows it, or the
    one holding date YYYY-MM-DD), set_part_way {part: dc | heat | district, way: model | calculation} (refused with
    the reason when that way cannot run). Profiles (a Modelling's profile generator): set_profile_shape {profile?,
    part?, day?: 24 values, weekday?: 7, month?: 12} draws what a drag draws (profile: its title, needed when several
    are open). Site map: map_focus {lat, lon, zoom?} or {example}, map_click {lat, lon} (does what the map's mode
    says: pick the building, add a sink, add an area corner), pick_atlas_building {lat, lon}.
    Structure and Modelling (the P&ID): add_variable {variable} ("+ Variable": a data column, or a new name drawn as
    "no data"), delete_variable {variable} (one without data, or a prepared one with its column in silver; never
    delivered data), select_variable {variable}, click_instrument {variable} (select it, or the next end of a link in
    link mode), move_instrument {variable, x, y, view?} (fractions of the P&ID picture), place_instruments
    {placements: [{variable, x, y, view?} | {variable, view, component: "TT1"}, ...]} (many in one call, all checked
    first; with view: fractions of that view's own picture, or the label of a component or instrument of the view's
    construct), select_link {from, to}, set_links {links: [{from, to, lags?}, ...]} (lags are steps back, default [1],
    [] removes the link, from = to is the variable's own past; nothing changes if one is wrong), annotate_variables
    {annotations: [{variable, kind?, confidence?, note?}, ...]} (kind sensor | setpoint | actuator | meter | it_load |
    weather | time | calculated | status; confidence sure | likely | unsure; null removes one), select_variables
    {variables} ([] clears), group_variables {variables, name?, method?: mean | sum | min | max, hide_members?, x?, y?}
    (ONLY A MARK: no values are computed), ungroup_variable {variable}; the digital construct (shapes over the P&ID):
    add_shape {kind: rect | circle | text, x, y, w?, h?, label?, role?} or {kind: line, points: [[x, y], ...]},
    edit_shape {shape, x?, y?, w?, h?, points?, label?, role?, props?}, delete_shape {shape}, select_shape {shape},
    match_variable {shape, variable}, set_layers {picture?, construct?, variables?, views?: own | auto | box | sheet |
    picture}; views (areas with a picture of their own): open_view {view}, close_view, add_view {name, x, y, w, h,
    show?} and edit_view {view, name?, x?, y?, w?, h?, show?} and remove_view {view} (these three are WRITTEN AT ONCE
    to site.json: ask the user first); save_draft / discard_draft (the unsaved work kept in the browser, or dropped
    back to the last save). The page logs every change (ui_snapshot changes, by "AI" or "you").
    Buttons such as Save, Train, Save project or Use as P&ID write files: ask the user first unless they asked.
    """
    try:
        hub = _agent(request)
        live.check_command(body.action, body.args)
        answer = hub.request(body.action, body.args)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except live.NoPage as exc:
        raise HTTPException(409, str(exc)) from exc
    if not answer.get("ok"):
        raise HTTPException(422, answer.get("error") or "The page could not do that")
    return UiCommandResult(did=answer.get("did", body.action), route=answer.get("route"), details=answer.get("details", {}))


@router.get("/snapshot", include_in_schema=False)
def ui_snapshot(request: Request, images: bool = True):
    """The open page described by itself: controls, visible text, page details and images of its drawings and
    charts (PNG, base64). The MCP server's ui_snapshot tool turns the images into image content."""
    hub = _agent(request)
    try:
        answer = hub.request("snapshot", {"images": images})
    except live.NoPage as exc:
        raise HTTPException(409, str(exc)) from exc
    if not answer.get("ok"):
        raise HTTPException(422, answer.get("error") or "The page could not describe itself")
    return answer.get("snapshot", {})


@router.put("/answer/{request_id}", include_in_schema=False)
def answer(request_id: str, payload: dict, request: Request):
    """The page's answer to a request (ui_do, ui_snapshot): taken only from the page it was sent to (X-Client-Id)."""
    return {"taken": _hub(request).answer(request_id, payload, request.headers.get("x-client-id"))}
