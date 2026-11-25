"""The electricity market from SMARD's downloads: both exports, summer time, the CO₂ of the mix, the route."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core import market

PRICE_HEAD = "Start date;End date;Germany/Luxembourg [€/MWh] Calculated resolutions;Belgium [€/MWh] Calculated resolutions"
GEN_HEAD = (
    "Start date;End date;Biomass [MWh] Calculated resolutions;Nuclear [MWh] Calculated resolutions;"
    "Lignite [MWh] Calculated resolutions;Fossil gas [MWh] Calculated resolutions;Photovoltaics [MWh] Calculated resolutions"
)


def write(folder: Path, sub: str, name: str, lines: list[str]) -> None:
    """A SMARD CSV as downloaded (UTF-8 with BOM, semicolons)."""
    (folder / sub).mkdir(parents=True, exist_ok=True)
    (folder / sub / name).write_text("﻿" + "\n".join(lines) + "\n", encoding="utf-8")


def test_the_english_export_through_the_autumn_hour_that_comes_twice(tmp_path: Path):
    # 29 October 2023: 2:00 local comes twice (summer, then winter time); 00:00 local is 22:00 UTC the day before
    write(
        tmp_path,
        market.PRICE_DIR,
        "p.csv",
        [
            PRICE_HEAD,
            "Oct 29, 2023 1:00 AM;Oct 29, 2023 2:00 AM;1,234.50;9",
            "Oct 29, 2023 2:00 AM;Oct 29, 2023 2:00 AM;-5.17;9",
            "Oct 29, 2023 2:00 AM;Oct 29, 2023 3:00 AM;7.00;9",
            "Oct 29, 2023 3:00 AM;Oct 29, 2023 4:00 AM;-;9",
        ],
    )
    p = market.prices(sorted((tmp_path / market.PRICE_DIR).glob("*.csv")))
    # 1:00 summer time is 23:00 UTC; 2:00 summer time 0:00 UTC, 2:00 winter time 1:00 UTC; 3:00 local: no value
    assert p == {1698534000: 1234.5, 1698537600: -5.17, 1698541200: 7.0}


def test_the_german_export_and_the_mix_co2(tmp_path: Path):
    write(
        tmp_path,
        market.GENERATION_DIR,
        "g.csv",
        [
            "Datum von;Datum bis;Biomasse [MWh] Berechnete Auflösungen;Kernenergie [MWh] Berechnete Auflösungen;"
            "Braunkohle [MWh] Berechnete Auflösungen;Erdgas [MWh] Berechnete Auflösungen;"
            "Photovoltaik [MWh] Berechnete Auflösungen",
            "01.06.2024 12:00;01.06.2024 13:00;1.000,0;-;1.000,0;2.000,0;6.000,0",
        ],
    )
    co2 = market.grid_co2(sorted((tmp_path / market.GENERATION_DIR).glob("*.csv")))
    at = 1717236000  # 12:00 summer time is 10:00 UTC
    assert co2 == {at: pytest.approx((1000 * 86 + 1000 * 1097 + 2000 * 369) / 10_000)}


def test_quarter_hours_make_one_hour_and_an_english_thousands_comma_is_thousands(tmp_path: Path):
    # English export, quarter-hourly: "1,000" is a thousand (not 1.0) and the hour's CO₂ is its four quarters together
    rows = [
        "Jun 1, 2024 12:00 PM;Jun 1, 2024 12:15 PM;1,000;-;0;0;512.5",
        "Jun 1, 2024 12:15 PM;Jun 1, 2024 12:30 PM;0;-;1,000;0;0",
        "Jun 1, 2024 12:30 PM;Jun 1, 2024 12:45 PM;0;-;0;0;1,000",
        "Jun 1, 2024 12:45 PM;Jun 1, 2024 1:00 PM;0;-;0;0;1,000",
    ]
    write(tmp_path, market.GENERATION_DIR, "g.csv", [GEN_HEAD, *rows])
    co2 = market.grid_co2(sorted((tmp_path / market.GENERATION_DIR).glob("*.csv")))
    pv = market.CO2_G_PER_KWH["photovoltaics"]
    want = (1000 * 86 + 1000 * 1097 + 2512.5 * pv) / 4512.5
    assert co2 == {1717236000: pytest.approx(want)}


def test_a_source_without_a_factor_is_refused(tmp_path: Path):
    lines = ["Start date;End date;Unobtainium [MWh]", "Jan 1, 2024 12:00 AM;Jan 1, 2024 1:00 AM;5"]
    write(tmp_path, market.GENERATION_DIR, "g.csv", lines)
    with pytest.raises(ValueError, match="no emission factor for unobtainium"):
        market.grid_co2(sorted((tmp_path / market.GENERATION_DIR).glob("*.csv")))


def test_the_route_gives_every_hour_with_null_where_a_file_has_none(tmp_path: Path, data_dir: Path):
    write(tmp_path, market.PRICE_DIR, "p.csv", [PRICE_HEAD, "Jan 1, 2024 1:00 AM;Jan 1, 2024 2:00 AM;50.00;9"])  # 0:00 UTC
    write(tmp_path, market.GENERATION_DIR, "g.csv", [GEN_HEAD, "Jan 1, 2024 2:00 AM;Jan 1, 2024 3:00 AM;0;0;1,000;0;0"])
    client = TestClient(create_app(data_dir, None, market_dir=tmp_path))
    start = 1704067200  # 1 January 2024, 0:00 UTC
    r = client.get("/api/market/hourly", params={"start": start, "end": start + 3 * 3600})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["times"] == [start, start + 3600, start + 7200]
    assert body["price_eur_mwh"] == [50.0, None, None]
    assert body["co2_g_kwh"] == [None, 1097.0, None]
    assert body["covered"] == {"price": 1, "co2": 1}
    assert body["files"] == {"price": ["p.csv"], "co2": ["g.csv"]}
    assert body["hint"] is None
    # no files (the usual case: not in git): every hour null and where to put them, not an error the browser logs
    empty = TestClient(create_app(data_dir, None, market_dir=tmp_path / "none"))
    r = empty.get("/api/market/hourly", params={"start": start, "end": start + 3600})
    assert r.status_code == 200 and r.json()["price_eur_mwh"] == [None] and "elec_price" in r.json()["hint"]
