"""Buildings with their heat demand, and streets with their heat line density, read one map box at a time.

Each source has its own small local SQLite file, `<source>/buildings.sqlite` beside the others (`DB_FILE`'s folder
in the data directory): the Wärmeatlas Hessen (`scripts/import_waermeatlas.py`, folder `waermeatlas`) and the open
atlases of `app/sources/` (NRW, Berlin, Hamburg, the national grid; each writes through `write_db`). One row per
building (or block, or grid cell), WGS84 coordinates, the outline as JSON, and an R-tree on the outline's bounding
box. A query reads only the R-tree pages and rows of the box it asks for, so the city never sits in memory. The
buildings are the city's, not a data center's: one import serves every data folder and the examples (find_dbs).
Pure stdlib (sqlite3, math).
"""

import json
import math
import sqlite3
from collections.abc import Iterable
from pathlib import Path

from .limits import WAERMEATLAS_MAX_BOX_KM, WAERMEATLAS_MAX_BUILDINGS, WAERMEATLAS_MAX_LINES

DB_FILE = Path("_external") / "waermeatlas" / "buildings.sqlite"  # relative to the data directory

# The column names below are the contract between the import script and the query.
SCHEMA = """
CREATE TABLE buildings (
    id INTEGER PRIMARY KEY,                        -- gebid, the Wärmeatlas building id
    lat REAL NOT NULL, lon REAL NOT NULL,          -- the building's point, inside its outline (WGS84)
    use TEXT,                                      -- ALKIS use, e.g. "Wohngebäude", "Bürogebäude"
    type TEXT,                                     -- GEMOD energy type: EFH, RH, MFH, GMH or a non-residential class
    age TEXT, age_share REAL,                      -- most likely construction-age class and its probability
    area_m2 REAL,                                  -- heated floor area (Energiebezugsfläche)
    heating_kwh REAL, hot_water_kwh REAL, total_kwh REAL,   -- modelled useful heat 2020, kWh/a
    heating_2030_kwh REAL, heating_2045_kwh REAL,  -- space heating with moderate renovation, kWh/a
    outline TEXT                                   -- JSON [[lat, lon], ...] (ALKIS outline) or null
);
CREATE VIRTUAL TABLE buildings_rtree USING rtree(id, min_lat, max_lat, min_lon, max_lon);
CREATE TABLE heat_lines (
    id INTEGER PRIMARY KEY,                        -- our own row id (LEA's segment ids repeat across deliveries)
    ref TEXT UNIQUE,                               -- LEA's segment id (WAH_Strassenabschnitte.id)
    name TEXT, kind TEXT,                          -- street name, ALKIS class (e.g. "Gemeindestraße")
    length_m REAL,                                 -- the segment's length
    mwh_per_m REAL,                                -- heat line density: its buildings' useful heat per m, MWh/(m·a)
    mwh REAL,                                      -- their useful heat, MWh/a (space heating + hot water, 2020)
    line TEXT NOT NULL                             -- JSON [[[lat, lon], ...], ...] (the parts of its MULTILINESTRING)
);
CREATE VIRTUAL TABLE heat_lines_rtree USING rtree(id, min_lat, max_lat, min_lon, max_lon);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);  -- "attribution": the source's credit line, shown on the map
"""
LINE_COLUMNS = ("id", "name", "kind", "length_m", "mwh_per_m", "mwh")
COLUMNS = (
    "id", "lat", "lon", "use", "type", "age", "age_share", "area_m2",
    "heating_kwh", "hot_water_kwh", "total_kwh", "heating_2030_kwh", "heating_2045_kwh",
)  # fmt: skip

KM_PER_DEG_LAT = 111.32
# the credit line of an import without one in its `meta` table (the Wärmeatlas Hessen's, made before it had one)
ATTRIBUTION = {"waermeatlas": "© LEA Hessen (Wärmeatlas Hessen), modelled useful heat 2020"}
NOT_IMPORTED = "No heat demand data on this machine: run scripts/import_waermeatlas.py or one of app/sources/ (in app/) once."


def find_dbs(roots: list[Path]) -> list[Path]:
    """Every source's newest import (`<root>/<source>/buildings.sqlite`) of the folders `roots` (the data folder's own,
    the examples', each version's): one per source, the newest (it holds every municipality fetched so far)."""
    newest: dict[str, Path] = {}
    for root in roots:
        for p in root.glob("*/buildings.sqlite") if root.is_dir() else []:
            have = newest.get(p.parent.name)
            if have is None or p.stat().st_mtime > have.stat().st_mtime:
                newest[p.parent.name] = p
    return [newest[k] for k in sorted(newest)]


def attribution_of(con: sqlite3.Connection, source: str) -> str:
    """The source's credit line: its `meta` table's, else the known one, else its folder name."""
    if con.execute("SELECT 1 FROM sqlite_master WHERE name = 'meta'").fetchone():
        row = con.execute("SELECT value FROM meta WHERE key = 'attribution'").fetchone()
        if row and row[0]:
            return row[0]
    return ATTRIBUTION.get(source, source)


def write_db(db: Path, attribution: str, buildings: Iterable[dict], lines: Iterable[dict] = ()) -> tuple[int, int]:
    """Write one source's buildings (dicts of COLUMNS + "outline": [[lat, lon], ...] or None) and street segments
    (dicts of "ref", "name", "kind", "length_m", "mwh_per_m", "mwh", "line": [[[lat, lon], ...], ...]) to `db`, the
    format buildings_in and heat_lines_in read, through a temporary file; an id or ref twice is written once.
    Returns (buildings, lines) written."""
    db.parent.mkdir(parents=True, exist_ok=True)
    tmp = db.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    out = sqlite3.connect(tmp)
    out.executescript(SCHEMA)
    out.execute("INSERT INTO meta VALUES ('attribution', ?)", (attribution,))
    n = m = 0
    for b in buildings:
        ring = b.get("outline")
        row = [b.get(c) for c in COLUMNS] + [json.dumps(ring, separators=(",", ":")) if ring else None]
        if out.execute("INSERT OR IGNORE INTO buildings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", row).rowcount != 1:
            continue
        lats, lons = ([q[0] for q in ring], [q[1] for q in ring]) if ring else ([b["lat"]], [b["lon"]])
        out.execute("INSERT INTO buildings_rtree VALUES (?,?,?,?,?)", (b["id"], min(lats), max(lats), min(lons), max(lons)))
        n += 1
    for h in lines:
        cur = out.execute(
            "INSERT OR IGNORE INTO heat_lines (ref, name, kind, length_m, mwh_per_m, mwh, line) VALUES (?,?,?,?,?,?,?)",
            (h["ref"], h.get("name"), h.get("kind"), h.get("length_m"), h["mwh_per_m"], h.get("mwh"),
             json.dumps(h["line"], separators=(",", ":"))),
        )  # fmt: skip
        if cur.rowcount != 1:
            continue
        lats, lons = [q[0] for p in h["line"] for q in p], [q[1] for p in h["line"] for q in p]
        box = (cur.lastrowid, min(lats), max(lats), min(lons), max(lons))
        out.execute("INSERT INTO heat_lines_rtree VALUES (?,?,?,?,?)", box)
        m += 1
    out.commit()
    out.execute("VACUUM")
    out.close()
    tmp.replace(db)
    return n, m


def parts_of(db: Path) -> list[str]:
    """The downloads (a source's municipalities) a committed file was built from: a rebuild fetches the missing ones
    first, so adding a municipality on another machine does not drop the others."""
    if not db.exists():
        return []
    con = sqlite3.connect(db)
    try:
        row = con.execute("SELECT value FROM meta WHERE key = 'parts'").fetchone()
    except sqlite3.OperationalError:
        row = None  # a file from before the meta table
    finally:
        con.close()
    return json.loads(row[0]) if row else []


def set_parts(db: Path, parts: list[str]) -> None:
    """Record the downloads `db` was built from (parts_of)."""
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    con.execute("INSERT OR REPLACE INTO meta VALUES ('parts', ?)", (json.dumps(sorted(parts)),))
    con.commit()
    con.close()


def find_db(own: Path, others: list[Path]) -> Path:
    """The newest import of the data folder's own and `others` (it has the most municipalities: each import holds
    every one fetched so far); `own` when none exists (the query's error then says how to import)."""
    found = [p for p in [own, *others] if p.is_file()]
    return max(found, key=lambda p: p.stat().st_mtime) if found else own


def utm32_to_wgs84(east: float, north: float) -> tuple[float, float]:
    """(lat, lon) in degrees of a point in ETRS89 / UTM zone 32N (EPSG:25832), GRS80 ellipsoid.

    Krüger's series to the third order (as in Wikipedia's "Universal Transverse Mercator"): mm accuracy
    inside the zone, so no pyproj/GDAL is needed.
    """
    a, f, k0 = 6378137.0, 1 / 298.257222101, 0.9996
    n = f / (2 - f)
    big_a = a / (1 + n) * (1 + n**2 / 4 + n**4 / 64)
    beta = (n / 2 - 2 * n**2 / 3 + 37 * n**3 / 96, n**2 / 48 + n**3 / 15, 17 * n**3 / 480)
    delta = (2 * n - 2 * n**2 / 3 - 2 * n**3, 7 * n**2 / 3 - 8 * n**3 / 5, 56 * n**3 / 15)
    xi = north / (k0 * big_a)
    eta = (east - 500000.0) / (k0 * big_a)
    xi_p = xi - sum(b * math.sin(2 * j * xi) * math.cosh(2 * j * eta) for j, b in enumerate(beta, 1))
    eta_p = eta - sum(b * math.cos(2 * j * xi) * math.sinh(2 * j * eta) for j, b in enumerate(beta, 1))
    chi = math.asin(math.sin(xi_p) / math.cosh(eta_p))
    lat = chi + sum(d * math.sin(2 * j * chi) for j, d in enumerate(delta, 1))
    lon = math.radians(9.0) + math.atan2(math.sinh(eta_p), math.cos(xi_p))
    return math.degrees(lat), math.degrees(lon)


def check_box(south: float, west: float, north: float, east: float, max_km: float = WAERMEATLAS_MAX_BOX_KM) -> None:
    """ValueError unless the box is a real lat/lon box no bigger than `max_km` (WAERMEATLAS_MAX_BOX_KM) on each side."""
    if not all(math.isfinite(v) for v in (south, west, north, east)):
        raise ValueError("bbox must be four finite numbers: south,west,north,east")
    if not (-90 <= south < north <= 90 and -180 <= west < east <= 180):
        raise ValueError("bbox must be south,west,north,east with south < north and west < east")
    height = (north - south) * KM_PER_DEG_LAT
    width = (east - west) * KM_PER_DEG_LAT * math.cos(math.radians((north + south) / 2))
    if max(height, width) > max_km:
        raise ValueError(
            f"The map area is {width:.1f} × {height:.1f} km; this loads for at most {max_km:g} × {max_km:g} km. Zoom in."
        )


def _as_list(db: Path | list[Path]) -> list[Path]:
    """One source's file or several; FileNotFoundError when none exists (nothing imported)."""
    dbs = [p for p in ([db] if isinstance(db, Path) else db) if p.exists()]
    if not dbs:
        raise FileNotFoundError(NOT_IMPORTED)
    return dbs


def buildings_in(
    db: Path | list[Path], south: float, west: float, north: float, east: float, limit: int = WAERMEATLAS_MAX_BUILDINGS
) -> dict:
    """The buildings whose outline (or point) touches the box, of every source `db` names: {"buildings": [...],
    "truncated": bool, "sources": {source: its credit line}} (a source: the folder name of its file; each building
    carries its own as "source"; its id is unique within its source only).

    Biggest demand first, so a box over the cap drops the smallest buildings, not a random patch.

    FileNotFoundError when nothing has been imported; ValueError for a bad or too large box.
    Reads through the R-tree only: memory is proportional to the answer, not to the city.
    """
    check_box(south, west, north, east)
    rows, sources = [], {}
    for path in _as_list(db):
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            got = con.execute(
                f"SELECT {', '.join('b.' + c for c in COLUMNS)}, b.outline "
                "FROM buildings_rtree r JOIN buildings b ON b.id = r.id "
                "WHERE r.max_lat >= ? AND r.min_lat <= ? AND r.max_lon >= ? AND r.min_lon <= ? ORDER BY b.total_kwh DESC LIMIT ?",
                (south, north, west, east, limit + 1),
            ).fetchall()
            if got:
                sources[path.parent.name] = attribution_of(con, path.parent.name)
        finally:
            con.close()
        rows += [(path.parent.name, r) for r in got]
    rows.sort(key=lambda x: -(x[1][COLUMNS.index("total_kwh")] or 0))
    out = [
        {**dict(zip(COLUMNS, r[:-1], strict=True)), "outline": json.loads(r[-1]) if r[-1] else None, "source": src}
        for src, r in rows[:limit]
    ]
    return {"buildings": out, "truncated": len(rows) > limit, "sources": sources}


def heat_lines_in(
    db: Path | list[Path], south: float, west: float, north: float, east: float, limit: int = WAERMEATLAS_MAX_LINES
) -> dict:
    """The street segments with a heat line density (Wärmeliniendichte) that touch the box, of every source `db`
    names: {"lines": [...], "truncated", "sources": {source: its credit line}} (each line carries its "source").

    Densest first, so a box over the cap drops the thinnest streets. FileNotFoundError when nothing has been imported,
    or no import has street segments (a Wärmeatlas import from before they were read: run the import again with
    --rebuild); ValueError for a bad or too large box. Reads through the R-tree only.
    """
    check_box(south, west, north, east)
    rows, sources, with_lines = [], {}, 0
    for path in _as_list(db):
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            if not con.execute("SELECT 1 FROM sqlite_master WHERE name = 'heat_lines'").fetchone():
                continue
            with_lines += 1
            got = con.execute(
                f"SELECT {', '.join('h.' + c for c in LINE_COLUMNS)}, h.line "
                "FROM heat_lines_rtree r JOIN heat_lines h ON h.id = r.id "
                "WHERE r.max_lat >= ? AND r.min_lat <= ? AND r.max_lon >= ? AND r.min_lon <= ? ORDER BY h.mwh_per_m DESC LIMIT ?",
                (south, north, west, east, limit + 1),
            ).fetchall()
            if got:
                sources[path.parent.name] = attribution_of(con, path.parent.name)
        finally:
            con.close()
        rows += [(path.parent.name, r) for r in got]
    if not with_lines:
        raise FileNotFoundError(
            "The Wärmeatlas import has no street segments yet: run scripts/import_waermeatlas.py --rebuild (in app/)."
        )
    rows.sort(key=lambda x: -(x[1][LINE_COLUMNS.index("mwh_per_m")] or 0))
    out = [{**dict(zip(LINE_COLUMNS, r[:-1], strict=True)), "line": json.loads(r[-1]), "source": src} for src, r in rows[:limit]]
    return {"lines": out, "truncated": len(rows) > limit, "sources": sources}
