"""The "Recovery · air cooled" example (examples/recovery_air_cooled/make.py) on synthetic weather: the energy balance
closes (IT, cooling, electrical losses and the building in, recovered and rejected heat out), Q = m cp ΔT, the recovery
takes the hall's heat up to the loop's capacity and as far as the loop's cold pipe lets it, whatever the demand, the
cooling plant takes the rest (more in summer, when the pipe is warm), the PUE is a real facility's (~1.2), the IT load
spans the loads a scenario asks about, and the plant is sized to give about 38,000 MWh of heat a year (~28,000 MWh
recovered) beside a smaller demand of its own (not the district dataset's series)."""

import numpy as np
import pandas as pd
import pytest

from backend.core.derived import add_derived
from backend.core.physics import Equation
from examples.district_heat_demand import make as dist
from examples.recovery_air_cooled import make as rec


def _base(start: str, temp: float, days: int = 14) -> pd.DataFrame:
    time = pd.date_range(start, periods=24 * days, freq="h")
    h = time.hour.to_numpy(float)
    return pd.DataFrame(
        {
            "time": time,
            "Hour": h,
            "Out_Temp": temp + 4 * np.sin(2 * np.pi * (h - 9) / 24),
            "Out_Hum": 60.0,
            "Out_Wind": 3.0,
            "Out_Wind_Dir": 180.0,
            "Out_Solar": np.clip(600 * np.sin(np.pi * (h - 6) / 12), 0, None),
            "Cool_Set": 25.0,
        }
    )


def test_balance_and_q_from_its_parts() -> None:
    for o in (rec.make(_base("2024-01-08", -2.0)), rec.make(_base("2024-07-08", 28.0))):
        heat = o[rec.HEX["q"]] + o["Heat_rejected"]
        assert rec.facility(o).to_numpy() == pytest.approx(heat.to_numpy(), abs=1e-6)
        assert add_derived(o, rec.DERIVED)[rec.HEX["q"]].to_numpy() == pytest.approx(o[rec.HEX["q"]].to_numpy(), abs=1e-9)


def test_recovery_takes_the_hall_heat_as_far_as_the_loop_lets_it() -> None:
    winter, summer = rec.make(_base("2024-01-08", -2.0)), rec.make(_base("2024-07-08", 28.0))
    assert rec.recovery_share(winter).mean() >= 0.95  # a cold pipe: all the hall's heat, up to the loop's capacity
    assert 0.3 < rec.recovery_share(summer).mean() < 0.95  # a warm pipe: the HEX cannot bring the water down to 18 °C
    for o in (winter, summer):
        assert (o[rec.HEX["q"]] <= rec.Q_LOOP + 1e-9).all() and o["Loop_T_cold"].between(rec.LOOP_MIN, rec.LOOP_MAX).all()
    # the loop warms when the buildings take less than it gets: a district without demand takes less of the hall's heat
    base = _base("2024-04-08", 12.0, days=28)
    none, some = rec.make(base, demand=np.zeros(len(base))), rec.make(base, demand=np.full(len(base), 6000.0))
    assert none["Loop_T_cold"].iloc[-1] > some["Loop_T_cold"].iloc[-1] + 1
    assert none[rec.HEX["q"]].tail(24 * 7).mean() < some[rec.HEX["q"]].tail(24 * 7).mean()
    # a given loop temperature: the recovery follows it, whatever the demand
    given = base.assign(Loop_T_cold=10.0)
    assert (rec.make(given, demand=np.zeros(len(base)))[rec.HEX["q"]] == rec.make(given)[rec.HEX["q"]]).all()


def test_free_cooling_takes_the_water_the_recovery_leaves() -> None:
    o = rec.make(_base("2024-07-08", 28.0))
    left = o[rec.HEX["t_out"]] > rec.T_CHWS + 0.5  # the recovery left heat in the water
    t_wb = rec.wet_bulb(o["Out_Temp"].shift(1).bfill(), o["Out_Hum"].shift(1).bfill())
    cold_tower = t_wb + rec.TOWER_APPROACH + rec.PHE_APPROACH < o[rec.HEX["t_out"]]
    share = rec.free_cooling(o[rec.HEX["t_out"]], t_wb)  # inside the plant: not a column
    assert (share[left & ~cold_tower] == 0).all() and (share[left & cold_tower] > 0).all()


def test_the_cooling_plant_takes_what_the_loop_leaves_more_in_summer() -> None:
    winter, summer = rec.make(_base("2024-01-08", -2.0)), rec.make(_base("2024-07-08", 28.0))
    assert summer["HVAC_Ener"].mean() > 1.2 * winter["HVAC_Ener"].mean()  # the chiller and the tower run in summer
    assert summer["Heat_rejected"].mean() > 2 * winter["Heat_rejected"].mean()
    # rejected even when everything is recovered: the pumps' heat leaves to the outdoor air
    assert (winter["Heat_rejected"] > 0).all()


def test_graph_and_equations_use_lag_one_and_no_derived_column() -> None:
    columns = list(rec.make(_base("2024-01-08", 0.0, days=2)).columns)
    graph = {v for t, ps in rec.LINKS.items() for v in (t, *(p for p, _ in ps))}
    assert all(k >= 1 for ps in rec.LINKS.values() for _, ks in ps for k in ks)  # lags start at 1
    assert graph <= set(columns) and not graph & set(rec.DERIVED)
    for target, expr in rec.EQUATIONS.items():
        eq = Equation(expr, columns)
        assert target not in rec.DERIVED and all(lag >= 1 for _, lag in eq.refs), target
    # the graph is the plant: every modelled variable has its equation, and it uses exactly its links (no more, no fewer)
    assert set(rec.EQUATIONS) == set(rec.LINKS)
    for target, parents in rec.LINKS.items():
        assert set(Equation(rec.EQUATIONS[target], columns).refs) == {(p, k) for p, ks in parents for k in ks}, target


def test_the_equations_are_the_generator() -> None:
    """With the generator's own numbers for the learned coefficients, every equation gives its column (the graph's
    links are the causes make() uses: nothing missing)."""
    o = rec.make(_base("2024-07-08", 26.0))
    known = {
        "dT": rec.DT_SERVER - rec.CRAH_APPROACH,
    }
    exact = ["ITE_Ener", "HEX_Hall_T_in", "HEX_Hall_m", "HEX_Hall_T_out", "Loop_T_warm"]
    for target in (*exact, "HEX_Cond_T_in", "HEX_Cond_m", "HEX_Cond_T_out", "Loop_T_warm_Cond"):  # the rest: noise, learned
        eq = Equation(rec.EQUATIONS[target], list(o.columns))
        values = {(v, lag): o[v].shift(lag).to_numpy() for v, lag in eq.refs}
        got = eq(values, {p: known[p] for p in eq.params})
        rows = slice(2, None)  # the first rows have no hour before
        assert got[rows] == pytest.approx(o[target].to_numpy()[rows], rel=1e-4, abs=1e-3), target


def test_size_and_its_own_demand() -> None:
    base = _base("2024-01-01", 10.0, days=364)  # a year: the hall's levels change every one to four weeks
    o = rec.make(base)
    heat_mwh_a = rec.facility(o).mean() * 8.76  # kW -> MWh a year
    assert 30_000 <= heat_mwh_a <= 42_000 and 3200 <= o["ITE_Ener"].mean() <= 4000  # a 5 MW data center
    assert 1.15 <= rec.pue(o) <= 1.3  # a real facility (1.21 on Frankfurt's weather): IT, cooling, UPS and building
    partial = (o["ITE_Ener"] + o["HVAC_Ener"]).sum() / o["ITE_Ener"].sum()
    assert 1.03 <= partial <= 1.12  # IT and cooling: warm chilled water, free cooling, the recovery
    # the IT load spans ~0.1-1, so a trained twin (a tree model is flat outside its data) answers a 20 % or 90 % scenario
    assert o["IT_Load"].quantile(0.02) < 0.2 and o["IT_Load"].quantile(0.98) > 0.85
    district = dist.heat_demand(rec.local_time(base["time"]), base["Out_Temp"], seed=0, **rec.DEMAND)  # its clock
    assert not np.allclose(o["Heat_Demand"], district)  # its own noise: a separate simulation
    assert np.corrcoef(o["Heat_Demand"], district)[0, 1] > 0.9  # but the same kind of district
