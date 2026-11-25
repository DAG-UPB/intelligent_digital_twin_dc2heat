"""Open-Meteo weather at the site: location, archive + forecast top-up, cache, errors. The HTTP call is mocked (no network)."""

import json
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.core import weather

H0 = int(datetime(2023, 1, 1, tzinfo=UTC).timestamp())


def _answer(start: int, hours: int, nulls: int = 0) -> dict:
    """An Open-Meteo-like answer: hourly unix times and temperatures, the last `nulls` hours missing."""
    temps = [float(i) for i in range(hours - nulls)] + [None] * nulls
    return {"hourly": {"time": [start + 3600 * i for i in range(hours)], "temperature_2m": temps}}


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> list:
    """Records the requests and answers two days of archive data."""
    seen: list = []

    def fake(url: str, params: dict) -> dict:
        seen.append((url, params))
        return _answer(H0, 48)

    monkeypatch.setattr(weather, "_get_json", fake)
    return seen


def test_site_location() -> None:
    assert weather.site_location({"source": {"lat": 50.1, "lon": 8.6}}) == (50.1, 8.6)
    building = {"outline": [[50.0, 8.0], [50.2, 8.2]]}
    assert weather.site_location({"source": None, "building": building}) == pytest.approx((50.1, 8.1))
    assert weather.site_location({}) is None


def test_archive_only_sends_coordinates_and_dates(calls: list) -> None:
    doc = weather.fetch_hourly(50.12341, 8.65432, date(2023, 1, 1), date(2023, 1, 2), today=date(2026, 1, 1))
    assert len(calls) == 1 and calls[0][0] == weather.ARCHIVE
    assert calls[0][1] == {
        "latitude": "50.1234",
        "longitude": "8.6543",
        "hourly": "temperature_2m",
        "timeformat": "unixtime",
        "timezone": "GMT",
        "start_date": "2023-01-01",
        "end_date": "2023-01-02",
    }
    assert doc["times"][0] == H0 and len(doc["temperature"]) == 48 and doc["lat"] == 50.1234


def test_recent_days_come_from_the_forecast_api(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake(url: str, params: dict) -> dict:
        if url == weather.ARCHIVE:
            return _answer(H0, 48, nulls=24)  # the archive lags: the second day is still missing
        assert params["past_days"] == 3
        return _answer(H0 + 3600 * 12, 72)  # overlaps the archive; only the later hours are used

    monkeypatch.setattr(weather, "_get_json", fake)
    doc = weather.fetch_hourly(50.0, 8.0, date(2023, 1, 1), date(2023, 1, 2), today=date(2023, 1, 3))
    assert doc["times"] == [H0 + 3600 * i for i in range(48)]  # archive day 1, forecast day 2, nothing after the end
    assert doc["temperature"][23] == 23.0 and doc["temperature"][24] == 12.0


def test_bad_ranges() -> None:
    with pytest.raises(ValueError, match="before start"):
        weather.fetch_hourly(50, 8, date(2023, 1, 2), date(2023, 1, 1))
    with pytest.raises(ValueError, match="At most"):
        weather.fetch_hourly(50, 8, date(2020, 1, 1), date(2023, 1, 1))
    for lat, lon in [(91, 8), (50, -181), (float("nan"), 8)]:  # a hand-edited site.json: never sent
        with pytest.raises(ValueError, match="latitude"):
            weather.fetch_hourly(lat, lon, date(2023, 1, 1), date(2023, 1, 2))


def test_future_dates_ask_nothing_of_the_forecast_api(calls: list) -> None:
    with pytest.raises(weather.WeatherUnavailable, match="no temperatures"):
        weather.fetch_hourly(50, 8, date(2030, 1, 1), date(2030, 1, 2), today=date(2026, 1, 1))
    assert calls == []


def test_offline_is_a_clear_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def offline(url: str, timeout: float) -> None:
        raise weather.urllib.error.URLError("no network")

    monkeypatch.setattr(weather.urllib.request, "urlopen", offline)
    with pytest.raises(weather.WeatherUnavailable, match="offline"):
        weather.fetch_hourly(50, 8, date(2023, 1, 1), date(2023, 1, 2), today=date(2026, 1, 1))


def test_route_caches_per_place_and_dates(client: TestClient, dataset_dir: Path, api: str, calls: list) -> None:
    q = {"start": "2023-01-01", "end": "2023-01-02"}
    assert client.get(f"{api}/weather/open-meteo", params=q).status_code == 404  # no site location yet
    site = {"source": {"id": "dc", "name": "DC", "lat": 50.0, "lon": 8.0, "temp_c": 30, "power_kw": 1}}
    client.put(f"{api}/site", json=site)
    first = client.get(f"{api}/weather/open-meteo", params=q)
    assert first.status_code == 200 and first.json()["temperature"][:2] == [0.0, 1.0]
    cache = json.loads((dataset_dir / "weather_open_meteo.json").read_text())
    assert (cache["lat"], cache["start"]) == (50.0, "2023-01-01")
    assert client.get(f"{api}/weather/open-meteo", params=q).json() == first.json() and len(calls) == 1  # cached
    client.put(f"{api}/site", json={**site, "source": {**site["source"], "lat": 51.0}})
    client.get(f"{api}/weather/open-meteo", params=q)
    assert len(calls) == 2  # moved: fetched again
    assert "weather_open_meteo.json" not in client.get(f"{api}/graph/files").text  # not a graph
    assert "weather_open_meteo.json" not in client.get(f"{api}/project").json()["files"]  # derived: not in a project


def test_route_maps_failures(client: TestClient, api: str, monkeypatch: pytest.MonkeyPatch) -> None:
    client.put(f"{api}/site", json={"source": {"id": "dc", "name": "DC", "lat": 50.0, "lon": 8.0, "temp_c": 30, "power_kw": 1}})

    def down(url: str, params: dict) -> dict:
        raise weather.WeatherUnavailable("Could not reach Open-Meteo (offline?): x")

    monkeypatch.setattr(weather, "_get_json", down)
    r = client.get(f"{api}/weather/open-meteo", params={"start": "2023-01-01", "end": "2023-01-02"})
    assert r.status_code == 502 and "offline" in r.json()["detail"]
