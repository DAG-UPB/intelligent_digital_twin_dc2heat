"""The app around the routes: API docs, static sites, JSON without NaN, Host and Origin checks."""

import math
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import SafeJSONResponse, create_app


def test_api_docs(client: TestClient) -> None:
    assert client.get("/api/docs").status_code == 200
    assert "/api/datasets/{dataset_id}/models/train" in client.get("/api/openapi.json").json()["paths"]
    assert client.get("/redoc").status_code == 404


def test_static_sites(data_dir: Path, tmp_path: Path) -> None:
    web, docs = tmp_path / "web", tmp_path / "docs"
    web.mkdir()
    docs.mkdir()
    (web / "index.html").write_text("<p>app</p>")
    (docs / "index.html").write_text("<p>docs</p>")
    client = TestClient(create_app(data_dir, web, docs))
    assert client.get("/").text == "<p>app</p>"
    assert client.get("/docs/").text == "<p>docs</p>"
    bare = client.get("/docs", follow_redirects=False)
    assert bare.status_code == 307 and bare.headers["location"] == "/docs/"
    assert client.get("/api/datasets").status_code == 200  # the "/" mount does not shadow the API
    assert client.get("/health").json()["datasets"] == 1


def test_missing_static_sites_are_skipped(data_dir: Path, tmp_path: Path) -> None:
    client = TestClient(create_app(data_dir, tmp_path / "no_web", tmp_path / "no_docs"))
    assert client.get("/").status_code == 404 and client.get("/docs/").status_code == 404


def test_nan_and_inf_become_null() -> None:
    body = SafeJSONResponse({"a": [1.0, math.nan, {"b": math.inf}], "c": (-math.inf, "x")}).body
    assert body == b'{"a":[1.0,null,{"b":null}],"c":[null,"x"]}'
    assert SafeJSONResponse({"a": 1.5}).body == b'{"a":1.5}'


@pytest.mark.parametrize("host", ["localhost:7600", "127.0.0.1:7600", "[::1]:7600", "localhost"])
def test_local_hosts_are_answered(client: TestClient, host: str) -> None:
    assert client.get("/api/datasets", headers={"host": host}).status_code == 200


def test_other_hosts_are_refused(client: TestClient, data_dir: Path) -> None:
    # DNS rebinding: a website whose name points at 127.0.0.1 sends its own name as Host
    assert client.get("/api/datasets", headers={"host": "attacker.example"}).status_code == 400
    custom = TestClient(create_app(data_dir, None, allowed_hosts=["twin.lan"]), base_url="http://twin.lan")
    assert custom.get("/health").status_code == 200


@pytest.mark.parametrize(
    "origin, status",
    [
        (None, 200),  # TestClient, curl, scripts
        ("http://localhost:7600", 200),  # the app itself
        ("http://localhost:7601", 200),  # the Vite dev server
        ("http://127.0.0.1:7600", 200),
        ("http://[::1]:7600", 200),
        ("http://evil.example", 403),
        ("http://localhost.evil.example", 403),
        ("null", 403),  # sandboxed iframe / file:// page
        ("http://[", 403),  # unparsable
    ],
)
def test_writes_only_from_local_pages(client: TestClient, api: str, origin: str | None, status: int) -> None:
    headers = {"origin": origin} if origin else {}
    assert client.put(f"{api}/equations", json={}, headers=headers).status_code == status


def _png() -> bytes:
    import io

    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (2, 2)).save(out, "PNG")
    return out.getvalue()


def test_cross_site_raw_body_post_is_refused(client: TestClient, dataset_dir: Path, api: str) -> None:
    # a no-cors text/plain POST needs no preflight; it must not reach the P&ID routes
    before = (dataset_dir / "dataset.json").read_bytes()
    png, plain = _png(), {"content-type": "text/plain"}  # a whole PNG: the signature alone is refused (B-C5)
    r = client.post(f"{api}/pid", content=png, headers={"origin": "http://evil.example"} | plain)
    assert r.status_code == 403 and not (dataset_dir / "pid.png").exists()
    assert (dataset_dir / "dataset.json").read_bytes() == before
    assert client.post(f"{api}/pid", content=png, headers=plain).status_code == 200  # the same request, sent locally
    # reading is unaffected (the browser's same-origin policy keeps the answer from the other site)
    assert client.get(f"{api}/equations", headers={"origin": "http://evil.example"}).status_code == 200


def test_an_unreadable_data_center_is_left_out_and_the_app_still_starts(data_dir: Path) -> None:
    broken = data_dir / "broken_dc"
    broken.mkdir()
    (broken / "df_broken.parquet").write_bytes(b"not a parquet file")
    client = TestClient(create_app(data_dir))
    health = client.get("/health").json()
    assert health["datasets"] == 1 and list(health["unreadable"]) == ["broken_dc"]
    assert [d["id"] for d in client.get("/api/datasets").json()["datasets"]] == ["sim_x"]


def test_a_request_body_above_the_limit_is_refused_before_it_is_read(client: TestClient, api: str, monkeypatch) -> None:
    # B-R3: no bound on the JSON bodies (site, project, prepared, ...): a client could send gigabytes
    from backend import app as app_module

    monkeypatch.setattr(app_module, "REQUEST_MAX_BYTES", 1000)
    small = create_app_for(client)
    r = small.put(f"{api}/site", content=b"{" + b" " * 2000 + b"}", headers={"content-type": "application/json"})
    assert r.status_code == 413 and "limit" in r.json()["detail"]
    assert small.put(f"{api}/site", json={}).status_code == 200


def create_app_for(client: TestClient) -> TestClient:
    from backend.app import create_app

    return TestClient(create_app(client.app.state.registry.data_dir, None))


def test_an_upload_is_cut_off_at_its_limit_while_it_arrives() -> None:
    # B-R3: the P&ID and document uploads were read whole before their size was checked
    import anyio
    from fastapi import HTTPException

    from backend.deps import read_body

    read = []

    class Upload:  # a request without a Content-Length, its body in chunks
        headers: dict = {}

        async def stream(self):
            for _ in range(50):
                read.append(1)
                yield b"x" * 64

    async def main():
        try:
            await read_body(Upload(), 100)
        except HTTPException as exc:
            return exc.status_code

    assert anyio.run(main) == 413 and len(read) == 2  # it stopped reading past the limit


def test_a_500_is_logged_with_its_traceback_and_the_long_calls_with_their_time(
    client: TestClient, api: str, caplog, monkeypatch
) -> None:
    # roadmap R17: logging was practically absent; a 500 in a minutes-long train left only uvicorn's traceback
    import logging

    from backend.routers import training

    caplog.set_level(logging.INFO, logger="backend")
    assert client.post(f"{api}/models/train", json={"name": "m", "model": "linear"}).status_code == 200
    assert client.post(f"{api}/models/m/simulate", json={"start": 10, "steps": 5}).status_code == 200
    assert client.post(f"{api}/models/evaluate", json={"names": ["m"]}).status_code == 200
    assert client.post(f"{api}/models/compare", json={"column": "y", "models": ["m"], "steps": 48}).status_code == 200
    took = [r.getMessage() for r in caplog.records if r.name == "backend.routers.training"]
    assert [m.split()[0] for m in took] == ["train", "simulate", "evaluate", "compare"] and all(" s" in m for m in took)

    def boom(*a, **k):
        raise RuntimeError("a bug")

    monkeypatch.setattr(training.twin, "fit", boom)
    quiet = TestClient(client.app, raise_server_exceptions=False)
    r = quiet.post(f"{api}/models/train", json={"name": "m2", "model": "linear"})
    assert r.status_code == 500 and "log" in r.json()["detail"]
    logged = [r for r in caplog.records if r.levelno == logging.ERROR and r.exc_info]
    assert logged and "POST" in logged[-1].getMessage() and "a bug" in str(logged[-1].exc_info[1])
