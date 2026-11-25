"""Plattform für Abwärme: the import from a tiny synthetic .xlsx (geocoding stubbed: nothing leaves the machine), the
map-box query and its route."""

import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import import_pfa
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core.pfa import DB_FILE, sources_in

HEAD = [
    "Unternehmens-\nID", "Melde-\nID", "Firmenname", "Standortname", "Straße und Hausnummer", "PLZ", "Ort",
    "Name des Abwärmepotentials", "Wärmemenge\npro Jahr\n(in kWh/a)", "Maximale thermische\nLeistung\n(in kW)",
    "Durchschnittliches\nTemperaturniveau\n(in °C)", "Temperaturbereich", "Durchschnittliche\ntägl. Verfügbarkeit\n(in h)",
    "Verfügbarkeit am\nWochenende", "Verfügbarkeit", "Vorhersehbarkeit der\nVerfügbarkeit", "Vorhandene Regelungsmöglichkeiten",
    *(f"Leistungsprofil\n{m}\n(in kW)" for m in import_pfa.MONTHS),
    "Ergänzende Informationen zum Abwärmepotential", "E-Mail-Adresse", "Telefonnummer",
]  # fmt: skip
MONTHLY = ["100000"] * 12  # kWh per month: 1,200 MWh a year


def _row(ref: str, plz: str, city: str, street: str, kwh: str, temp: str) -> list[str]:
    return ["1", ref, "​ACME GmbH", "Werk", street, plz, city, "Kühlturm", kwh, "500", temp, "25 - 60 °C", "24", "Ja",
            "7 Tage 24 Std", "Nein", "TEMPERATUR", *MONTHLY, "Abwärme aus der Kühlung", "secret@acme.de", "0123"]  # fmt: skip


def _sheet(rows: list[list[str]]) -> str:
    def cells(r: list[str]) -> str:
        return "".join(f'<c t="inlineStr"><is><t>{escape(v)}</t></is></c>' for v in r)

    body = "".join(f"<row>{cells(r)}</row>" for r in rows)
    return f'<worksheet xmlns="{import_pfa.NS["m"]}"><sheetData>{body}</sheetData></worksheet>'


def _xlsx(path: Path, rows: list[list[str]], head: list[str] = HEAD) -> Path:
    """A workbook with an info sheet and the potentials' sheet (caption row, header row, data), inline strings."""
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(
            "xl/workbook.xml",
            f'<workbook xmlns="{import_pfa.NS["m"]}" xmlns:r="{rel}"><sheets>'
            '<sheet name="Informationen" sheetId="1" r:id="rId1"/><sheet name="Abwärmepotentiale" sheetId="2" r:id="rId2"/>'
            "</sheets></workbook>",
        )
        z.writestr(
            "xl/_rels/workbook.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/>'
            "</Relationships>",
        )
        z.writestr("xl/worksheets/sheet1.xml", _sheet([["Die Plattform für Abwärme"]]))
        z.writestr("xl/worksheets/sheet2.xml", _sheet([["", "", "Informationen zur Firma"], head, *rows]))
    return path


PLACES = {"Hanauer Landstraße 1": (50.1131, 8.7012)}


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Three sources in Frankfurt (two of one report, placed by their postcode only) and one in Munich (left out)."""
    xlsx = _xlsx(
        tmp_path / "pfa.xlsx",
        [
            _row("11", "60314", "Frankfurt am Main", "Hanauer Landstraße 1", "1200000", "35"),
            _row("12", "60314", "63607 Frankfurt am Main", "Nirgendwo 9", "300000", "95,5"),
            _row("12", "60314", "Frankfurt am Main", "Nirgendwo 9", "100000", "40"),  # a second potential of report 12
            _row("13", "80331", "München", "Marienplatz 1", "9000000", "120"),
        ],
    )

    def place(rec: dict, cache: dict, offline: bool):  # the address, else its postcode: no request
        hit = PLACES.get(rec["street"])
        return (*hit, "address") if hit else (50.11, 8.70, "postcode")

    monkeypatch.setattr(import_pfa, "geocode", place)
    monkeypatch.setattr(import_pfa, "CACHE", tmp_path / "cache.json")
    out = tmp_path / "data" / DB_FILE
    assert import_pfa.build(xlsx, out, ("60",)) == (3, 0)
    return out


BOX = (50.0, 8.5, 50.2, 8.9)


def test_import_keeps_the_postcodes_asked_for_and_their_figures(db: Path) -> None:
    got = sources_in(db, *BOX)
    assert not got["truncated"] and [s["id"] for s in got["sources"]] == [1, 2, 3]  # the largest first
    big, small, third = got["sources"]
    assert big["company"] == "ACME GmbH" and big["mwh"] == 1200 and big["max_kw"] == 500 and big["temp_c"] == 35
    assert big["months_mwh"] == [100.0] * 12 and big["weekend"] is True and big["predictable"] is False
    assert (big["lat"], big["lon"], big["geo"]) == (50.1131, 8.7012, "address")
    assert small["temp_c"] == 95.5 and small["geo"] == "postcode"  # the German decimal comma
    assert small["city"] == "Frankfurt am Main"  # the postcode repeated in the town dropped
    assert third["mwh"] == 100 and third["temp_c"] == 40  # the same report's second potential, its own source
    assert "secret@acme.de" not in str(got) and "0123" not in str(got)  # the contact columns are not imported


def test_query_box_and_missing_import(db: Path, tmp_path: Path) -> None:
    assert sources_in(db, 48.0, 11.0, 48.2, 11.2)["sources"] == []
    assert sources_in(db, *BOX, limit=1)["truncated"]
    with pytest.raises(ValueError, match="Zoom in"):
        sources_in(db, 49.0, 8.0, 51.0, 9.0)  # ~70 × 220 km
    with pytest.raises(FileNotFoundError, match="import_pfa"):
        sources_in(tmp_path / "missing.sqlite", *BOX)


def test_route(db: Path) -> None:
    client = TestClient(create_app(db.parents[2]))
    r = client.get("/api/district/heat-sources", params={"bbox": ",".join(map(str, BOX))})
    assert r.status_code == 200 and len(r.json()["sources"]) == 3
    r = client.get("/api/district/heat-sources", params={"bbox": "49,8,51,9"})
    assert r.status_code == 400 and "Zoom in" in r.json()["detail"]


def test_a_missing_column_is_named(tmp_path: Path) -> None:
    xlsx = _xlsx(tmp_path / "bad.xlsx", [], [h if h != "Firmenname" else "Firma" for h in HEAD])
    with pytest.raises(ValueError, match="company"):
        list(import_pfa.records(xlsx, ("60",)))
