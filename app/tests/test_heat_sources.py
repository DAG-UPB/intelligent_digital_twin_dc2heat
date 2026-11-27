"""Several heat demand sources side by side: write_db, find_dbs, the merged map-box query, and the NRW import from a
tiny synthetic shapefile zip (app/sources/)."""

import os
import sqlite3
import struct
import zipfile
from pathlib import Path

import pytest

from backend.core.waermeatlas import buildings_in, find_dbs, heat_lines_in, parts_of, set_parts, utm32_to_wgs84, write_db
from sources import shp
from sources.nrw import fetch as nrw

AROUND = (50.0, 7.0, 50.01, 7.01)


def _building(i: int, lat: float, lon: float, kwh: float) -> dict:
    return {"id": i, "lat": lat, "lon": lon, "use": "Wohngebäude", "type": "EFH", "total_kwh": kwh, "outline": None}


def test_sources_merge_biggest_first_each_with_its_credit(tmp_path: Path) -> None:
    a, b = tmp_path / "_external" / "a" / "buildings.sqlite", tmp_path / "_external" / "b" / "buildings.sqlite"
    assert write_db(a, "© A", [_building(1, 50.005, 7.005, 10.0), _building(1, 50.005, 7.005, 99.0)]) == (1, 0)  # once
    line = {"ref": "s", "mwh_per_m": 2.0, "line": [[[50.004, 7.004], [50.006, 7.006]]]}
    assert write_db(b, "© B", [_building(1, 50.006, 7.006, 20.0)], [line]) == (1, 1)
    dbs = find_dbs([tmp_path / "_external", tmp_path / "missing"])
    assert [p.parent.name for p in dbs] == ["a", "b"]
    got = buildings_in(dbs, *AROUND)
    assert [(x["source"], x["id"], x["total_kwh"]) for x in got["buildings"]] == [("b", 1, 20.0), ("a", 1, 10.0)]
    assert got["sources"] == {"a": "© A", "b": "© B"}
    assert buildings_in(dbs, *AROUND, limit=1)["truncated"]
    lines = heat_lines_in(dbs, *AROUND)  # a has no street segments: b's only
    assert [(x["source"], x["mwh_per_m"]) for x in lines["lines"]] == [("b", 2.0)] and lines["sources"] == {"b": "© B"}
    with pytest.raises(FileNotFoundError, match="app/sources"):
        buildings_in([], *AROUND)


def test_find_dbs_takes_each_sources_newest(tmp_path: Path) -> None:
    old, new = tmp_path / "one" / "nrw" / "buildings.sqlite", tmp_path / "two" / "nrw" / "buildings.sqlite"
    for p in (old, new):
        p.parent.mkdir(parents=True)
        p.write_text("db")
    os.utime(old, (1, 1))
    assert find_dbs([tmp_path / "one", tmp_path / "two"]) == [new]


def test_find_dbs_reads_a_file_per_municipality_and_nothing_else(tmp_path: Path) -> None:
    for name in ("nrw/buildings_05314000_Bonn.sqlite", "nrw/buildings_05774032_Paderborn.sqlite", "pfa/sources.sqlite"):
        (tmp_path / name).parent.mkdir(exist_ok=True)
        (tmp_path / name).write_text("db")
    assert [p.name for p in find_dbs([tmp_path])] == ["buildings_05314000_Bonn.sqlite", "buildings_05774032_Paderborn.sqlite"]


# ---- a tiny NRW municipality: shapefiles written by hand, zipped as LANUK names them ----


def _dbf(fields: list[tuple[str, str, int, int]], rows: list[list]) -> bytes:
    """A dBASE III file: (name, type C/N/F, size, decimals) fields."""
    head = struct.pack("<BBBBIHH20x", 3, 124, 1, 1, len(rows), 32 + 32 * len(fields) + 1, 1 + sum(f[2] for f in fields))
    desc = b"".join(struct.pack("<11sc4xBB14x", n.encode(), t.encode(), s, d) for n, t, s, d in fields) + b"\r"
    body = b"".join(
        b" " + b"".join((str(v) if v is not None else "").encode().rjust(s) if t != "C" else str(v or "").encode().ljust(s)
                        for (_, t, s, _), v in zip(fields, row, strict=True))
        for row in rows
    )  # fmt: skip
    return head + desc + body + b"\x1a"


def _shp(kind: int, shapes: list[list[list[tuple[float, float]]]]) -> bytes:
    """A .shp of polylines (3) or polygons (5): each shape its parts."""
    recs = b""
    for i, parts in enumerate(shapes, 1):
        pts = [p for part in parts for p in part]
        starts, at = [], 0
        for part in parts:
            starts.append(at)
            at += len(part)
        body = struct.pack("<i4d2i", kind, 0, 0, 0, 0, len(parts), len(pts)) + struct.pack(f"<{len(parts)}i", *starts)
        body += b"".join(struct.pack("<2d", *p) for p in pts)
        recs += struct.pack(">2i", i, len(body) // 2) + body
    return struct.pack(">7i", 9994, 0, 0, 0, 0, 0, (100 + len(recs)) // 2) + struct.pack("<2i8d", 1000, kind, *[0] * 8) + recs


def _square(x: float, y: float, r: float) -> list[tuple[float, float]]:
    return [(x - r, y - r), (x - r, y + r), (x + r, y + r), (x + r, y - r), (x - r, y - r)]


X0, Y0 = 365000.0, 5621000.0  # UTM 32N, near Bonn
TAIL = "05314000_Bonn"


@pytest.fixture
def nrw_zip(tmp_path: Path) -> Path:
    """A heated house with its outline, an unheated shed, two street segments (one without heat)."""
    fields = [("Fest_ID", "N", 10, 0), ("Nutzung", "C", 60, 0), ("beheizt", "N", 5, 0), ("WG_NWG", "C", 5, 0),
              ("WG_Typ", "C", 8, 0), ("GEBAEUDETY", "C", 12, 0), ("NF", "F", 19, 11), ("RW", "F", 19, 11),
              ("WW", "F", 19, 11), ("RW_WW", "F", 19, 11)]  # fmt: skip
    rows = [[11, "Wohngebäude", 1, "WG", "GMFH", "GMFH_1960", 800.5, 70000.4, 15000.0, 85000.4],
            [12, "Schuppen", 0, "NWG", "0", "0", 10.0, 0.0, 0.0, 0.0]]  # fmt: skip
    later = [("Fest_ID", "N", 10, 0), ("RW_m_30", "F", 19, 11), ("RW_m_45", "F", 19, 11)]
    lines = [("WLD_ID", "N", 10, 0), ("Strassenla", "F", 19, 11), ("RW_WW_GHD_", "F", 19, 11), ("Waermedich", "F", 19, 11)]
    path = tmp_path / "nrw" / f"KWP-NRW_{TAIL}_EPSG25832_Shape.zip"
    path.parent.mkdir()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"WBM-NRW_{TAIL}.dbf", _dbf(fields, rows))
        z.writestr(f"WBM-NRW_{TAIL}.shp", _shp(5, [[_square(X0, Y0, 10)], [_square(X0 + 50, Y0, 3)]]))
        z.writestr(f"WBM-NRW-moderat_{TAIL}.dbf", _dbf(later, [[11, 60000.0, 40000.0], [12, 0.0, 0.0]]))
        z.writestr(f"WBM-NRW-moderat_{TAIL}.shp", _shp(5, [[_square(X0, Y0, 10)], [_square(X0 + 50, Y0, 3)]]))
        z.writestr(f"WBM-NRW-Waermelinien_{TAIL}.dbf", _dbf(lines, [[7, 100.0, 250000.0, 2500.0], [8, 50.0, 0.0, 0.0]]))
        streets = [[[(X0 - 50, Y0 - 20), (X0 + 50, Y0 - 20)]], [[(X0, Y0 + 90), (X0 + 50, Y0 + 90)]]]
        z.writestr(f"WBM-NRW-Waermelinien_{TAIL}.shp", _shp(3, streets))
    return path


def test_shapefile_reader_reads_the_records_with_their_shapes(nrw_zip: Path) -> None:
    with zipfile.ZipFile(nrw_zip) as z:
        got = list(shp.records(z.open, f"WBM-NRW_{TAIL}"))
    assert [r["Fest_ID"] for r, _ in got] == [11.0, 12.0] and got[0][0]["Nutzung"] == "Wohngebäude"
    assert got[0][1] == [_square(X0, Y0, 10)]
    assert shp.centroid(_square(X0, Y0, 10)) == pytest.approx((X0, Y0)) and shp.ring_area(_square(X0, Y0, 10)) == 400


def test_nrw_import_keeps_the_heated_buildings_and_the_streets_with_heat(nrw_zip: Path) -> None:
    db = nrw_zip.parent / "buildings.sqlite"
    assert nrw.build([nrw_zip], db) == (1, 1)
    lat, lon = utm32_to_wgs84(X0, Y0)
    box = (lat - 0.003, lon - 0.004, lat + 0.003, lon + 0.004)
    [house] = buildings_in(db, *box)["buildings"]
    assert house["id"] == 11 and house["type"] == "GMH" and house["age"] == "1946–1960" and house["source"] == "nrw"
    assert (house["heating_kwh"], house["hot_water_kwh"], house["total_kwh"], house["area_m2"]) == (70000, 15000, 85000, 800.5)
    assert (house["heating_2030_kwh"], house["heating_2045_kwh"]) == (60000, 40000)
    assert (house["lat"], house["lon"]) == pytest.approx((lat, lon), abs=1e-6) and len(house["outline"]) == 5
    got = heat_lines_in(db, *box)
    [street] = got["lines"]
    assert (street["mwh_per_m"], street["mwh"], street["length_m"]) == (2.5, 250, 100) and "LANUK" in got["sources"]["nrw"]


def test_nrw_names_are_found_by_name_or_ags() -> None:
    files = {"05315000": "KWP-NRW_05315000_Koeln_EPSG25832_Shape.zip", "05314000": "KWP-NRW_05314000_Bonn_EPSG25832_Shape.zip"}
    assert nrw.pick(["Köln", "05314000", "bonn"], files) == [files["05315000"], files["05314000"], files["05314000"]]
    with pytest.raises(ValueError, match="Koeln"):
        nrw.pick(["Koelnx"], files)


def test_a_file_remembers_the_downloads_it_was_built_from(tmp_path: Path) -> None:
    db = tmp_path / "nrw" / "buildings.sqlite"
    assert parts_of(db) == []  # not built yet
    db.parent.mkdir()
    sqlite3.connect(db).close()  # a file from before the meta table
    assert parts_of(db) == []
    write_db(db, "credit", [])
    set_parts(db, ["b.zip", "a.zip"])
    assert parts_of(db) == ["a.zip", "b.zip"]
