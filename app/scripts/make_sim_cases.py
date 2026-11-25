"""Create two example data centers from sim_1 on the same outdoor plant, only the inside different: a cooling tower,
a water-cooled chiller and a plate HEX for free cooling (waterside economiser); the chiller runs only when needed:

  sim_1_air    A1, air-cooled: the CRAH on chilled water (18/24 °C); extraction points hall (hot-aisle air) and
               condenser (the condenser water between chiller and tower)
  sim_1_water  W1, water-cooled: cold plates take LIQUID_SHARE of the IT heat on facility water, cooled by the tower
               through a plate HEX all year (free cooling); the rear doors take the rest on the same chilled water as
               A1's; extraction points liquid (the facility water) and condenser

Both keep sim_1's data and the heat demand of make_sim_1_modified.py (Heat_Demand). HVAC_Ener is replaced by the
plant's own electricity (chiller + AUX of the IT power for fans and pumps), so free cooling shows in it. Every value of
hour t is computed from hour t-1. Q of each HEX is calculated (dataset.json "derived"), never a model target.

The plant (both; `load`: the share of the IT heat on chilled water, 1 in A1, 1 - LIQUID_SHARE in W1)
  free cooling in series: the plate HEX pre-cools the chilled-water return, the chiller trims the rest
  T_tw     = T_wb(t-1) + TOWER_APPROACH                                   water from the tower      [CTI]
  FC_Share = clip((T_CHWR - PHE_APPROACH - T_tw) / (T_CHWR - T_CHWS), 0, 1)  share free-cooled  [Alfa Laval; ASHRAE 90.4]
  chiller  = (1 - FC_Share) * load * ITE_Ener(t-1), COP = min(COP_MAX, ETA_CARNOT * T_CHWS[K] / (T_cond - T_CHWS))
  HVAC_Ener = chiller / COP + AUX * ITE_Ener(t-1)
  condenser: Q_cond = chiller + chiller / COP (only while the chiller runs; the free-cooled heat goes through the plate
  HEX to the tower, not past the condenser HEX), then as make_sim_1_modified.py; A1's hall HEX as there
W1, the facility water on the tower through a plate HEX
  T_FWS    = clip(T_tw + PHE_APPROACH, T_FWS_MIN, T_FWS_MAX)    40 °C (W40), rising with the wet bulb up to W45
  Q_liq    = LIQUID_SHARE * ITE_Ener(t-1)
  HEX_Liq_m = max(Q_liq, MIN_FLOW * Q_LIQ_DESIGN) / (CP_WATER * DT_LIQ_DESIGN), T_in = T_FWS + Q_liq / (m CP_WATER)
  HEX_Liq_Q = min(EPS_PLATE m CP_WATER (T_in - T_SINK), Q_liq, Heat_Demand(t-1)), T_out = T_in - Q / (m CP_WATER)

Run from app/:  .venv/bin/python scripts/make_sim_cases.py [data dir]   (needs sim_1/ there)
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_sim_1_modified import (  # noqa: E402  the air-cooled dataset's constants, demand, wet bulb and hall HEX
    _HALL_M,
    _HALL_TIN,
    _WB,
    CP_AIR,
    CP_WATER,
    DATA,
    DEMAND_SHARE,
    DT_COND_DESIGN,
    DT_SERVER,
    EPS_AIR,
    EPS_PLATE,
    MIN_FLOW,
    Q_COND_DESIGN,
    Q_MIN,
    T_CW_MIN,
    T_SINK,
    TOWER_APPROACH,
    heat_demand,
    wet_bulb,
)

from backend.core.dataset_files import read_graph, write_graph  # noqa: E402

# Chilled water and free cooling (both cases)
T_CHWS, T_CHWR = 18.0, 24.0  # °C, chilled water supply / return (ASHRAE TC 9.9: warm chilled water for free cooling)
PHE_APPROACH = 2.0  # K, plate HEX between tower water and chilled water (1-3 K; Alfa Laval)
ETA_CARNOT = 0.5  # share of the Carnot COP a chiller reaches
COP_MAX = 8.0
AUX = 0.02  # fans and pumps, share of the IT power
# W1: liquid cooling on warm facility water
LIQUID_SHARE = 0.75  # share of the IT heat the cold plates take (70-80 %; ASHRAE TC 9.9 liquid cooling guidelines)
T_FWS_MIN, T_FWS_MAX = 40.0, 45.0  # °C, facility water to the CDUs (ASHRAE W40, at most W45)
DT_LIQ_DESIGN = 10.0  # K, facility water range at full load
Q_LIQ_DESIGN = 50.0  # kW, design facility water load (LIQUID_SHARE of sim_1's peak ITE_Ener, 62.7 kW)
QL_MIN = MIN_FLOW * Q_LIQ_DESIGN
QC_MIN_W = MIN_FLOW * (1 - LIQUID_SHARE) * Q_COND_DESIGN  # W1's condenser carries the air's share only


def cop(t_cond: np.ndarray | float) -> np.ndarray:
    """A chiller's COP making T_CHWS chilled water and condensing at t_cond (°C)."""
    return np.minimum(COP_MAX, ETA_CARNOT * (T_CHWS + 273.15) / np.maximum(np.asarray(t_cond) - T_CHWS, 5.0))


def fc_share(t_wb: np.ndarray) -> np.ndarray:
    """Share of the chilled-water load the tower takes through the plate HEX (0: chiller only, 1: free cooling)."""
    return np.clip((T_CHWR - PHE_APPROACH - (t_wb + TOWER_APPROACH)) / (T_CHWR - T_CHWS), 0.0, 1.0)


def _points(*pairs: tuple[str, str]) -> dict:
    return {
        p: {"q": f"HEX_{k}_Q", "t": f"HEX_{k}_T_in", "t_in": f"HEX_{k}_T_in", "t_out": f"HEX_{k}_T_out", "m": f"HEX_{k}_m"}
        for p, k in pairs
    }


def _plate(t_in: np.ndarray, m: np.ndarray, heat: np.ndarray, demand: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """What a plate HEX on hot water recovers (at most its heat, the demand and what the plate can take) and the hot
    water's outlet temperature."""
    q = np.minimum(np.minimum(EPS_PLATE * m * CP_WATER * np.maximum(0, t_in - T_SINK), heat), demand)
    return q, t_in - q / (m * CP_WATER)


def _base(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, np.ndarray, np.ndarray]:
    out = df.copy()
    out["Heat_Demand"] = heat_demand(df["time"], df["Out_Temp"], DEMAND_SHARE * df["ITE_Ener"].mean())
    p = out.shift(1).bfill()  # one hour back; the first hour repeats the second
    return out, p, p["Heat_Demand"].to_numpy(), np.maximum(p["ITE_Ener"].to_numpy(), 1e-6)


def _plant(out: pd.DataFrame, t_wb: np.ndarray, ite: np.ndarray, demand: np.ndarray, load: float, q_min: float) -> np.ndarray:
    """The outdoor plant of both cases: the free-cooled share of the chilled water, the plant's electricity and the
    condenser HEX (only the chiller's heat passes it); `load` is the share of the IT heat on chilled water. Returns
    the condenser's heat."""
    s = fc_share(t_wb)
    t_cw = np.maximum(t_wb + TOWER_APPROACH, T_CW_MIN)  # tower bypass: never below T_CW_MIN at the chiller
    k = cop(t_cw + DT_COND_DESIGN + 2.0)
    chiller = (1 - s) * load * ite
    out["FC_Share"] = s
    out["HVAC_Ener"] = chiller / k + AUX * ite
    q_cond = chiller * (1 + 1 / k)
    m = np.maximum(q_cond, q_min) / (CP_WATER * DT_COND_DESIGN)
    t_in = t_cw + q_cond / (m * CP_WATER)
    q, t_out = _plate(t_in, m, q_cond, demand)
    out["HEX_Cond_T_in"], out["HEX_Cond_T_out"], out["HEX_Cond_m"], out["HEX_Cond_Q"] = t_in, t_out, m, q
    return q_cond


def add_air(df: pd.DataFrame) -> pd.DataFrame:
    """A1: the plant, and the hall HEX in the CRAH's return air."""
    out, p, demand, ite = _base(df)
    t_wb = wet_bulb(p["Out_Temp"].to_numpy(), p["Out_Hum"].to_numpy())
    q_cond = _plant(out, t_wb, ite, demand, 1.0, Q_MIN)
    t_in = p["In_Temp"].to_numpy() + DT_SERVER
    m = ite / (CP_AIR * DT_SERVER)
    q = np.minimum(EPS_AIR * m * CP_AIR * np.maximum(0, t_in - T_SINK), demand)
    out["HEX_Hall_T_in"], out["HEX_Hall_T_out"], out["HEX_Hall_m"], out["HEX_Hall_Q"] = t_in, t_in - q / (m * CP_AIR), m, q
    _check(out, {"Hall": (CP_AIR, None), "Cond": (CP_WATER, q_cond)})
    return out


def add_water(df: pd.DataFrame) -> pd.DataFrame:
    """W1: the plant for the rear doors' share, and the liquid cooling HEX on the facility water."""
    out, p, demand, ite = _base(df)
    t_wb = wet_bulb(p["Out_Temp"].to_numpy(), p["Out_Hum"].to_numpy())
    q_cond = _plant(out, t_wb, ite, demand, 1 - LIQUID_SHARE, QC_MIN_W)
    t_fws = np.clip(t_wb + TOWER_APPROACH + PHE_APPROACH, T_FWS_MIN, T_FWS_MAX)
    q_liq = LIQUID_SHARE * ite
    m = np.maximum(q_liq, QL_MIN) / (CP_WATER * DT_LIQ_DESIGN)
    t_in = t_fws + q_liq / (m * CP_WATER)
    q, t_out = _plate(t_in, m, q_liq, demand)
    out["HEX_Liq_T_in"], out["HEX_Liq_T_out"], out["HEX_Liq_m"], out["HEX_Liq_Q"] = t_in, t_out, m, q
    _check(out, {"Liq": (CP_WATER, q_liq), "Cond": (CP_WATER, q_cond)})
    assert out["HEX_Liq_T_in"].between(T_FWS_MIN, T_FWS_MAX + DT_LIQ_DESIGN + 1).all(), "liquid: 40-56 °C (W40, W45 on hot days)"
    assert (out["HEX_Liq_T_in"] > out["HEX_Cond_T_in"]).mean() > 0.9, "the facility water is the hot one"
    return out


def _check(o: pd.DataFrame, hexes: dict[str, tuple[float, np.ndarray | None]]) -> None:
    """Energy balance, demand limit, the exchangers' heat and plausible temperatures."""
    demand = o["Heat_Demand"].shift(1).bfill()
    for k, (cp, heat) in hexes.items():
        t_in, t_out, m, q = (o[f"HEX_{k}_{v}"] for v in ("T_in", "T_out", "m", "Q"))
        assert np.allclose(q, m * cp * (t_in - t_out), atol=1e-6), f"{k}: Q = m cp (T_in - T_out)"
        assert (q >= 0).all() and (q <= demand + 1e-9).all(), f"{k}: 0 <= Q <= demand"
        assert heat is None or (q <= heat + 1e-9).all(), f"{k}: Q <= its heat"
        assert (t_out <= t_in + 1e-9).all() and (m > 0).all(), f"{k}: T_out <= T_in, flow"
    assert (o["HVAC_Ener"] > 0).all() and (o["Heat_Demand"] > 0).all() and o["FC_Share"].between(0, 1).all()


# The new variables and their causes (lag 1); Q is calculated, no node. Hour and Out_Hum join as inputs.
_DEMAND = {"Hour": [], "Out_Hum": [], "Heat_Demand": ["Out_Temp", "Hour", "Heat_Demand"]}
_W = ["Out_Temp", "Out_Hum"]
LINKS = {
    "sim_1_air": {
        **_DEMAND,
        "FC_Share": _W,
        "HVAC_Ener": [*_W, "ITE_Ener"],
        "HEX_Hall_T_in": ["In_Temp"],
        "HEX_Hall_m": ["ITE_Ener"],
        "HEX_Hall_T_out": ["ITE_Ener", "In_Temp", "Heat_Demand"],
        "HEX_Cond_T_in": [*_W, "ITE_Ener"],
        "HEX_Cond_m": [*_W, "ITE_Ener"],
        "HEX_Cond_T_out": [*_W, "ITE_Ener", "Heat_Demand"],
    },
    "sim_1_water": {
        **_DEMAND,
        "FC_Share": _W,
        "HVAC_Ener": [*_W, "ITE_Ener"],
        "HEX_Liq_T_in": [*_W, "ITE_Ener"],
        "HEX_Liq_m": ["ITE_Ener"],
        "HEX_Liq_T_out": [*_W, "ITE_Ener", "Heat_Demand"],
        "HEX_Cond_T_in": [*_W, "ITE_Ener"],
        "HEX_Cond_m": [*_W, "ITE_Ener"],
        "HEX_Cond_T_out": [*_W, "ITE_Ener", "Heat_Demand"],
    },
}
POINTS = {
    "sim_1_air": _points(("hall", "Hall"), ("condenser", "Cond")),
    "sim_1_water": _points(("liquid", "Liq"), ("condenser", "Cond")),
}
CP = {"Hall": CP_AIR, "Cond": CP_WATER, "Liq": CP_WATER}
PLANT = {
    "sim_1_air": {"cooling": "air", "heat_rejection": "cooling_tower", "free_cooling": "plate_hex", "chiller": "trim"},
    "sim_1_water": {"cooling": "liquid", "heat_rejection": "cooling_tower", "free_cooling": "plate_hex", "chiller": "trim"},
}
NAMES = {"sim_1_air": "Simulation 1 · air cooled, free cooling", "sim_1_water": "Simulation 1 · water cooled"}


def dataset_json(dc: str) -> dict:
    points = POINTS[dc]
    heat = [
        "Heat_Demand",
        "FC_Share",
        *[c for p in points.values() for c in (p["t_in"], p["t_out"], p["m"], p["q"])],
    ]
    return {
        "name": NAMES[dc],
        "kind": "simulation",
        "actuators": ["Cool_Set", "IT_Load"],
        "heat": heat,
        "levers": ["Cool_Set"],
        "pid_image": None,
        "plant": PLANT[dc],
        "heat_source": points,
        "derived": {
            v["q"]: {"m": v["m"], "t_in": v["t_in"], "t_out": v["t_out"], "cp": CP[v["q"].split("_")[1]]} for v in points.values()
        },
        "kpi": {
            "it_power": "ITE_Ener",
            "cooling_power": "HVAC_Ener",
            "heat_demand": "Heat_Demand",
            "reuse": {p: v["q"] for p, v in points.items()},
            "power_unit": "kW",
        },
    }


# Physics equations (every term from hour t-1, so every input has a lag >= 1): the formulas above, with some
# constants learned (a: the tower approach, c, d and e: the plant's electricity, tf and g: the facility water).
_S = f"minimum(1, maximum(0, ({T_CHWR - PHE_APPROACH:g} - {_WB} - a) / {T_CHWR - T_CHWS:g}))"


def _condenser(load: str, q_min: float) -> tuple[str, str, str]:
    """The condenser HEX's heat, flow and inlet of a plant with `load` (a factor of ITE_Ener, "" for 1) on chilled water."""
    qc = f"((1 - {_S})*{load}ITE_Ener[t-1]*(1 + e))"
    cm = f"(maximum({qc}, {q_min:g}) / ({CP_WATER:g}*dT))"
    return qc, cm, f"(maximum({_WB} + a, {T_CW_MIN:g}) + {qc} / ({CP_WATER:g}*{cm}))"


_QC, _CM, _CTIN = _condenser("", Q_MIN)
_QCW, _CMW, _CTINW = _condenser(f"{1 - LIQUID_SHARE:g}*", QC_MIN_W)
_QL = f"({LIQUID_SHARE:g}*ITE_Ener[t-1])"
_LM = f"(maximum({_QL}, {QL_MIN:g}) / ({CP_WATER:g}*dT))"
_LTIN = f"(minimum({T_FWS_MAX:g}, maximum(tf, {_WB} + g)) + {_QL} / ({CP_WATER:g}*{_LM}))"
# the outlet's flow and heat terms are not identifiable from it alone (its fit wanders off): there they are the
# numbers the T_in and m equations learn back (1/COP 0.14, the design ranges), and only the temperatures (a; tf, g)
# are learned
_FIX = {"(1 + e)": "(1 + 0.14)", f"{CP_WATER:g}*dT": f"{CP_WATER:g}*{{dT}}"}


def _fixed(expr: str, dt: float) -> str:
    for a, b in _FIX.items():
        expr = expr.replace(a, b)
    return expr.replace("{dT}", f"{dt:g}")


_HALL_DT = f"minimum(eps*maximum(0, {_HALL_TIN} - {T_SINK:g}), Heat_Demand[t-1] / ({CP_AIR:g}*{_HALL_M}))"
EQUATIONS = {
    "sim_1_air": {
        "In_Temp": "a*In_Temp[t-1] + b*(Cool_Set[t-1] - In_Temp[t-1]) + c*ITE_Ener[t-1] + d",
        "FC_Share": _S,
        "HVAC_Ener": f"c*(1 - {_S})*ITE_Ener[t-1] + d*ITE_Ener[t-1]",
        "HEX_Hall_T_in": _HALL_TIN[1:-1],
        "HEX_Hall_m": _HALL_M[1:-1],
        "HEX_Hall_T_out": f"{_HALL_TIN} - {_HALL_DT}",
        "HEX_Cond_m": _CM[1:-1],
        "HEX_Cond_T_in": _CTIN[1:-1],
        "HEX_Cond_T_out": _fixed(f"{_CTIN} - minimum({_QC}, Heat_Demand[t-1]) / ({CP_WATER:g}*{_CM})", DT_COND_DESIGN),
    },
    "sim_1_water": {
        "In_Temp": "a*In_Temp[t-1] + b*(Cool_Set[t-1] - In_Temp[t-1]) + c*ITE_Ener[t-1] + d",
        "FC_Share": _S,
        "HVAC_Ener": f"c*(1 - {_S})*ITE_Ener[t-1] + d*ITE_Ener[t-1]",
        "HEX_Cond_m": _CMW[1:-1],
        "HEX_Cond_T_in": _CTINW[1:-1],
        "HEX_Cond_T_out": _fixed(f"{_CTINW} - minimum({_QCW}, Heat_Demand[t-1]) / ({CP_WATER:g}*{_CMW})", DT_COND_DESIGN),
        "HEX_Liq_m": _LM[1:-1],
        "HEX_Liq_T_in": _LTIN[1:-1],
        "HEX_Liq_T_out": _fixed(f"{_LTIN} - minimum({_QL}, Heat_Demand[t-1]) / ({CP_WATER:g}*{_LM})", DT_LIQ_DESIGN),
    },
}
MAKE = {"sim_1_air": add_air, "sim_1_water": add_water}
# the heat distribution's plant models (component presets, core/component_library.py): its Model in Heat Matching,
# sized for some 20-40 kW of waste heat and a district of some 400 kW
HEAT_COMPONENTS = {"hex": "hex_approach", "hp": "hp_0_5mw", "tank": "storage_tank"}


def main(data: Path = DATA) -> None:
    """Write data/sim_1_air and data/sim_1_water from data/sim_1 (models and site.json are kept)."""
    src = data / "sim_1"
    raw = pd.read_parquet(src / "df_sim_1.parquet")
    for dc, make in MAKE.items():
        dst = data / dc
        dst.mkdir(exist_ok=True)
        df = make(raw)
        # over sim_1's year: hours of free cooling only and hours of chiller only
        assert "FC_Share" not in df or ((df["FC_Share"] == 1).any() and (df["FC_Share"] == 0).any()), "free cooling modes"
        df.to_parquet(dst / f"df_{dc}.parquet", index=False)
        targets, strengths = read_graph(src / "causal_graph_manual.json")
        targets.pop("HVAC_Ener", None)  # the plant's electricity has its own causes here
        for target, parents in LINKS[dc].items():
            targets[target] = [(p, -1) for p in parents]
        write_graph(dst / "causal_graph.json", targets, strengths)
        for name, obj in (("dataset.json", dataset_json(dc)), ("equations.json", EQUATIONS[dc])):
            (dst / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
        if not (dst / "site.json").exists() and (src / "site.json").exists():
            site = json.loads((src / "site.json").read_text())
            hex_option = "liquid" if dc == "sim_1_water" else "condenser"
            site = {**site, "hex_option": hex_option, "heat_components": HEAT_COMPONENTS}
            (dst / "site.json").write_text(json.dumps(site, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {dst}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else DATA)
