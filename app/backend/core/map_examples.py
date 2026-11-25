"""Machine-local example data centers for the Site map, from `_local/map_examples.json` in the data directory.

`_local/` holds the user's private material (never committed). Without it the map shows only the built-in
examples, so a missing, too large or malformed file gives an empty list and never an error. Pure stdlib.
"""

import json
import math
from pathlib import Path

from .limits import MAP_EXAMPLES_MAX_BYTES

LOCAL_DIR = Path("_local")  # relative to the data directory; git-ignored, never listed as a dataset (no parquet)
EXAMPLES_FILE = LOCAL_DIR / "map_examples.json"


def _num(v: object) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v)


def _rings(v: object) -> list | None:
    """Building outlines as [[[lat, lon], ...], ...], or None when the value is not that shape."""
    if not isinstance(v, list):
        return None
    ok = all(isinstance(r, list) and all(isinstance(p, list) and len(p) == 2 and all(map(_num, p)) for p in r) for r in v)
    return v if ok else None


def _entry(d: object) -> dict | None:
    """One example in the shape of the web's ExampleDataCenter, or None when a required field is missing or wrong."""
    if not (isinstance(d, dict) and isinstance(d.get("name"), str) and all(_num(d.get(k)) for k in ("lat", "lon", "heatKw"))):
        return None
    text = {k: d[k] if isinstance(d.get(k), str) else "" for k in ("address", "basis", "source")}
    # the source is drawn as a link: plain web URLs only (no javascript: and the like)
    if not text["source"].startswith(("https://", "http://")):
        text["source"] = ""
    out = {"name": d["name"], "lat": d["lat"], "lon": d["lon"], "heatKw": d["heatKw"], **text}
    if (rings := _rings(d.get("buildings"))) is not None:
        out["buildings"] = rings
    if d.get("labelLeft") is True:
        out["labelLeft"] = True
    return out


def map_examples(path: Path) -> list[dict]:
    """The valid entries of the examples file (`Storage.map_examples_file`: `_local/map_examples.json`, or
    `district_data/map_examples.json` from version_2 on); invalid ones are skipped; [] when missing or unreadable."""
    try:
        if path.stat().st_size > MAP_EXAMPLES_MAX_BYTES:
            return []
        items = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, RecursionError):
        return []
    return [e for d in items if (e := _entry(d))] if isinstance(items, list) else []
