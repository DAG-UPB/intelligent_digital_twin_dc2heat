"""backend/core/summary.py and GET /api/datasets/{id}/summary, on synthetic data only."""

from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from synthetic import make_frame, write_dataset

from backend.app import create_app
from backend.core.summary import KPI_NOTE, NO_REUSE_NOTE, kpi_columns, role_of, summarize

SIM_CONFIG = {"kind": "simulation", "actuators": ["IT_Load"], "levers": [], "heat": ["HEX_Hall_Q"]}


def sim_frame(n: int = 48) -> pd.DataFrame:
    """Hourly frame with the simulations' column names: IT 100 kW, cooling 50 kW (PUE 1.5), hall heat 80 kW,
    condenser heat 30 kW, demand 60 kW."""
    return pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=n, freq="h"),
            "ITE_Ener": np.full(n, 100.0),
            "HVAC_Ener": np.full(n, 50.0),
            "In_Temp": np.linspace(20, 24, n),
            "Out_Temp": np.linspace(-5, 15, n),
            "HEX_Hall_Q": np.full(n, 80.0),
            "HEX_Cond_Q": np.full(n, 30.0),
            "Heat_Demand": np.full(n, 60.0),
            "IT_Load": np.arange(n, dtype=float),
        }
    )


def test_statistics_and_overview() -> None:
    df = make_frame(100)
    s = summarize(df, {"actuators": ["s"], "levers": ["s"], "heat": ["z"]})
    assert s["rows"] == 100 and s["start"] == "2024-01-01T00:00:00" and s["end"] == "2024-01-05T03:00:00"
    assert s["resolution_seconds"] == 3600 and s["duration_hours"] == 99 and s["completeness"] == 1
    assert s["gaps"] == {"count": 0, "longest_hours": 0.0}
    y = next(v for v in s["variables"] if v["name"] == "y")
    assert y["count"] == 100 and y["missing"] == 0
    assert y["mean"] == pytest.approx(df["y"].mean()) and y["median"] == pytest.approx(df["y"].median())
    assert y["p25"] == pytest.approx(df["y"].quantile(0.25)) and y["max"] == pytest.approx(df["y"].max())
    assert len(y["histogram"]["counts"]) == 20 and sum(y["histogram"]["counts"]) == 100
    assert {v["name"]: v["role"] for v in s["variables"]} == {"u": "measured", "s": "lever", "y": "measured", "z": "heat"}
    assert not any(v["calculated"] for v in s["variables"])
    derived = {"z": {"m": "u", "t_in": "y", "t_out": "s", "cp": 1.0}}  # dataset.json "derived": marked calculated
    calc = summarize(df, {"derived": derived})["variables"]
    assert [v["name"] for v in calc if v["calculated"]] == ["z"]


def test_correlation_pairwise_and_constant_column() -> None:
    df = make_frame(200)
    df["c"] = 3.0  # constant: no correlation defined
    df.loc[:9, "u"] = np.nan  # pairwise complete: u's correlations use the other 190 rows
    s = summarize(df, {})
    names, m = s["correlation"]["names"], np.array(s["correlation"]["matrix"], dtype=float)
    i = {n: k for k, n in enumerate(names)}
    assert m[i["y"], i["z"]] == pytest.approx(df["y"].corr(df["z"])) and m[i["y"], i["z"]] > 0.99
    assert np.isnan(m[i["c"], i["y"]]) and np.isnan(m[i["c"], i["c"]])
    assert m[i["u"], i["y"]] == pytest.approx(df["u"].corr(df["y"]))


def test_missing_values_gaps_and_inf() -> None:
    df = make_frame(50)
    df.loc[0:4, "y"] = np.nan
    df.loc[5, "y"] = np.inf
    df = df.drop(index=range(20, 26)).reset_index(drop=True)  # 6 hours missing: one step of 7 h
    s = summarize(df, {})
    y = next(v for v in s["variables"] if v["name"] == "y")
    assert y["missing"] == 6 and y["count"] == 38
    assert s["completeness"] == pytest.approx(1 - 6 / (44 * 4))
    assert s["gaps"] == {"count": 1, "longest_hours": 7.0}


def test_series_are_downsampled_by_bin_means() -> None:
    df = make_frame(1000)
    s = summarize(df, {}, max_points=100)
    assert len(s["series"]["time"]) == 100 and len(s["series"]["columns"]["y"]) == 100
    assert s["series"]["time"][1] == "2024-01-01T10:00:00"  # bin start
    assert s["series"]["columns"]["y"][0] == pytest.approx(df["y"][:10].mean())
    short = summarize(make_frame(30), {})
    assert len(short["series"]["time"]) == 30  # fewer rows than points: every row


def test_simulation_kpis() -> None:
    config = {
        **SIM_CONFIG,
        "heat_source": {"hall": {"q": "HEX_Hall_Q", "t": "In_Temp"}, "condenser": {"q": "HEX_Cond_Q", "t": "Out_Temp"}},
    }
    s = summarize(sim_frame(), config, hex_option="condenser")
    k = {x["label"]: x for x in s["kpis"]}
    assert s["kpi_columns"]["it_power"] and s["kpi_columns"]["cooling_power"]  # the roles, for the what-if
    assert list(k) == ["PUE (partial)", "ERF", "ERE", "IT energy, total", "Heat reused, total"]  # only these
    assert k["PUE (partial)"]["value"] == pytest.approx(1.5) and "IT + cooling only" in k["PUE (partial)"]["note"]
    assert k["ERF"]["value"] == pytest.approx(30 / 150) and k["ERF"]["note"].startswith("condenser HEX")
    assert k["ERE"]["value"] == pytest.approx((150 - 30) / 100)  # = (1 - ERF) x PUE
    assert k["IT energy, total"]["value"] == pytest.approx(48 * 100 / 1000) and k["IT energy, total"]["unit"] == "MWh"
    assert (
        k["Heat reused, total"]["value"] == pytest.approx(48 * 30 / 1000)
        and "50 % of Heat_Demand covered" in k["Heat reused, total"]["note"]
    )
    assert s["kpi_note"] is None
    hall = {x["label"]: x for x in summarize(sim_frame(), config, hex_option="hall")["kpis"]}
    assert hall["ERF"]["value"] == pytest.approx(80 / 150) and "hall HEX" in hall["Heat reused, total"]["note"]
    # 80 kW of heat against 60 kW of demand each hour: all of it covered, not 133 % (the surplus heats nothing)
    assert "· 100 % of Heat_Demand covered" in hall["Heat reused, total"]["note"]
    # no heat_source: every HEX_*_Q counts (summed)
    assert kpi_columns(list(sim_frame().columns), SIM_CONFIG)["heat_power"] == ["HEX_Hall_Q", "HEX_Cond_Q"]
    assert s["kpi_columns"]["other_power"] == []  # no simulation names the facility's other electricity


def test_energies_count_each_row_for_its_own_step() -> None:
    # B-W10: 48 hourly rows and 120 one-minute ones gave 0.28 MWh of IT energy (every row a median minute), not 5.0
    hourly = sim_frame()
    minutes = sim_frame(120).assign(time=pd.date_range("2024-01-03", periods=120, freq="min"))
    k = {x["label"]: x["value"] for x in summarize(pd.concat([hourly, minutes], ignore_index=True), SIM_CONFIG)["kpis"]}
    assert k["IT energy, total"] == pytest.approx(4.8 + 0.2, abs=0.01)
    holed = sim_frame().drop(index=range(10, 30)).reset_index(drop=True)  # a 20 h gap holds no energy
    k = {x["label"]: x["value"] for x in summarize(holed, SIM_CONFIG)["kpis"]}
    assert k["IT energy, total"] == pytest.approx(28 * 100 / 1000)
    assert k["Heat reused, total"] == pytest.approx(28 * (80 + 30) / 1000)


def test_no_reuse_column_skips_erf_and_ere() -> None:
    s = summarize(sim_frame().drop(columns=["HEX_Hall_Q", "HEX_Cond_Q"]), SIM_CONFIG)
    assert [x["label"] for x in s["kpis"]] == ["PUE (partial)", "IT energy, total"] and s["kpi_note"] == NO_REUSE_NOTE


def test_real_data_gets_no_guessed_kpis_and_no_invented_units() -> None:
    s = summarize(sim_frame(), {"kind": "real"})  # same names, but nothing says their units
    assert all(x["unit"] is None for x in s["kpis"])
    assert "IT energy, total" not in {x["label"] for x in s["kpis"]}  # no energy without a power unit
    names = {"ITE_Ener": "it", "HVAC_Ener": "cool", "In_Temp": "a", "Out_Temp": "b", "HEX_Hall_Q": "q"}
    other = sim_frame().rename(columns=names)
    s = summarize(other, {"kind": "real"})
    assert s["kpis"] == [] and s["kpi_note"] == KPI_NOTE


def test_kpi_mapping_from_dataset_json() -> None:
    df = sim_frame().rename(columns={"ITE_Ener": "it", "HVAC_Ener": "cool", "HEX_Hall_Q": "q"})
    config = {"kind": "real", "kpi": {"it_power": "it", "cooling_power": "cool", "heat_power": "q", "power_unit": "W"}}
    cols = kpi_columns(list(df.columns), config)
    assert (
        cols["it_power"] == "it" and cols["heat_power"] == ["q"] and cols["heat_demand"] is None and cols["reuse_point"] is None
    )
    k = {x["label"]: x for x in summarize(df, config)["kpis"]}
    assert k["IT energy, total"]["unit"] == "kWh" and k["PUE (partial)"]["value"] == pytest.approx(1.5)
    assert k["ERF"]["value"] == pytest.approx(80 / 150) and k["Heat reused, total"]["note"] == "q"


def test_full_pue_with_the_other_facility_power() -> None:
    df = sim_frame().assign(ups=8.0, light=2.0)
    df.loc[0, ["ITE_Ener", "ups"]] = [1000.0, np.nan]  # a row without every column: left out of the ratios
    mapping = {"it_power": "ITE_Ener", "cooling_power": "HVAC_Ener", "heat_power": ["HEX_Hall_Q"], "power_unit": "kW"}
    config = {"kind": "real", "kpi": {**mapping, "other_power": ["ups", "light", "gone"]}}
    assert kpi_columns(list(df.columns), config)["other_power"] == ["ups", "light"]  # only columns there
    k = {x["label"]: x for x in summarize(df, config)["kpis"]}
    assert list(k) == ["PUE", "ERF", "ERE", "IT energy, total", "Heat reused, total"]
    assert k["PUE"]["value"] == pytest.approx(160 / 100) and k["PUE"]["note"] == "total facility ÷ IT · ISO/IEC 30134-2"
    assert k["ERF"]["value"] == pytest.approx(80 / 160) and "reused / (IT + cooling + other)" in k["ERF"]["note"]
    assert k["ERE"]["value"] == pytest.approx((160 - 80) / 100) and k["ERE"]["note"].startswith("(IT + cooling + other − reused)")
    # one column as a string, like heat_power
    assert kpi_columns(list(df.columns), {"kpi": {**mapping, "other_power": "ups"}})["other_power"] == ["ups"]
    # a variable counts once: a repeat, or the IT, cooling or reused heat named again (a hand-written dataset.json)
    twice = {"kind": "real", "kpi": {**mapping, "other_power": ["ups", "ups", "HVAC_Ener", "ITE_Ener", "HEX_Hall_Q"]}}
    assert kpi_columns(list(df.columns), twice)["other_power"] == ["ups"]
    assert {x["label"]: x["value"] for x in summarize(df, twice)["kpis"]}["PUE"] == pytest.approx(158 / 100)
    # without it: the partial PUE, as before
    partial = {x["label"]: x for x in summarize(df, {"kind": "real", "kpi": mapping})["kpis"]}
    assert partial["PUE (partial)"]["note"] == "IT + cooling only · ISO/IEC 30134-2"
    assert partial["ERF"]["note"] == "reused / (IT + cooling) · ISO/IEC 30134-6"
    # without the cooling there is no PUE, the other power alone does not make one
    no_cool = {"kind": "real", "kpi": {"it_power": "ITE_Ener", "other_power": ["ups"], "power_unit": "kW"}}
    assert [x["label"] for x in summarize(df, no_cool)["kpis"]] == ["IT energy, total"]


def test_reused_heat_that_is_the_it_power_column() -> None:
    # an air-cooled heat source bounded by its IT power (heat_source q = the IT column): one column in two roles
    df = sim_frame()
    kpi = {"it_power": "ITE_Ener", "cooling_power": "HVAC_Ener", "power_unit": "kW"}
    config = {"kind": "real", "heat_source": {"hall": {"q": "ITE_Ener", "t": "T"}}, "kpi": kpi}
    k = {x["label"]: x["value"] for x in summarize(df, config)["kpis"]}
    assert k["PUE (partial)"] == pytest.approx(1.5) and k["ERF"] == pytest.approx(100 / 150)


def test_heat_source_point() -> None:
    hs = {"hall": {"q": "Q1", "t": "T1"}, "condenser": {"q": "Q2", "t": "T2"}}
    cols = kpi_columns(["Q1", "Q2"], {"kind": "real", "heat_source": hs})
    assert cols["heat_power"] == ["Q2"] and cols["reuse_point"] == "condenser"  # no hex_option: the condenser
    assert kpi_columns(["Q1"], {"kind": "real", "heat_source": hs})["reuse_point"] == "hall"  # else the first that exists
    assert cols["power_unit"] is None


def test_reuse_per_option_in_the_kpi_mapping() -> None:
    config = {
        "kind": "simulation",
        "kpi": {
            "it_power": "ITE_Ener",
            "cooling_power": "HVAC_Ener",
            "heat_demand": "Heat_Demand",
            "reuse": {"hall": "HEX_Hall_Q", "condenser": "HEX_Cond_Q"},
            "power_unit": "kW",
        },
    }
    cols = kpi_columns(list(sim_frame().columns), config, "hall")
    assert cols["heat_power"] == ["HEX_Hall_Q"] and cols["reuse_point"] == "hall" and cols["heat_demand"] == "Heat_Demand"
    assert kpi_columns(list(sim_frame().columns), config)["heat_power"] == ["HEX_Cond_Q"]


def test_role_of() -> None:
    assert role_of("a", {"heat": ["a"], "actuators": ["a"]}) == "heat"
    assert role_of("b", {"actuators": ["b"]}) == "actuator" and role_of("c", {}) == "measured"


def test_summary_endpoint(client: TestClient, api: str) -> None:
    r = client.get(f"{api}/summary")
    d = r.json()
    assert r.status_code == 200 and d["file"] == "df_sim_x" and d["rows"] == 600
    assert [v["name"] for v in d["variables"]] == ["u", "s", "y", "z"] and d["correlation"]["names"] == ["u", "s", "y", "z"]
    assert client.get(f"{api}/summary", params={"file": "df_sim_x"}).json() == d  # cached
    assert client.get(f"{api}/summary", params={"file": "nope"}).status_code == 404
    assert client.get("/api/datasets/nope/summary").status_code == 404


def test_summary_endpoint_nan_and_constant_are_null(tmp_path: Path) -> None:
    df = make_frame(30)
    df["c"] = 1.0
    df.loc[3, "y"] = np.nan
    write_dataset(tmp_path / "gappy", df)
    d = TestClient(create_app(tmp_path)).get("/api/datasets/gappy/summary").json()
    i = d["correlation"]["names"].index("c")
    assert d["correlation"]["matrix"][i][i] is None and d["series"]["columns"]["y"][3] is None
    assert next(v for v in d["variables"] if v["name"] == "c")["std"] == 0


def test_shapes_for_the_extra_views() -> None:
    from backend.core.summary import autocorrelation, shapes

    t = pd.date_range("2024-01-01", periods=24 * 60, freq="h")
    daily = np.sin(2 * np.pi * t.hour.to_numpy() / 24)
    num = pd.DataFrame({"d": daily, "ramp": np.arange(len(t), dtype=float)})
    out = shapes(num, pd.Series(t))
    assert out["duration"]["ramp"][0] == len(t) - 1 and out["duration"]["ramp"][-1] == 0  # highest first
    assert len(out["daily"]["d"]["mean"]) == 24 and out["daily"]["d"]["mean"][6] == pytest.approx(1.0)
    acf = autocorrelation(daily, 48)
    assert acf[23] > 0.9 and acf[11] < -0.9  # one day back alike, half a day back opposite
    assert out["monthly"]["ramp"][0] < out["monthly"]["ramp"][1] and np.isnan(out["monthly"]["ramp"][5])  # no June


def test_the_kpi_variables_are_chosen_and_saved_in_dataset_json(tmp_path):
    import json

    from fastapi.testclient import TestClient

    from backend.app import create_app

    d = tmp_path / "dc_t"
    d.mkdir()
    times = pd.date_range("2024-01-01", periods=4, freq="h")
    pd.DataFrame(
        {"time": times, "elec_it": [10.0, 10, 10, 10], "elec_cool": [3.0, 3, 3, 3], "q": [2.0] * 4, "ups": [1.0] * 4}
    ).to_parquet(d / "data.parquet")
    (d / "dataset.json").write_text(json.dumps({"name": "T", "kind": "real"}))
    c = TestClient(create_app(tmp_path, None))
    assert c.get("/api/datasets/dc_t/summary").json()["kpis"] == []

    r = c.put(
        "/api/datasets/dc_t/kpi",
        json={"it_power": "elec_it", "cooling_power": "elec_cool", "heat_power": ["q"], "power_unit": "kW"},
    )
    assert r.status_code == 200
    assert json.loads((d / "dataset.json").read_text())["kpi"] == {
        "it_power": "elec_it",
        "cooling_power": "elec_cool",
        "heat_power": ["q"],
        "power_unit": "kW",
    }
    kpis = {k["label"]: k["value"] for k in c.get("/api/datasets/dc_t/summary").json()["kpis"]}
    assert kpis["PUE (partial)"] == pytest.approx(1.3) and kpis["ERF"] == pytest.approx(2 / 13)

    # the facility's other electricity: saved as a list, then PUE is the full one
    r = c.put("/api/datasets/dc_t/kpi", json={"it_power": "elec_it", "cooling_power": "elec_cool", "other_power": "ups"})
    assert r.status_code == 200 and json.loads((d / "dataset.json").read_text())["kpi"]["other_power"] == ["ups"]
    assert {k["label"]: k["value"] for k in c.get("/api/datasets/dc_t/summary").json()["kpis"]}["PUE"] == pytest.approx(1.4)
    r = c.put("/api/datasets/dc_t/kpi", json={"it_power": "elec_it", "other_power": []})  # an empty list is none
    assert r.status_code == 200 and json.loads((d / "dataset.json").read_text())["kpi"] == {"it_power": "elec_it"}
    assert c.put("/api/datasets/dc_t/kpi", json={"other_power": ["ups", "nope"]}).status_code == 422
    r = c.put("/api/datasets/dc_t/kpi", json={"it_power": "elec_it", "cooling_power": "elec_cool", "other_power": ["elec_cool"]})
    assert r.status_code == 422 and "counts once" in r.json()["detail"]  # else E_DC would count the cooling twice
    r = c.put("/api/datasets/dc_t/kpi", json={"it_power": "elec_it", "cooling_power": "elec_cool", "other_power": ["ups", "ups"]})
    assert r.status_code == 200 and json.loads((d / "dataset.json").read_text())["kpi"]["other_power"] == ["ups"]

    assert c.put("/api/datasets/dc_t/kpi", json={"it_power": "nope"}).status_code == 422
    assert c.put("/api/datasets/dc_t/kpi", json={"heat_power": ["q"]}).status_code == 422
    assert c.put("/api/datasets/dc_t/kpi", json={}).status_code == 200
    assert "kpi" not in json.loads((d / "dataset.json").read_text())
