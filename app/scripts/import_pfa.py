"""Import the waste heat sources of the Plattform für Abwärme (PfA, BfEE/BAFA) once, for the Site map.

The PfA publishes the waste heat potentials companies above 2.5 GWh/a must report (§ 17 EnEfG) as one Excel table
(licence CC BY 4.0 since 2026-10-01; "pfa_datentabelle_excel.xlsx", https://www.bfee-online.de/pfa). It has addresses,
no coordinates: this script reads the table (stdlib only: an .xlsx is a zip of XML), keeps the rows of the postcodes
asked for (default: Rhein-Main, 60/61/63/65), geocodes each address once through OpenStreetMap's Nominatim (only the
company's public address leaves the machine, at most one request a second, cached in `geocode_cache.json` next to
the output so a rerun asks only for new ones) and writes `sources.sqlite` with an R-tree, the format
`backend/core/pfa.py` reads one map box at a time.

Per row (sheet "Abwärmepotentiale", header in row 2): Melde-ID, company and site name, address, the potential's name,
heat a year (kWh/a), maximum thermal power (kW), mean temperature (°C) and its range, mean hours a day, on weekends,
availability, predictability, control, a profile per month ("in kW" in the header: mostly a mean kW, some fill in
kWh a month; stored ÷ 1000 as `months_mwh`, read as a shape only, pages/district/pfa.ts sourceYear) and the
supplementary note. The contact columns (e-mail, phone) are not
imported. An address Nominatim does not find falls back to its postcode and town (`geo` = "postcode"), else the row is
skipped (reported).

Run from app/:  .venv/bin/python scripts/import_pfa.py PATH/TO/pfa_datentabelle_excel.xlsx [--plz 60,61,63,65] [--offline]
(--offline: no geocoding requests, only the cache; rows without a cached place are skipped)
"""

import json
import re
import sqlite3
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))

from backend.config import DATA_DIR  # noqa: E402
from backend.core.pfa import DB_FILE, SCHEMA  # noqa: E402

DB = DATA_DIR / DB_FILE
CACHE = DB.parent / "geocode_cache.json"
SHEET = "Abwärmepotentiale"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
# Nominatim's policy asks for an application's own User-Agent and at most one request a second; nothing personal in it
USER_AGENT = "dc2heat-intelligent-digital-twin/1.0 (PfA import script)"
COLUMNS = {  # header text (spaces and line breaks collapsed) -> our name
    "Melde- ID": "id",
    "Firmenname": "company",
    "Standortname": "site",
    "Straße und Hausnummer": "street",
    "PLZ": "plz",
    "Ort": "city",
    "Name des Abwärmepotentials": "name",
    "Wärmemenge pro Jahr (in kWh/a)": "kwh",
    "Maximale thermische Leistung (in kW)": "max_kw",
    "Durchschnittliches Temperaturniveau (in °C)": "temp_c",
    "Temperaturbereich": "temp_range",
    "Durchschnittliche tägl. Verfügbarkeit (in h)": "hours_per_day",
    "Verfügbarkeit am Wochenende": "weekend",
    "Verfügbarkeit": "availability",
    "Vorhersehbarkeit der Verfügbarkeit": "predictable",
    "Vorhandene Regelungsmöglichkeiten": "control",
    "Ergänzende Informationen zum Abwärmepotential": "note",
}
MONTHS = ("Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember")


def _col(ref: str) -> int:
    """0-based column of a cell reference ("AB12" -> 27)."""
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group():  # type: ignore[union-attr]
        n = n * 26 + ord(ch) - 64
    return n - 1


def sheet_rows(xlsx: Path, name: str):
    """The rows of sheet `name` as lists of strings (empty cells ""), streamed from the zip's XML."""
    with zipfile.ZipFile(xlsx) as z:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
        book = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = {r.get("Id"): r.get("Target") for r in rels}
        sheet = next((s for s in book.find("m:sheets", NS) if s.get("name") == name), None)  # type: ignore[union-attr]
        if sheet is None:
            raise ValueError(f"no sheet {name!r} in {xlsx.name}")
        path = target[sheet.get(REL)].lstrip("/")
        path = path if path.startswith("xl/") else f"xl/{path}"
        with z.open(path) as f:
            for _, el in ET.iterparse(f):
                if el.tag != f"{{{NS['m']}}}row":
                    continue
                row: list[str] = []
                for c in el.findall("m:c", NS):
                    i = _col(c.get("r", "A1"))
                    v = c.find("m:v", NS)
                    text = "".join(t.text or "" for t in c.iter(f"{{{NS['m']}}}t")) if c.get("t") == "inlineStr" else None
                    if text is None:
                        text = (shared[int(v.text)] if c.get("t") == "s" else v.text or "") if v is not None else ""
                    row.extend([""] * (i - len(row)))
                    row.append(text)
                yield row
                el.clear()


def num(v: str) -> float | None:
    """A number of the table (German decimal comma allowed), None for an empty or text cell."""
    try:
        return float(v.replace(",", ".")) if v.strip() else None
    except ValueError:
        return None


def records(xlsx: Path, plz: tuple[str, ...]):
    """The table's rows with a postcode starting with one of `plz`, as dicts of our column names."""
    rows = sheet_rows(xlsx, SHEET)
    next(rows)  # the groups' captions (§ 17 EnEfG)
    head = [" ".join(h.split()) for h in next(rows)]
    at = {COLUMNS[h]: i for i, h in enumerate(head) if h in COLUMNS}
    missing = set(COLUMNS.values()) - set(at)
    if missing:
        raise ValueError(f"columns not found in the header: {sorted(missing)}")
    month_at = [next(i for i, h in enumerate(head) if h.startswith("Leistungsprofil") and m in h) for m in MONTHS]
    seen: dict[str, int] = {}
    for r in rows:
        r = r + [""] * (len(head) - len(r))
        rec = {k: r[i].replace("​", "").strip() for k, i in at.items()}
        if not rec["id"] or not rec["plz"].startswith(plz):
            continue
        # a report (Melde-ID) holds one or more potentials: each its own source, the report's id and its number
        seen[rec["id"]] = seen.get(rec["id"], 0) + 1
        rec["ref"] = f"{rec['id']}-{seen[rec['id']]}"
        rec["city"] = re.sub(r"^\d{5}\s+", "", rec["city"])  # some repeat the postcode in the town: "63607 Wächtersbach"
        rec["months"] = [num(r[i]) for i in month_at]
        yield rec


def geocode(rec: dict, cache: dict, offline: bool) -> tuple[float, float, str] | None:
    """(lat, lon, quality) of the record's address: "address", else its postcode and town ("postcode"); cached."""
    for quality, q in (
        ("address", {"street": rec["street"], "postalcode": rec["plz"], "city": rec["city"]}),
        ("postcode", {"postalcode": rec["plz"], "city": rec["city"]}),
    ):
        key = json.dumps(q, ensure_ascii=False, sort_keys=True)
        if key not in cache:
            if offline:
                continue
            url = f"{NOMINATIM}?{urllib.parse.urlencode({**q, 'country': 'de', 'format': 'jsonv2', 'limit': 1})}"
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as resp:
                hits = json.load(resp)
            cache[key] = [float(hits[0]["lat"]), float(hits[0]["lon"])] if hits else None
            time.sleep(1.1)  # Nominatim: at most one request a second
        if cache[key]:
            return cache[key][0], cache[key][1], quality
    return None


def build(xlsx: Path, db: Path, plz: tuple[str, ...], offline: bool = False) -> tuple[int, int]:
    """Write the sources of `xlsx` with these postcodes to `db` (through a temporary file); (written, skipped)."""
    db.parent.mkdir(parents=True, exist_ok=True)
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    tmp = db.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    out = sqlite3.connect(tmp)
    out.executescript(SCHEMA)
    n = skipped = 0
    try:
        for rec in records(xlsx, plz):
            place = geocode(rec, cache, offline)
            if not place:
                skipped += 1
                print(f"  not found: {rec['plz']} {rec['city']}, {rec['street']} ({rec['id']})")
                continue
            lat, lon, quality = place
            months = rec["months"] if any(m is not None for m in rec["months"]) else None
            cur = out.execute(
                "INSERT OR IGNORE INTO sources (ref, company, site, street, plz, city, name, mwh, max_kw, temp_c, temp_range,"
                " hours_per_day, weekend, availability, predictable, control, months_mwh, note, lat, lon, geo)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (rec["ref"], rec["company"], rec["site"], rec["street"], rec["plz"], rec["city"], rec["name"],
                 None if num(rec["kwh"]) is None else round(num(rec["kwh"]) / 1000, 1), num(rec["max_kw"]),
                 num(rec["temp_c"]), rec["temp_range"] or None, num(rec["hours_per_day"]),
                 {"Ja": 1, "Nein": 0}.get(rec["weekend"]), rec["availability"] or None,
                 {"Ja": 1, "Nein": 0}.get(rec["predictable"]), rec["control"] or None,
                 json.dumps([None if m is None else round(m / 1000, 2) for m in months]) if months else None,
                 rec["note"][:500] or None, round(lat, 6), round(lon, 6), quality),
            )  # fmt: skip
            if cur.rowcount == 1:
                out.execute("INSERT INTO sources_rtree VALUES (?,?,?,?,?)", (cur.lastrowid, lat, lat, lon, lon))
                n += 1
        out.commit()
    finally:
        out.close()
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding="utf-8")  # kept even when stopped
    tmp.replace(db)
    return n, skipped


def main() -> None:
    """Refuse unless git ignores the folder; read, geocode and write."""
    argv = sys.argv[1:]
    value_of = {argv[i + 1] for i, a in enumerate(argv[:-1]) if a == "--plz"}
    args = [a for a in argv if not a.startswith("--") and a not in value_of]
    if len(args) != 1:
        sys.exit(__doc__.split("Run from app/:")[1].strip())
    ignored = subprocess.run(["git", "check-ignore", "-q", str(DB)], cwd=APP, check=False).returncode == 0
    if not ignored:
        sys.exit(f"git does not ignore {DB.parent}: add a .gitignore rule first")
    plz = ("60", "61", "63", "65")
    if "--plz" in sys.argv:
        plz = tuple(p.strip() for p in sys.argv[sys.argv.index("--plz") + 1].split(",") if p.strip())
    t0 = time.perf_counter()
    n, skipped = build(Path(args[0]), DB, plz, offline="--offline" in sys.argv)
    print(
        f"{n} waste heat sources (postcodes {', '.join(plz)}), {skipped} not placed -> {DB} in {time.perf_counter() - t0:.0f} s"
    )


if __name__ == "__main__":
    main()
