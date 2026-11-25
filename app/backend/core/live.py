"""The live link between the open page and an assistant (MCP): change events, the page's screen state, UI commands.

One app process serves the page and the assistant, so this is an in-memory hub: every write to the API is announced
to the open pages (Server-Sent Events), which reload what changed, unless the write came from that page itself
(its `X-Client-Id`). The page reports what the user is looking at. The assistant asks the page to do something or
to describe itself (`request`): the request goes to the page the user used last, which carries it out with the same
code as its buttons and answers; the assistant waits for that answer. Nothing here is stored on disk.

The assistant works the page only once the user lets it: the page's Connect AI shows a one-time code
(`new_code`; asked for only with the secret its event stream gave it in its first message, so a process cannot call
itself a page by an id alone), the user gives it to the agent, the agent exchanges it for a token (`pair`) and sends
that token with its page tools (ui_state, ui_snapshot, ui_do: `authorized`). One agent at a time; Disconnect, or a
restart, ends it.
"""

import hmac
import json
import queue
import re
import secrets
import threading
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator

# POSTs that only compute or read (nothing is written): no change event; the MCP server marks them as reads.
# The same list as web/src/api/http.ts COMPUTE_ONLY (also used by e2e/readonly.ts), plus the P&ID readers and the OS
# folder dialog; live/pair connects the agent (Connect AI), no file is written. Evaluate with `store` also keeps its
# answer beside the models (models/evaluation.json, a cache of what was computed): not announced either.
COMPUTE_ONLY = re.compile(
    r"/(live/pair|models/evaluate|models/\{name\}/simulate|equations/check|graph/discover-lags|models/estimate|models/compare|foundation/demand|check|simulate|fit|extract|preview|pick)$"
)

# What the assistant can ask the page to do, and the arguments each needs. The generic ones (click, fill) work on
# every control of every page by its name, as ui_snapshot lists it; the others are gestures on drawings and maps.
COMMANDS: dict[str, set[str]] = {
    "click": {"control"},  # press a button, link, tab, radio or checkbox (its name or ref from ui_snapshot)
    "fill": {"control", "value"},  # type into a field, set a slider, choose a menu option
    "navigate": {"route"},  # "dc/pid", "district/map", ... (web/src/app/routes.ts)
    "open_dataset": {"dataset"},  # a data center of the current data folder
    "message": {"text"},  # a short note shown on the page
    "scroll": {"to"},  # top, bottom, or a section by its name: a part loaded once near (Modelling under a structure)
    "select_variable": {"variable"},  # Physical structure: select (highlight) a variable
    "click_instrument": {"variable"},  # Physical structure: click it (select it, or link to it in link mode)
    "add_variable": {"variable"},  # Physical structure: "+ Variable" (a data column, or a new name without data)
    "delete_variable": {"variable"},  # Physical structure: Delete variable (not delivered data; a prepared one in silver too)
    "move_instrument": {"variable", "x", "y"},  # Physical structure: drag it to x, y (0..1 of the P&ID picture)
    "place_instruments": {"placements"},  # Physical structure: many at once, [{variable, x, y | view + component}]
    "save_draft": set(),  # Physical structure: keep the unsaved work in the browser now (the graph file: Save)
    "discard_draft": set(),  # Physical structure: drop the unsaved work and its draft, back to the last save
    "select_link": {"from", "to"},  # Physical structure: click a causal link
    "set_links": {"links"},  # Physical structure: add, change or remove many, [{from, to, lags?}, ...] ([] removes)
    "select_variables": {"variables"},  # Physical structure: select several (the user sees them marked); [] clears
    "group_variables": {"variables"},  # Physical structure: mark several as one variable (mean, ...); name?, method?
    "ungroup_variable": {"variable"},  # Physical structure: drop a group's mark, its members are shown again
    "open_view": {"view"},  # Physical structure: zoom onto one view of the P&ID (an area with a picture of its own)
    "add_view": {"name", "x", "y", "w", "h"},  # Physical structure: mark an area as a view (fractions; show?; written at once)
    "remove_view": {"view"},  # Physical structure: remove a view (its picture is backed up)
    "edit_view": {"view"},  # Physical structure: name?, x?, y?, w?, h?, show?; what is in it moves with it (written at once)
    "close_view": set(),  # Physical structure: back to the whole P&ID
    "annotate_variables": {"annotations"},  # Physical structure: [{variable, kind?, confidence?, note?}, ...]
    # Physical structure, the digital construct (shapes over the P&ID; x, y, w, h, points in 0..1 of the drawing)
    "set_layers": set(),  # picture / construct / variables: true or false; views: own | auto | box | sheet | picture
    "add_shape": {"kind"},  # rect | circle (x, y, w?, h?), line (points), text (x, y); label?, role?
    "edit_shape": {"shape"},  # any of x, y, w, h, points, label, role, props (values; null removes one)
    "delete_shape": {"shape"},
    "select_shape": {"shape"},
    "match_variable": {"shape", "variable"},  # put the variable (added if new) on the shape
    "map_focus": set(),  # Site map: lat + lon (+ zoom), or example (a data center's name on the map)
    "map_click": {"lat", "lon"},  # Site map: click there (picks a building, adds a sink or an area corner by mode)
    "pick_atlas_building": {"lat", "lon"},  # Site map: click the Wärmeatlas building at that point
    "set_window": set(),  # Heat Matching: the year picker's band, number (1..count, as shown) or date (YYYY-MM-DD)
    "set_part_way": {"part", "way"},  # Heat Matching: dc | heat | district runs its model | calculation
    "set_profile_shape": set(),  # a Modelling's profile generator: profile?, part?, day (24), weekday (7), month (12)
}
HEARTBEAT_S = 5.0  # a closed tab is noticed at its next ping: keep that short
POLL_S = 0.1  # how often an open stream looks for its events on the event loop (`astream`): the delay of an event
QUEUE_MAX = 200
REQUEST_TIMEOUT_S = 20.0
PAIR_CODE_S = 600.0  # how long the code Connect AI shows can be used
PAIR_TRIES = 5  # wrong codes before the one shown is dropped (a million codes: guessing gets 5 in 10**6)


class NoPage(Exception):
    """No page of the app is open, or it did not answer in time."""


def check_command(action: str, args: dict) -> None:
    """ValueError for an unknown action or a missing argument."""
    if action not in COMMANDS:
        raise ValueError(f"Unknown action '{action}': one of {', '.join(sorted(COMMANDS))}")
    missing = sorted(COMMANDS[action] - set(args))
    if missing:
        raise ValueError(f"'{action}' needs {', '.join(missing)}")
    if action == "place_instruments" and not (isinstance(args["placements"], list) and args["placements"]):
        raise ValueError("'place_instruments' needs placements: a list of {variable, x, y}")
    if action == "set_links" and not (isinstance(args["links"], list) and args["links"]):
        raise ValueError("'set_links' needs links: a list of {from, to, lags?}")
    if action in ("select_variables", "group_variables") and not isinstance(args["variables"], list):
        raise ValueError(f"'{action}' needs variables: a list of variable names")
    if action == "annotate_variables" and not (isinstance(args["annotations"], list) and args["annotations"]):
        raise ValueError("'annotate_variables' needs annotations: a list of {variable, kind?, confidence?, note?}")
    if action == "map_focus" and "example" not in args and not {"lat", "lon"} <= set(args):
        raise ValueError("'map_focus' needs lat and lon, or example")
    if action == "set_window" and not {"number", "date"} & set(args):
        raise ValueError("'set_window' needs number (1..count, as the page shows it) or date (YYYY-MM-DD)")
    if action == "set_profile_shape" and not {"day", "weekday", "month"} & set(args):
        raise ValueError("'set_profile_shape' needs day (24 values), weekday (7) or month (12)")


class Hub:
    """Subscribers (open pages) and the last screen state a page reported."""

    def __init__(self) -> None:
        self._subscribers: list[tuple[str | None, queue.Queue]] = []  # (page id, its queue)
        self._lock = threading.Lock()
        self.ui: dict | None = None
        self.ui_at = 0.0
        self._reports: dict[str | None, dict] = {}  # every open tab's last report, to hand over when one closes
        self._answers: dict[str, tuple[threading.Event, list, str | None]] = {}  # request id -> wait, answer, page
        self._code: tuple[str, float] | None = None  # the code Connect AI shows, and when it runs out
        self._wrong = 0  # wrong tries at the code shown
        self._token: str | None = None  # the connected agent's
        self._secrets: dict[str, str | None] = {}  # each open stream's secret -> its page id

    @property
    def agent(self) -> bool:
        """Is an agent connected."""
        return self._token is not None

    def new_code(self, client: str | None, secret: str | None) -> str:
        """A new six-digit code for the agent, shown by the open page `client`: only a page that listens and sends the
        secret its stream gave it (`stream`'s first message) gets one."""
        with self._lock:
            known = secret is not None and client is not None and self._secrets.get(secret) == client
        if not known:
            raise ValueError("Only an open page of the app can show a code")
        code = f"{secrets.randbelow(10**6):06d}"
        self._code, self._wrong = (code, time.time() + PAIR_CODE_S), 0
        return code

    def pair(self, code: str) -> str:
        """The agent's token for the code the page shows (used up; a new pairing replaces an earlier agent). After
        PAIR_TRIES wrong codes the one shown is dropped: the user asks for a new one."""
        given = "".join(ch for ch in str(code) if ch.isdigit())
        with self._lock:
            shown = self._code
            if shown is None or time.time() > shown[1] or not hmac.compare_digest(given, shown[0]):
                self._wrong += shown is not None
                if self._wrong >= PAIR_TRIES:
                    self._code = None
                raise ValueError("Wrong or expired code: ask the user to press Connect AI in the app and tell you the code")
            self._code, self._token = None, secrets.token_urlsafe(24)
        self.publish({"type": "agent", "connected": True})
        return self._token

    def unpair(self) -> None:
        """Disconnect the agent (and drop a code not used yet)."""
        self._code, self._token = None, None
        self.publish({"type": "agent", "connected": False})

    def authorized(self, token: str | None) -> bool:
        """Is `token` the connected agent's."""
        return bool(token and self._token and hmac.compare_digest(token, self._token))

    @property
    def pages(self) -> int:
        """How many pages are listening."""
        with self._lock:
            return len(self._subscribers)

    def clients(self) -> list[str | None]:
        """The ids of the pages listening now."""
        with self._lock:
            return [c for c, _ in self._subscribers]

    def publish(self, event: dict) -> int:
        """Send an event to every open page, or a request only to its target page (a page that lags too far behind
        misses it); how many got it."""
        with self._lock:
            subscribers = [q for c, q in self._subscribers if not event.get("target") or c == event["target"]]
        sent = 0
        for q in subscribers:
            try:
                q.put_nowait(event)
                sent += 1
            except queue.Full:
                pass
        return sent

    def report(self, state: dict) -> bool:
        """Keep the screen of the tab the user works in: a tab in the background (not focused) does not replace a
        focused one, so it cannot take the assistant's requests (it may report while it refreshes). A closed tab
        keeps nothing: the next open one that reports takes over. Only a listening page's report counts (False
        otherwise), so the reports kept are at most the open streams."""
        if state.get("client") is None or state.get("client") not in self.clients():
            return False
        self._reports[state.get("client")] = state
        same = self.ui is not None and self.ui.get("client") == state.get("client")
        closed = self.ui is not None and self.ui.get("client") not in self.clients()
        if self.ui is None or same or closed or state.get("focused") or not self.ui.get("focused"):
            self.ui, self.ui_at = state, time.time()
        return True

    def request(self, action: str, args: dict, timeout: float = REQUEST_TIMEOUT_S) -> dict:
        """Ask the page the user used last to do `action` and wait for its answer; NoPage if none answers."""
        rid = uuid.uuid4().hex
        done, box = threading.Event(), []
        target = (self.ui or {}).get("client")
        open_pages = self.clients()
        if target not in open_pages:  # the tab the user worked in is closed: the only open one, if there is one
            target = open_pages[0] if len(open_pages) == 1 else None
            if target is None:
                raise NoPage(
                    "No page of the app is open: ask the user to open it in the browser"
                    if not open_pages
                    else "The tab the user worked in is closed: ask them to click into the app's tab they want to use"
                )
        self._answers[rid] = (done, box, target)
        try:
            if not self.publish({"type": "request", "id": rid, "target": target, "action": action, "args": args}):
                raise NoPage("No page of the app is open: ask the user to open it in the browser")
            if not done.wait(timeout):
                raise NoPage(f"The page did not answer within {timeout:.0f} s (is the tab open and in front?)")
            return box[0]
        finally:
            self._answers.pop(rid, None)

    def answer(self, rid: str, payload: dict, client: str | None) -> bool:
        """The answer of the page `client` to a request sent to it; False when nobody waits for it (late, unknown, or
        from another page)."""
        waiting = self._answers.get(rid)
        if waiting is None or waiting[2] != client:
            return False
        waiting[1].append(payload)
        waiting[0].set()
        return True

    def _subscribe(self, client: str | None) -> tuple[tuple[str | None, queue.Queue], str]:
        """A new listening page: its queue and the secret its stream gives it (`new_code`)."""
        entry, secret = (client, queue.Queue(maxsize=QUEUE_MAX)), secrets.token_urlsafe(24)
        with self._lock:
            self._subscribers.append(entry)
            self._secrets[secret] = client
        return entry, secret

    def _unsubscribe(self, entry: tuple[str | None, queue.Queue], secret: str) -> None:
        with self._lock:
            self._subscribers.remove(entry)
            self._secrets.pop(secret, None)
        self._closed(entry[0])

    @staticmethod
    def _hello(secret: str) -> str:
        return f"data: {json.dumps({'type': 'hello', 'secret': secret})}\n\n"

    def stream(self, max_events: int | None = None, heartbeat: float = HEARTBEAT_S, client: str | None = None) -> Iterator[str]:
        """Server-Sent Events for one page (`client`: its id): first {type: hello, secret} (the page's proof that it
        listens, for `new_code`), then its events as `data:` lines, a comment as heartbeat. Blocks while it waits:
        for a thread of its own (the tests); the app serves `astream`."""
        entry, secret = self._subscribe(client)
        try:
            yield self._hello(secret)
            sent = 0
            while max_events is None or sent < max_events:
                try:
                    yield f"data: {json.dumps(entry[1].get(timeout=heartbeat))}\n\n"
                    sent += 1
                except queue.Empty:
                    yield ": ping\n\n"
        finally:
            self._unsubscribe(entry, secret)

    async def astream(
        self,
        gone: Callable[[], Awaitable[bool]],
        max_events: int | None = None,
        heartbeat: float = HEARTBEAT_S,
        client: str | None = None,
    ) -> AsyncIterator[str]:
        """`stream` on the event loop, until it ends or `gone()` (the page closed): it looks for its events every
        POLL_S instead of holding a worker thread while it waits (with one each, 40 open tabs took every thread and
        a plain request waited seconds)."""
        import anyio

        # ponytail: polling every POLL_S per open tab (cheap for tens of tabs); an asyncio event set by publish
        # through call_soon_threadsafe if there are ever hundreds
        entry, secret = self._subscribe(client)
        try:
            yield self._hello(secret)
            sent, quiet = 0, 0.0
            while max_events is None or sent < max_events:
                try:
                    event = entry[1].get_nowait()
                except queue.Empty:
                    if await gone():
                        break
                    await anyio.sleep(POLL_S)
                    quiet += POLL_S
                    if quiet >= heartbeat:
                        quiet = 0.0
                        yield ": ping\n\n"
                    continue
                quiet, sent = 0.0, sent + 1
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            self._unsubscribe(entry, secret)

    def _closed(self, client: str | None) -> None:
        """A tab closed: forget it; if it was the one in front, the open tab that reported last (a focused one
        first) takes over at once, not only when it reports again."""
        if client in self.clients():  # the same tab still has another stream (a reconnect)
            return
        self._reports.pop(client, None)
        if self.ui is None or self.ui.get("client") != client:
            return
        left = [r for c, r in self._reports.items() if c in self.clients()]
        left.sort(key=lambda r: bool(r.get("focused")))  # stable: among equals the later report stays last
        self.ui, self.ui_at = (left[-1], time.time()) if left else (None, 0.0)
