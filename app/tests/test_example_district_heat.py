"""The "District · heat demand" example (examples/district_heat_demand/make.py) on synthetic weather: demand falls with
the outdoor temperature, a hot-water base stays in summer, day and week rhythms, its own weather, and the size that
takes what sim_recovery_air gives."""

import numpy as np
import pandas as pd

from backend.core.physics import Equation
from examples.district_heat_demand import make as dist


def _base(days: int = 730) -> pd.DataFrame:
    """Two synthetic years, hourly: a seasonal and a day swing (coldest in January, at 5 h)."""
    time = pd.Series(pd.date_range("2023-01-01", periods=24 * days, freq="h"))
    doy, h = time.dt.dayofyear.to_numpy(float), time.dt.hour.to_numpy(float)
    out_temp = 15 - 12 * np.cos(2 * np.pi * (doy - 15) / 365) + 4 * np.sin(2 * np.pi * (h - 11) / 24)
    return pd.DataFrame({"time": time, "Out_Temp": out_temp})


def test_demand_follows_the_weather_with_a_summer_base() -> None:
    o = dist.make(_base())
    month = o["time"].dt.month
    jan, jul = o["Heat_Demand"][month == 1].mean(), o["Heat_Demand"][month == 7].mean()
    assert jan > 5 * jul and 0.8 * dist.DHW_KW <= jul <= 1.2 * dist.DHW_KW  # summer: hot water only
    assert np.corrcoef(o["Out_Temp"], o["Heat_Demand"])[0, 1] < -0.8
    annual = o["Heat_Demand"].sum() / 2 / 1000
    assert 3000 <= annual <= 9000  # MWh a year: of the order of the data center's ~5,000


def test_day_and_week_rhythm() -> None:
    o = dist.make(_base())
    winter = o[o["time"].dt.month == 1]
    by_hour = winter.groupby(winter["time"].dt.hour)["Heat_Demand"].mean()
    assert by_hour[7] > 1.2 * by_hour[3] and by_hour[19] > 1.2 * by_hour[3]  # morning and evening above the night setback
    noon = o["time"].dt.hour == 12
    wkend = o["time"].dt.dayofweek >= 5
    assert o["Heat_Demand"][noon & wkend].mean() != o["Heat_Demand"][noon & ~wkend].mean()


def test_its_own_weather_and_noise() -> None:
    base = _base()
    o = dist.make(base)
    assert not np.allclose(o["Out_Temp"], base["Out_Temp"])  # the years swapped, plus noise
    assert abs(o["Out_Temp"].mean() - base["Out_Temp"].mean()) < 1.5
    clean = dist.heat_demand(o["time"], o["Out_Temp"], seed=None)
    assert 0.005 < (o["Heat_Demand"] / clean - 1).std() < 0.1
    assert np.array_equal(dist.make(base)["Heat_Demand"], o["Heat_Demand"])  # seeded


def test_graph_and_equation_use_lag_one() -> None:
    columns = list(dist.make(_base(days=2)).columns)
    assert {v for t, ps in dist.LINKS.items() for v in (t, *ps)} <= set(columns)
    for target, expr in dist.EQUATIONS.items():
        assert all(lag >= 1 for _, lag in Equation(expr, columns).refs), target
