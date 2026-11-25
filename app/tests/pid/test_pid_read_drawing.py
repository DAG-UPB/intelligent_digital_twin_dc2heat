"""read_drawing end to end on synthetic drawings, against golden snapshots.

The goldens were recorded from the pre-refactor extractor (minus the fields dropped on
purpose: geometry, facilityNodes, facilityEdges, elapsed). Node ids end up in users'
pid_plant.json and variable assignments, so any change here must be deliberate.
To re-record after an intended change: PID_UPDATE_GOLDEN=1 pytest tests/pid
"""

import json
import os
from pathlib import Path

import pytest
from pid_drawings import colour_pdf, colour_svg, make_pdf, mono_pdf

from backend.pid import components_of, extract, read_drawing

GOLDEN = Path(__file__).parent / "golden"


def _read(tmp_path, data: bytes, suffix: str) -> dict:
    path = tmp_path / f"drawing{suffix}"
    path.write_bytes(data)
    return read_drawing(path)


@pytest.mark.parametrize(
    ("name", "build", "suffix"),
    [("mono_pdf", mono_pdf, ".pdf"), ("colour_pdf", colour_pdf, ".pdf"), ("colour_svg", colour_svg, ".svg")],
)
def test_golden(tmp_path, name, build, suffix):
    payload = _read(tmp_path, build(), suffix)
    assert payload["stats"].pop("elapsedSeconds") >= 0
    payload.update(components_of(payload))
    got = json.loads(json.dumps(payload))  # tuples -> lists, as the API sends it
    path = GOLDEN / f"{name}.json"
    if os.environ.get("PID_UPDATE_GOLDEN"):
        path.write_text(json.dumps(got, indent=1, sort_keys=True) + "\n")
    assert got == json.loads(path.read_text())


def test_geometric_path_on_a_monochrome_drawing(tmp_path):
    p = _read(tmp_path, mono_pdf(), ".pdf")
    assert p["viewBox"] == "0 0 600.0 400.0" and p["colorCoded"] is False and p["colorRuns"] == []
    assert p["stats"]["bySource"] == {"tag": 3, "junction": 1}
    tag0 = p["nodes"][0]
    assert (tag0["id"], tag0["class"], tag0["x"], tag0["y"]) == ("tag0", "P4711", 80.0, 100.0)  # y flipped
    assert components_of(p)["links"] == [["tag0", "tag1"], ["tag0", "tag2"], ["tag1", "tag2"]]


def test_colour_path_screen_space_and_hex_colours(tmp_path):
    p = _read(tmp_path, colour_pdf(), ".pdf")
    assert p["colorCoded"] is True
    assert {r["color"] for r in p["colorRuns"]} == {"#ff0000", "#0000ff"}
    blue = next(r for r in p["colorRuns"] if r["color"] == "#0000ff")
    assert blue["points"] == [[250.0, 280.0], [250.0, 100.0]]  # the form placed by cm, then y flipped
    wt = next(n for n in p["colorNodes"] if n["id"] == "WT 4a")
    assert wt["label_y"] == 400 - 305  # label_y flipped too


def test_svg_without_viewbox_uses_width_and_height(tmp_path):
    svg = (
        b'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">'
        b'<line x1="0" y1="10" x2="50" y2="10" stroke="red"/></svg>'
    )
    p = _read(tmp_path, svg, ".svg")
    assert p["viewBox"] == "0 0 200.0 100.0"
    assert p["pageBox"] == [0.0, 0.0, 200.0, 100.0]


def test_warnings_for_few_paths_off_page_geometry_and_no_edges(tmp_path):
    p = _read(tmp_path, make_pdf(b"0 0 m 50 0 l S 900 900 m 950 950 l S", box=(0, 0, 100, 100)), ".pdf")
    assert p["warnings"] == [
        extract._NO_TEMPLATES,
        "50% of the drawing falls outside the page box, so coordinates are unreliable for this file.",
        "only 2 vector paths found; this may be a scanned/raster or raster file, "
        "which this pipeline cannot read (it needs vector geometry).",
        "extraction produced 0 edges.",
    ]


def test_unreadable_file_raises_extraction_failed(tmp_path):
    with pytest.raises(ValueError, match="^Extraction failed: "):
        _read(tmp_path, b"%PDF-1.4\nnothing here", ".pdf")
    with pytest.raises(ValueError, match="^Extraction failed: "):
        _read(tmp_path, b"<svg", ".svg")


def test_colour_graph_failure_keeps_the_geometric_result(tmp_path, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(extract, "build_color_graph", boom)
    p = _read(tmp_path, colour_pdf(), ".pdf")
    assert "colour topology failed: boom" in p["warnings"]
    assert p["colorRuns"] and p["colorNodes"] == [] and p["nodes"]


def test_extraction_is_deterministic(tmp_path):
    a = _read(tmp_path, colour_svg(), ".svg")
    b = _read(tmp_path, colour_svg(), ".svg")
    for p in (a, b):
        p["stats"].pop("elapsedSeconds")
    assert a == b


def test_a_drawing_that_takes_too_long_is_refused_in_time(tmp_path, monkeypatch):
    # B-R2: the reader is quadratic in places and had no time limit (75,000 short lines did not finish in 170 s)
    import time
    import zlib

    lines = b"".join(b"%d %d m %d %d l S\n" % (i % 97, i % 89, i % 97 + 1, i % 89 + 1) for i in range(4000))
    s = zlib.compress(lines)
    p = tmp_path / "many.pdf"
    head = b"%PDF-1.4\n1 0 obj\n<< /Length " + str(len(s)).encode() + b" /Filter /FlateDecode >>\nstream\n"
    p.write_bytes(head + s + b"\nendstream\nendobj\n")
    monkeypatch.setattr(extract, "PID_READ_TIMEOUT_S", 0.2)
    t0 = time.monotonic()
    with pytest.raises(ValueError, match="longer than"):
        read_drawing(p)
    assert time.monotonic() - t0 < 2  # about 4 s to read in full
