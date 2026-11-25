"""The scripts: the synthetic HEX variables (air-cooled; free-cooling cases A1, W1), the privacy guard, the memory watchdog."""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import make_sim_1_modified
import make_sim_cases
import pandas as pd
import pytest


def _sim(hours: int, out_temp: float, ite: float = 40.0) -> pd.DataFrame:
    time = pd.date_range("2024-01-01", periods=hours, freq="h")
    return pd.DataFrame({"time": time, "ITE_Ener": ite, "HVAC_Ener": 5.0, "In_Temp": 23.0, "Out_Temp": out_temp, "Out_Hum": 50.0})


def _balance(h: pd.DataFrame, k: str, cp: float) -> None:
    """Q = m cp (T_in - T_out) exactly, and T_out < T_in when Q > 0."""
    t_in, t_out, m, q = (h[f"HEX_{k}_{v}"] for v in ("T_in", "T_out", "m", "Q"))
    assert q.to_numpy() == pytest.approx((m * cp * (t_in - t_out)).to_numpy())
    assert (t_out[q > 0] < t_in[q > 0]).all()


def test_add_hex_has_four_columns_per_hex() -> None:
    h = make_sim_1_modified.add_hex(_sim(48, 0.0))
    assert sorted(c for c in h if c.startswith("HEX_")) == sorted(
        f"HEX_{k}_{v}" for k in ("Hall", "Cond") for v in ("T_in", "T_out", "m", "Q")
    )
    assert make_sim_1_modified.DATASET["heat_source"]["condenser"] == {
        "q": "HEX_Cond_Q",
        "t": "HEX_Cond_T_in",
        "t_in": "HEX_Cond_T_in",
        "t_out": "HEX_Cond_T_out",
        "m": "HEX_Cond_m",
    }


def test_cases_free_cooling_and_chiller_only_when_needed() -> None:
    """A1 (air) and W1 (water): free cooling when the weather allows, the chiller's heat at the condenser only while it
    runs, the plant's electricity falling with free cooling, and every HEX's energy balance."""
    c = make_sim_cases
    cold, warm = c.add_air(_sim(48, -5.0)), c.add_air(_sim(48, 30.0))
    assert (cold["FC_Share"] == 1).all() and (warm["FC_Share"] == 0).all()
    assert cold["HEX_Cond_Q"].max() == pytest.approx(0) and warm["HEX_Cond_Q"].min() > 0  # no chiller, no condenser heat
    assert cold["HVAC_Ener"].mean() < warm["HVAC_Ener"].mean()
    for k, cp in (("Hall", c.CP_AIR), ("Cond", c.CP_WATER)):
        _balance(warm, k, cp)
    # W1: the same plant, only the inside different: the facility water hot, the condenser with the air's share
    w, wc = c.add_water(_sim(48, 30.0)), c.add_water(_sim(48, -5.0))
    for k in ("Liq", "Cond"):
        _balance(w, k, c.CP_WATER)
    assert w["HEX_Liq_T_in"].between(c.T_FWS_MIN, c.T_FWS_MAX + c.DT_LIQ_DESIGN + 1e-9).all()
    assert (w["HEX_Liq_T_in"] > w["HEX_Cond_T_in"]).all()
    assert wc["HEX_Cond_Q"].max() == pytest.approx(0) and (wc["FC_Share"] == 1).all()
    assert w["HVAC_Ener"].mean() < warm["HVAC_Ener"].mean()  # the chiller only for the rear doors' share
    hot = c.add_water(_sim(48, 46.0))
    assert hot["HEX_Liq_T_in"].min() > w["HEX_Liq_T_in"].max() - 1e-9  # the facility supply rises with the wet bulb
    assert set(c.POINTS["sim_1_air"]) == set(c.POINTS["sim_1_water"]) - {"liquid"} | {"hall"}
    for dc in c.MAKE:
        derived = set(c.dataset_json(dc)["derived"])
        graph_vars = set(c.LINKS[dc]) | {p for ps in c.LINKS[dc].values() for p in ps}
        assert not graph_vars & derived and not set(c.EQUATIONS[dc]) & derived


def test_q_is_derived_not_in_the_graph_or_the_equations() -> None:
    """Q of each HEX is calculated from T_in, T_out and m (dataset.json "derived"): no graph node, no equation."""
    from backend.core.derived import add_derived

    m = make_sim_1_modified
    h = m.add_hex(_sim(48, 0.0))
    derived = m.DATASET["derived"]
    assert derived["HEX_Hall_Q"] == {"m": "HEX_Hall_m", "t_in": "HEX_Hall_T_in", "t_out": "HEX_Hall_T_out", "cp": m.CP_AIR}
    assert derived["HEX_Cond_Q"]["cp"] == m.CP_WATER
    for q, values in add_derived(h, derived).items():
        assert values.to_numpy() == pytest.approx(h[q].to_numpy()), q
    graph = {v for t, ps in m.LINKS.items() for v in (t, *ps)}
    assert not graph & set(derived) and not set(m.EQUATIONS) & set(derived)
    assert set(m.LINKS["HEX_Cond_T_out"]) >= {"Heat_Demand"} and set(m.LINKS["HEX_Hall_T_out"]) >= {"Heat_Demand"}


def test_add_hex_hall_and_condenser_in_winter() -> None:
    m = make_sim_1_modified
    h = m.add_hex(_sim(72, -10.0))  # cold
    _balance(h, "Hall", m.CP_AIR)
    _balance(h, "Cond", m.CP_WATER)
    demand = h["Heat_Demand"].shift(1).bfill()
    r, d = h.iloc[24 + 8], demand.iloc[24 + 8]  # 8:00, after the morning peak: more demand than the hall coil gives
    assert r["HEX_Hall_T_in"] == 35.0  # 23 °C room + 12 K across the servers
    assert r["HEX_Hall_m"] == pytest.approx(40 / (1.006 * 12))  # 3.3 kg/s of air
    assert d > 20 and r["HEX_Hall_Q"] == pytest.approx(0.6 * 40 / 12 * (35 - 25))  # eps * C_air * (T_in - T_sink) = 20 kW
    assert r["HEX_Hall_T_out"] == pytest.approx(35 - 0.6 * 10)  # air cooled by 6 K
    # a wet bulb of -10 °C is far below: the tower bypass holds 27 °C; 45 kW < 45 kW minimum flow heat -> minimum flow
    assert r["HEX_Cond_m"] == pytest.approx(45 / (4.18 * 5.5)) and r["HEX_Cond_T_in"] == pytest.approx(27 + 5.5)
    assert r["HEX_Cond_Q"] == pytest.approx(min(45, d))
    assert h["Heat_Demand"].mean() == pytest.approx(0.5 * 40)  # DEMAND_SHARE x mean IT power


def test_add_hex_is_demand_limited_in_summer() -> None:
    m = make_sim_1_modified
    h = m.add_hex(_sim(72, 30.0, ite=60.0))  # above the heating limit: hot water only
    demand = h["Heat_Demand"].shift(1).bfill()
    assert (h["HEX_Hall_Q"] == demand).all() and (h["HEX_Cond_Q"] == demand).all()
    _balance(h, "Hall", m.CP_AIR)
    _balance(h, "Cond", m.CP_WATER)
    wb = m.wet_bulb(30.0, 50.0)
    assert 22 < wb < 23  # Stull 2011: 30 °C, 50 % -> 22.3 °C
    # 65 kW > minimum-flow heat: the pump holds the design range of 5.5 K
    assert h["HEX_Cond_m"].iloc[-1] == pytest.approx(65 / (4.18 * 5.5)) and h["HEX_Cond_T_in"].iloc[-1] == pytest.approx(
        max(wb + 4, 27) + 5.5
    )


def test_add_hex_never_takes_more_than_the_exchanger_gives() -> None:
    m = make_sim_1_modified
    df = _sim(72, -10.0)
    df.loc[48:, "ITE_Ener"] = 2.0  # the hall nearly idles on the last day of a cold spell: the coil, not the demand, limits
    h = m.add_hex(df)
    demand, last = h["Heat_Demand"].shift(1).bfill(), h.iloc[50:]
    assert (last["HEX_Hall_Q"] < demand[50:]).all() and last["HEX_Hall_Q"].to_numpy() == pytest.approx(0.6 * 2 / 12 * 10)
    assert (h["HEX_Hall_T_out"] > m.T_SINK).all()
    assert (last["HEX_Cond_Q"] <= 7.0 + 1e-9).all()  # never more than the condenser heat (IT + HVAC)


def test_heat_demand_follows_the_weather_and_the_clock() -> None:
    m = make_sim_1_modified
    df = _sim(24 * 14, 0.0)
    df.loc[24 * 7 :, "Out_Temp"] = 20.0  # second week above the heating limit
    d = m.heat_demand(df["time"], df["Out_Temp"], 10.0)
    assert d.mean() == pytest.approx(10.0) and (d > 0).all()
    assert d[24 * 3 : 24 * 4].mean() > 5 * d[24 * 10 : 24 * 11].mean()  # winter week >> hot water only
    assert d[24 * 2 + 7] > d[24 * 2 + 3]  # morning peak above the night
    # the 24 h mean ends one hour back: the first warm hour does not change the demand yet (same Monday hour as week 1)
    assert d[24 * 7] == pytest.approx(d[0]) and d[24 * 7 + 1] < d[1]


def test_equations_reproduce_the_hex_from_the_previous_hour() -> None:
    """equations.json: every input of the phys model has a lag >= 1, and with the true constants it gives add_hex back."""
    import numpy as np

    from backend.core.physics import Equation

    m = make_sim_1_modified
    df = _sim(72, -10.0)
    df.loc[30:, "Out_Temp"], df.loc[50:, "ITE_Ener"] = 35.0, 2.0  # winter, summer, an idle hall
    df["HVAC_Ener"], df["Out_Hum"] = np.linspace(1, 30, 72), 60.0
    h = m.add_hex(df)
    rows = np.arange(1, len(h))
    for v, expr in m.EQUATIONS.items():
        eq = Equation(expr, [*h.columns, "Cool_Set"])
        assert min(lag for _, lag in eq.refs) >= 1, v
        if v.startswith("HEX_"):
            true = {"eps": m.EPS_AIR, "approach": m.TOWER_APPROACH, "dT": m.DT_COND_DESIGN if "Cond" in v else m.DT_SERVER}
            pred = eq({(p, lag): h[p].to_numpy()[rows - lag] for p, lag in eq.refs}, true)
            assert pred == pytest.approx(h[v].to_numpy()[1:]), v


DATA = Path(__file__).resolve().parent.parent / "data"


def test_data_dirs_come_from_the_script_location() -> None:
    if "IDT_DATA_DIR" not in os.environ:
        assert DATA == make_sim_1_modified.DATA


def _ignored(path: Path) -> bool:
    return subprocess.run(["git", "check-ignore", "-q", str(path)], cwd=DATA).returncode == 0


@pytest.mark.skipif(shutil.which("git") is None or not DATA.exists(), reason="needs the git checkout")
def test_privacy_guard() -> None:
    """Only simulations may be committed: everything else under app/data (real plants, _local) is ignored by git."""
    assert _ignored(DATA / "plant_a_rack_1" / "x.parquet")
    assert _ignored(DATA / "_local" / "map_examples.json")
    assert not _ignored(DATA / "sim_3" / "x.parquet")
    for p in ["sim_3/.backup/x.json", "sim_3/pid.png", "sim_3/pid_plant.json"]:
        assert _ignored(DATA / p), p
    assert subprocess.run(["git", "check-ignore", "-q", str(DATA / "sim_3" / "causal_graph.json")], cwd=DATA).returncode == 1


@pytest.mark.skipif(sys.platform == "win32" or shutil.which("bash") is None, reason="guard.sh is a bash script")
def test_memory_guard() -> None:
    """guard.sh passes the command's exit code through and reports the peak RSS."""
    guard = Path(__file__).resolve().parent.parent / "scripts" / "guard.sh"
    for cmd, rc in [("true", 0), ("false", 1)]:
        r = subprocess.run(["bash", str(guard), cmd], capture_output=True, text=True, timeout=30)
        assert r.returncode == rc
        assert r.stdout.strip().splitlines()[-1].startswith("peak RSS: ") and r.stdout.rstrip().endswith(f"exit {rc}")
