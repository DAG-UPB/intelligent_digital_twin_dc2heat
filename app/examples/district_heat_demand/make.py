"""Create data/sim_district_heat, "District · heat demand": a residential district's hourly heat demand over two years,
on its own outdoor temperature. It is a separate simulation from the data center (sim_recovery_air): Heat Matching and
Planning puts the two together, the district's demand and weather replacing the data center's own inputs.

The demand, every hour (kW):

  Heat_Demand = UA * max(0, HEATING_LIMIT - T24) * curve(hour, weekend) * WEEKEND_FACTOR (weekends)    space heating
              + DHW_KW * dhw(hour, weekend) / mean(dhw)                                                  hot water
              then * (1 + e), e an AR(1) noise of a few per cent (occupants, wind, sun)
  T24         = the mean Out_Temp of the 24 h before (the buildings' thermal mass; BDEW gas SLPs use the daily mean
                temperature the same way)

  curve       the residential day curve of web/src/lib/demand.ts: night setback 22-5 h, a morning peak (6:30, at
              weekends 8:30) and an evening peak (19 h); dhw a morning (7 h, at weekends 9 h) and an evening (20 h)
              draw on a small base (make_sim_1_modified.heat_demand, the same shapes)

The weather: data/sim_1's outdoor temperature (EnergyPlus, simulated) with its two years swapped (2023 has sim_1's 2024
and the other way round) plus an AR(1) noise of about 1 K, so it is plausible for the same site but not the weather the
data center saw. Same hours as sim_1 (2023-01-01 to 2024-12-29, hourly).

Constants, sized to take what an air-cooled data center of ~520 kW IT gives (~5,000 MWh/a: sim_recovery_air):
  HEATING_LIMIT  18.3 °C daily mean, the heating degree-day base 65 °F (ASHRAE Handbook Fundamentals, ch. 14) for
                 sim_1's US-type weather (12-15 °C for new European buildings)
  UA             95 kW/K: some 500-900 dwellings at 0.1-0.2 kW/K each; space heating ~4,700 MWh/a, peak ~4 MW
  DHW_KW         110 kW mean hot water: ~960 MWh/a, 1-2 MWh per dwelling and year (15-20 % of the demand; 10-25 % in
                 residential areas); about a fifth of the data center's hall heat, so in summer the data center can
                 give only about a fifth of its heat, in winter all of it

Also writes dataset.json (kpi.heat_demand: Heat_Demand), causal_graph.json (Heat_Demand on Out_Temp and on itself, lag
1) and equations.json, and trains "phys" (degree hours with the buildings' inertia, fitted) and "linear".

Run from app/:  bash scripts/guard.sh .venv/bin/python examples/district_heat_demand/make.py [data dir] [--no-train]
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

APP = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(APP), str(APP / "scripts")]
from make_sim_1_modified import DATA, EVENING_PEAK, MORNING_PEAK, NIGHT_SETBACK, WEEKEND_FACTOR, _gauss  # noqa: E402

from backend.core.dataset_files import write_graph  # noqa: E402

ID = "sim_district_heat"
SOURCE = "sim_1"
HEATING_LIMIT = 18.3  # °C
UA = 95.0  # kW/K
DHW_KW = 110.0  # kW
NOISE, NOISE_AR = 0.01, 0.9  # AR(1) demand noise: ~2 % standard deviation
WEATHER_NOISE = 0.3  # K per hour, AR(1) 0.95: ~1 K standard deviation

LINKS = {"Heat_Demand": ["Heat_Demand", "Out_Temp"]}
# semi-physical: the buildings follow the degree hours of the hour before with their inertia a (fitted), on a hot-water base
EQUATIONS = {"Heat_Demand": "a*Heat_Demand[t-1] + (1 - a)*(b*maximum(0, c - Out_Temp[t-1]) + d)"}

DATASET = {
    "name": "District · heat demand",
    "kind": "simulation",
    "actuators": [],
    "heat": ["Heat_Demand"],
    "levers": [],
    "pid_image": None,
    "kpi": {"heat_demand": "Heat_Demand", "power_unit": "kW"},
}


def _ar1(n: int, sd: float, rho: float, seed: int) -> np.ndarray:
    e = np.random.default_rng(seed).normal(0, sd, n)
    for i in range(1, n):
        e[i] += rho * e[i - 1]
    return e


def _dhw(hour: np.ndarray, weekend: np.ndarray) -> np.ndarray:
    return 0.25 + _gauss(hour, np.where(weekend, 9, 7), 1) + 0.8 * _gauss(hour, 20, 1.5)


_DHW_MEAN = float(_dhw(np.arange(24.0), np.zeros(24, bool)).mean())


def heat_demand(
    time: pd.Series,
    out_temp: pd.Series,
    ua: float = UA,
    dhw_kw: float = DHW_KW,
    seed: int | None = 0,
    window: int = 24,
    soft: float = 0.0,
    limit: float = HEATING_LIMIT,
    peaks: tuple[float, float, float] = (MORNING_PEAK, EVENING_PEAK, NIGHT_SETBACK),
) -> np.ndarray:
    """A residential district's heat (kW): space heating on the outdoor temperature of the `window` hours before, hot
    water all year, times a small AR(1) noise (`seed` None: none). `soft` (K) rounds the heating limit `limit` (°C): the
    buildings do not all stop heating at one temperature, so spring and autumn fade in and out (softplus; 0: a sharp
    limit). `peaks`: the day curve's morning and evening peaks and its night setback (shares of the mean); `time` is
    the local time the buildings live by."""
    hour = time.dt.hour.to_numpy(float)
    weekend = (time.dt.dayofweek >= 5).to_numpy()
    t24 = out_temp.shift(1).rolling(window, min_periods=1).mean().bfill().to_numpy()
    morning, evening, setback = peaks
    night = np.where((hour >= 22) | (hour < 5), 1 - setback, 1.0)
    curve = night + morning * _gauss(hour, np.where(weekend, 8.5, 6.5), 1.3) + evening * _gauss(hour, 19, 1.8)
    below = limit - t24
    degrees = soft * np.logaddexp(0, below / soft) if soft else np.maximum(0, below)
    space = ua * degrees * curve * np.where(weekend, WEEKEND_FACTOR, 1.0)
    d = space + dhw_kw * _dhw(hour, weekend) / _DHW_MEAN
    return d if seed is None else d * np.clip(1 + _ar1(len(d), NOISE, NOISE_AR, seed), 0.8, 1.2)


def weather(base: pd.DataFrame, seed: int = 0) -> pd.Series:
    """The district's outdoor temperature: the base's two years swapped (rolled by 8760 h) plus an AR(1) noise."""
    t = np.roll(base["Out_Temp"].to_numpy(float), 8760)
    return pd.Series(t + _ar1(len(t), WEATHER_NOISE, 0.95, seed + 100), index=base.index)


def make(base: pd.DataFrame, seed: int = 0) -> pd.DataFrame:
    """The district's hourly columns (time, Hour, Out_Temp, Heat_Demand) from `base` (time, Out_Temp)."""
    out = pd.DataFrame({"time": base["time"].to_numpy(), "Hour": base["time"].dt.hour.to_numpy(float)})
    out["Out_Temp"] = weather(base, seed).to_numpy()
    out["Heat_Demand"] = heat_demand(out["time"], out["Out_Temp"], seed=seed)
    assert (out["Heat_Demand"] > 0).all() and out.notna().all().all()
    return out


def train(data: Path) -> None:
    """phys and linear, trained by the app's own route (in-process), and their test-period free run."""
    from fastapi.testclient import TestClient

    from backend.app import create_app

    api = TestClient(create_app(data))
    base = f"/api/datasets/{ID}/models"
    for name, body in (("linear", {"model": "linear"}), ("phys", {"model": "physics", "equations": EQUATIONS})):
        r = api.post(f"{base}/train", json={"name": name, **body})
        assert r.status_code == 200, r.text
    r = api.post(f"{base}/evaluate", json={"names": ["linear", "phys"]})
    assert r.status_code == 200, r.text
    for name, m in r.json()["models"].items():
        print(name, {v: round(x, 3) for v, x in m["free_r2"].items() if x is not None})


def main(data: Path = DATA, fit: bool = True) -> None:
    """Write data/sim_district_heat from data/sim_1's hours and outdoor temperature (models are rewritten)."""
    dst = data / ID
    dst.mkdir(exist_ok=True)
    df = make(pd.read_parquet(data / SOURCE / f"df_{SOURCE}.parquet", columns=["time", "Out_Temp"]))
    df.to_parquet(dst / f"df_{ID}.parquet", index=False)
    write_graph(dst / "causal_graph.json", {"Hour": [], "Out_Temp": []} | {v: [(p, -1) for p in ps] for v, ps in LINKS.items()})
    for name, obj in (("dataset.json", DATASET), ("equations.json", EQUATIONS)):
        (dst / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    years = df.groupby(df["time"].dt.year)["Heat_Demand"].agg(["sum", "max"]) / [1000, 1]
    print(f"wrote {dst}\n", years.round(0).rename(columns={"sum": "MWh", "max": "peak kW"}))
    if fit:
        train(data)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--no-train"]
    main(Path(args[0]) if args else DATA, "--no-train" not in sys.argv)
