"""Create data/sim_1_modified: sim_1 plus a heat demand and two demand-limited heat-recovery exchangers (HEX).

The two HEX are the two design options of site.json hex_option: each set of columns is what that option would
recover if it alone served the heat demand. Each HEX has four columns, all on its hot (heat-source) side:
T_in and T_out (°C), the mass flow m (kg/s) and the recovered heat Q (kW), with Q = m * cp * (T_in - T_out) exactly
and cp a literature constant. Q is a calculated column (dataset.json "derived"): it is not in the causal graph and
never a model target; the twin predicts T_in, T_out and m and the app computes Q from them. Every value of hour t is
computed from the values of hour t-1 (rows one back), so every causal link has a lag of at least 1. Full derivation
and sources: docs/concepts/simulated-heat-recovery.md.

Heat demand of the recovery loop (the 5GDH / heat-pump source it feeds), the district generator of
web/src/lib/demand.ts with its default parameters:
  T24(t)          = mean of Out_Temp over hours t-24 .. t-1                 the buildings follow the daily mean
  Heat_Demand(t)  = S * [(1-f_dhw) * max(0, T_limit - T24) * heating(h) / mean(..) + f_dhw * dhw(h) / mean(..)]
  h = clock hour of t (Hour[t-1] + 1, a calendar input); heating and hot-water daily curves, night set-back and the
  weekend shift as in demand.ts. S = DEMAND_SHARE * mean(ITE_Ener): the year's demand is half the year's IT heat,
  so in winter it exceeds what the exchangers can give and in summer (hot water only) it is far below; the demand
  limit binds in part of the year [ERF of real schemes 0.1-0.6: Yuan et al. 2023].

Hall HEX, an air-to-water coil in the CRAH return air (hot side: AIR):
  HEX_Hall_T_in(t)  = In_Temp(t-1) + DT_SERVER                     hot-aisle return air        [ASHRAE TC 9.9; AKCP]
  HEX_Hall_m(t)     = ITE_Ener(t-1) / (CP_AIR * DT_SERVER)          air flow sized for DT_SERVER [Upsite, AKCP]
  Q_max             = EPS_AIR * m * CP_AIR * max(0, T_in - T_SINK)  ε-NTU, air is C_min          [Yuan et al. 2023]
  HEX_Hall_Q(t)     = min(Q_max, Heat_Demand(t-1))                  only used heat counts       [EU 2024/1364]
  HEX_Hall_T_out(t) = T_in - Q / (m * CP_AIR)                       air on to the CRAH coil

Condenser HEX, a water-to-water plate HEX on the condenser water between chiller and cooling tower (hot side: WATER):
  Q_cond            = ITE_Ener(t-1) + HVAC_Ener(t-1)                IT heat + cooling electricity
  T_wb              = Stull (2011) wet bulb of Out_Temp(t-1), Out_Hum(t-1)
  T_cw              = max(T_wb + TOWER_APPROACH, T_CW_MIN)          water from the tower        [CTI; AHRI 550/590]
  HEX_Cond_m(t)     = max(Q_cond, MIN_FLOW * Q_COND_DESIGN) / (CP_WATER * DT_COND_DESIGN)
                      variable-speed condenser pump holding the design range, down to MIN_FLOW of design flow
                      [AHRI 550/590 range 5.6 K; ASHRAE 90.1-2019 6.5.4.2: variable flow to <= 50 % of design]
  HEX_Cond_T_in(t)  = T_cw + Q_cond / (m * CP_WATER)                water leaving the chiller
  Q_max             = EPS_PLATE * m * CP_WATER * (T_in - T_SINK)    plate HEX, hot side C_min   [Deppmann 2023]
  HEX_Cond_Q(t)     = min(Q_max, Q_cond, Heat_Demand(t-1))
  HEX_Cond_T_out(t) = T_in - Q / (m * CP_WATER)                     water on to the tower

HVAC_Ener is sim_1's EnergyPlus cooling (chiller) electricity; it does not see the recovery (no fan penalty, no COP
change). In heat-recovery operation all cooling heat is taken to pass the condenser water loop (water-side
economiser in winter), and the tower bypass keeps the water entering the chiller at >= T_CW_MIN, above T_SINK.

Also writes the standard graph (manual + the new links, no Q: it is calculated) and its lag-discovered versions,
dataset.json and the physics equations (equations.json, the same formulas with the constants the 'phys' model learns):
  causal_graph.json         manual graph (sim_1/causal_graph_manual.json) + the new links, all lag 1
  causal_graph_pcmci.json   same variables and links, lags 1..5 discovered with PCMCI
  causal_graph_pc.json      same, discovered with PC

Run from app/:  .venv/bin/python scripts/make_sim_1_modified.py [data dir]
The data dir defaults to app/data (or $IDT_DATA_DIR); it must hold sim_1/.
"""

import json
import os
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.core.causal_discovery import relag_graph  # noqa: E402
from backend.core.dataset_files import read_graph, write_graph  # noqa: E402

DATA = Path(os.environ.get("IDT_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))

# Specific heats, constant over 20-45 °C (they vary < 0.3 % there)
CP_AIR = 1.006  # kJ/(kg K), dry air (ASHRAE Handbook Fundamentals 2021, ch. 1 Psychrometrics)
CP_WATER = 4.18  # kJ/(kg K), liquid water at 30 °C (IAPWS-IF97: 4.180)
# Hall (air side)
DT_SERVER = 12.0  # K, air temperature rise across the servers (10-15 K typical; AKCP, Upsite)
EPS_AIR = 0.6  # effectiveness of a 2-4 row counter-flow recovery coil, air = C_min (0.5-0.75)
# Condenser water (between chiller and tower)
TOWER_APPROACH = 4.0  # K above wet bulb (CTI 95/85/78 °F: 3.9 K)
T_CW_MIN = 27.0  # °C, condenser water into the chiller in heat-recovery operation (tower bypass)
DT_COND_DESIGN = 5.5  # K, condenser design range (AHRI 550/590: 29.4 -> 35 °C)
Q_COND_DESIGN = 90.0  # kW, design condenser load (sim_1 peak of ITE_Ener + HVAC_Ener: 88 kW)
MIN_FLOW = 0.5  # minimum condenser flow, share of design (ASHRAE 90.1 6.5.4.2: variable flow down to 50 %)
EPS_PLATE = 0.8  # plate HEX effectiveness (approach 1-3 K; Deppmann 2023)
# Heat sink (shared by both options): return water of the low-temperature loop / heat-pump evaporator
T_SINK = 25.0  # °C (20-27 °C; Stockholm Data Parks 2017, EN 14511)
# Heat demand (web/src/lib/demand.ts DEFAULT_DISTRICT)
DEMAND_SHARE = 0.5  # annual demand / annual IT heat (ERF of real schemes 0.1-0.6)
HEATING_LIMIT = 15.0  # °C, no space heating above this 24 h mean outdoor temperature
DHW_SHARE = 0.2  # hot-water share of the annual demand
MORNING_PEAK, EVENING_PEAK, NIGHT_SETBACK, WEEKEND_FACTOR = 0.6, 0.5, 0.3, 1.05

Q_MIN = MIN_FLOW * Q_COND_DESIGN  # condenser heat below which the flow stays at its minimum

# The four columns of each HEX (dataset.json heat_source; t = t_in is the source temperature Heat distribution uses)
POINTS = {
    p: {"q": f"HEX_{k}_Q", "t": f"HEX_{k}_T_in", "t_in": f"HEX_{k}_T_in", "t_out": f"HEX_{k}_T_out", "m": f"HEX_{k}_m"}
    for p, k in (("hall", "Hall"), ("condenser", "Cond"))
}
# Q of each HEX is calculated from the other three (dataset.json "derived"; backend/core/derived.py, lib/sourceMap.ts)
DERIVED = {
    v["q"]: {"m": v["m"], "t_in": v["t_in"], "t_out": v["t_out"], "cp": cp}
    for v, cp in ((POINTS["hall"], CP_AIR), (POINTS["condenser"], CP_WATER))
}

# New variables and their causes, added to the causal graph at lag 1 (lags start at 1). Hour and Out_Hum join the
# graph as inputs. Heat_Demand's own past stands for the 24 h mean outdoor temperature (the buildings' memory).
# No Q: it is calculated. T_out carries the demand limit (T_out <- T_in, m and Heat_Demand through their causes).
_COND = ["Out_Temp", "Out_Hum", "ITE_Ener", "HVAC_Ener"]
LINKS = {
    "Hour": [],
    "Out_Hum": [],
    "Heat_Demand": ["Out_Temp", "Hour", "Heat_Demand"],
    "HEX_Hall_T_in": ["In_Temp"],
    "HEX_Hall_m": ["ITE_Ener"],
    "HEX_Hall_T_out": ["ITE_Ener", "In_Temp", "Heat_Demand"],
    "HEX_Cond_T_in": _COND,
    "HEX_Cond_m": ["ITE_Ener", "HVAC_Ener"],
    "HEX_Cond_T_out": [*_COND, "Heat_Demand"],
}
HEAT = ["Heat_Demand", *[c for p in POINTS.values() for c in (p["t_in"], p["t_out"], p["m"], p["q"])]]

DATASET = {
    "name": "Simulation 1 · with heat exchangers",
    "kind": "simulation",
    "actuators": ["Cool_Set", "IT_Load"],
    "heat": HEAT,
    "levers": ["Cool_Set"],
    "pid_image": None,
    "heat_source": POINTS,
    "derived": DERIVED,
    "kpi": {
        "it_power": "ITE_Ener",
        "cooling_power": "HVAC_Ener",
        "heat_demand": "Heat_Demand",
        "reuse": {p: v["q"] for p, v in POINTS.items()},
        "power_unit": "kW",
    },
}

# Physics equations: the formulas above, every term from hour t-1 like the data (no same-step term, so every input of
# the phys model has a lag >= 1, as the graph rules require). m and T_in are written out inside T_out, so the three
# equations of a HEX share their inputs; Q is calculated from them (no equation). dT, eps and the tower approach are learned,
# the rest is fixed. The plate limit is left out: the tower bypass keeps the water >= T_SINK + 2 K and the range
# <= 5.5 K, so eps_plate * (T_in - T_SINK) >= the range and the limit can never bind (nothing to learn).
_WB = (
    "(Out_Temp[t-1]*arctan(0.151977*sqrt(Out_Hum[t-1] + 8.313659)) + arctan(Out_Temp[t-1] + Out_Hum[t-1])"
    " - arctan(Out_Hum[t-1] - 1.676331) + 0.00391838*Out_Hum[t-1]**1.5*arctan(0.023101*Out_Hum[t-1]) - 4.686035)"
)
_HALL_TIN = "(In_Temp[t-1] + dT)"
_HALL_M = f"(ITE_Ener[t-1] / ({CP_AIR:g}*dT))"
_HALL_DT = f"minimum(eps*maximum(0, {_HALL_TIN} - {T_SINK:g}), Heat_Demand[t-1] / ({CP_AIR:g}*{_HALL_M}))"  # air ΔT
_QC = "(ITE_Ener[t-1] + HVAC_Ener[t-1])"
_COND_M = f"(maximum({_QC}, {Q_MIN:g}) / ({CP_WATER:g}*dT))"
_COND_TIN = f"(maximum({_WB} + approach, {T_CW_MIN:g}) + {_QC} / ({CP_WATER:g}*{_COND_M}))"
_COND_Q = f"minimum({_QC}, Heat_Demand[t-1])"
EQUATIONS = {
    "In_Temp": "a*In_Temp[t-1] + b*(Cool_Set[t-1] - In_Temp[t-1]) + c*ITE_Ener[t-1] + d",
    "HEX_Hall_T_in": _HALL_TIN[1:-1],
    "HEX_Hall_m": _HALL_M[1:-1],
    "HEX_Hall_T_out": f"{_HALL_TIN} - {_HALL_DT}",
    "HEX_Cond_m": _COND_M[1:-1],
    "HEX_Cond_T_in": _COND_TIN[1:-1],
    "HEX_Cond_T_out": f"{_COND_TIN} - {_COND_Q} / ({CP_WATER:g}*{_COND_M})",
}


def wet_bulb(t: np.ndarray, rh: np.ndarray) -> np.ndarray:
    """Wet-bulb temperature (°C) from dry bulb (°C) and relative humidity (%), Stull (2011), ±0.3 K at sea level."""
    return (
        t * np.arctan(0.151977 * np.sqrt(rh + 8.313659))
        + np.arctan(t + rh)
        - np.arctan(rh - 1.676331)
        + 0.00391838 * rh**1.5 * np.arctan(0.023101 * rh)
        - 4.686035
    )


def _gauss(h: np.ndarray, mu: np.ndarray | float, sd: float) -> np.ndarray:
    return np.exp(-0.5 * ((h - mu) / sd) ** 2)


def heat_demand(time: pd.Series, out_temp: pd.Series, mean_kw: float) -> np.ndarray:
    """demand.ts districtProfile at the hours of `time`, from the outdoor temperature of the 24 h before each hour,
    scaled to a mean of mean_kw over the file."""
    hour = time.dt.hour.to_numpy(float)
    weekend = (time.dt.dayofweek >= 5).to_numpy()
    t24 = out_temp.shift(1).rolling(24, min_periods=1).mean().bfill().to_numpy()
    night = np.where((hour >= 22) | (hour < 5), 1 - NIGHT_SETBACK, 1.0)
    curve = night + MORNING_PEAK * _gauss(hour, np.where(weekend, 8.5, 6.5), 1.3) + EVENING_PEAK * _gauss(hour, 19, 1.8)
    space = np.maximum(0, HEATING_LIMIT - t24) * curve * np.where(weekend, WEEKEND_FACTOR, 1.0)
    dhw = 0.25 + _gauss(hour, np.where(weekend, 9, 7), 1) + 0.8 * _gauss(hour, 20, 1.5)
    shape = (1 - DHW_SHARE) * space / (space.mean() or 1) + DHW_SHARE * dhw / dhw.mean()
    return mean_kw * shape


def add_hex(df: pd.DataFrame) -> pd.DataFrame:
    """sim_1 data plus Heat_Demand and the four columns of each HEX; each new value from the row one hour back."""
    out = df.copy()
    out["Heat_Demand"] = heat_demand(df["time"], df["Out_Temp"], DEMAND_SHARE * df["ITE_Ener"].mean())
    p = out.shift(1).bfill()  # one hour back; the first hour repeats the second
    demand = p["Heat_Demand"].to_numpy()
    ite = np.maximum(p["ITE_Ener"].to_numpy(), 1e-6)

    t_in = p["In_Temp"].to_numpy() + DT_SERVER
    m = ite / (CP_AIR * DT_SERVER)
    q = np.minimum(EPS_AIR * m * CP_AIR * np.maximum(0, t_in - T_SINK), demand)
    out["HEX_Hall_T_in"], out["HEX_Hall_T_out"], out["HEX_Hall_m"], out["HEX_Hall_Q"] = t_in, t_in - q / (m * CP_AIR), m, q

    q_cond = p["ITE_Ener"].to_numpy() + p["HVAC_Ener"].to_numpy()
    t_cw = np.maximum(wet_bulb(p["Out_Temp"].to_numpy(), p["Out_Hum"].to_numpy()) + TOWER_APPROACH, T_CW_MIN)
    m = np.maximum(q_cond, Q_MIN) / (CP_WATER * DT_COND_DESIGN)
    t_in = t_cw + q_cond / (m * CP_WATER)
    q = np.minimum(np.minimum(EPS_PLATE * m * CP_WATER * (t_in - T_SINK), q_cond), demand)
    out["HEX_Cond_T_in"], out["HEX_Cond_T_out"], out["HEX_Cond_m"], out["HEX_Cond_Q"] = t_in, t_in - q / (m * CP_WATER), m, q
    check(out, q_cond, t_cw)
    return out


def check(o: pd.DataFrame, q_cond: np.ndarray, t_cw: np.ndarray) -> None:
    """Energy balance, demand limit, the exchangers' own limits and plausible ranges."""
    demand = o["Heat_Demand"].shift(1).bfill()
    for k, cp, eps in (("Hall", CP_AIR, EPS_AIR), ("Cond", CP_WATER, EPS_PLATE)):
        t_in, t_out, m, q = (o[f"HEX_{k}_{v}"] for v in ("T_in", "T_out", "m", "Q"))
        assert np.allclose(q, m * cp * (t_in - t_out), atol=1e-6), f"{k}: Q = m cp (T_in - T_out)"
        assert (q >= 0).all() and (q <= demand + 1e-9).all(), f"{k}: 0 <= Q <= demand"
        assert (q <= eps * m * cp * (t_in - T_SINK) + 1e-9).all(), f"{k}: Q <= what the HEX can take"
        assert (t_out[q > 0] < t_in[q > 0]).all() and (t_out <= t_in + 1e-9).all(), f"{k}: T_out < T_in when Q > 0"
        assert (t_out > T_SINK).all(), f"{k}: hotter than the sink return"
        assert (m > 0).all(), f"{k}: flow"
    assert o["HEX_Hall_T_in"].between(27, 47).all(), "hall: return air 27-47 °C (Yuan et al. 2023)"
    assert o["HEX_Hall_m"].max() < 6, "hall: air flow of a < 70 kW hall"
    assert o["HEX_Cond_T_in"].between(T_CW_MIN, 50).all(), "condenser: 27-50 °C (Yuan et al. 2023: up to 40-50 °C)"
    assert (o["HEX_Cond_T_in"] - t_cw <= DT_COND_DESIGN + 1e-9).all(), "condenser: range <= design"
    assert (o["HEX_Cond_Q"] <= q_cond + 1e-9).all() and (o["HEX_Cond_T_out"] >= t_cw - 1e-9).all(), (
        "condenser: never more than its heat"
    )
    assert (o["Heat_Demand"] > 0).all(), "demand: hot water all year"


def main(data: Path = DATA) -> None:
    """Write data/sim_1_modified from data/sim_1."""
    src, dst = data / "sim_1", data / "sim_1_modified"
    dst.mkdir(exist_ok=True)
    df = add_hex(pd.read_parquet(src / "df_sim_1.parquet"))
    df.to_parquet(dst / "df_sim_1_modified.parquet", index=False)

    # The standard graph is the manual one (graph_manual.json of simulation_prepared), not the
    # discovered one; the new links are added to it.
    targets, strengths = read_graph(src / "causal_graph_manual.json")
    for target, parents in LINKS.items():
        targets[target] = [(p, -1) for p in parents]
    write_graph(dst / "causal_graph.json", targets, strengths)

    # The same graph with its lags discovered (variables and links stay; lags 1..5), once per method.
    # Same code as "Discover lags" on the Physical structure page.
    for method in ("pcmci", "pc"):
        new, no_evidence = relag_graph(targets, df, method, min_lag=1, max_lag=5)
        write_graph(dst / f"causal_graph_{method}.json", new)
        print(f"{method}: {sum(len(v) for v in new.values())} lagged links, no evidence for {no_evidence}")

    for name, obj in (("dataset.json", DATASET), ("equations.json", EQUATIONS)):
        (dst / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    # Same site (building, sinks, blocks, P&ID layout); keep an existing one untouched.
    if not (dst / "site.json").exists() and (src / "site.json").exists():
        shutil.copy(src / "site.json", dst / "site.json")
    print(f"wrote {dst}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else DATA)
