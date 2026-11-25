"""The P&ID HTTP routes, through the real app on a temporary data directory."""

import json
import shutil

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from pid_drawings import PNG_1PX, colour_svg, make_pdf, mono_pdf

from backend.app import create_app
from backend.routers import pid as pid_router

needs_rsvg = pytest.mark.skipif(shutil.which("rsvg-convert") is None, reason="rsvg-convert not installed")
needs_pdftoppm = pytest.mark.skipif(shutil.which("pdftoppm") is None, reason="pdftoppm not installed")


@pytest.fixture
def dataset_dir(tmp_path):
    directory = tmp_path / "sim_t"
    directory.mkdir()
    pd.DataFrame({"time": pd.date_range("2024-01-01", periods=3, freq="h"), "a": [1.0, 2.0, 3.0]}).to_parquet(
        directory / "data.parquet"
    )
    return directory


@pytest.fixture
def client(tmp_path, dataset_dir):
    return TestClient(create_app(tmp_path, None))


def _fake_render(data, suffix, dpi=150):
    return PNG_1PX


def test_extract_svg(client):
    r = client.post("/api/pid/extract", content=colour_svg())
    assert r.status_code == 200
    body = r.json()
    for key in ("viewBox", "colorRuns", "colorNodes", "colorConnections", "edges", "stats", "warnings"):
        assert key in body
    assert not {"geometry", "facilityNodes", "facilityEdges", "elapsed"} & set(body)
    assert [c["id"] for c in body["components"]] == ["P4711", "WT 4a", "H1007", "M1.1"]
    assert body["links"] == [["H1007", "P4711"], ["H1007", "WT 4a"], ["P4711", "WT 4a"]]


def test_extract_rejects_a_non_drawing(client):
    r = client.post("/api/pid/extract", content=b"hello")
    assert r.status_code == 422
    assert r.json()["detail"] == "Not a PDF, SVG or DEXPI file (no %PDF- header, no <svg> and no <PlantModel> element)."


def test_extract_reports_a_failed_extraction(client):
    r = client.post("/api/pid/extract", content=b"%PDF-1.4\nno pages, no geometry")
    assert r.status_code == 422
    assert r.json()["detail"].startswith("Extraction failed: ")


@pytest.mark.parametrize("url", ["/api/pid/extract", "/api/pid/preview", "/api/datasets/sim_t/pid"])
def test_too_large(client, monkeypatch, url):
    monkeypatch.setattr(pid_router, "MAX_BYTES", 100)
    r = client.post(url, content=b"%PDF-" + b"x" * 96)
    assert r.status_code == 413
    assert r.json()["detail"] == "File too large (limit 50 MB)"


def test_preview_without_the_renderer(client, monkeypatch):
    monkeypatch.setattr(pid_router.shutil, "which", lambda name: None)
    r = client.post("/api/pid/preview", content=mono_pdf())
    assert r.status_code == 503
    assert r.json()["detail"] == "pdftoppm is not installed"
    assert client.post("/api/pid/preview", content=colour_svg()).json()["detail"] == "rsvg-convert is not installed"


@needs_pdftoppm
def test_preview_pdf(client):
    r = client.post("/api/pid/preview", content=mono_pdf())
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.content.startswith(pid_router.PNG_MAGIC)


@needs_rsvg
def test_preview_svg(client):
    r = client.post("/api/pid/preview", content=colour_svg())
    assert r.status_code == 200 and r.content.startswith(pid_router.PNG_MAGIC)


def test_use_as_pid_unknown_dataset(client):
    for r in (client.post("/api/datasets/nope/pid", content=PNG_1PX), client.get("/api/datasets/nope/pid/plant")):
        assert r.status_code == 404
        assert r.json()["detail"] == "Dataset 'nope' not found"


def test_plant_without_a_drawing(client):
    assert client.get("/api/datasets/sim_t/pid/plant").json() == {"components": [], "links": [], "pipes": []}


def test_use_png_stores_it_and_drops_a_stale_plant(client, dataset_dir):
    (dataset_dir / "dataset.json").write_text(json.dumps({"name": "Sim T", "kind": "simulation"}))
    (dataset_dir / "pid_plant.json").write_text(json.dumps({"components": [{"id": "old"}], "links": [], "pipes": []}))
    r = client.post("/api/datasets/sim_t/pid", content=PNG_1PX)
    assert r.json().items() >= {"pid_image": "pid.png", "bytes": len(PNG_1PX), "components": 0}.items()
    assert (dataset_dir / "pid.png").read_bytes() == PNG_1PX
    assert json.loads((dataset_dir / "dataset.json").read_text()) == {
        "name": "Sim T",
        "kind": "simulation",
        "pid_image": "pid.png",
    }
    assert not (dataset_dir / "pid_plant.json").exists()
    assert client.get("/api/datasets/sim_t/pid/plant").json() == {"components": [], "links": [], "pipes": []}


def test_use_drawing_whose_extraction_fails_drops_a_stale_plant(client, dataset_dir, monkeypatch):
    def fail(path, *_):
        raise ValueError("Extraction failed: nope")

    monkeypatch.setattr(pid_router, "read_drawing", fail)
    monkeypatch.setattr(pid_router, "_render_png", _fake_render)
    (dataset_dir / "pid_plant.json").write_text("{}")
    r = client.post("/api/datasets/sim_t/pid", content=mono_pdf())
    assert r.json().items() >= {"pid_image": "pid.png", "bytes": len(PNG_1PX), "components": 0}.items()
    assert not (dataset_dir / "pid_plant.json").exists()
    assert json.loads((dataset_dir / "dataset.json").read_text()) == {"pid_image": "pid.png"}


def test_use_drawing_stores_the_plant_in_page_fractions(client, dataset_dir, monkeypatch):
    monkeypatch.setattr(pid_router, "_render_png", _fake_render)
    r = client.post("/api/datasets/sim_t/pid", content=mono_pdf())
    assert r.json().items() >= {"pid_image": "pid.png", "bytes": len(PNG_1PX), "components": 3}.items()
    plant = client.get("/api/datasets/sim_t/pid/plant").json()
    assert plant["components"][0] == {"id": "tag0", "label": "P4711", "x": 80 / 600, "y": 100 / 400}
    assert plant["links"] == [["tag0", "tag1"], ["tag0", "tag2"], ["tag1", "tag2"]]
    assert len(plant["pipes"]) == 3  # no colour runs: the geometric edge routes
    assert all(0 <= v <= 1 for pipe in plant["pipes"] for pt in pipe for v in pt)


def test_use_drawing_that_cannot_render_changes_nothing(client, dataset_dir, monkeypatch):
    monkeypatch.setattr(pid_router.shutil, "which", lambda name: None)
    (dataset_dir / "pid_plant.json").write_text("{}")
    r = client.post("/api/datasets/sim_t/pid", content=mono_pdf())
    assert r.status_code == 503
    assert (dataset_dir / "pid_plant.json").read_text() == "{}"
    assert not (dataset_dir / "pid.png").exists()


def test_use_rejects_a_non_drawing(client):
    assert client.post("/api/datasets/sim_t/pid", content=b"hello").status_code == 422


@needs_rsvg
def test_use_svg_round_trip(client, dataset_dir):
    r = client.post("/api/datasets/sim_t/pid", content=colour_svg())
    assert r.status_code == 200 and r.json()["components"] == 4
    assert (dataset_dir / "pid.png").read_bytes().startswith(pid_router.PNG_MAGIC)
    plant = client.get("/api/datasets/sim_t/pid/plant").json()
    assert plant["components"][0] == {"id": "P4711", "label": "P4711", "x": 50 / 400, "y": 100 / 300}
    assert len(plant["pipes"]) == 3  # the colour runs


@needs_pdftoppm
def test_use_pdf_renders_at_200_dpi(client, dataset_dir):
    r = client.post("/api/datasets/sim_t/pid", content=make_pdf(b"0 0 m 72 72 l S", box=(0, 0, 72, 36)))
    assert r.status_code == 200
    png = (dataset_dir / "pid.png").read_bytes()
    assert int.from_bytes(png[16:20], "big") == 200  # IHDR width: 1 inch at 200 dpi


def test_a_view_gets_a_picture_of_its_own_backed_up_when_replaced_or_removed(client, dataset_dir, monkeypatch):
    url = "/api/datasets/sim_t/pid/views/unit-1"
    r = client.post(url, content=PNG_1PX)
    assert r.status_code == 200 and r.json() == {
        "view": "unit-1",
        "width": 1,
        "height": 1,
        "bytes": len(PNG_1PX),
        "backup": None,
        "area": None,  # not in site.json yet
        "shapes": 0,  # a PNG: no construct
        "note": "no construct: a PNG, or a PDF with only a scanned image in it, has no lines or texts to read",
    }
    assert (dataset_dir / "pid_views" / "unit-1.png").read_bytes() == PNG_1PX
    assert client.get(url + ".png").content == PNG_1PX
    assert not (dataset_dir / "pid.png").exists()  # the P&ID itself is untouched

    monkeypatch.setattr(pid_router, "_render_png", _fake_render)  # a PDF is rendered (its first page)
    again = client.post(url, content=make_pdf(b"0 0 m 72 72 l S")).json()
    assert again["backup"].startswith(".backup/") and (dataset_dir / again["backup"]).read_bytes() == PNG_1PX

    gone = client.delete(url).json()
    assert gone["removed"] and not (dataset_dir / "pid_views" / "unit-1.png").exists()
    assert client.get(url + ".png").status_code == 404
    assert client.delete(url).json() == {"removed": False, "backup": None}


def test_a_view_takes_its_pictures_shape(client, dataset_dir):
    site = {"pid_views": [{"id": "u", "name": "U", "x": 0.5, "y": 0.5, "w": 0.4, "h": 0.1}]}
    (dataset_dir / "site.json").write_text(json.dumps(site))
    wide = PNG_1PX[:16] + (200).to_bytes(4, "big") + (100).to_bytes(4, "big") + PNG_1PX[24:]  # a 200 x 100 IHDR
    # no P&ID picture: the app's own 1100 x 640 drawing; 0.4 wide = 440 units, so 220 units = 0.34375 high
    area = client.post("/api/datasets/sim_t/pid/views/u", content=wide).json()["area"]
    assert area["w"] == 0.4 and area["h"] == 0.34375
    assert json.loads((dataset_dir / "site.json").read_text())["pid_views"][0] == area
    tall = PNG_1PX[:16] + (100).to_bytes(4, "big") + (400).to_bytes(4, "big") + PNG_1PX[24:]
    area = client.post("/api/datasets/sim_t/pid/views/u", content=tall).json()["area"]
    assert area["h"] == 0.5 and area["w"] == round(0.5 * 640 / (4 * 1100), 6)  # would run off: narrower


def test_a_drawing_as_a_views_picture_is_read_into_its_construct(client, dataset_dir, monkeypatch):
    monkeypatch.setattr(pid_router, "_render_png", _fake_render)
    url = "/api/datasets/sim_t/pid/views/rack-1"
    r = client.post(url, content=colour_svg()).json()
    construct = client.get(url + "/construct").json()["shapes"]
    assert r["shapes"] == len(construct) > 0 and (dataset_dir / "pid_views" / "rack-1.construct.json").exists()
    assert any(s["role"] == "component" and s["label"] for s in construct)  # recognised, with the drawing's tag as label
    assert not (dataset_dir / "pid_construct.json").exists()  # the P&ID's own construct is untouched

    again = client.post(url, content=PNG_1PX).json()  # a PNG has no lines to read: the old construct goes (backed up)
    assert again["shapes"] == 0 and client.get(url + "/construct").json() == {"shapes": []}
    assert (dataset_dir / again["backup"]).with_suffix(".construct.json").exists()
    client.post(url, content=colour_svg())
    client.delete(url)
    assert not list((dataset_dir / "pid_views").glob("rack-1.*"))


def test_a_summary_tells_what_the_construct_would_hold_in_a_few_kb(client):
    whole = client.post("/api/pid/extract", content=colour_svg()).json()
    summary = client.post("/api/pid/extract", params={"summary": True}, content=colour_svg()).json()
    assert summary["shapes"] == sum(summary["by_role"].values()) > 0 and "drawing" in summary["by_role"]
    assert summary["labelled"] and all(x["label"] for x in summary["labelled"])
    assert len(json.dumps(summary)) < len(json.dumps(whole))


def test_a_views_picture_and_construct_are_copied_once_read_and_its_construct_can_be_replaced(client, dataset_dir, monkeypatch):
    monkeypatch.setattr(pid_router, "_render_png", _fake_render)
    views = [{"id": f"rack-{k}", "name": f"Rack {k}", "x": 0.1 * k, "y": 0.1, "w": 0.05, "h": 0.05} for k in (1, 2)]
    (dataset_dir / "site.json").write_text(json.dumps({"pid_views": views}))
    base = "/api/datasets/sim_t/pid/views"
    client.post(f"{base}/rack-1", content=colour_svg())
    copied = client.post(f"{base}/rack-2/copy", params={"source": "rack-1"}).json()
    assert copied["source"] == "rack-1" and copied["area"]["id"] == "rack-2"
    assert client.get(f"{base}/rack-2/construct").json() == client.get(f"{base}/rack-1/construct").json()
    assert (dataset_dir / "pid_views" / "rack-2.png").read_bytes() == (dataset_dir / "pid_views" / "rack-1.png").read_bytes()

    shapes = [{"id": "inst:0", "kind": "circle", "x": 0.2, "y": 0.3, "w": 0.02, "h": 0.04, "label": "TT1", "role": "instrument"}]
    saved = client.put(f"{base}/rack-2/construct", json={"shapes": shapes})
    assert saved.status_code == 200 and saved.json()["saved"]
    assert [s["label"] for s in client.get(f"{base}/rack-2/construct").json()["shapes"]] == ["TT1"]
    assert list((dataset_dir / ".backup").glob("*-pid-view-rack-2.construct.json"))  # the copied one, backed up
    assert len(client.get(f"{base}/rack-1/construct").json()["shapes"]) > 1  # the source is untouched


@pytest.mark.parametrize("url", ["/api/datasets/sim_t/pid", "/api/datasets/sim_t/pid/views/v1"])
def test_a_png_that_is_only_its_signature_is_refused(client, dataset_dir, url):
    # B-C5: 8 bytes of PNG signature were stored as the P&ID picture (and a view's size read from nothing)
    r = client.post(url, content=pid_router.PNG_MAGIC)
    assert r.status_code == 422 and "PNG" in r.json()["detail"]
    assert not (dataset_dir / "pid.png").exists()
