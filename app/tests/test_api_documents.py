"""The user's documents about a data center: any file kept as it is, listed with its path, described, removed."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.routers import documents as documents_router


def test_any_file_is_kept_as_it_is_in_silver_with_its_path_note_and_view(client: TestClient, dataset_dir: Path, api: str):
    assert client.get(f"{api}/documents").json()["documents"] == []
    old_word = b"\xd0\xcf\x11\xe0 a binary .doc: the app does not open it"
    up = client.post(
        f"{api}/documents/rack loop.doc", params={"note": "how the racks are cooled", "view": "rack-1"}, content=old_word
    )
    assert up.status_code == 200, up.text
    kept = dataset_dir / "silver" / "documents" / "rack loop.doc"  # silver: made here, never next to the data
    assert kept.read_bytes() == old_word and up.json()["path"] == str(kept.resolve())
    client.post(f"{api}/documents/photo.jpg", content=b"\xff\xd8 jpeg")
    listed = client.get(f"{api}/documents").json()
    assert [(d["name"], d["note"], d["view"], d["bytes"]) for d in listed["documents"]] == [
        ("photo.jpg", "", "", 7),
        ("rack loop.doc", "how the racks are cooled", "rack-1", len(old_word)),
    ]
    assert "own file tools" in listed["about"] and "constructs and causal links" in listed["about"]
    assert client.get(f"{api}/documents/rack loop.doc").content == old_word  # to open it in the browser


def test_an_assistant_can_save_its_own_text(client: TestClient, api: str):
    saved = client.put(
        f"{api}/documents/sensors.md/text", json={"text": "| TT1 | rack inlet |", "note": "AI: sensor table", "view": "rack-1"}
    )
    assert saved.status_code == 200 and saved.json()["bytes"] == 20
    assert client.get(f"{api}/documents/sensors.md").text == "| TT1 | rack inlet |"
    assert client.get(f"{api}/documents").json()["documents"][0]["view"] == "rack-1"
    assert client.put(f"{api}/documents/summary.pdf/text", json={"text": "x"}).status_code == 400


def test_info_replacing_and_removing_back_up_first(client: TestClient, dataset_dir: Path, api: str):
    client.post(f"{api}/documents/a.txt", content=b"first")
    again = client.post(f"{api}/documents/a.txt", content=b"second").json()
    assert again["backup"].startswith(".backup/") and (dataset_dir / again["backup"]).read_bytes() == b"first"
    info = client.put(f"{api}/documents/a.txt/info", json={"note": "valves", "view": "rack-2"}).json()
    assert info == {"name": "a.txt", "note": "valves", "view": "rack-2"}
    client.put(f"{api}/documents/a.txt/info", json={})
    assert client.get(f"{api}/documents").json()["documents"][0] | {"modified": "", "path": ""} == {
        "name": "a.txt",
        "path": "",
        "bytes": 6,
        "modified": "",
        "note": "",
        "view": "",
    }
    gone = client.delete(f"{api}/documents/a.txt").json()
    assert gone["removed"] and (dataset_dir / gone["backup"]).read_bytes() == b"second"
    assert (dataset_dir / again["backup"]).read_bytes() == b"first"  # within the same second: two backups, none lost
    assert client.get(f"{api}/documents").json()["documents"] == []


@pytest.mark.parametrize("name", ["documents.json", "Documents.JSON", ".hidden", "a\\b.txt"])  # B-D2: any case of the info file
def test_a_name_that_is_no_plain_file_name_is_refused(client: TestClient, api: str, name: str):
    assert client.post(f"{api}/documents/{name}", content=b"x").status_code == 400


def test_a_document_too_big_is_refused(client: TestClient, api: str, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(documents_router, "DOC_MAX_BYTES", 10)
    assert client.post(f"{api}/documents/a.txt", content=b"x" * 11).status_code == 413


def test_a_page_or_drawing_opens_without_running_its_scripts(client: TestClient, api: str):
    client.post(f"{api}/documents/plan.svg", content=b"<svg xmlns='http://www.w3.org/2000/svg'><script>x()</script></svg>")
    client.post(f"{api}/documents/plan.pdf", content=b"%PDF-1.4")
    svg, pdf = client.get(f"{api}/documents/plan.svg"), client.get(f"{api}/documents/plan.pdf")
    assert svg.headers["content-security-policy"] == "sandbox" and svg.headers["x-content-type-options"] == "nosniff"
    assert "content-security-policy" not in pdf.headers and pdf.headers["content-disposition"].startswith("inline")


@pytest.mark.parametrize("name", ["page.xht", "style.xsl", "data.rdf", "notes.txt", "photo.png", "sheet.xlsx", "x.mht"])
def test_every_document_but_a_pdf_opens_in_a_sandbox(client: TestClient, api: str, name: str):
    # B-S4: .xht, .xsl and .rdf run scripts in a browser too, and a list of the active kinds misses some
    assert client.post(f"{api}/documents/{name}", content=b"<x/>").status_code == 200
    r = client.get(f"{api}/documents/{name}")
    assert r.headers["content-security-policy"] == "sandbox" and r.headers["x-content-type-options"] == "nosniff"
