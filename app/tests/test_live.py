"""Live link: writes are announced to the open pages (not compute-only calls, not the page's own reports), the page's
screen state is readable, and commands reach the listening pages."""

import json
import threading

import pytest
from conftest import connect_agent, page_secret
from fastapi.testclient import TestClient

from backend.core import live
from backend.core.live import COMPUTE_ONLY, Hub, NoPage


def _record(client: TestClient) -> list[dict]:
    events: list[dict] = []
    client.app.state.live.publish = lambda e: events.append(e) or 1  # type: ignore[attr-defined]
    return events


def test_writes_are_announced_with_the_writing_page(client: TestClient, api: str) -> None:
    events = _record(client)
    client.put(f"{api}/site", json={}, headers={"X-Client-Id": "page-1"})
    client.put(f"{api}/site", json={})  # e.g. the assistant over MCP: no client id
    assert events == [
        {"type": "changed", "method": "PUT", "path": f"{api}/site", "client": "page-1"},
        {"type": "changed", "method": "PUT", "path": f"{api}/site", "client": None},
    ]


def test_reads_compute_only_calls_failures_and_live_reports_are_not_announced(client: TestClient, api: str) -> None:
    events = _record(client)
    client.get(f"{api}/site")
    client.post(f"{api}/equations/check", json={"target": "y", "expr": "a*y[t-1]"})
    client.put(f"{api}/site", json={"sinks": [{"id": "a"}]})  # 422
    client.put("/api/live/ui", json={"route": "dc/pid", "dataset": "sim_x"})
    assert events == []


def test_the_compute_only_list_matches_the_e2e_one() -> None:
    # web/src/api/http.ts COMPUTE_ONLY (also e2e/readonly.ts): these POSTs write nothing (no change event, a read tool)
    for path in ("models/compare", "foundation/demand", "models/evaluate", "models/m/simulate", "prepared/preview"):
        assert COMPUTE_ONLY.search(f"/api/datasets/d/{path}"), path
    assert not COMPUTE_ONLY.search("/api/datasets/d/models/train")


def test_the_page_reports_its_screen_and_the_assistant_reads_it(client: TestClient) -> None:
    connect_agent(client)
    assert client.get("/api/live/ui-state").json() == {"state": None, "seconds_ago": None, "pages": 0}
    page = client.app.state.live.stream(heartbeat=0.01, client="p1")  # a report counts only from a listening page
    next(page)
    report = {
        "client": "p1",
        "focused": True,
        "route": "dc/pid",
        "dataset": "sim_x",
        "data_version": "local",
        "page": {"selected_variable": "y"},
    }
    client.put("/api/live/ui", json=report)
    got = client.get("/api/live/ui-state").json()
    assert got["state"] == report and got["seconds_ago"] < 5
    page.close()


def test_reports_and_answers_count_only_from_the_listening_page_asked(client: TestClient) -> None:
    # B-S3: anyone could report a screen (kept for good, the store unbounded) or answer the page's requests
    connect_agent(client)
    hub = client.app.state.live
    for i in range(3):
        r = client.put("/api/live/ui", json={"client": f"nobody-{i}", "route": "dc/pid", "dataset": "sim_x"})
        assert r.json() == {"ok": False}
    assert hub.ui is None and hub._reports == {}
    page = hub.stream(heartbeat=0.01, client="p1")
    next(page)
    assert client.put("/api/live/ui", json={"client": "p1", "route": "dc/pid", "dataset": "sim_x"}).json() == {"ok": True}
    got: list = []
    asking = threading.Thread(target=lambda: got.append(hub.request("snapshot", {}, timeout=2)))
    asking.start()
    rid = json.loads(next(page).removeprefix("data: "))["id"]
    assert client.put(f"/api/live/answer/{rid}", json={"ok": True, "did": "x"}, headers={"X-Client-Id": "p2"}).json() == {
        "taken": False
    }
    assert client.put(f"/api/live/answer/{rid}", json={"ok": True, "did": "p1"}, headers={"X-Client-Id": "p1"}).json() == {
        "taken": True
    }
    asking.join(3)
    assert got == [{"ok": True, "did": "p1"}]
    page.close()
    assert hub._reports == {}  # a closed page's report goes with it


def test_the_stream_delivers_events_and_commands_to_every_page() -> None:
    hub = Hub()
    a, b = hub.stream(max_events=1, heartbeat=0.05), hub.stream(max_events=1, heartbeat=0.05)
    assert next(a).startswith('data: {"type": "hello"') and next(b).startswith('data: {"type": "hello"')  # its secret
    assert hub.pages == 2
    assert hub.publish({"type": "command", "action": "message", "args": {"text": "hi"}}) == 2
    assert next(a) == next(b) == 'data: {"type": "command", "action": "message", "args": {"text": "hi"}}\n\n'
    assert list(a) == [] and hub.pages == 1  # done after max_events: unsubscribed
    b.close()
    assert hub.pages == 0
    c = hub.stream(heartbeat=0.01)
    next(c)
    assert next(c) == ": ping\n\n"  # nothing to send: a heartbeat keeps the connection open
    c.close()


def _page_answering(hub, answer: dict, seen: list, client_id: str = "p1") -> threading.Thread:
    """A listening page that answers the next request with `answer` (and records the request)."""
    page = hub.stream(max_events=1, heartbeat=0.01, client=client_id)  # frequent pings: the page must skip them
    next(page)

    def run() -> None:
        for line in page:
            if not line.startswith("data: "):  # a heartbeat comment, not an event
                continue
            event = json.loads(line.removeprefix("data: "))
            seen.append(event)
            hub.answer(event["id"], answer, client_id)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread


def test_a_request_goes_to_the_last_page_and_returns_its_answer(client: TestClient) -> None:
    connect_agent(client)
    hub = client.app.state.live
    client.put("/api/live/ui", json={"client": "p1", "route": "dc/pid", "dataset": "sim_x"})
    seen: list = []
    _page_answering(hub, {"ok": True, "did": "pressed Add link", "route": "dc/pid", "details": {"control": "Add link"}}, seen)
    r = client.post("/api/live/command", json={"action": "click", "args": {"control": "Add link"}})
    assert r.status_code == 200
    assert r.json() == {"did": "pressed Add link", "route": "dc/pid", "details": {"control": "Add link"}}
    assert seen[0]["target"] == "p1" and seen[0]["action"] == "click" and seen[0]["args"] == {"control": "Add link"}


def test_the_page_refusing_is_an_error_for_the_assistant(client: TestClient) -> None:
    connect_agent(client)
    _page_answering(client.app.state.live, {"ok": False, "error": "No control named 'Fly'"}, [])
    r = client.post("/api/live/command", json={"action": "click", "args": {"control": "Fly"}})
    assert r.status_code == 422 and "No control named" in r.json()["detail"]


def test_snapshot_returns_what_the_page_describes(client: TestClient) -> None:
    connect_agent(client)
    snap = {"route": "dc/pid", "controls": [{"name": "Add link", "kind": "button"}], "images": []}
    _page_answering(client.app.state.live, {"ok": True, "snapshot": snap}, [])
    assert client.get("/api/live/snapshot").json() == snap


def test_the_page_tools_wait_for_the_users_code(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Connect AI: without the code the page shows, an agent cannot read or work the page; the code works once, for
    a while, and only an open page can ask for one; Disconnect ends it."""
    hub = client.app.state.live
    for method, path in (("GET", "/api/live/ui-state"), ("GET", "/api/live/snapshot"), ("POST", "/api/live/command")):
        r = client.request(method, path, json={"action": "message", "args": {"text": "hi"}} if method == "POST" else None)
        assert r.status_code == 403 and "Connect AI" in r.json()["detail"]
    assert client.post("/api/live/pair-code").status_code == 403  # no open page asked
    assert client.post("/api/live/pair", json={"code": "123456"}).status_code == 403  # no code shown yet
    events = _record(client)
    page = hub.stream(heartbeat=0.01, client="p1")
    secret = page_secret(next(page))
    code = client.post("/api/live/pair-code", headers={"X-Client-Id": "p1"}, json={"secret": secret}).json()["code"]
    assert len(code) == 6 and code.isdigit()
    wrong = str((int(code) + 1) % 10**6).zfill(6)
    assert client.post("/api/live/pair", json={"code": wrong}).status_code == 403
    token = client.post("/api/live/pair", json={"code": f"{code[:3]} {code[3:]}"}).json()["token"]  # spaces as shown
    assert events[-1] == {"type": "agent", "connected": True}
    assert client.post("/api/live/pair", json={"code": code}).status_code == 403  # used up
    assert client.get("/api/live/ui-state", headers={"X-Agent-Token": token}).status_code == 200
    assert client.get("/api/live/ui-state", headers={"X-Agent-Token": "guess"}).status_code == 403
    assert client.get("/api/live/connect").json()["agent"] is True
    client.delete("/api/live/pair")
    assert events[-1] == {"type": "agent", "connected": False}
    assert client.get("/api/live/ui-state", headers={"X-Agent-Token": token}).status_code == 403
    # a code runs out
    code = hub.new_code("p1", secret)
    monkeypatch.setattr(live.time, "time", lambda: 1e12)
    assert client.post("/api/live/pair", json={"code": code}).status_code == 403
    page.close()


def test_only_a_listening_page_with_its_streams_secret_gets_a_code(client: TestClient) -> None:
    # B-S1: opening the event stream under any id made a process a "page" that could ask for the code itself
    hub = client.app.state.live
    page, other = hub.stream(heartbeat=0.01, client="p1"), hub.stream(heartbeat=0.01, client="p2")
    secret, theirs = page_secret(next(page)), page_secret(next(other))
    assert secret != theirs

    def ask(body: dict | None) -> int:
        return client.post("/api/live/pair-code", headers={"X-Client-Id": "p1"}, json=body).status_code

    assert ask(None) == ask({}) == ask({"secret": "guess"}) == ask({"secret": theirs}) == 403
    assert ask({"secret": secret}) == 200
    page.close()
    assert ask({"secret": secret}) == 403  # its stream closed: the secret with it
    other.close()


def test_a_code_is_dropped_after_five_wrong_tries(client: TestClient) -> None:
    # B-S2: 2,999 wrong tries in 3 s, then the right one worked
    hub = client.app.state.live
    page = hub.stream(heartbeat=0.01, client="p1")
    code = hub.new_code("p1", page_secret(next(page)))
    wrong = str((int(code) + 1) % 10**6).zfill(6)
    for _ in range(live.PAIR_TRIES):
        assert client.post("/api/live/pair", json={"code": wrong}).status_code == 403
    r = client.post("/api/live/pair", json={"code": code})
    assert r.status_code == 403 and "Connect AI" in r.json()["detail"]  # gone: the user asks for a new one
    page.close()


def test_no_answer_in_time_is_reported() -> None:
    hub = Hub()
    page = hub.stream(heartbeat=0.05)
    next(page)
    with pytest.raises(NoPage, match="did not answer"):
        hub.request("snapshot", {}, timeout=0.05)
    page.close()
    with pytest.raises(NoPage, match="No page"):
        hub.request("snapshot", {}, timeout=0.05)
    assert hub.answer("unknown", {"ok": True}, None) is False


def test_a_background_tab_does_not_take_over_from_the_tab_in_front() -> None:
    hub = Hub()
    tabs = [hub.stream(heartbeat=0.05, client=c) for c in ("front", "back", "other")]  # all three are open
    for t in tabs:
        next(t)
    hub.report({"client": "front", "route": "dc/pid", "focused": True})
    hub.report({"client": "back", "route": "district/map", "focused": False})  # e.g. refreshing in the background
    assert hub.ui["client"] == "front"
    hub.report({"client": "front", "route": "dc/pid", "focused": False})  # the user left that tab
    hub.report({"client": "back", "route": "district/map", "focused": False})
    assert hub.ui["client"] == "back"
    hub.report({"client": "other", "route": "heat/flow", "focused": True})  # clicked into another tab
    assert hub.ui["client"] == "other"


def test_a_request_to_a_closed_tab_goes_to_the_only_open_one_or_fails_at_once() -> None:
    hub = Hub()
    hub.report({"client": "closed", "route": "dc/pid", "focused": True})
    other = hub.stream(heartbeat=0.05, client="open")
    next(other)
    sent = hub.publish({"type": "request", "id": "x", "target": "open", "action": "snapshot", "args": {}})
    assert sent == 1 and next(other).startswith("data:")  # requests reach only their target
    second = hub.stream(heartbeat=0.05, client="also-open")
    next(second)
    with pytest.raises(NoPage, match="closed"):  # two other tabs: which one is meant is unknown
        hub.request("snapshot", {}, timeout=0.05)
    other.close()
    second.close()


def test_a_closed_tab_in_front_does_not_block_a_new_one() -> None:
    hub = Hub()
    old = hub.stream(heartbeat=0.05, client="old")
    next(old)
    hub.report({"client": "old", "route": "dc/pid", "focused": True})
    old.close()  # the tab is closed
    new = hub.stream(heartbeat=0.05, client="new")
    next(new)
    hub.report({"client": "new", "route": "help/about", "focused": False})  # e.g. opened in the background
    assert hub.ui["client"] == "new"
    new.close()


def test_when_the_tab_in_front_closes_the_open_one_takes_over_at_once() -> None:
    hub = Hub()
    old, new = hub.stream(heartbeat=0.05, client="old"), hub.stream(heartbeat=0.05, client="new")
    next(old), next(new)
    hub.report({"client": "old", "route": "dc/pid", "focused": True})
    hub.report({"client": "new", "route": "dc/pid", "focused": False})  # opened while the old one was in front
    assert hub.ui["client"] == "old"
    old.close()  # the old tab is gone: no new report is needed
    assert hub.ui["client"] == "new"
    new.close()
    assert hub.ui is None


def test_the_heat_matching_and_profile_commands_are_checked_before_they_reach_the_page(client: TestClient) -> None:
    connect_agent(client)
    for action, args, why in (
        ("set_window", {}, "number"),
        ("set_part_way", {"part": "dc"}, "way"),
        ("set_profile_shape", {"profile": "Q_houses"}, "weekday"),
    ):
        r = client.post("/api/live/command", json={"action": action, "args": args})
        assert r.status_code == 400 and why in r.json()["detail"], action
    seen: list = []
    _page_answering(client.app.state.live, {"ok": True, "did": "showing week 3 of 52"}, seen)
    r = client.post("/api/live/command", json={"action": "set_window", "args": {"number": 3}})
    assert r.status_code == 200 and r.json()["did"] == "showing week 3 of 52"
    assert seen[0]["action"] == "set_window" and seen[0]["args"] == {"number": 3}


def test_open_event_streams_hold_no_worker_thread(client: TestClient) -> None:
    # B-R1: each open stream held a worker thread while it waited; with 45 open a plain GET took 5-8 s
    import time

    import anyio
    import anyio.to_thread

    from backend.routers import live as live_router

    class Page:  # the request of one open tab
        app = client.app

        async def is_disconnected(self) -> bool:
            return False

    async def main() -> float:
        anyio.to_thread.current_default_thread_limiter().total_tokens = 4
        streams = [live_router.events(Page(), None, f"tab-{i}") for i in range(20)]
        if hasattr(streams[0], "__await__"):  # an async route
            streams = [await s for s in streams]
        async with anyio.create_task_group() as tg:
            for s in streams:
                tg.start_soon(_drain, s.body_iterator)
            await anyio.sleep(0.2)
            t0 = time.monotonic()
            await anyio.to_thread.run_sync(lambda: None)  # what a plain sync route needs
            took = time.monotonic() - t0
            tg.cancel_scope.cancel()
        return took

    async def _drain(body) -> None:
        async for _ in body:
            pass

    assert anyio.run(main) < 1.0
    assert client.app.state.live.pages == 0  # every stream left the hub when it ended


def test_the_apps_stream_says_hello_then_delivers_an_event_and_ends() -> None:
    import anyio

    hub = Hub()

    async def main() -> list[str]:
        async def gone() -> bool:
            return False

        lines = []
        body = hub.astream(gone, max_events=1, client="p1")
        lines.append(await anext(body))
        hub.publish({"type": "changed", "method": "PUT", "path": "/x", "client": None})
        lines += [line async for line in body]
        return lines

    hello, event = anyio.run(main)
    assert page_secret(hello) and json.loads(event.removeprefix("data: "))["path"] == "/x"
    assert hub.pages == 0
