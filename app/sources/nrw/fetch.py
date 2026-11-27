"""Import the open heat demand of North Rhine-Westphalia (LANUK, Kommunale Wärmeplanung NRW) for the Site map.

LANUK publishes, for each of NRW's 396 municipalities, a zip of shapefiles (EPSG:25832) under dl-de/zero-2.0
(https://www.opengeodata.nrw.de/produkte/umwelt_klima/energie/kwp/; Bonn 134 MB, Köln 336 MB). This script downloads
the municipalities asked for into `app/data/_external/nrw/` (the zips, git-ignored: their shapefiles are read inside
the zip) and writes `buildings_<AGS>_<name>.sqlite` next to them for each (committed; one file a municipality keeps
each under GitHub's 100 MB, and a municipality added elsewhere drops none): the format
`backend/core/waermeatlas.py` reads, so the Site map's heat demand layer shows NRW beside the Wärmeatlas Hessen.

What is read (Kurzdokumentation_Raumwaermebedarfsmodell.pdf in the zip; model 2024, buildings as of summer 2022):
  WBM-NRW_<AGS>_<name>       one polygon per building (LoD1/LoD2 outline): Fest_ID (id), Nutzung (ALKIS use),
                             beheizt (heated), WG_NWG (residential or not), WG_Typ (EFH, RH, MFH, GMFH),
                             GEBAEUDETY (<type>_<age class>), NF (useful floor area m², the energy reference),
                             RW / WW / RW_WW (useful heat for space heating / hot water / both, kWh/a)
  WBM-NRW-moderat_<...>      the same buildings with moderate renovation: RW_m_30 / RW_m_45 (space heating 2030 / 2045)
  WBM-NRW-Waermelinien_<...> street segments (polylines): WLD_ID, Strassenla (m), RW_WW_GHD_ (the useful heat of the
                             buildings assigned to it, with the process heat of commerce, kWh/a), Waermedich (kWh/(m·a))
LANUK warns that a single building's value can differ greatly from its real consumption: compare sums, not houses.

Memory: the records are streamed from the zip into SQLite; only the renovated values (two numbers a building) are
held per municipality.

Run from app/:  bash scripts/guard.sh .venv/bin/python sources/nrw/fetch.py Bonn [Köln 05334002 ...] [--rebuild]
(a name as LANUK writes it, ä → ae, or its AGS; no name: the municipalities fetched so far, rebuilt with --rebuild)
"""

import re
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP))

from backend.config import DATA_DIR  # noqa: E402
from backend.core.waermeatlas import DB_FILE, utm32_to_wgs84, write_db  # noqa: E402
from sources.shp import centroid, records, ring_area  # noqa: E402

BASE = "https://www.opengeodata.nrw.de/produkte/umwelt_klima/energie/kwp/"
DIR = DATA_DIR / DB_FILE.parent.parent / "nrw"
ATTRIBUTION = "© LANUK NRW (Kommunale Wärmeplanung NRW), dl-de/zero-2.0, modelled useful heat 2024"
ZIP = re.compile(r"KWP-NRW_(\d{8})_([A-Za-z0-9_-]+)_EPSG25832_Shape\.zip")
# GEBAEUDETY's age class (the last year of the span) -> its span (the model description's table)
AGES = {
    "1900": "before 1900", "1945": "1900–1945", "1960": "1946–1960", "1970": "1961–1970", "1980": "1971–1980",
    "1985": "1981–1985", "1995": "1986–1995", "2000": "1996–2000", "2005": "2001–2005", "2010": "2006–2010",
    "2015": "2011–2015", "2022": "2016 or later",
}  # fmt: skip


def rnd(v: float | None, digits: int = 0) -> float | None:
    """Rounded, None kept: the model's 11 decimals are noise and only bloat every map answer."""
    return None if v is None else round(v, digits)


def ascii_name(name: str) -> str:
    """A municipality's name as LANUK writes it in its file names: ä → ae, ß → ss, spaces → _."""
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("Ä", "Ae"), ("Ö", "Oe"), ("Ü", "Ue"), ("ß", "ss"), (" ", "_")):
        name = name.replace(a, b)
    return name


def listing() -> dict[str, str]:
    """The download folder's per-municipality zips: {AGS: file name}."""
    with urllib.request.urlopen(BASE, timeout=60) as r:
        text = r.read().decode("utf-8")
    return {m.group(1): m.group(0) for m in ZIP.finditer(text)}


def pick(asked: list[str], files: dict[str, str]) -> list[str]:
    """The zip file names of the municipalities asked for (an AGS or a name, case-insensitive); ValueError for one
    not found, with the closest names."""
    out = []
    for a in asked:
        key = ascii_name(a).lower()
        hit = files.get(a) or next((f for f in files.values() if ZIP.fullmatch(f).group(2).lower() == key), None)  # type: ignore[union-attr]
        if not hit:
            near = sorted(f for f in files.values() if key[:4] in f.lower())[:5]
            raise ValueError(f"no NRW municipality {a!r}" + (f"; did you mean {', '.join(near)}?" if near else ""))
        out.append(hit)
    return out


def db_of(zip_name: str) -> Path:
    """The file of one municipality's zip: buildings_<AGS>_<name>.sqlite."""
    m = ZIP.fullmatch(zip_name)
    return DIR / f"buildings_{m.group(1)}_{m.group(2)}.sqlite"  # type: ignore[union-attr]


def fetch(name: str) -> Path:
    """Download one municipality's zip once (through a .part file); its path."""
    DIR.mkdir(parents=True, exist_ok=True)
    path = DIR / name
    if not path.exists():
        print(f"downloading {BASE}{name} …")
        part = path.with_suffix(".part")
        urllib.request.urlretrieve(BASE + name, part)
        part.rename(path)
    return path


def buildings(z: zipfile.ZipFile, tail: str):
    """The heated buildings of one municipality's zip (`tail`: "<AGS>_<name>"), as write_db takes them."""
    later = {
        int(row["Fest_ID"]): (row.get("RW_m_30"), row.get("RW_m_45"))
        for row, _ in records(z.open, f"WBM-NRW-moderat_{tail}")
        if row["Fest_ID"] is not None
    }
    for row, parts in records(z.open, f"WBM-NRW_{tail}"):
        total = row["RW_WW"] or 0
        if not parts or row["Fest_ID"] is None or not row["beheizt"] or total <= 0:
            continue
        ring = max(parts, key=ring_area)
        lat, lon = utm32_to_wgs84(*centroid(ring))
        residential = row["WG_NWG"] == "WG"
        kind = {"GMFH": "GMH"}.get(row["WG_Typ"], row["WG_Typ"]) if residential else row["Nutzung"]
        h30, h45 = later.get(int(row["Fest_ID"]), (None, None))
        yield {
            "id": int(row["Fest_ID"]), "lat": round(lat, 6), "lon": round(lon, 6), "use": row["Nutzung"], "type": kind,
            "age": AGES.get((row["GEBAEUDETY"] or "").rpartition("_")[2]), "age_share": None, "area_m2": rnd(row["NF"], 1),
            "heating_kwh": rnd(row["RW"]), "hot_water_kwh": rnd(row["WW"]), "total_kwh": rnd(total),
            "heating_2030_kwh": rnd(h30), "heating_2045_kwh": rnd(h45),
            "outline": [[round(v, 6) for v in utm32_to_wgs84(*p)] for p in ring],
        }  # fmt: skip


def lines(z: zipfile.ZipFile, tail: str):
    """The street segments with heat of one municipality's zip, as write_db takes them (kWh -> MWh)."""
    for row, parts in records(z.open, f"WBM-NRW-Waermelinien_{tail}"):
        if not parts or not (row["Waermedich"] or 0) > 0:
            continue
        yield {
            "ref": str(int(row["WLD_ID"])), "name": None, "kind": None, "length_m": rnd(row["Strassenla"], 1),
            "mwh_per_m": rnd(row["Waermedich"] / 1000, 3), "mwh": rnd((row["RW_WW_GHD_"] or 0) / 1000, 1),
            "line": [[[round(v, 6) for v in utm32_to_wgs84(*p)] for p in part] for part in parts if len(part) > 1],
        }  # fmt: skip


def build(zips: list[Path], db: Path) -> tuple[int, int]:
    """Write the buildings and street segments of every zip to `db`; (buildings, segments) written."""
    opened = [zipfile.ZipFile(p) for p in zips]
    tails = [ZIP.fullmatch(p.name).group(1) + "_" + ZIP.fullmatch(p.name).group(2) for p in zips]  # type: ignore[union-attr]
    try:
        return write_db(
            db,
            ATTRIBUTION,
            (b for z, t in zip(opened, tails, strict=True) for b in buildings(z, t)),
            (h for z, t in zip(opened, tails, strict=True) for h in lines(z, t)),
        )
    finally:
        for z in opened:
            z.close()


def main() -> None:
    """Fetch the municipalities asked for and write each one's file (once; again with --rebuild); no name: every zip
    fetched so far."""
    asked = [a for a in sys.argv[1:] if not a.startswith("--")]
    try:
        names = (
            pick(asked, listing()) if asked else sorted(p.name for p in DIR.glob("KWP-NRW_*_Shape.zip") if ZIP.fullmatch(p.name))
        )
    except ValueError as exc:
        sys.exit(str(exc))
    if not names:
        sys.exit("nothing fetched yet: name a municipality, e.g. Bonn")
    for name in names:
        db = db_of(name)
        if db.exists() and "--rebuild" not in sys.argv:
            print(f"{db.name} is there already (pass --rebuild to write it again)")
            continue
        t0 = time.perf_counter()
        n, m = build([fetch(name)], db)
        print(
            f"{n} buildings, {m} street segments -> {db} ({db.stat().st_size / 1e6:.0f} MB) in {time.perf_counter() - t0:.0f} s"
        )


if __name__ == "__main__":
    main()
