"""Waste heat sources of the Plattform für Abwärme (PfA, BfEE/BAFA, CC BY 4.0), read one map box at a time.

`scripts/import_pfa.py` reads the published Excel table once, geocodes the addresses and writes a small local SQLite
file (`DB_FILE` in the data directory): one row per reported waste heat potential with its place and an R-tree. A
query reads only the R-tree pages and rows of its box. The sources are the region's, not a data center's: one import
serves every data folder (waermeatlas.find_db picks the newest). Pure stdlib (sqlite3, json).
"""

import json
import sqlite3
from pathlib import Path

from .limits import PFA_MAX_BOX_KM, PFA_MAX_SOURCES
from .waermeatlas import check_box

DB_FILE = Path("_external") / "pfa" / "sources.sqlite"  # relative to the data directory
ATTRIBUTION = "Plattform für Abwärme © BfEE/BAFA, CC BY 4.0"

# The column names below are the contract between the import script and the query.
SCHEMA = """
CREATE TABLE sources (
    id INTEGER PRIMARY KEY,                 -- our own row id
    ref TEXT UNIQUE,                        -- the PfA's Melde-ID and the potential's number in that report
    company TEXT, site TEXT,                -- Firmenname, Standortname
    street TEXT, plz TEXT, city TEXT,       -- the reported address
    name TEXT,                              -- the potential's name, e.g. "Kühlturm", "Abgas Dampfkessel"
    mwh REAL,                               -- heat a year, MWh/a
    max_kw REAL,                            -- maximum thermal power, kW
    temp_c REAL, temp_range TEXT,           -- mean temperature °C and its range ("25 - 60 °C", ">=110 °C")
    hours_per_day REAL, weekend INTEGER,    -- mean hours a day available; on weekends too (1/0, null unknown)
    availability TEXT, predictable INTEGER, -- e.g. "7 Tage 24 Std"; predictable (1/0)
    control TEXT,                           -- what can be controlled, e.g. "DRUCK, TEMPERATUR"
    months_mwh TEXT,                        -- JSON, the twelve "Leistungsprofil (in kW)" figures ÷ 1000, January first, or null:
                                            -- mostly a mean kW (so MW), some kWh a month (so MWh): a shape, not an amount
    note TEXT,                              -- the supplementary information, at most 500 characters
    lat REAL NOT NULL, lon REAL NOT NULL,   -- geocoded (WGS84)
    geo TEXT NOT NULL                       -- "address" or "postcode" (placed at its postcode and town only)
);
CREATE VIRTUAL TABLE sources_rtree USING rtree(id, min_lat, max_lat, min_lon, max_lon);
"""
COLUMNS = (
    "id", "company", "site", "street", "plz", "city", "name", "mwh", "max_kw", "temp_c", "temp_range",
    "hours_per_day", "weekend", "availability", "predictable", "control", "note", "lat", "lon", "geo",
)  # fmt: skip


def sources_in(db: Path, south: float, west: float, north: float, east: float, limit: int = PFA_MAX_SOURCES) -> dict:
    """The waste heat sources in the box: {"sources": [...], "truncated": bool}, the largest (MWh/a) first.

    FileNotFoundError when nothing has been imported; ValueError for a bad box or one above PFA_MAX_BOX_KM.
    """
    check_box(south, west, north, east, PFA_MAX_BOX_KM)
    if not db.exists():
        raise FileNotFoundError("No Plattform für Abwärme data on this machine: run scripts/import_pfa.py (in app/) once.")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        rows = con.execute(
            f"SELECT {', '.join('s.' + c for c in COLUMNS)}, s.months_mwh FROM sources_rtree r JOIN sources s ON s.id = r.id "
            "WHERE r.max_lat >= ? AND r.min_lat <= ? AND r.max_lon >= ? AND r.min_lon <= ? ORDER BY s.mwh DESC LIMIT ?",
            (south, north, west, east, limit + 1),
        ).fetchall()
    finally:
        con.close()
    out = []
    for r in rows[:limit]:
        s = dict(zip(COLUMNS, r[:-1], strict=True))
        s["weekend"] = None if s["weekend"] is None else bool(s["weekend"])
        s["predictable"] = None if s["predictable"] is None else bool(s["predictable"])
        s["months_mwh"] = json.loads(r[-1]) if r[-1] else None
        out.append(s)
    return {"sources": out, "truncated": len(rows) > limit}
