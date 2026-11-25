"""Hourly outdoor temperature at the site from Open-Meteo (free, no key), cached in the dataset folder.

Only the site's coordinates and the period's dates are sent. The historical archive (ERA5, ~5 days
behind today) covers the period; the last days it does not have yet come from the forecast API's
``past_days``. The answer is cached as weather_open_meteo.json and fetched again only when the
coordinates or the dates change. Times are unix seconds (UTC, GMT on Open-Meteo's side).
"""

import json
import math
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from .dataset_files import write_atomic
from .limits import WEATHER_MAX_DAYS

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
FORECAST = "https://api.open-meteo.com/v1/forecast"
TIMEOUT_S = 20
FORECAST_PAST_DAYS = 92  # the forecast API's longest look back


class WeatherUnavailable(RuntimeError):
    """Open-Meteo could not be reached or refused the request."""


def site_location(site: dict) -> tuple[float, float] | None:
    """(lat, lon) of the data center: its heat-source bubble, else the centre of its building outline."""
    src = site.get("source") or {}
    if src.get("lat") is not None and src.get("lon") is not None:
        return float(src["lat"]), float(src["lon"])
    ring = (site.get("building") or {}).get("outline") or []
    if ring:
        return sum(float(p[0]) for p in ring) / len(ring), sum(float(p[1]) for p in ring) / len(ring)
    return None


def _get_json(url: str, params: dict) -> dict:
    """GET a JSON document; WeatherUnavailable with Open-Meteo's reason on any failure."""
    full = f"{url}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(full, timeout=TIMEOUT_S) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as exc:
        try:
            reason = json.loads(exc.read()).get("reason", exc.reason)
        except ValueError:
            reason = exc.reason
        raise WeatherUnavailable(f"Open-Meteo refused the request: {reason}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise WeatherUnavailable(f"Could not reach Open-Meteo (offline?): {exc}") from exc


def _day(t: int) -> date:
    """The UTC date of a unix time."""
    return datetime.fromtimestamp(t, UTC).date()


def _pairs(doc: dict) -> list[tuple[int, float]]:
    """(unix time, °C) of an Open-Meteo answer, without the hours it has no value for."""
    h = doc.get("hourly") or {}
    return [(int(t), float(v)) for t, v in zip(h.get("time") or [], h.get("temperature_2m") or [], strict=False) if v is not None]


def fetch_hourly(lat: float, lon: float, start: date, end: date, today: date | None = None) -> dict:
    """Hourly temperature_2m from start to end (inclusive dates): the archive, topped up from the forecast API."""
    if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("The site's location is not a valid latitude/longitude")
    if end < start:
        raise ValueError("end must not be before start")
    if (end - start).days > WEATHER_MAX_DAYS:
        raise ValueError(f"At most {WEATHER_MAX_DAYS} days of weather at a time")
    today = today or date.today()
    common = {"latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}", "hourly": "temperature_2m"}
    common |= {"timeformat": "unixtime", "timezone": "GMT"}
    pairs: list[tuple[int, float]] = []
    if start <= today:
        pairs = _pairs(_get_json(ARCHIVE, {**common, "start_date": start.isoformat(), "end_date": min(end, today).isoformat()}))
    # the archive lags a few days behind: the forecast API's past days fill the rest
    last = _day(pairs[-1][0]) if pairs else start - timedelta(days=1)
    if last < min(end, today) and (today - last).days <= FORECAST_PAST_DAYS:
        past = min(FORECAST_PAST_DAYS, (today - last).days + 1)
        more = _pairs(_get_json(FORECAST, {**common, "past_days": past, "forecast_days": 1}))
        cut = pairs[-1][0] if pairs else 0
        pairs += [p for p in more if p[0] > cut and start <= _day(p[0]) <= end]
    if not pairs:
        raise WeatherUnavailable("Open-Meteo has no temperatures for this period")
    return {
        "lat": round(lat, 4),
        "lon": round(lon, 4),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "source": "Open-Meteo (CC BY 4.0)",
        "times": [t for t, _ in pairs],
        "temperature": [v for _, v in pairs],
    }


def cached_hourly(path: Path, lat: float, lon: float, start: date, end: date) -> dict:
    """The cached answer when it is for the same place and dates, else a new fetch that replaces the cache."""
    key = {"lat": round(lat, 4), "lon": round(lon, 4), "start": start.isoformat(), "end": end.isoformat()}
    if path.exists():
        try:
            doc = json.loads(path.read_text())
            if {k: doc.get(k) for k in key} == key:
                return doc
        except ValueError:
            pass  # a broken cache is fetched again
    doc = fetch_hourly(lat, lon, start, end)
    write_atomic(path, json.dumps(doc))
    return doc
