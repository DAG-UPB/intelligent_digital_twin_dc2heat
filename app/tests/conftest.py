"""Shared fixtures: a synthetic dataset folder in tmp_path and a TestClient over it (no real data)."""

import json
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from synthetic import DATASET, make_frame, write_dataset

from backend.app import create_app


@pytest.fixture(scope="session")
def frame() -> pd.DataFrame:
    return make_frame()


@pytest.fixture
def data_dir(tmp_path: Path, frame: pd.DataFrame) -> Path:
    """tmp_path holding one dataset, sim_x."""
    write_dataset(tmp_path / DATASET, frame)
    return tmp_path


@pytest.fixture
def dataset_dir(data_dir: Path) -> Path:
    return data_dir / DATASET


@pytest.fixture
def client(data_dir: Path) -> TestClient:
    """The app over data_dir, without the web page or the docs."""
    return TestClient(create_app(data_dir, None))


def page_secret(first_line: str) -> str:
    """The secret a page's event stream gives it in its first message (the page sends it to ask for a code)."""
    hello = json.loads(first_line.removeprefix("data: "))
    assert hello["type"] == "hello"
    return hello["secret"]


def connect_agent(client: TestClient) -> str:
    """Connect an agent the way the user does: an open page shows a code (Connect AI), the agent pairs with it; its
    token goes on every later request of `client`."""
    hub = client.app.state.live  # type: ignore[attr-defined]
    page = hub.stream(heartbeat=0.01, client="connect-ai-page")
    secret = page_secret(next(page))  # listening: an open page
    code = hub.new_code("connect-ai-page", secret)
    page.close()
    token = client.post("/api/live/pair", json={"code": code}).json()["token"]
    client.headers["X-Agent-Token"] = token
    return token


@pytest.fixture
def api() -> str:
    """URL prefix of the synthetic dataset."""
    return f"/api/datasets/{DATASET}"
