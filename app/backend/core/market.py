"""The German electricity market by the hour, from SMARD's downloads (Bundesnetzagentur, smard.de, CC BY 4.0).

Whoever has the files drops them in, nothing else: every CSV in ``<market dir>/elec_price/`` (Großhandelspreise,
day-ahead) and ``<market dir>/elec_generation/`` (Realisierte Erzeugung), any years, English or German export, hourly
or quarter-hourly. The market dir is ``app/data/_market/`` (``config.MARKET_DIR``, env ``IDT_MARKET_DATA``).
Read on request, cached by the files' names and times; no import step, nothing written.

The price is the DE/LU bidding zone's, €/MWh. The grid's CO₂ is the generation mix's, g/kWh: each source's
generation times its emission factor over the total (``CO2_G_PER_KWH``, as ``pyest.electricity.emissions.
get_arbitrary_carbon_emissions``, the group's package, from the TenneT/FfE CO₂-Monitor's methods report). Imports,
exports and the pumps' own consumption are left out, as there.
"""

import csv
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

PRICE_DIR = "elec_price"
GENERATION_DIR = "elec_generation"
BERLIN = ZoneInfo("Europe/Berlin")
HOUR = 3600

# Direct emissions per kWh of electricity generated, g CO₂/kWh: the CO₂-Monitor's methods report (TenneT, FfE),
# p. 38 (https://www.co2-monitor.org/assets/methodenbericht.pdf), as pyest uses them; SMARD's "other conventional"
# (oil, non-renewable waste, mine gas, …) takes pyest's "Other" and "Waste". Renewables and nuclear: 0 (no direct
# emissions). Keys: SMARD's column names, English and German export, without the unit.
CO2_G_PER_KWH: dict[str, float] = {
    "biomass": 86,
    "hydropower": 0,
    "wind offshore": 0,
    "wind onshore": 0,
    "photovoltaics": 0,
    "other renewable": 0,
    "nuclear": 0,
    "lignite": 1097,
    "hard coal": 838,
    "fossil gas": 369,
    "hydro pumped storage": 0,
    "other conventional": 1137,
}
GERMAN_SOURCES = {
    "biomasse": "biomass",
    "wasserkraft": "hydropower",
    "wind offshore": "wind offshore",
    "wind onshore": "wind onshore",
    "photovoltaik": "photovoltaics",
    "sonstige erneuerbare": "other renewable",
    "kernenergie": "nuclear",
    "braunkohle": "lignite",
    "steinkohle": "hard coal",
    "erdgas": "fossil gas",
    "pumpspeicher": "hydro pumped storage",
    "sonstige konventionelle": "other conventional",
}
PRICE_COLUMN = re.compile(r"^(germany/luxembourg|deutschland/luxemburg)\b", re.I)


def _name(header: str) -> str:
    """A column's name without its unit and SMARD's suffix: "Lignite [MWh] Calculated resolutions" → "lignite"."""
    return header.split("[")[0].strip().lower()


def _number(text: str, german: bool) -> float | None:
    """SMARD's number, English ("4,044.50") or German ("4.044,50") as the file is; "-" or empty: none. The file decides,
    not the number: "1,019" is 1019 in an English file and 1.019 only in a German one."""
    t = text.strip()
    if t in ("", "-"):
        return None
    return float(t.replace(".", "").replace(",", ".") if german else t.replace(",", ""))


def _local(text: str) -> datetime:
    """SMARD's start time, local (Europe/Berlin) and naive: "Jan 1, 2023 12:00 AM" or "01.01.2023 00:00"."""
    t = text.strip()
    for fmt in ("%b %d, %Y %I:%M %p", "%d.%m.%Y %H:%M"):
        try:
            return datetime.strptime(t, fmt)
        except ValueError:
            continue
    raise ValueError(f"not a SMARD time: {t!r}")


def read_smard(path: Path) -> tuple[list[int], dict[str, list[float | None]]]:
    """One SMARD CSV: its start times as unix seconds (UTC) and its columns by name (without the unit).

    The times are local with summer time: in the autumn the hour 2:00–3:00 comes twice, the first is summer time
    (fold 0), the second winter time (fold 1); a repeated local time takes the second fold.
    """
    with path.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f, delimiter=";"))
    if not rows or len(rows[0]) < 3:
        raise ValueError(f"{path.name}: not a SMARD CSV (semicolon-separated, start, end, values)")
    names = [_name(h) for h in rows[0][2:]]
    times: list[int] = []
    cols: dict[str, list[float | None]] = {n: [] for n in names}
    seen: set[datetime] = set()
    first = next((r[0].strip() for r in rows[1:] if len(r) >= 3), "")
    german = re.match(r"\d\d\.\d\d\.\d{4}", first) is not None  # "01.01.2023 00:00": the German export
    for r in rows[1:]:
        if len(r) < 3:
            continue
        local = _local(r[0])
        at = local.replace(tzinfo=BERLIN, fold=1 if local in seen else 0)
        seen.add(local)
        times.append(int(at.astimezone(UTC).timestamp()))
        for n, v in zip(names, r[2:], strict=False):
            cols[n].append(_number(v, german))
    return times, cols


def _hourly(times: list[int], values: list[float | None]) -> dict[int, float]:
    """Means by the hour (a quarter-hourly file becomes hourly); hours without a value are left out."""
    sums: dict[int, list[float]] = {}
    for t, v in zip(times, values, strict=True):
        if v is not None:
            sums.setdefault(t - t % HOUR, []).append(v)
    return {h: sum(vs) / len(vs) for h, vs in sums.items()}


def prices(files: list[Path]) -> dict[int, float]:
    """The DE/LU day-ahead price by the hour, €/MWh, from SMARD price files (a later file wins an hour)."""
    out: dict[int, float] = {}
    for p in sorted(files):
        times, cols = read_smard(p)
        col = next((n for n in cols if PRICE_COLUMN.match(n)), None)
        if col is None:
            raise ValueError(f"{p.name}: no Germany/Luxembourg price column")
        out.update(_hourly(times, cols[col]))
    return out


def grid_co2(files: list[Path]) -> dict[int, float]:
    """The generation mix's CO₂ by the hour, g/kWh, from SMARD generation files: Σ generation × factor / Σ generation
    over the hour (a quarter-hourly file: its four quarters together)."""
    out: dict[int, float] = {}
    for p in sorted(files):
        times, cols = read_smard(p)
        known = {GERMAN_SOURCES.get(n, n): v for n, v in cols.items()}
        unknown = [n for n in known if n not in CO2_G_PER_KWH]
        if unknown:
            raise ValueError(f"{p.name}: no emission factor for {', '.join(unknown)}")
        co2: dict[int, list[float]] = {}  # hour -> [Σ generation × factor, Σ generation] of this file
        for i, t in enumerate(times):
            gen = {n: v[i] or 0.0 for n, v in known.items()}  # "-": nothing generated (nuclear since 15 April 2023)
            acc = co2.setdefault(t - t % HOUR, [0.0, 0.0])
            acc[0] += sum(g * CO2_G_PER_KWH[n] for n, g in gen.items())
            acc[1] += sum(gen.values())
        out.update({h: e / g for h, (e, g) in co2.items() if g > 0})  # a later file wins an hour
    return out


_cache: dict[tuple, dict] = {}


def market(folder: Path) -> dict:
    """Every hour the folder's files give: {"price": {hour: €/MWh}, "co2": {hour: g/kWh}, "files": {...}}; cached
    until a file changes. Empty dicts when there are no files."""
    dirs = {"price": folder / PRICE_DIR, "co2": folder / GENERATION_DIR}
    files = {k: sorted(d.glob("*.csv")) if d.is_dir() else [] for k, d in dirs.items()}
    key = tuple((str(p), p.stat().st_mtime_ns) for fs in files.values() for p in fs)
    if key not in _cache:
        _cache.clear()
        names = {k: [p.name for p in v] for k, v in files.items()}
        _cache[key] = {"price": prices(files["price"]), "co2": grid_co2(files["co2"]), "files": names}
    return _cache[key]


def hourly(folder: Path, start: int, end: int) -> dict:
    """The market's hours from `start` to `end` (unix seconds, end excluded), one row per hour, null where a file has
    none: {"times", "price_eur_mwh", "co2_g_kwh", "files", "covered": {"price", "co2"} (hours with a value)}.

    Without any files every hour is null and "hint" says where to put them: no files is the usual case (they are not
    in git), not an error. ValueError for a bad span.
    """
    if end <= start:
        raise ValueError("end must be after start")
    m = market(folder)
    hint = None
    if not m["price"] and not m["co2"]:
        hint = (
            f"No SMARD data: put its CSV downloads into {folder / PRICE_DIR} (day-ahead prices) and "
            f"{folder / GENERATION_DIR} (actual generation)."
        )
    first = start - start % HOUR
    times = list(range(first, end, HOUR))
    price = [m["price"].get(t) for t in times]
    co2 = [m["co2"].get(t) for t in times]

    def span(hours: dict[int, float]) -> list[str] | None:
        """From its first hour to the end of its last, ISO (UTC)."""
        if not hours:
            return None
        return [
            datetime.fromtimestamp(min(hours), UTC).isoformat(),
            (datetime.fromtimestamp(max(hours), UTC) + timedelta(hours=1)).isoformat(),
        ]

    return {
        "times": times,
        "price_eur_mwh": [None if v is None else round(v, 2) for v in price],
        "co2_g_kwh": [None if v is None else round(v, 1) for v in co2],
        "files": m["files"],
        "span": {"price": span(m["price"]), "co2": span(m["co2"])},
        "covered": {"price": sum(v is not None for v in price), "co2": sum(v is not None for v in co2)},
        "hint": hint,
    }
