"""Import the Wärmeatlas Hessen buildings of Frankfurt am Main (or other municipalities) once, for the Site map.

Downloads LEA's per-municipality delivery (Frankfurt: 255 MB zip, a GeoPackage) into app/data/_external/waermeatlas/
(git-ignored), unpacks the GeoPackage and its data description, and writes `buildings.sqlite` next to them, with
the buildings of every municipality imported so far (another one: pass its delivery, e.g. 06411000_Darmstadt, or
its URL; the names are LEA's, https://www.waermeatlas-hessen.de/daten_auslieferung/):
one row per heated building (useful heat > 0) with WGS84 coordinates, its ALKIS outline and an R-tree, and the
street segments with their heat line density (also with an R-tree), the
format `backend/core/waermeatlas.py` reads one map box at a time.

What is in the GeoPackage (EPSG:25832, ETRS89 / UTM 32N; "Datenbeschreibung.pdf" in the zip, Oct 2023):
  WAH_Punkte   one point per building, inside its outline (200 279 in Frankfurt, 87 861 heated):
               gebid (building id), energieflaeche (heated floor area m²), grundflaeche (footprint m²),
               gebalter_<class> (probability of each of 11 construction-age classes), nutzmix /
               nutzmix_alkis_beschreib (ALKIS building-use key / text), gebtyp_gemod (energy type: EFH, RH,
               MFH, GMH or a non-residential class), geg_relevant (heated under the GEG), qh_2020_kwh /
               qw_2020_kwh / qnutzwaerme_2020_kwh (modelled space heating / hot water / total useful heat
               kWh/a, 2020), qh_<moderate|staerkere|ambitionierte>_sanierung_<2030|2045>_kwh (space heating
               after renovation)
  Hausumringe  ALKIS building outlines (ags, oi object id, gfk function key); no key shared with the points,
               so each point is joined to the outline that contains it (both through their R-tree indexes)
  WAH_Strassenabschnitte  street segments (MULTILINESTRING) with the useful heat of the buildings LEA assigns to
               each: id, name, klasse (ALKIS class), laenge_segment (m), raumwaerme / warmwasser (kWh/a),
               nutzwaerme_pro_m (heat line density, kWh/(m·a)); the ones with heat go to `heat_lines` (24 135 in
               Frankfurt, 11 184 with heat)
  WAH_Baubloecke, WAH_Raster_100m/1km, Flurstuecke: sums per block and grid cell, and parcels (not used)
Licence: "Fachdaten: © LEA LandesEnergieAgentur Hessen GmbH" (no open licence named); outlines from the
Geoportal Hessen (dl-de/zero-2.0).

Memory: rows are streamed from one SQLite file to the other (a few MB RSS); nothing is held for the city.

Run from app/:  bash scripts/guard.sh .venv/bin/python scripts/import_waermeatlas.py [DELIVERY_OR_URL ...] [--rebuild]
(no delivery: Frankfurt; a new delivery rebuilds the file with it added)
"""

import json
import sqlite3
import struct
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))

from backend.config import DATA_DIR  # noqa: E402
from backend.core.waermeatlas import DB_FILE, SCHEMA, utm32_to_wgs84  # noqa: E402

BASE = "https://www.waermeatlas-hessen.de/daten_auslieferung/"
FRANKFURT = "06412000_Frankfurt_am_Main"
DB = DATA_DIR / DB_FILE
DIR = DB.parent
RAW = DIR / "raw"  # Frankfurt's GeoPackage (imported first, kept where it was); every other one in raw/<delivery>/
KEEP = ("WaermeatlasHessen.gpkg", "Datenbeschreibung.pdf")
AGES = (
    ("vor1860", "before 1860"), ("1860_1918", "1860–1918"), ("1919_1948", "1919–1948"), ("1949_1957", "1949–1957"),
    ("1958_1968", "1958–1968"), ("1969_1978", "1969–1978"), ("1979_1983", "1979–1983"), ("1984_1994", "1984–1994"),
    ("1995_2001", "1995–2001"), ("2002_2011", "2002–2011"), ("2012_nach", "2012 or later"),
)  # fmt: skip
ENVELOPE_BYTES = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}


def _wkb(blob: bytes) -> list | tuple:
    """A GeoPackage geometry blob's WKB, parsed: a POINT (x, y), a LINESTRING [(x, y)], a POLYGON [ring][(x, y)], a
    MULTI... a list of those (2D only)."""
    flags = blob[3]
    wkb = memoryview(blob)[8 + ENVELOPE_BYTES[(flags >> 1) & 7] :]
    pos = 0

    def read(fmt: str, order: str) -> tuple:
        nonlocal pos
        out = struct.unpack_from(order + fmt, wkb, pos)
        pos += struct.calcsize(fmt)
        return out

    def geometry() -> list | tuple:
        order = "<" if wkb[pos] == 1 else ">"
        read("B", order)
        (kind,) = read("I", order)
        if kind == 1:
            return read("dd", order)
        if kind == 2:
            return [read("dd", order) for _ in range(read("I", order)[0])]
        if kind == 3:
            return [[read("dd", order) for _ in range(read("I", order)[0])] for _ in range(read("I", order)[0])]
        if kind in (5, 6):
            return [geometry() for _ in range(read("I", order)[0])]
        raise ValueError(f"unsupported WKB geometry type {kind}")

    return geometry()


def gpkg_geometry(blob: bytes) -> list[list[list[tuple[float, float]]]] | tuple[float, float]:
    """A GeoPackage geometry blob: a POINT as (x, y), a (MULTI)POLYGON as [polygon][ring][(x, y)] (2D only)."""
    g = _wkb(blob)
    return [g] if isinstance(g, list) and g and isinstance(g[0][0], tuple) else g


def gpkg_lines(blob: bytes) -> list[list[tuple[float, float]]]:
    """A GeoPackage (MULTI)LINESTRING blob as its parts, each [(x, y), ...] (2D only)."""
    g = _wkb(blob)
    return [g] if g and isinstance(g[0], tuple) else g


def rnd(v: float | None, digits: int = 0) -> float | None:
    """Rounded, None kept: the model's 15 digits are noise and only bloat every map answer."""
    return None if v is None else round(v, digits)


def contains(ring: list[tuple[float, float]], x: float, y: float) -> bool:
    """Ray casting: is (x, y) inside the ring?"""
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1], strict=True):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def outline_of(gpkg: sqlite3.Connection, x: float, y: float) -> list[tuple[float, float]] | None:
    """Outer ring (UTM) of the ALKIS outline that contains the point, via the outlines' R-tree."""
    rows = gpkg.execute(
        "SELECT h.geom FROM rtree_Hausumringe_geom r JOIN Hausumringe h ON h.fid = r.id "
        "WHERE r.minx <= ? AND r.maxx >= ? AND r.miny <= ? AND r.maxy >= ?",
        (x, x, y, y),
    )
    for (blob,) in rows:
        for polygon in gpkg_geometry(blob):
            if contains(polygon[0], x, y):
                return polygon[0]
    return None


def delivery_of(arg: str) -> str:
    """LEA's delivery name of a name or URL ("06411000_Darmstadt", ".../06411000_Darmstadt.zip"): letters, digits,
    _ and - only, so it is safe as a file name; ValueError otherwise."""
    name = arg.rsplit("/", 1)[-1].removesuffix(".zip")
    if not name or not all(c.isalnum() or c in "_-" for c in name):
        raise ValueError(f"not a Wärmeatlas delivery: {arg!r} (e.g. {FRANKFURT})")
    return name


def raw_dir(delivery: str) -> Path:
    return RAW if delivery == FRANKFURT else RAW / delivery


def fetch(delivery: str) -> Path:
    """Download a delivery's zip once and unpack its GeoPackage and description (only those two members); the GeoPackage."""
    DIR.mkdir(parents=True, exist_ok=True)
    zip_path = DIR / f"{delivery}.zip"
    if not zip_path.exists():
        print(f"downloading {BASE}{delivery}.zip …")
        part = zip_path.with_suffix(".part")
        urllib.request.urlretrieve(f"{BASE}{delivery}.zip", part)
        part.rename(zip_path)
    raw = raw_dir(delivery)
    raw.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            name = Path(info.filename).name  # basename only: no path from the archive is trusted
            if name in KEEP and not (raw / name).exists():
                with z.open(info) as src, open(raw / name, "wb") as dst:
                    while chunk := src.read(1 << 20):
                        dst.write(chunk)
    return raw / KEEP[0]


def imported() -> list[Path]:
    """The GeoPackages of every delivery fetched so far."""
    return sorted(p for p in [RAW / KEEP[0], *RAW.glob(f"*/{KEEP[0]}")] if p.is_file())


def build(srcs: Path | list[Path], db: Path) -> int:
    """Write the buildings of the GeoPackage(s) `srcs` to `db` (through a temporary file); returns their number.
    A building in two deliveries (a building id is unique in Hessen) is written once."""
    tmp = db.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    out = sqlite3.connect(tmp)
    out.executescript(SCHEMA)
    srcs = [srcs] if isinstance(srcs, Path) else srcs
    n = sum(_copy(src, out) for src in srcs)
    lines = sum(_copy_lines(src, out) for src in srcs)
    print(f"{lines} street segments with a heat line density")
    out.commit()
    out.execute("VACUUM")
    out.close()
    tmp.replace(db)
    return n


def _copy(src: Path, out: sqlite3.Connection) -> int:
    """Copy the heated buildings of one GeoPackage into `out`; returns how many were new."""
    gpkg = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    ages = ", ".join(f"gebalter_{c}" for c, _ in AGES)
    rows = gpkg.execute(
        f"SELECT gebid, geom, nutzmix_alkis_beschreib, gebtyp_gemod, energieflaeche, qh_2020_kwh, qw_2020_kwh, "
        f"qnutzwaerme_2020_kwh, qh_moderate_sanierung_2030_kwh, qh_moderate_sanierung_2045_kwh, {ages} "
        "FROM WAH_Punkte WHERE qnutzwaerme_2020_kwh > 0"
    )
    n = 0
    for gebid, geom, use, kind, area, qh, qw, qn, qh30, qh45, *p in rows:
        x, y = gpkg_geometry(geom)
        lat, lon = utm32_to_wgs84(x, y)
        ring = outline_of(gpkg, x, y)
        outline = [[round(v, 6) for v in utm32_to_wgs84(*pt)] for pt in ring] if ring else [[lat, lon]]
        best = max(range(len(AGES)), key=lambda i: p[i] or 0)
        lats, lons = [q[0] for q in outline], [q[1] for q in outline]
        if out.execute("SELECT 1 FROM buildings WHERE id = ?", (gebid,)).fetchone():
            continue
        out.execute(
            "INSERT INTO buildings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (gebid, round(lat, 6), round(lon, 6), use, kind, AGES[best][1] if p[best] else None, rnd(p[best], 2),
             rnd(area, 1), rnd(qh), rnd(qw), rnd(qn), rnd(qh30), rnd(qh45),
             json.dumps(outline, separators=(",", ":")) if ring else None),
        )  # fmt: skip
        out.execute("INSERT INTO buildings_rtree VALUES (?,?,?,?,?)", (gebid, min(lats), max(lats), min(lons), max(lons)))
        n += 1
    gpkg.close()
    return n


def _copy_lines(src: Path, out: sqlite3.Connection) -> int:
    """Copy the street segments of one GeoPackage that carry heat (WAH_Strassenabschnitte, useful heat per m > 0) into
    `out`, kWh -> MWh; returns how many were new. A GeoPackage without them (an older delivery) gives none."""
    gpkg = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    if not gpkg.execute("SELECT 1 FROM sqlite_master WHERE name = 'WAH_Strassenabschnitte'").fetchone():
        gpkg.close()
        return 0
    rows = gpkg.execute(
        "SELECT id, geom, name, klasse, laenge_segment, nutzwaerme_pro_m, raumwaerme, warmwasser "
        "FROM WAH_Strassenabschnitte WHERE nutzwaerme_pro_m > 0"
    )
    n = 0
    for ref, geom, name, kind, length, per_m, qh, qw in rows:
        parts = [[[round(v, 6) for v in utm32_to_wgs84(*pt)] for pt in part] for part in gpkg_lines(geom) if len(part) > 1]
        if not parts:
            continue
        cur = out.execute(
            "INSERT OR IGNORE INTO heat_lines (ref, name, kind, length_m, mwh_per_m, mwh, line) VALUES (?,?,?,?,?,?,?)",
            (ref, name, kind, rnd(length, 1), rnd(per_m / 1000, 3), rnd(((qh or 0) + (qw or 0)) / 1000, 1),
             json.dumps(parts, separators=(",", ":"))),
        )  # fmt: skip
        if cur.rowcount != 1:
            continue  # the same segment in another delivery
        lats, lons = [q[0] for p in parts for q in p], [q[1] for p in parts for q in p]
        box = (cur.lastrowid, min(lats), max(lats), min(lons), max(lons))
        out.execute("INSERT INTO heat_lines_rtree VALUES (?,?,?,?,?)", box)
        n += 1
    gpkg.close()
    return n


def main() -> None:
    """Refuse unless git ignores the folder; fetch the deliveries asked for (Frankfurt by default); build the index
    of every delivery fetched so far, when one is new (or with --rebuild)."""
    probe = DIR / "buildings.sqlite"
    ignored = subprocess.run(["git", "check-ignore", "-q", str(probe)], cwd=APP, check=False).returncode == 0
    if not ignored:
        sys.exit(f"git does not ignore {DIR}: add a .gitignore rule first (LEA's data must never be committed)")
    try:
        asked = [delivery_of(a) for a in sys.argv[1:] if not a.startswith("--")] or [FRANKFURT]
    except ValueError as exc:
        sys.exit(str(exc))
    t0 = time.perf_counter()
    new = [d for d in asked if not (raw_dir(d) / KEEP[0]).exists()]
    for d in asked:
        print(f"{d}: GeoPackage {fetch(d).stat().st_size / 1e6:.0f} MB")
    t1 = time.perf_counter()
    print(f"fetched in {t1 - t0:.1f} s")
    if DB.exists() and not new and "--rebuild" not in sys.argv:
        print(f"{DB} exists with these deliveries (pass --rebuild to write it again)")
        return
    srcs = imported()
    n = build(srcs, DB)
    print(
        f"{n} buildings of {len(srcs)} deliveries -> {DB} ({DB.stat().st_size / 1e6:.1f} MB) in {time.perf_counter() - t1:.1f} s"
    )


if __name__ == "__main__":
    main()
