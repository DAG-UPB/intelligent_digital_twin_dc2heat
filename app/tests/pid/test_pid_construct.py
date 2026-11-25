"""The digital construct of a P&ID: instrument bubbles, shapes from an extraction, checks, the routes."""

import json

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from pid_drawings import PNG_1PX, instrument_svg

from backend.app import create_app
from backend.pid import construct as pc
from backend.pid import read_drawing
from backend.pid.instruments import demo
from backend.routers import pid as pid_router


@pytest.fixture
def payload(tmp_path):
    path = tmp_path / "sheet.svg"
    path.write_bytes(instrument_svg())
    return read_drawing(path)


def test_the_bubble_self_check():
    demo()


def test_instrument_bubbles_are_read_with_their_tags(payload):
    tags = sorted(b["tag"] for b in payload["instruments"])
    assert tags == ["PT 7", "TI 101"]  # not the motor, not the legend lattice
    ti = next(b for b in payload["instruments"] if b["tag"] == "TI 101")
    assert abs(ti["x"] - 120) < 1 and abs(ti["y"] - 70) < 1  # screen space, y down, as the svg says
    assert payload["stats"]["instruments"] == 2


def test_the_construct_of_a_drawing(payload):
    shapes = pc.construct_of(payload)["shapes"]
    roles = {r: [s for s in shapes if s["role"] == r] for r in ("component", "instrument", "pipe")}
    # a component is boxed by its symbol in the drawing: only M1.1 has one (the pump circle, r 8 at 170, 100);
    # P4711, WT 4a and H1007 are pipe ends with a tag, and get no made-up box
    (pump,) = roles["component"]
    assert pump["label"] == "M1.1"
    assert (round(pump["x"] * 400), round(pump["y"] * 300), round(pump["w"] * 400), round(pump["h"] * 300)) == (170, 100, 16, 16)
    assert {s["label"] for s in roles["instrument"]} == {"TI 101", "PT 7"}
    ti = next(s for s in roles["instrument"] if s["label"] == "TI 101")
    assert ti["kind"] == "circle" and abs(ti["x"] - 0.3) < 0.01 and abs(ti["y"] - 70 / 300) < 0.01
    assert abs(ti["w"] * 400 - 12) < 1 and abs(ti["h"] * 300 - 12) < 1  # round on the sheet
    assert roles["pipe"] and all(s["kind"] == "line" and len(s["points"]) >= 2 for s in roles["pipe"])
    assert all(0 <= v <= 1 for s in roles["pipe"] for p in s["points"] for v in p)
    assert pc.check({"shapes": shapes})["shapes"] == shapes  # what is read is what may be saved


@pytest.mark.parametrize(
    ("shapes", "message"),
    [
        ([{"id": "a", "kind": "star", "x": 0.5, "y": 0.5}], "kind must be"),
        ([{"id": "a", "kind": "rect", "x": 0.5, "y": 0.5, "w": 0.1, "h": 0.1}] * 2, "two shapes have the id"),
        ([{"id": "a", "kind": "rect", "x": 0.5, "y": 0.5, "w": 0, "h": 0.1}], "w must be"),
        ([{"id": "a", "kind": "rect", "x": 9, "y": 0.5, "w": 0.1, "h": 0.1}], "x must be"),
        ([{"id": "a", "kind": "line", "points": [[0, 0]]}], "2 to"),
        ([{"id": "a", "kind": "text", "x": 0.5, "y": 0.5, "role": "boss"}], "role must be"),
        ([{"id": "", "kind": "text", "x": 0.5, "y": 0.5}], "needs an id"),
        ([{"id": "a", "kind": "text", "x": 0.5, "y": 0.5, "props": {"1kW": 5}}], "must start with a letter"),
        ([{"id": "a", "kind": "text", "x": 0.5, "y": 0.5, "props": {"on": True}}], "number or a text"),
        ([{"id": "a", "kind": "text", "x": 0.5, "y": 0.5, "props": {"t": "x" * 81}}], "longer than"),
    ],
)
def test_bad_shapes_are_refused(shapes, message):
    with pytest.raises(ValueError, match=message):
        pc.check({"shapes": shapes})


def test_values_of_a_shape_are_kept():
    shape = {"id": "a", "kind": "rect", "x": 0.5, "y": 0.5, "w": 0.1, "h": 0.1, "props": {"capacity_kW": 50, "type": "chiller"}}
    assert pc.check({"shapes": [shape]})["shapes"][0]["props"] == {"capacity_kW": 50, "type": "chiller"}


def test_check_keeps_only_the_keys_of_the_kind():
    out = pc.check({"shapes": [{"id": "t", "kind": "text", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.3, "label": "Hall"}]})
    assert out == {"shapes": [{"id": "t", "kind": "text", "label": "Hall", "role": "", "x": 0.1, "y": 0.2}]}


@pytest.fixture
def client(tmp_path):
    directory = tmp_path / "sim_t"
    directory.mkdir()
    frame = pd.DataFrame({"time": pd.date_range("2024-01-01", periods=3, freq="h"), "a": [1.0, 2.0, 3.0]})
    frame.to_parquet(directory / "data.parquet")
    return TestClient(create_app(tmp_path, None)), directory


def test_construct_routes(client, monkeypatch):
    c, directory = client
    api = "/api/datasets/sim_t/pid/construct"
    assert c.get(api).json() == {"shapes": [], "saved": False, "picture": False}

    # an older drawing has only its plant graph: the construct starts from it, not saved yet
    plant = {"components": [{"id": "P1", "label": "P1", "x": 0.2, "y": 0.3}], "links": [], "pipes": [[[0, 0], [1, 1]]]}
    (directory / "pid_plant.json").write_text(json.dumps(plant))
    seeded = c.get(api).json()
    assert not seeded["saved"] and [s["id"] for s in seeded["shapes"]] == ["comp:P1", "pipe:0"]

    shapes = [*seeded["shapes"], {"id": "note:1", "kind": "text", "x": 0.5, "y": 0.1, "label": "Hall 2", "role": "note"}]
    saved = c.put(api, json={"shapes": shapes})
    assert saved.status_code == 200 and saved.json()["saved"]
    assert c.get(api).json()["shapes"][-1]["label"] == "Hall 2"
    assert c.put(api, json={"shapes": [{"id": "x", "kind": "line", "points": [[0, 0]]}]}).status_code == 422

    # a new drawing replaces the construct with its own; a picture alone removes it
    monkeypatch.setattr(pid_router, "_render_png", lambda data, suffix, dpi=150: PNG_1PX)
    assert c.post("/api/datasets/sim_t/pid", content=instrument_svg()).status_code == 200
    labels = {s["label"] for s in c.get(api).json()["shapes"]}
    assert {"TI 101", "PT 7", "P4711"} <= labels and "Hall 2" not in labels
    assert c.post("/api/datasets/sim_t/pid", content=PNG_1PX).status_code == 200
    assert not (directory / "pid_construct.json").exists()


def test_a_new_drawing_backs_up_the_old_one_and_unplaces_its_instruments(client, monkeypatch):
    c, directory = client
    monkeypatch.setattr(pid_router, "_render_png", lambda data, suffix, dpi=150: PNG_1PX)
    assert c.post("/api/datasets/sim_t/pid", content=instrument_svg()).json()["backup"] is None  # nothing to back up
    layout = {
        "paper:a": {"x": 0.4, "y": 0.5, "tag": "TT"},
        "plant:a": {"x": 0.4, "y": 0.5, "tag": "P1"},
        "a": {"x": 9, "y": 9, "tag": "TT"},
    }
    (directory / "site.json").write_text(json.dumps({"pid_layout": layout}))

    backup = c.post("/api/datasets/sim_t/pid", content=instrument_svg()).json()["backup"]
    assert {p.name for p in (directory / backup).iterdir()} == {"pid.png", "pid_plant.json", "pid_construct.json", "site.json"}
    got = json.loads((directory / "site.json").read_text())["pid_layout"]
    assert got["paper:a"] == {"x": -1, "y": -1, "tag": "TT"}  # back in the tray, its tag kept
    assert got["plant:a"]["tag"] == "" and got["a"] == layout["a"]  # the built-in drawing's spots stay

    # remove: backed up, gone, and dataset.json no longer names a picture
    removed = c.delete("/api/datasets/sim_t/pid").json()
    assert removed["removed"] and (directory / removed["backup"] / "pid.png").exists()
    assert not any((directory / n).exists() for n in ("pid.png", "pid_plant.json", "pid_construct.json"))
    assert "pid_image" not in json.loads((directory / "dataset.json").read_text())
    assert c.delete("/api/datasets/sim_t/pid").json() == {"removed": False, "backup": None}


def test_only_the_selected_area_is_read_and_kept(client, monkeypatch, tmp_path):
    from backend.pid.crop import demo as crop_demo

    crop_demo()
    path = tmp_path / "sheet.svg"
    path.write_bytes(instrument_svg())
    whole, part = read_drawing(path), read_drawing(path, (0.25, 0.1, 1, 1))  # x 100..400, y 30..300 of 400 x 300
    assert whole["viewBox"] == "0 0 400.0 300.0" and part["viewBox"] == "0 0 300.0 270.0"
    ti = next(b for b in part["instruments"] if b["tag"] == "TI 101")
    assert (round(ti["x"]), round(ti["y"])) == (20, 40)  # moved with the area: (120, 70) - (100, 30)
    assert "P4711" not in {c["label"] for c in pc.components_of(part)["components"]}  # its tag is left of the area

    import io

    from PIL import Image

    page = io.BytesIO()
    Image.new("RGB", (400, 300), "white").save(page, "PNG")
    c, directory = client
    monkeypatch.setattr(pid_router, "_render_png", lambda data, suffix, dpi=150: page.getvalue())
    assert (
        c.post("/api/pid/extract", params={"crop": "0.25,0.1,1,1"}, content=instrument_svg()).json()["viewBox"]
        == "0 0 300.0 270.0"
    )
    assert c.post("/api/pid/extract", params={"crop": "0.5,0,0.4,1"}, content=instrument_svg()).status_code == 422
    assert c.post("/api/datasets/sim_t/pid", params={"crop": "0.25,0.1,1,1"}, content=instrument_svg()).status_code == 200
    shapes = c.get("/api/datasets/sim_t/pid/construct").json()["shapes"]
    assert "P4711" not in {s["label"] for s in shapes} and "TI 101" in {s["label"] for s in shapes}
    with Image.open(directory / "pid.png") as kept:
        assert kept.size == (300, 270)  # the picture is cut to the area too


def test_the_construct_starts_with_every_line_and_text_of_the_sheet(payload):
    shapes = pc.construct_of(payload)["shapes"]
    drawing = [s for s in shapes if s["role"] == "drawing"]
    lines = [s for s in drawing if s["kind"] == "line"]
    assert len(lines) == len([d for d in payload["lines"] if len(d["points"]) >= 2]) > 10  # all of them
    assert {s["color"] for s in lines} >= {"#ff0000", "#0000ff"}  # the pipes keep their colours
    assert {"P4711", "WT 4a", "DN 800"} <= {s["label"] for s in drawing if s["kind"] == "text"}
    # the sheet first (drawn below), then what was recognised on it
    first_recognised = next(i for i, s in enumerate(shapes) if s["role"] != "drawing")
    assert all(s["role"] != "drawing" for s in shapes[first_recognised:])
    assert pc.check({"shapes": shapes})["shapes"][0]["color"] == lines[0]["color"]  # colour survives the check
    with pytest.raises(ValueError, match="#rrggbb"):
        pc.check({"shapes": [{**lines[0], "color": "red"}]})
