"""Wärmeatlas buildings: UTM -> WGS84, the import from a tiny synthetic GeoPackage, the map-box query and its route."""

import math
import os
import sqlite3
import struct
from pathlib import Path

import import_waermeatlas
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core.waermeatlas import DB_FILE, buildings_in, find_db, heat_lines_in, utm32_to_wgs84

A, F, K0 = 6378137.0, 1 / 298.257222101, 0.9996  # GRS80, UTM


def _meridian_arc(lat: float, steps: int = 20000) -> float:
    """Exact meridian arc length (m) from the equator, by integrating the radius of curvature (Simpson)."""
    e2 = F * (2 - F)
    phi = math.radians(lat)
    m = lambda p: A * (1 - e2) / (1 - e2 * math.sin(p) ** 2) ** 1.5  # noqa: E731
    h = phi / steps
    return h / 3 * sum((1 if i in (0, steps) else 4 if i % 2 else 2) * m(i * h) for i in range(steps + 1))


def _forward(lat: float, lon: float) -> tuple[float, float]:
    """(east, north) in UTM 32N by Krüger's forward series: the inverse of the function under test."""
    n = F / (2 - F)
    big_a = A / (1 + n) * (1 + n**2 / 4 + n**4 / 64)
    alpha = (n / 2 - 2 * n**2 / 3 + 5 * n**3 / 16, 13 * n**2 / 48 - 3 * n**3 / 5, 61 * n**3 / 240)
    phi, dl = math.radians(lat), math.radians(lon - 9)
    c = 2 * math.sqrt(n) / (1 + n)
    t = math.sinh(math.atanh(math.sin(phi)) - c * math.atanh(c * math.sin(phi)))
    xi, eta = math.atan(t / math.cos(dl)), math.atanh(math.sin(dl) / math.sqrt(1 + t * t))
    east = 500000 + K0 * big_a * (eta + sum(a * math.cos(2 * j * xi) * math.sinh(2 * j * eta) for j, a in enumerate(alpha, 1)))
    north = K0 * big_a * (xi + sum(a * math.sin(2 * j * xi) * math.cosh(2 * j * eta) for j, a in enumerate(alpha, 1)))
    return east, north


def test_utm_on_the_central_meridian_matches_the_meridian_arc() -> None:
    for lat in (0.0, 50.0, 50.11):
        got = utm32_to_wgs84(500000.0, K0 * _meridian_arc(lat))
        assert got == pytest.approx((lat, 9.0), abs=1e-8)  # ~1 mm


def test_utm_round_trips_across_frankfurt() -> None:
    for lat, lon in ((50.1131636, 8.6719057), (50.02, 8.47), (50.23, 8.80)):
        assert utm32_to_wgs84(*_forward(lat, lon)) == pytest.approx((lat, lon), abs=1e-8)


# ---- a tiny GeoPackage with the two tables the import reads ----


def _blob(wkb: bytes, envelope: tuple[float, ...] = ()) -> bytes:
    """GeoPackage geometry: header (little endian, envelope [minx, maxx, miny, maxy] or none), then WKB."""
    flags = 0x01 | (0x02 if envelope else 0)
    return b"GP" + bytes([0, flags]) + struct.pack("<i", 25832) + struct.pack("<" + "d" * len(envelope), *envelope) + wkb


def _point(x: float, y: float) -> bytes:
    return _blob(struct.pack("<BIdd", 1, 1, x, y))


def _square(x: float, y: float, r: float) -> tuple[bytes, tuple[float, float, float, float]]:
    ring = [(x - r, y - r), (x + r, y - r), (x + r, y + r), (x - r, y + r), (x - r, y - r)]
    polygon = struct.pack("<BII", 1, 3, 1) + struct.pack("<I", len(ring)) + b"".join(struct.pack("<dd", *p) for p in ring)
    box = (x - r, x + r, y - r, y + r)
    return _blob(struct.pack("<BII", 1, 6, 1) + polygon, box), box


def _multiline(*parts: list[tuple[float, float]]) -> bytes:
    lines = b"".join(struct.pack("<BII", 1, 2, len(p)) + b"".join(struct.pack("<dd", *q) for q in p) for p in parts)
    return _blob(struct.pack("<BII", 1, 5, len(parts)) + lines)


AGE_COLUMNS = [f"gebalter_{c}" for c, _ in import_waermeatlas.AGES]
OFFICE = "Büro-, Verwaltungs- oder Amtsgebäude"  # a non-residential GEMOD type
X0, Y0 = _forward(50.1131636, 8.6719057)  # a point in Frankfurt's centre, in UTM


@pytest.fixture
def gpkg(tmp_path: Path) -> Path:
    """Three buildings: a heated office with its outline, a heated house without one, an unheated garage."""
    path = tmp_path / "w.gpkg"
    con = sqlite3.connect(path)
    con.execute(
        "CREATE TABLE WAH_Punkte (fid INTEGER PRIMARY KEY, geom BLOB, gebid INTEGER, nutzmix_alkis_beschreib TEXT, "
        "gebtyp_gemod TEXT, energieflaeche REAL, qh_2020_kwh REAL, qw_2020_kwh REAL, qnutzwaerme_2020_kwh REAL, "
        "qh_moderate_sanierung_2030_kwh REAL, qh_moderate_sanierung_2045_kwh REAL, "
        f"{', '.join(c + ' REAL' for c in AGE_COLUMNS)})"
    )
    con.execute("CREATE TABLE Hausumringe (fid INTEGER PRIMARY KEY, geom BLOB)")
    con.execute("CREATE VIRTUAL TABLE rtree_Hausumringe_geom USING rtree(id, minx, maxx, miny, maxy)")
    ages, unknown = [0.0] * len(AGE_COLUMNS), [None] * len(AGE_COLUMNS)
    ages[4] = 0.7  # 1958–1968
    rows = [
        (1, _point(X0, Y0), 11, "Bürogebäude", OFFICE, 5000.0, 400000.0, 50000.0, 450000.0, 1, 2, *unknown),
        (2, _point(X0 + 50, Y0), 12, "Wohngebäude", "MFH", 800.0, 70000.0, 15000.0, 85000.0, 3, 4, *ages),
        (3, _point(X0 - 50, Y0), 13, "Garage", None, None, None, None, None, None, None, *unknown),
    ]  # fmt: skip
    con.executemany(f"INSERT INTO WAH_Punkte VALUES ({','.join('?' * len(rows[0]))})", rows)
    blob, box = _square(X0, Y0, 10)
    con.execute("INSERT INTO Hausumringe VALUES (1, ?)", (blob,))
    con.execute("INSERT INTO rtree_Hausumringe_geom VALUES (1, ?, ?, ?, ?)", box)
    # street segments: a dense one (two parts) along the office, a thin one, one without heat
    con.execute(
        "CREATE TABLE WAH_Strassenabschnitte (fid INTEGER PRIMARY KEY, geom BLOB, id TEXT, name TEXT, klasse TEXT, "
        "laenge_segment REAL, nutzwaerme_pro_m REAL, raumwaerme REAL, warmwasser REAL)"
    )
    streets = [
        (1, _multiline([(X0 - 100, Y0 - 20), (X0, Y0 - 20)], [(X0, Y0 - 20), (X0 + 100, Y0 - 20)]), "s1", "Taunusanlage",
         "Gemeindestraße", 200.0, 2675.0, 485000.0, 50000.0),
        (2, _multiline([(X0 + 40, Y0 + 30), (X0 + 60, Y0 + 30)]), "s2", "Weg", "Weg, Pfad, Steig", 20.0, 500.0, 9000.0, 1000.0),
        (3, _multiline([(X0, Y0 + 300), (X0 + 10, Y0 + 300)]), "s3", "Leer", "Gemeindestraße", 10.0, 0.0, 0.0, 0.0),
    ]  # fmt: skip
    con.executemany("INSERT INTO WAH_Strassenabschnitte VALUES (?,?,?,?,?,?,?,?,?)", streets)
    con.commit()
    con.close()
    return path


@pytest.fixture
def db(gpkg: Path, tmp_path: Path) -> Path:
    out = tmp_path / "data" / DB_FILE
    out.parent.mkdir(parents=True)
    assert import_waermeatlas.build(gpkg, out) == 2  # the garage has no heat demand
    return out


AROUND = (50.11, 8.668, 50.116, 8.676)  # ~0.7 × 0.6 km around that point


def test_import_joins_each_point_to_the_outline_around_it(db: Path) -> None:
    got = {b["id"]: b for b in buildings_in(db, *AROUND)["buildings"]}
    office, house = got[11], got[12]
    assert office["total_kwh"] == 450000 and office["hot_water_kwh"] == 50000 and office["age"] is None
    assert (office["lat"], office["lon"]) == pytest.approx((50.1131636, 8.6719057), abs=1e-6)
    assert len(office["outline"]) == 5 and all(abs(lat - 50.1131636) < 2e-4 for lat, _ in office["outline"])
    assert house["outline"] is None and house["age"] == "1958–1968" and house["age_share"] == 0.7
    assert house["type"] == "MFH" and house["area_m2"] == 800


def test_query_reads_only_the_box_biggest_first_and_caps_the_count(db: Path) -> None:
    assert buildings_in(db, 50.12, 8.68, 50.13, 8.69)["buildings"] == []
    capped = buildings_in(db, *AROUND, limit=1)
    assert capped["truncated"] and [b["id"] for b in capped["buildings"]] == [11]


def test_query_rejects_big_or_bad_boxes_and_a_missing_import(db: Path, tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Zoom in"):
        buildings_in(db, 50.0, 8.6, 50.1, 8.7)
    with pytest.raises(ValueError, match="south < north"):
        buildings_in(db, 50.12, 8.6, 50.11, 8.7)
    with pytest.raises(ValueError, match="finite"):
        buildings_in(db, math.nan, 8.6, 50.11, 8.7)
    with pytest.raises(FileNotFoundError, match="import_waermeatlas"):
        buildings_in(tmp_path / "missing.sqlite", *AROUND)


def test_route(db: Path) -> None:
    client = TestClient(create_app(db.parents[2]))
    r = client.get("/api/district/buildings", params={"bbox": ",".join(map(str, AROUND))})
    assert r.status_code == 200 and len(r.json()["buildings"]) == 2 and r.json()["truncated"] is False
    bad = (("1,2,3", "four numbers"), ("a,b,c,d", "four numbers"), ("50,8.6,50.1,8.7", "Zoom in"), ("nan,8,50,9", "finite"))
    for bbox, detail in bad:
        r = client.get("/api/district/buildings", params={"bbox": bbox})
        assert r.status_code == 400 and detail in r.json()["detail"], bbox


def test_find_db_takes_the_own_import_else_another(tmp_path: Path) -> None:
    own, a, b = (tmp_path / n / "buildings.sqlite" for n in ("own", "a", "b"))
    assert find_db(own, [a, b]) == own  # none: the own one, whose error says how to import
    b.parent.mkdir()
    b.write_text("db")
    assert find_db(own, [a, b]) == b  # the examples' or another version's
    own.parent.mkdir()
    own.write_text("db")
    os.utime(b, (1, 1))  # b older
    assert find_db(own, [a, b]) == own  # the newest: it holds every municipality imported so far
    os.utime(own, (0, 0))
    assert find_db(own, [a, b]) == b


def test_import_merges_deliveries_once_each(gpkg: Path, tmp_path: Path) -> None:
    out = tmp_path / "merged.sqlite"
    assert import_waermeatlas.build([gpkg, gpkg], out) == 2  # the same buildings twice: written once
    assert import_waermeatlas.delivery_of("https://x/daten_auslieferung/06411000_Darmstadt.zip") == "06411000_Darmstadt"
    assert import_waermeatlas.delivery_of("../../x/06411000_Darmstadt") == "06411000_Darmstadt"  # the last segment only
    with pytest.raises(ValueError, match="delivery"):
        import_waermeatlas.delivery_of("Darmstadt; rm -rf")


def test_import_keeps_the_streets_with_heat_and_their_line_density(db: Path) -> None:
    got = heat_lines_in(db, *AROUND)
    assert not got["truncated"] and [h["name"] for h in got["lines"]] == ["Taunusanlage", "Weg"]  # densest first, no empty one
    dense = got["lines"][0]
    assert dense["mwh_per_m"] == 2.675 and dense["mwh"] == 535 and dense["length_m"] == 200 and dense["kind"] == "Gemeindestraße"
    assert len(dense["line"]) == 2 and all(len(part) == 2 for part in dense["line"])  # its two parts, [lat, lon] each
    assert dense["line"][0][1] == pytest.approx(list(utm32_to_wgs84(X0, Y0 - 20)), abs=1e-6)
    assert heat_lines_in(db, *AROUND, limit=1)["truncated"]
    assert heat_lines_in(db, 50.12, 8.68, 50.13, 8.69)["lines"] == []


def test_heat_lines_need_an_import_with_them(db: Path, tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="import_waermeatlas"):
        heat_lines_in(tmp_path / "missing.sqlite", *AROUND)
    old = sqlite3.connect(db)
    old.execute("DROP TABLE heat_lines")
    old.commit()
    old.close()
    with pytest.raises(FileNotFoundError, match="--rebuild"):
        heat_lines_in(db, *AROUND)


def test_heat_lines_route(db: Path) -> None:
    client = TestClient(create_app(db.parents[2]))
    r = client.get("/api/district/heat-lines", params={"bbox": ",".join(map(str, AROUND))})
    assert r.status_code == 200 and len(r.json()["lines"]) == 2
    r = client.get("/api/district/heat-lines", params={"bbox": "50,8.6,50.1,8.7"})
    assert r.status_code == 400 and "Zoom in" in r.json()["detail"]
