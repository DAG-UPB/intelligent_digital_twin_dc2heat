"""DEXPI (Proteus XML) P&IDs: read like a drawing, drawn as a picture, used as a data center's P&ID."""

import json
import xml.etree.ElementTree as ET

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from pid_drawings import PNG_1PX, dexpi_xml

from backend.app import create_app
from backend.pid import components_of, plant_fractions, sniff
from backend.pid.construct import construct_of
from backend.pid.dexpi import picture, read_dexpi
from backend.routers import pid as pid_router


def test_sniff_tells_dexpi_from_svg():
    assert sniff(dexpi_xml()[:4096]) == ".xml"
    assert sniff(b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>') == ".svg"


def test_read_dexpi_gives_equipment_pipes_and_instruments_on_the_sheet():
    p = read_dexpi(dexpi_xml())
    assert p["viewBox"] == "0 0 400.0 300.0"
    tank, pump = p["colorNodes"]
    # y runs down from the top: the tank's extent middle (60, 230) -> (60, 70); the pump at its location
    assert (tank["tag"], tank["x"], tank["y"], tank["w"], tank["h"]) == ("T-101", 60, 70, 40, 60)
    assert (pump["tag"], pump["x"], pump["y"]) == ("P-101", 300, 200)
    assert p["colorConnections"] == [{"source": "PMP1", "target": "TNK1"}]
    assert [len(r["points"]) for r in p["colorRuns"]] == [3, 2]
    assert [(b["tag"], b["x"], b["y"], b["d"]) for b in p["instruments"]] == [("TI 101", 150, 100, 10), ("PI 7", 250, 150, 10)]
    assert components_of(p)["links"] == [["PMP1", "TNK1"]]
    plant = plant_fractions(p)
    assert plant["components"][0]["x"] == pytest.approx(0.15)


def test_a_dexpi_file_gives_its_drawing_as_digital_lines_and_texts():
    p = read_dexpi(dexpi_xml())
    assert len(p["lines"]) == 6  # tank outline, pump circle and line, two centre lines, TI bubble
    assert p["lines"][0]["points"][0] == p["lines"][0]["points"][-1] and p["lines"][0]["color"] == "#0000ff"
    assert [t["text"] for t in p["texts"]] == ["TI"]


def test_the_construct_of_a_dexpi_file_has_the_equipment_sizes():
    shapes = {s["id"]: s for s in construct_of(read_dexpi(dexpi_xml()))["shapes"]}
    assert shapes["comp:TNK1"]["w"] == pytest.approx(0.1) and shapes["comp:TNK1"]["h"] == pytest.approx(0.2)
    assert shapes["comp:PMP1"]["w"] == pytest.approx(0.05)  # no extent: boxed by its symbol (circle r 10 mm)
    assert {s["label"] for s in shapes.values() if s["role"] == "instrument"} == {"TI 101", "PI 7"}
    assert sum(s["role"] == "pipe" for s in shapes.values()) == 2


def test_the_picture_draws_the_files_graphics_and_placed_symbols():
    svg = ET.fromstring(picture(dexpi_xml()))
    tags = [el.tag.rsplit("}", 1)[-1] for el in svg.iter()]
    assert tags.count("ellipse") == 2  # the pump symbol (from the catalogue) and the TI bubble
    assert "polygon" in tags and tags.count("polyline") == 3 and tags.count("text") == 1
    # the pump symbol's line (0,10)-(10,10) is turned by its Reference (0, 1): -> (290,100)-(290,110), y down
    pump_line = [el for el in svg.iter() if el.tag.endswith("polyline") and el.get("points").startswith("290")]
    assert pump_line[0].get("points") == "290.0,200.0 290.0,190.0"


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><PlantModel/>', "DOCTYPE"),
        (b"<PlantModel><Equipment", "Not readable XML"),
        (b"<PlantModel/>", "no coordinates"),
    ],
)
def test_bad_dexpi_files_are_refused(data, message):
    with pytest.raises(ValueError, match=message):
        read_dexpi(data)


def test_a_dexpi_file_is_used_as_the_pid(tmp_path, monkeypatch):
    directory = tmp_path / "sim_t"
    directory.mkdir()
    pd.DataFrame({"t": pd.date_range("2024-01-01", periods=3, freq="h"), "a": [1.0, 2, 3]}).to_parquet(directory / "data.parquet")
    c = TestClient(create_app(tmp_path, None))
    assert c.post("/api/pid/extract", content=dexpi_xml()).json()["stats"]["instruments"] == 2

    rendered = []
    monkeypatch.setattr(pid_router.shutil, "which", lambda cmd: cmd)
    monkeypatch.setattr(pid_router.subprocess, "run", lambda cmd, input, **kw: rendered.append((cmd[0], input)) or _Done())
    r = c.post("/api/datasets/sim_t/pid", content=dexpi_xml())
    assert r.status_code == 200 and r.json()["components"] == 2
    assert rendered[0][0] == "rsvg-convert" and rendered[0][1].startswith(b"<svg")  # drawn from the file's graphics
    plant = json.loads((directory / "pid_plant.json").read_text())
    assert [c["label"] for c in plant["components"]] == ["T-101", "P-101"]
    labels = {s["label"] for s in c.get("/api/datasets/sim_t/pid/construct").json()["shapes"]}
    assert {"T-101", "P-101", "TI 101"} <= labels


class _Done:
    returncode, stdout = 0, PNG_1PX
