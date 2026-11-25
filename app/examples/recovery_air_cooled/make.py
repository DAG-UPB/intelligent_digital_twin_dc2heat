"""Create data/sim_recovery_air, "Recovery · air cooled": an air-cooled 5 MW data center in Frankfurt whose hall heat
goes to a district loop, with an energy balance that closes every hour and a PUE of a real facility (IT, cooling,
electrical losses and the building: ~1.21), and the district's heat demand beside it (about 80 % of which the data center's
heat covers through the heat pump, hour by hour: a winter of more demand than heat, a summer with heat to spare).
Its hours are UTC; the customers' day lives by Frankfurt's clock (summer time too).

The plant (one loop, warm side first):

  IT -> hall air (CRAH, hot-aisle containment) -> chilled water return -> RECOVERY HEX -> free-cooling plate HEX
     -> chiller (trim) -> chilled water supply 18 °C; the free-cooled and the chiller's heat go to a cooling tower

The recovery HEX is a water-to-water plate HEX on the chilled-water return, ahead of the free cooling and the chiller.
Its cold side is the cold pipe of a low-temperature (5th generation) district loop whose building heat pumps lift the
heat. It takes the hall's heat up to the loop's capacity Q_LOOP and as far as the loop's cold pipe lets it. That pipe
runs through the ground (about 8 °C in late winter, 18 °C in late summer without the data center, lagging the weather
by weeks) and warms when it gets more heat than the buildings' heat pumps take out of it, cools when they take more:
in winter they take all the data center gives (the pipe stays at 6-8 °C), in summer they need about 0.5 MW of the
data center's ~3.7, the pipe warms to ~20 °C, the HEX can no longer bring the water down to 18 °C and the free cooling
and the chiller take the rest (about a third of the hall's heat). The loop and the ground take the summer's surplus
(no seasonal storage is modelled): HEX_Hall_Q is the heat the data center gives the loop:
its water comes back from the heat distribution at Loop_T_cold and goes to it at Loop_T_warm (the HEX's cold side, its
pump at a constant flow M_LOOP); what the district uses of it, hour by hour, through its heat pump and storage, is
Heat Matching's.

The other extraction point, an alternative design on the same hours (the Structure page's and Heat Matching's
switch, both what-ifs): a condenser HEX on the chiller's condenser water, the recovery there instead of in the hall.
The chiller takes all the hall's heat (the tower bypassed, its water held at >= T_CW_MIN), so the HEX gets that heat
plus the chiller's work, warmer (~33 °C), up to the loop's capacity: HEX_Cond_T_in = max(T_wb + TOWER_APPROACH,
T_CW_MIN) + Q_cond / (m cp), HEX_Cond_m holds the design range DT_COND_DESIGN (down to MIN_FLOW), HEX_Cond_Q =
min(Q_LOOP, Q_cond, EPS_PLATE m cp (T_in - Loop_T_cold)), and the loop's water on to the heat distribution
Loop_T_warm_Cond = Loop_T_cold(t-1) + HEX_Cond_Q / (M_LOOP cp) (the loop's cold pipe is the hall design's: its
warming by the other design's heat is left out). The plant's electricity and the balance below are the hall design's
(the chiller's extra work in the condenser design is not in HVAC_Ener).

Every value of hour t is computed from hour t-1 (lags start at 1). Electricity in, heat out, every hour:

  ITE_Ener      = (P_IDLE + (P_PEAK - P_IDLE) * IT_Load(t-1))         linear server power curve; the server fans speed
                  * (1 + FAN_PER_K * max(0, In_Temp(t-1) - FAN_FROM))  up above a 24 °C inlet (+0.6 %/K)
  fans          = CRAH_FAN * P_PEAK * max(X_MIN, ITE/P_PEAK)^FAN_EXP  CRAH EC fans (their heat is in the hall's)
  Q_hall        = ITE_Ener + fans
  HEX_Hall_T_in = In_Temp(t-1) + DT_SERVER - CRAH_APPROACH           chilled-water return (hot side of the HEX)
  HEX_Hall_m    = Q_hall / (CP_WATER * (HEX_Hall_T_in - T_CHWS))     coil valves: the flow follows the load
  HEX_Hall_Q    = min(Q_LOOP, Q_hall, EPS_PLATE * m * CP_WATER * (T_in - Loop_T_cold(t-1)))   recovered
  HEX_Hall_T_out = T_in - Q / (m * CP_WATER)                         >= T_CHWS: never more than the hall's heat
  Loop_T_warm   = Loop_T_cold(t-1) + Q / (M_LOOP * CP_WATER)          the loop's water on to the heat distribution
  rest          = Q_hall - HEX_Hall_Q                                left for the plant
  s             = clip((T_out - PHE_APPROACH - T_tw) / max(T_out - T_CHWS, 0.01), 0, 1), T_tw = T_wb(t-1) + TOWER_APPROACH:
                  the free-cooling plate HEX's share of what the recovery leaves (free_cooling(); not a column)
  W_chiller     = (1 - s) * rest / COP(T_tw + DT_COND_DESIGN + 2 K)
  W_tower       = TOWER_KW * (rest + W_chiller)                      tower fans and condenser pump
  pumps         = CHW_PUMP * P_PEAK * (m / M_DESIGN)^2               chilled-water pumps (variable speed)
  Elec_Loss_Ener = 2 * UPS_KW * (UPS_A0 + UPS_A1 y + UPS_A2 y^2) + DIST_LOSS * ITE,  y = ITE / (2 UPS_KW)
                  2N double-conversion UPS (each half loaded) and transformers, PDUs, busbars
  W_elec        = Elec_Loss_Ener / COP_ELEC(Out_Temp(t-1))            the electrical rooms' DX / economiser units
  Building_Ener = BLD_BASE + BLD_LIGHT * day(Hour(t-1)) + BLD_HEAT * max(0, 15 - Out_Temp(t-1))
                  + BLD_COOL * max(0, Out_Temp(t-1) - 22)             offices, security, lighting, generator heaters
  HVAC_Ener     = fans + pumps + W_chiller + W_tower + W_elec
  Heat_rejected = rest + W_chiller + W_tower + pumps + Elec_Loss_Ener + W_elec + Building_Ener   to the outdoor air

  => ITE_Ener + HVAC_Ener + Elec_Loss_Ener + Building_Ener = HEX_Hall_Q + Heat_rejected, exactly (check()), and
     HEX_Hall_Q = m cp (T_in - T_out) exactly (dataset.json "derived": Q is calculated from its parts, never a model
     target). PUE = (ITE + HVAC + Elec_Loss + Building) / ITE (dataset.json kpi "other_power": the Dashboard's full
     PUE): about 1.21 over the year, 1.20 in winter, 1.23 in summer (cooling ~7.7 %, electrical losses ~9.5 %, the
     building ~3.5 % of the IT power); IT and cooling alone (the partial PUE) 1.08.

  Hour          the hour of the day on Frankfurt's clock (summer time too; the time stamps are UTC): the customers' day

The room and the inputs:

  weather       Frankfurt am Main at the data center (50.109 N, 8.703 E), hourly, ERA5 reanalysis from the
                Open-Meteo historical weather API (archive-api.open-meteo.com, CC BY 4.0; Hersbach et al. 2020, ERA5,
                doi:10.24381/cds.adbb2d47): Out_Temp (°C, 2 m), Out_Hum (%, 2 m), in weather_frankfurt.csv.gz (UTC;
                its wind and sun are left out: nothing in the plant follows them); on data/sim_1's hours
  Loop_T_cold   the loop's cold pipe at the HEX, measured: 6.5 + 0.55 * the outdoor temperature smoothed over ~30 days
                (the ground) + LOOP_K * the loop's surplus (what the HEX gives minus what the buildings' heat pumps
                take, (1 - 1/COP_BUILDINGS) * Heat_Demand) smoothed over ~10 days, + AR(1) noise, 6..26 °C (above
                freezing, with a margin, for the heat pumps); an input of the data center
  IT_Load       0..1 (it_load()): moves 30 % of the way each hour toward the day's target of the hour before (Hour,
                Is_Weekend: Frankfurt's clock): the hall's level (0.12-0.82, each held for one to four weeks, all in
                turn: customers moving in and out, the HPC cluster's campaigns; ~0.54 on average), a little higher in
                business hours, lower at weekends, growing by 0.06 over the two years, plus noise (seeded): ~0.1-1 in
                the data, so the twin has seen the loads a scenario asks about; the twin takes the measured one
  Cool_Set      the supply-air setpoint, 22..27 °C (22-26 in the data; ASHRAE recommended 18-27), held for one to four weeks, then
                changed by the operator (seeded)
  In_Temp(t)    = In_Temp + ROOM_B * (Cool_Set - In_Temp) + ROOM_C * ITE_Ener + ROOM_D (all t-1) + noise
  Heat_Demand   the district's heat, an input (replace it by a district's measured demand: make(base, demand=...)); of
                the data center's columns only the loop's cold pipe follows it, which the twin takes as measured. The
                demand of examples/district_heat_demand/make.py (space
                heating on the 72 h mean outdoor temperature with a soft heating limit, so spring and autumn fade, the
                residential day curve, hot water all year, a few % noise), sized so the data center covers ~75 % of it,
                on this data center's weather and with its own noise

Constants (literature ranges; the shared ones come from scripts/make_sim_1_modified.py and make_sim_cases.py):
  P_IDLE / P_PEAK   2 / 5 MW: idle 40 % of peak (30-60 %; Fan, Weber & Barroso 2007, ISCA; Barroso, Hölzle &
                        Ranganathan 2018, The Datacenter as a Computer); a ~3.6 MW mean IT load (72 % of the design),
                    so the heat it gives (all its electricity) is about 38,000 MWh a year, ~28,000 MWh recovered
  FAN_PER_K, FAN_FROM  0.6 % more IT power per K of inlet air above 24 °C: server fans (ASHRAE TC 9.9 2011 Thermal
                    Guidelines, Fig. "server power vs inlet temperature": +2-4 % from 25 to 30 °C)
  CRAH_FAN, FAN_EXP, X_MIN  EC fans 6 % of the design heat at full airflow (3-8 %), ~flow^2.3 with a pressure
                    setpoint and N+1 units' minimum speeds, never below 30 % flow
  CHW_PUMP          1.2 % of the design heat at design flow, ~flow^2: ~40 m of head at a 12 K rise (chilled-water
                    loops 25-45 m; the 1.5-3 % often quoted is for 5-7 K rises)
  UPS_A0/A1/A2      no-load 1.5 % of the rating, 2 % and 1 % (load and load² terms): ~93.5 % at the 2N systems'
                    usual ~36 % load: a 2N system of the 2010s (double conversion: 93-96 %; Rasmussen, APC/Schneider
                    White Paper 108)
  DIST_LOSS         3 % of the IT power: MV/LV transformers, PDUs, busbars, cables (1-3 %; White Paper 113)
  COP_ELEC          12 at 0 °C (economiser), 7 at 20 °C, 3 at 36 °C: DX units for the UPS and switchgear rooms
  BLD_*             100 kW base (offices and control room, security, BMS, generator jacket heaters), 30 kW lighting
                    by day, 2.5 kW/K below 15 °C (heating), 1.5 kW/K above 22 °C (the offices' cooling)
  Q_LOOP            4.3 MW, the district loop's capacity at the data center
  DT_LOOP, M_LOOP   6 K, the loop's rise across the recovery HEX at that capacity: its pump's constant flow (~173 kg/s,
                    above the hall water's at most ~100 kg/s: the hall side is the HEX's smaller one, EPS_PLATE's)
  DT_SERVER         12 K air rise across the servers (10-15 K; ASHRAE TC 9.9, Upsite)
  CRAH_APPROACH     6 K, hot-aisle air minus the water leaving the CRAH coil (3-8 K for deep counter-flow coils)
  T_CHWS            18 °C warm chilled water (16-20 °C for free cooling; ASHRAE TC 9.9)
  Loop_T_cold       6-21 °C: the cold pipe of a 5GDHC / anergy loop (8-15 °C, warmer in summer; such loops run 0-30
                    °C: Buffa et al. 2019, Renew. Sustain. Energy Rev. 104); the ground's 0.55 of the outdoor swing
                    with a ~4-week lag (soil at ~1.5 m: Kusuda & Achenbach 1965); LOOP_K 1.6 K per MW of surplus
  COP_BUILDINGS     4: the buildings' heat pumps on the loop (5GDHC substations, ~3.5-5)
  EPS_PLATE         0.8, plate HEX effectiveness (approach 1-3 K; Deppmann 2023)
  PHE_APPROACH, TOWER_APPROACH   2 K (1-3 K; Alfa Laval), 4 K above wet bulb (CTI 95/85/78 °F: 3.9 K)
  COP               0.5 of Carnot at T_CHWS, at most 8 (centrifugal chillers on warm chilled water: 6-9)
  DT_COND_DESIGN    5.5 K condenser range (AHRI 550/590), + 2 K condensing approach
  TOWER_KW          0.035 kW per kW rejected: tower fans 0.01-0.02 + condenser pump 0.015-0.03 (plant kW/ton
                    breakdowns, Taylor 2011-12, ASHRAE J. "Optimizing design & control of chilled water plants")
  ROOM_B/C/D        0.35 per h toward the setpoint, 0.00024 K/kW (0.8 K at the mean IT power): a first-order hall
                    with a ~3 h time constant
  demand            UA 520 kW/K on the 72 h mean with a 2 K soft heating limit at 16 °C (German practice: 15 °C,
                    VDI 4710 / VDI 3807 G20/15), a day curve of thousands of dwellings (morning +25 %, evening +20 %,
                    a 15 % night setback: peak/mean ~1.28 a winter day), hot water 400 kW mean (~10 % of the heat;
                    district_heat_demand/make.py's shape): ~30,000 MWh/a on Frankfurt's weather, a town district of
                    some 2,500-3,000 dwellings; against the data center's heat lifted by the heat pump (COP ~4.3 to
                    70 °C: ~4.8 MW) January asks ~1.5 times it, summer ~0.65 MW (hot water, a little heating): ~75 %
                    covered hour by hour, the rest in winter

Also writes dataset.json (frame: the new form), site.json (what the app saved there since stays, the
hall HEX's spots left to the drawing's defaults, the map bubble's kW follows the heat), causal_graph_drawn.json (the
links and their lags, LINKS), causal_graph.json (those refined by causal discovery: DISCOVERY) and equations.json,
then trains the linear, the physics and the XGBoost model ("linear",
"phys", "xgb"), and the ones Modelling compares them with ("linear_all", "xgb_all", "sym"), on the first year with
the app's own training route in-process, and prints their free run over the held-out second year, stored as the
evaluation Modelling shows when it opens (models/evaluation.json); Heat Matching can run any of them. The district's
structure (silver/district_structure) gets its prepared inputs (the 24 h and 72 h mean outdoor temperature, beside the
data's weekend, as Chronos-2 sees them: core/foundation.py), its graph, equations and the same six models too; Heat Matching
runs its XGBoost one.

Run from app/:  bash scripts/guard.sh .venv/bin/python examples/recovery_air_cooled/make.py [data dir] [--no-train]
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

APP = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(APP), str(APP / "scripts")]
from make_sim_1_modified import (  # noqa: E402
    _WB,
    CP_WATER,
    DATA,
    DT_SERVER,
    EPS_PLATE,
    MIN_FLOW,
    T_CW_MIN,
    _gauss,
    wet_bulb,
)
from make_sim_cases import (  # noqa: E402
    COP_MAX,
    DT_COND_DESIGN,
    ETA_CARNOT,
    HEAT_COMPONENTS,
    PHE_APPROACH,
    PLANT,
    T_CHWS,
    TOWER_APPROACH,
    _points,
    cop,
)

from backend.core.dataset_files import write_graph  # noqa: E402
from examples.district_heat_demand.make import heat_demand  # noqa: E402

ID = "sim_recovery_air"
SOURCE = "sim_1"  # its hours (the district example's too, so the two line up), not its weather
WEATHER_FILE = Path(__file__).with_name("weather_frankfurt.csv.gz")
SCALE = 5000 / 750  # a 5 MW data center: the plant and the district of the 750 kW one this example started as, scaled
P_IDLE, P_PEAK = 300.0 * SCALE, 750.0 * SCALE
FAN_PER_K, FAN_FROM = 0.006, 24.0
CRAH_FAN, FAN_EXP, X_MIN = 0.06, 2.3, 0.3
CHW_PUMP = 0.012
UPS_KW, UPS_A0, UPS_A1, UPS_A2 = P_PEAK, 0.015, 0.02, 0.01  # each of the 2N systems rated for the whole IT peak
DIST_LOSS = 0.03
BLD_BASE, BLD_LIGHT, BLD_HEAT, BLD_COOL = 100.0, 30.0, 2.5, 1.5
CRAH_APPROACH = 6.0
TOWER_KW = 0.035
Q_LOOP = 650.0 * SCALE  # kW
LOOP_BASE, LOOP_GAIN, LOOP_DAYS, LOOP_MIN, LOOP_MAX = 6.5, 0.55, 30.0, 6.0, 26.0
DT_LOOP = 6.0  # K, the loop's rise across the recovery HEX at Q_LOOP
LOOP_K, LOOP_IMB_DAYS, LOOP_NOISE = 1.6, 10.0, 0.05  # K per MW of the loop's surplus over ~10 days; AR(1) noise
COP_BUILDINGS = 4.0  # the buildings' heat pumps: they take (1 - 1/COP) of their heat from the loop
TZ = "Europe/Berlin"  # the time stamps are UTC; the customers' day lives by Frankfurt's clock
M_LOOP = Q_LOOP / (CP_WATER * DT_LOOP)  # kg/s, the loop pump's constant flow through the HEX's cold side
M_DESIGN = P_PEAK * (1 + CRAH_FAN) / (CP_WATER * 12.0)  # kg/s at the design heat and a 12 K water rise
# the district's demand, ~75 % of it covered: a German heating limit, a day curve of thousands of dwellings
DEMAND = {"ua": 520.0, "dhw_kw": 400.0, "window": 72, "soft": 2.0, "limit": 16.0, "peaks": (0.25, 0.2, 0.15)}
ROOM_B, ROOM_C, ROOM_D, ROOM_NOISE = 0.35, 0.02 * 60 / P_PEAK, -0.8, 0.05  # the hall of sim_1's 60 kW, scaled
SETPOINTS = (22.0, 23.0, 24.0, 25.0, 26.0, 27.0)
SETPOINT_ODDS = (0.08, 0.17, 0.3, 0.25, 0.13, 0.07)  # mostly 24-25 °C
DEMAND_SEED = 7  # its own noise: not the district dataset's
WEATHER = ["Out_Temp", "Out_Hum"]  # what the plant follows (the wind and the sun move nothing in it: left out)
IT_K, IT_NOISE = 0.3, 0.02  # the IT load moves 30 % of the way to the day's target each hour (~3 h), and its noise
# the hall's level, each held for one to four weeks, all in turn (customers moving in and out, the HPC cluster's
# campaigns): 0.47 on average, and the data see the IT load from ~0.1 to ~1, so a trained twin answers a scenario
# anywhere in that range (a tree model, xgb, is flat outside the loads it was trained on)
IT_LEVELS = (0.12, 0.22, 0.32, 0.42, 0.52, 0.62, 0.72, 0.82)

# the two extraction points, the hall's recovery HEX and the condenser HEX (the other design); what the heat
# distribution gets is the loop's water on the HEX's cold side, warm to it and cold back (t, t_return), each design its
# own warm pipe; t_in, t_out and m are the HEX's hot side (its Q)
POINTS = _points(("hall", "Hall"), ("condenser", "Cond"))
POINTS["hall"] |= {"t": "Loop_T_warm", "t_return": "Loop_T_cold"}
POINTS["condenser"] |= {"t": "Loop_T_warm_Cond", "t_return": "Loop_T_cold"}
HEX = POINTS["hall"]
COND = POINTS["condenser"]
Q_COND_DESIGN = P_PEAK * (1 + CRAH_FAN) * 1.2  # kW: the hall's design heat and the chiller's work
# the Site map's data center: its average utilization and the share of its heat used (the installed power follows)
UTILIZATION = 0.2
HEAT_USED = 0.9
DERIVED = {h["q"]: {"m": h["m"], "t_in": h["t_in"], "t_out": h["t_out"], "cp": CP_WATER} for h in (HEX, COND)}

# The links and their lags (hours): each variable's causes as make() computes it, every one an hour before (lag 1,
# the drawn graph) and nothing else, so the graph is the plant's: a link that is not in make() is not in the graph, and
# each physics equation below uses exactly its variable's links (test_example_recovery_air.py checks both). The IT load
# of hour t-1 is the IT electricity (and heat) of hour t, so the plant's columns hang on IT_Load
# (and In_Temp, the server fans), not on ITE_Ener[t-1], which would be an hour late. Two variables have their causes
# in the graph but are taken from the data by the trained models (INPUTS), as Modelling does with an actuator: the
# IT load (the customers' load follows the clock, its noise is theirs) and Loop_T_cold, the loop's water back from the
# heat distribution (it follows the ground, the heat the data center gives it and what the buildings take, over days
# and weeks: too slowly, and through states no column holds, for an hourly twin to carry over a year). Heat_Demand,
# the district's, is an input (no parents).
_HALL = [("IT_Load", (1,)), ("In_Temp", (1,))]  # the hall's heat and its water: the IT power, the server fans
_WEATHER1 = [("Out_Temp", (1,)), ("Out_Hum", (1,))]  # the wet bulb (the tower), the outdoor air
_LOOP1 = [("Loop_T_cold", (1,))]  # the loop's cold pipe at the recovery HEX
LINKS: dict[str, list[tuple[str, tuple[int, ...]]]] = {
    # the loop's cold pipe: toward the ground's temperature (the weather's, slowly), warmed by what the HEX gives it
    # (the hall's heat at the pipe's temperature), cooled by what the buildings' heat pumps take (the demand)
    "Loop_T_cold": [("Loop_T_cold", (1,)), ("Out_Temp", (1,)), *_HALL, ("Heat_Demand", (1,))],
    # the customers' load follows the clock: toward the day's target (lower at weekends), from where it was
    "IT_Load": [("IT_Load", (1,)), ("Hour", (1,)), ("Is_Weekend", (1,))],
    "ITE_Ener": _HALL,
    "In_Temp": [("In_Temp", (1,)), ("Cool_Set", (1,)), ("ITE_Ener", (1,))],
    "HEX_Hall_T_in": [("In_Temp", (1,))],
    "HEX_Hall_m": _HALL,
    "HEX_Hall_T_out": [*_HALL, *_LOOP1],
    "Loop_T_warm": [*_HALL, *_LOOP1],
    # the condenser HEX (the other design): the chiller's condenser water, from the hall's heat and the tower water
    "HEX_Cond_T_in": [*_HALL, *_WEATHER1],
    "HEX_Cond_m": [*_HALL, *_WEATHER1],
    "HEX_Cond_T_out": [*_HALL, *_WEATHER1, *_LOOP1],
    "Loop_T_warm_Cond": [*_HALL, *_WEATHER1, *_LOOP1],
    "HVAC_Ener": [*_HALL, *_WEATHER1, *_LOOP1],
    # the UPS and distribution losses follow the IT power; the building the clock (its lights) and the weather
    "Elec_Loss_Ener": _HALL,
    "Building_Ener": [("Hour", (1,)), ("Out_Temp", (1,))],
    "Heat_rejected": [*_HALL, *_WEATHER1, *_LOOP1, ("Hour", (1,))],
}
# taken from the data in the trained models (Modelling's default inputs: the graph's drivers and the actuators): the
# IT load has its causes in the graph (the clock), but the twin runs on the measured one
INPUTS = ["Hour", "Is_Weekend", *WEATHER, "Loop_T_cold", "Cool_Set", "IT_Load", "Heat_Demand"]


def day(hour: np.ndarray) -> np.ndarray:
    """1 from 7:00 to 18:59 (local, whole hours), else 0: the lights of the offices and the halls' corridors."""
    return np.clip(hour - 6, 0, 1) * np.clip(19 - hour, 0, 1)


def cop_elec(out_temp: np.ndarray) -> np.ndarray:
    """COP of the electrical rooms' DX units with economiser: 12 at 0 °C and below, 7 at 20 °C, 3 at 36 °C."""
    return np.clip(12 - 0.25 * out_temp, 3, 12)


def local_time(time: pd.Series) -> pd.Series:
    """The UTC time stamps on Frankfurt's clock (summer time too), without a zone."""
    return time.dt.tz_localize("UTC").dt.tz_convert(TZ).dt.tz_localize(None)


def free_cooling(t_out: np.ndarray, t_wb: np.ndarray) -> np.ndarray:
    """Share of what the recovery leaves that the free-cooling plate HEX takes: it cools the water leaving the recovery
    HEX (t_out) toward the tower water (wet bulb + approach) + its own approach, down to T_CHWS; 1 when the water is
    already at T_CHWS and the tower could take it, 0 when the tower water is too warm."""
    return np.clip((t_out - PHE_APPROACH - (t_wb + TOWER_APPROACH)) / np.maximum(t_out - T_CHWS, 0.01), 0.0, 1.0)


# Physics equations (every term at t-1). The rest of the graph is data-driven (linear on its parents). Fixed numbers
# are the plant's data sheet; the named coefficients are learned (semi-physical).
_ITE = f"(({P_IDLE:g} + {P_PEAK - P_IDLE:g}*IT_Load[t-1])*(1 + {FAN_PER_K:g}*maximum(0, In_Temp[t-1] - {FAN_FROM:g})))"
_FANS = f"({CRAH_FAN * P_PEAK:g}*maximum({X_MIN:g}, {_ITE}/{P_PEAK:g})**{FAN_EXP:g})"
_QH = f"({_ITE} + {_FANS})"
_TIN = "(In_Temp[t-1] + dT)"
_MCP = f"({_QH} / ({_TIN} - {T_CHWS:g}))"  # m * cp of the chilled water
_QREC = f"minimum(minimum({Q_LOOP:g}, {_QH}), {EPS_PLATE:g}*{_MCP}*maximum(0, {_TIN} - Loop_T_cold[t-1]))"
_REST = f"({_QH} - {_QREC})"
_TOUT = f"({_TIN} - {_QREC} / {_MCP})"
# the free-cooling share on the water the recovery HEX leaves (free_cooling()), the tower approach a learned
_S = f"minimum(1, maximum(0, ({_TOUT} - {PHE_APPROACH:g} - {_WB} - a) / maximum({_TOUT} - {T_CHWS:g}, 0.01)))"
_PUMPS = f"({CHW_PUMP * P_PEAK:g}*({_MCP}/{CP_WATER * M_DESIGN:g})**2)"
_X = f"({_ITE}/{P_PEAK:g})"  # the IT power per unit of the peak: coefficients of order one
_ELEC = f"(u0 + u1*{_X} + u2*{_X}**2)"  # learned: the UPS's no-load, load and load² losses and the distribution's
_Y = f"({_ITE}/{2 * UPS_KW:g})"
_ELEC_SHEET = f"({2 * UPS_KW:g}*({UPS_A0:g} + {UPS_A1:g}*{_Y} + {UPS_A2:g}*{_Y}**2) + {DIST_LOSS:g}*{_ITE})"  # data sheet
_COPE = "clip(12 - 0.25*Out_Temp[t-1], 3, 12)"
_DAY = "(clip(Hour[t-1] - 6, 0, 1)*clip(19 - Hour[t-1], 0, 1))"  # 7:00-18:59 on Frankfurt's clock (day())
_BLD = f"b0 + b1*{_DAY} + b2*maximum(0, 15 - Out_Temp[t-1]) + b3*maximum(0, Out_Temp[t-1] - 22)"
# the condenser design: the tower water (bypassed, held at >= T_CW_MIN), the chiller's condenser heat, its flow
_TCW = f"maximum({_WB} + {TOWER_APPROACH:g}, {T_CW_MIN:g})"
_COPC = f"minimum({COP_MAX:g}, {ETA_CARNOT * (T_CHWS + 273.15):g}/maximum({_TCW} + {DT_COND_DESIGN + 2.0:g} - {T_CHWS:g}, 5))"
_QC = f"({_QH}*(1 + 1/{_COPC}))"
_MC = f"(maximum({_QC}, {MIN_FLOW * Q_COND_DESIGN:g})/{CP_WATER * DT_COND_DESIGN:g})"
_TINC = f"({_TCW} + {_QC}/({_MC}*{CP_WATER:g}))"
_QCREC = f"minimum(minimum({Q_LOOP:g}, {_QC}), {EPS_PLATE:g}*{_MC}*{CP_WATER:g}*maximum(0, {_TINC} - Loop_T_cold[t-1]))"
_GAUSS = lambda mu, sd: f"exp(-0.5*((Hour[t-1] - {mu:g})/{sd:g})**2)"  # noqa: E731 - the day's bumps (_gauss)
EQUATIONS = {
    # semi-physical: toward the ground (a share g of the outdoor temperature over b) by a, plus the loop's surplus by k
    # (the heat recovered, as HEX_Hall_T_out's, minus the share u of the demand the buildings' heat pumps take)
    "Loop_T_cold": f"Loop_T_cold[t-1] + a*(b + g*Out_Temp[t-1] - Loop_T_cold[t-1]) + k*({_QREC} - u*Heat_Demand[t-1])/1000",
    # semi-physical: toward the day's target (a base c, the afternoon s1, less by f at weekends, the evening s2) by k
    "IT_Load": f"IT_Load[t-1] + k*(c + s1*{_GAUSS(14, 4)}*(1 - f*Is_Weekend[t-1]) + s2*{_GAUSS(21, 2)} - IT_Load[t-1])",
    # physical: the server power curve, its fans above a 24 °C inlet
    "ITE_Ener": _ITE,
    # semi-physical: a first-order hall, toward the setpoint (b), warmed by the IT (r per MW), a bias (d)
    "In_Temp": "In_Temp[t-1] + b*(Cool_Set[t-1] - In_Temp[t-1]) + r*ITE_Ener[t-1]/1000 + d",
    "HEX_Hall_T_in": _TIN,
    # physical: the coil valves hold the flow at the hall's heat over the water's rise
    "HEX_Hall_m": f"{_MCP} / {CP_WATER:g}",
    # semi-physical: the HEX takes the hall's heat up to the loop's capacity and as far as its cold pipe lets it
    "HEX_Hall_T_out": _TOUT,
    # physical: the loop's water warms by the heat recovered at its pump's constant flow
    "Loop_T_warm": f"Loop_T_cold[t-1] + {_QREC}/{M_LOOP * CP_WATER:g}",
    # physical: the condenser design's water, as make() has it (the chiller's COP, the tower water, the design range),
    # and the loop's water it warms
    "HEX_Cond_T_in": _TINC,
    "HEX_Cond_m": _MC,
    "HEX_Cond_T_out": f"{_TINC} - {_QCREC}/({_MC}*{CP_WATER:g})",
    "Loop_T_warm_Cond": f"Loop_T_cold[t-1] + {_QCREC}/{M_LOOP * CP_WATER:g}",
    # semi-physical: the fans and pumps as their data sheets say (k scales them), the chiller on the share not
    # free-cooled of what is left (c ~ 1/COP), the tower on all that is left (f), the electrical rooms' units on the
    # losses (g ~ 1); the tower approach a inside the free-cooling share
    "HVAC_Ener": f"k*({_FANS} + {_PUMPS}) + c*(1 - {_S})*{_REST} + f*{_REST} + g*{_ELEC_SHEET}/{_COPE}",
    "Elec_Loss_Ener": _ELEC,
    # semi-physical: a base, the lights by day, heating below 15 °C and cooling above 22 °C
    "Building_Ener": _BLD,
    # physical balance: what is not recovered, the plant's and the electrical rooms' electricity (but the fans', in the
    # hall's heat) and the building leave to the outdoor air, written with the other equations' terms (no same-step
    # links)
    "Heat_rejected": f"{_REST}*(1 + c*(1 - {_S}) + f) + k*{_PUMPS} + {_ELEC_SHEET}*(1 + g/{_COPE}) + {_BLD}",
}


def it_load(time: pd.Series, seed: int = 0) -> np.ndarray:
    """Utilisation 0..1 of the hall (`time` on Frankfurt's clock): each hour it moves IT_K of the way toward the day's
    target of the hour before: the hall's level (IT_LEVELS in turn, each held for weeks), a little more in business
    hours (less at weekends), an evening bump, growing by 0.06 over two years as customers move in, plus noise."""
    h = time.dt.hour.shift(1).bfill().to_numpy(float)
    weekend = (time.dt.dayofweek >= 5).shift(1).bfill().to_numpy(bool)
    years = ((time - time.iloc[0]).dt.total_seconds() / (365.25 * 86400)).to_numpy()
    rng = np.random.default_rng(seed + 4)
    level, i = np.empty(len(h)), 0
    while i < len(h):  # every level in turn, shuffled, so each year sees them all
        for v in rng.permutation(IT_LEVELS):
            hold = int(rng.integers(7, 29)) * 24
            level[i : i + hold] = v
            i += hold
    target = level + 0.03 * years + 0.08 * _gauss(h, 14, 4) * np.where(weekend, 0.6, 1.0) + 0.03 * _gauss(h, 21, 2)
    e = np.random.default_rng(seed).normal(0, IT_NOISE, len(h))
    x = np.empty(len(h))
    x[0] = target[0]
    for i in range(1, len(x)):
        x[i] = np.clip(x[i - 1] + IT_K * (target[i] - x[i - 1]) + e[i], 0.05, 1.0)
    return x


def cool_set(time: pd.Series, seed: int = 0) -> np.ndarray:
    """The supply-air setpoint: one of SETPOINTS (mostly 24-25 °C), held for one to four weeks, then changed."""
    rng = np.random.default_rng(seed + 3)
    out, i, n = np.empty(len(time)), 0, len(time)
    while i < n:
        hold = int(rng.integers(7, 29)) * 24
        out[i : i + hold] = rng.choice(SETPOINTS, p=SETPOINT_ODDS)
        i += hold
    return out


def loop_ground(time: pd.Series, out_temp: np.ndarray) -> np.ndarray:
    """The loop's cold pipe without the data center (°C): the outdoor temperature smoothed over ~30 days (the ground the
    loop runs through), scaled: ~8 °C in late winter, ~18 °C in late summer."""
    steps = LOOP_DAYS * 24 * 3600 / max(1.0, float(time.diff().dt.total_seconds().median() or 3600))
    smooth = pd.Series(out_temp).ewm(alpha=1 / steps, adjust=False).mean().to_numpy()
    smooth = smooth + (np.mean(out_temp[: int(steps)]) - smooth[0]) * np.exp(-np.arange(len(smooth)) / steps)  # no cold start
    return LOOP_BASE + LOOP_GAIN * smooth


def make(base: pd.DataFrame, demand: np.ndarray | None = None, seed: int = 0) -> pd.DataFrame:
    """The data center's hourly columns from `base` (time in UTC, Hour, the weather; Cool_Set and Loop_T_cold when
    given, else made); `demand` replaces the generated Heat_Demand (kW, one per row)."""
    out = base[["time", "Hour", *[c for c in WEATHER if c in base]]].reset_index(drop=True)
    n = len(out)
    local = local_time(out["time"])
    out["Hour"] = local.dt.hour.to_numpy(float)  # Frankfurt's clock: the customers' day
    out["Is_Weekend"] = (local.dt.dayofweek >= 5).to_numpy(float)  # Saturday and Sunday, on the same clock
    out["Cool_Set"] = base["Cool_Set"].to_numpy(float) if "Cool_Set" in base else cool_set(out["time"], seed)
    out["IT_Load"] = it_load(local, seed)
    own = heat_demand(local, out["Out_Temp"], seed=seed + DEMAND_SEED, **DEMAND) if demand is None else demand
    out["Heat_Demand"] = np.asarray(own, float)

    # the hall: the IT power of hour t from the load and the inlet air of hour t-1, the inlet from the hour before
    load, cool = out["IT_Load"].to_numpy(), out["Cool_Set"].to_numpy(float)
    rng = np.random.default_rng(seed + 1)
    ite, in_t = np.empty(n), np.empty(n)
    in_t[0] = cool[0]
    ite[0] = P_IDLE + (P_PEAK - P_IDLE) * load[0]
    for t in range(1, n):
        ite[t] = (P_IDLE + (P_PEAK - P_IDLE) * load[t - 1]) * (1 + FAN_PER_K * max(0.0, in_t[t - 1] - FAN_FROM))
        in_t[t] = in_t[t - 1] + ROOM_B * (cool[t - 1] - in_t[t - 1]) + ROOM_C * ite[t - 1] + ROOM_D + rng.normal(0, ROOM_NOISE)
    out["ITE_Ener"], out["In_Temp"] = ite, in_t
    p = out.shift(1).bfill()  # one hour back
    fans = CRAH_FAN * P_PEAK * np.maximum(X_MIN, ite / P_PEAK) ** FAN_EXP
    q_hall = ite + fans
    t_in = p["In_Temp"].to_numpy() + DT_SERVER - CRAH_APPROACH
    m = q_hall / (CP_WATER * (t_in - T_CHWS))
    cap = np.minimum(Q_LOOP, q_hall)
    if "Loop_T_cold" in base:  # a given loop: the recovery follows it
        loop = base["Loop_T_cold"].to_numpy(float)
        before = np.r_[loop[0], loop[:-1]]
        q = np.minimum(cap, EPS_PLATE * m * CP_WATER * np.maximum(0, t_in - before))
    else:  # the loop warms when it gets more than the buildings' heat pumps take out (summer), cools when less
        # the weather and the buildings' demand of the hour before (measured hourly: lags start at 1)
        ground = loop_ground(out["time"], p["Out_Temp"].to_numpy(float))
        need = p["Heat_Demand"].to_numpy() * (1 - 1 / COP_BUILDINGS)
        noise = np.random.default_rng(seed + 5).normal(0, LOOP_NOISE, n)
        keep = np.exp(-1 / (LOOP_IMB_DAYS * 24))
        loop, q, before = np.empty(n), np.empty(n), np.empty(n)
        surplus, e, last = 0.0, 0.0, ground[0]
        for t in range(n):
            before[t] = last
            q[t] = min(cap[t], EPS_PLATE * m[t] * CP_WATER * max(0.0, t_in[t] - last))
            surplus = keep * surplus + (1 - keep) * (q[t] - need[t])
            e = 0.95 * e + noise[t]
            loop[t] = last = min(LOOP_MAX, max(LOOP_MIN, ground[t] + LOOP_K * surplus / 1000 + e))
    out["Loop_T_cold"] = loop
    out["Loop_T_warm"] = before + q / (M_LOOP * CP_WATER)  # the loop's water on to the heat distribution
    out[HEX["t_in"]], out[HEX["t_out"]], out[HEX["m"]], out[HEX["q"]] = t_in, t_in - q / (m * CP_WATER), m, q

    rest = q_hall - q
    out_t = p["Out_Temp"].to_numpy()
    t_wb = wet_bulb(out_t, p["Out_Hum"].to_numpy())
    # the other design, the recovery at the chiller's condenser instead of the hall: the chiller takes all the hall's
    # heat (tower bypassed, its water held at >= T_CW_MIN) and adds its work; the condenser pump holds the design range
    t_cw = np.maximum(t_wb + TOWER_APPROACH, T_CW_MIN)
    q_cond = q_hall * (1 + 1 / cop(t_cw + DT_COND_DESIGN + 2.0))
    m_c = np.maximum(q_cond, MIN_FLOW * Q_COND_DESIGN) / (CP_WATER * DT_COND_DESIGN)
    t_in_c = t_cw + q_cond / (m_c * CP_WATER)
    q_c = np.minimum(np.minimum(Q_LOOP, q_cond), EPS_PLATE * m_c * CP_WATER * np.maximum(0, t_in_c - before))
    out[COND["t_in"]], out[COND["t_out"]], out[COND["m"]], out[COND["q"]] = t_in_c, t_in_c - q_c / (m_c * CP_WATER), m_c, q_c
    out["Loop_T_warm_Cond"] = before + q_c / (M_LOOP * CP_WATER)  # the loop's water on to the heat distribution
    s = free_cooling(t_in - q / (m * CP_WATER), t_wb)
    w_chiller = (1 - s) * rest / cop(t_wb + TOWER_APPROACH + DT_COND_DESIGN + 2.0)
    w_tower = TOWER_KW * (rest + w_chiller)
    pumps = CHW_PUMP * P_PEAK * (m / M_DESIGN) ** 2
    # the UPS and distribution losses, the electrical rooms' units that cool them, the building (its lights by the
    # clock of the hour before)
    y = ite / (2 * UPS_KW)
    elec = 2 * UPS_KW * (UPS_A0 + UPS_A1 * y + UPS_A2 * y**2) + DIST_LOSS * ite
    w_elec = elec / cop_elec(out_t)
    hour = p["Hour"].to_numpy(float)
    building = BLD_BASE + BLD_LIGHT * day(hour) + BLD_HEAT * np.maximum(0, 15 - out_t) + BLD_COOL * np.maximum(0, out_t - 22)
    out["HVAC_Ener"] = fans + pumps + w_chiller + w_tower + w_elec
    out["Elec_Loss_Ener"] = elec
    out["Building_Ener"] = building
    out["Heat_rejected"] = rest + w_chiller + w_tower + pumps + elec + w_elec + building
    check(out, q_hall)
    return out


def facility(o: pd.DataFrame) -> pd.Series:
    """The whole facility's electricity per hour: IT, cooling, electrical losses and the building."""
    return o["ITE_Ener"] + o["HVAC_Ener"] + o["Elec_Loss_Ener"] + o["Building_Ener"]


def check(o: pd.DataFrame, q_hall: np.ndarray) -> None:
    """The energy balance, Q = m cp ΔT, the loop's limit and plausible ranges."""
    t_in, t_out, m, q = (o[HEX[k]].to_numpy() for k in ("t_in", "t_out", "m", "q"))
    assert np.allclose(facility(o), q + o["Heat_rejected"], atol=1e-6), "electricity = heat"
    assert np.allclose(q, m * CP_WATER * (t_in - t_out), atol=1e-9), "Q = m cp (T_in - T_out)"
    assert (q >= 0).all() and (q <= q_hall + 1e-9).all() and (t_out >= T_CHWS - 1e-9).all(), "0 <= Q <= the hall's heat"
    assert (q <= Q_LOOP + 1e-9).all(), "never more than the loop takes"
    assert (o["Heat_rejected"] > 0).all() and (o["HVAC_Ener"] > 0).all() and (m > 0).all()
    assert (o["Heat_Demand"] >= 0).all()
    assert o["Cool_Set"].between(18, 27).all() and o["In_Temp"].between(15, 32).all(), "ASHRAE A1 inlet air"
    assert o["Loop_T_cold"].between(LOOP_MIN, LOOP_MAX).all()
    warm, cold = o["Loop_T_warm"].to_numpy(), np.r_[o["Loop_T_cold"].iloc[0], o["Loop_T_cold"].to_numpy()[:-1]]
    assert (m < M_LOOP).all() and (warm >= cold - 1e-9).all() and (warm <= t_in + 1e-9).all(), "the loop warms, never above T_in"
    ct_in, ct_out, cm, cq = (o[COND[k]].to_numpy() for k in ("t_in", "t_out", "m", "q"))
    assert np.allclose(cq, cm * CP_WATER * (ct_in - ct_out), atol=1e-9), "condenser: Q = m cp (T_in - T_out)"
    assert ((ct_in >= T_CW_MIN) & (ct_in <= 45)).all() and (cq >= 0).all() and (cq <= Q_LOOP + 1e-9).all(), "condenser: 27-45 °C"
    warm_c = o["Loop_T_warm_Cond"].to_numpy()
    assert (warm_c >= cold - 1e-9).all() and (warm_c <= ct_in + 1e-9).all(), "the condenser design's loop water"


def recovery_share(o: pd.DataFrame) -> pd.Series:
    """Recovered / recoverable heat (the hall's heat: IT and the CRAH fans) per hour."""
    fans = CRAH_FAN * P_PEAK * np.maximum(X_MIN, o["ITE_Ener"] / P_PEAK) ** FAN_EXP
    return o[HEX["q"]] / (o["ITE_Ener"] + fans)


def pue(o: pd.DataFrame) -> float:
    """The facility's PUE over the rows (ISO/IEC 30134-2): its whole electricity over the IT's."""
    return float(facility(o).sum() / o["ITE_Ener"].sum())


def base_frame(data: Path = DATA) -> pd.DataFrame:
    """data/sim_1's hours with Frankfurt's weather at them (weather_frankfurt.csv.gz, UTC) and the hour of the day."""
    hours = pd.read_parquet(data / SOURCE / f"df_{SOURCE}.parquet", columns=["time"])
    w = pd.read_csv(WEATHER_FILE, parse_dates=["time"])
    out = hours.merge(w, on="time", how="left")
    assert out[WEATHER].notna().all().all(), "the weather covers every hour"
    out["Hour"] = out["time"].dt.hour.astype(float)
    return out


DATASET = {
    "name": "Recovery · air cooled",
    "kind": "simulation",
    "actuators": ["Cool_Set", "IT_Load"],
    "heat": [
        *["Heat_Demand", "Loop_T_cold", "Loop_T_warm"],
        *[HEX["t_in"], HEX["t_out"], HEX["m"], HEX["q"], "Heat_rejected"],
    ],
    "levers": ["Cool_Set"],
    "pid_image": None,
    "plant": PLANT["sim_1_air"],
    "heat_source": POINTS,
    "derived": DERIVED,
    "kpi": {
        "it_power": "ITE_Ener",
        "cooling_power": "HVAC_Ener",
        "other_power": ["Elec_Loss_Ener", "Building_Ener"],
        "heat_power": HEX["q"],
        "heat_demand": "Heat_Demand",
        "reuse": {"hall": HEX["q"]},
        "power_unit": "kW",
    },
    "frame": True,
}


# the district on the Site map: the residential buildings around the European Central Bank (district_buildings.json,
# from OpenStreetMap: nearest first until their floor area covers the demand), each a heat sink with its share of the
# generated demand by floor area (its Quick analysis; Heat Distribution's demand when no model runs), the loop's 70/40 °C
BUILDINGS = Path(__file__).with_name("district_buildings.json")
# the streets and paths around them (OpenStreetMap), where the Site map's heat network runs: copied as streets.json
STREETS = Path(__file__).with_name("district_streets.json")
SINK_DEMAND = {"heatingLimit": 16, "dhwShare": 0.1, "supplyTemp": 70, "returnTemp": 40}  # as the generated demand


def district_sinks(annual_mwh: float) -> list[dict]:
    """The buildings as heat sinks, their annual demands adding up to `annual_mwh` (by floor area)."""
    bs = json.loads(BUILDINGS.read_text())["buildings"]
    floor = sum(b["floor_m2"] for b in bs)
    out = []
    for b in bs:
        kwh = annual_mwh * 1000 * b["floor_m2"] / floor
        out.append(
            {
                "id": f"osm-{b['osm_id']}",
                "name": b["name"],
                "lat": b["lat"],
                "lon": b["lon"],
                "temp_c": 70.0,
                "power_kw": round(kwh / 8760, 1),
                "outline": b["outline"],
                "area": False,
                "demand": {"houses": 1, "kwhPerHouse": round(kwh), **SINK_DEMAND},
            }
        )
    return out


MODELS = {"linear": {"model": "linear"}, "phys": {"model": "physics", "equations": EQUATIONS}, "xgb": {"model": "xgboost"}}
# the cheap ones Modelling compares them with (all vs all at lags 1..5, symbolic regression on the graph: seconds to
# half a minute each), so every approach shows results; TabPFN is left out (minutes, and a model of training rows)
COMPARED = {
    "linear_all": {"model": "linear", "structure": "all"},
    "xgb_all": {"model": "xgboost", "structure": "all"},
    "sym": {"model": "symbolic"},
}
# the evaluation Modelling shows when it opens (models/evaluation.json): its default levers (dataset.json) and window
EVALUATE = {"levers": DATASET["levers"], "horizon": 24, "store": True}


# the district's structure (silver/district_structure): its heat demand on the weather and the clock, as Chronos-2
# sees them too (the outdoor temperature, its 24 h and 72 h means and the weekend as prepared variables, and the hour):
# a demand follows them, not its own past, so its twin runs free over a whole year without drifting (free-run R² of
# its XGBoost 0.99; with its own lags 1 and 24 h as inputs 0.49). Semi-physical: space heating on the 72 h mean with
# the generator's soft heating limit, its day curve (two harmonics of the hour), a weekend factor, hot water with its
# own day curve
PREPARED = [
    {"name": "Out_Temp_mean24", "op": "rolling_mean", "inputs": ["Out_Temp"], "params": {"window": 24}, "scope": "district"},
    # the buildings' inertia: the demand follows the outdoor temperature of the last three days
    {"name": "Out_Temp_mean72", "op": "rolling_mean", "inputs": ["Out_Temp"], "params": {"window": 72}, "scope": "district"},
]  # the weekend is a column of the data (Is_Weekend, Frankfurt's clock): the data center's IT load follows it too
_DRIVERS = ["Out_Temp", "Out_Temp_mean24", "Out_Temp_mean72", "Is_Weekend", "Hour"]
DISTRICT_GRAPH = {
    **{c: [] for c in _DRIVERS},
    "Heat_Demand": [(c, 0) for c in _DRIVERS],
}
_H = "6.283185*Hour[t]/24"
DISTRICT_EQUATIONS = {
    "Heat_Demand": f"b*2*log(1 + exp((16 - Out_Temp_mean72[t])/2))*(1 + c1*cos({_H}) + s1*sin({_H}) + c2*cos(2*{_H})"
    f" + s2*sin(2*{_H}))*(1 + f*Is_Weekend[t]) + d*(1 + e1*cos({_H}) + e2*sin({_H}))"
}
DISTRICT_MODELS = {
    "linear": {"model": "linear"},
    "phys": {"model": "physics", "equations": DISTRICT_EQUATIONS},
    "xgb": {"model": "xgboost"},
}
# all vs all on the structure's own variables, not every column of the data center's (the demand then also sees its
# own past, lags 1..5)
DISTRICT_COMPARED = {
    "linear_all": {"model": "linear", "structure": "all", "variables": list(DISTRICT_GRAPH)},
    "xgb_all": {"model": "xgboost", "structure": "all", "variables": list(DISTRICT_GRAPH)},
    "sym": {"model": "symbolic"},
}


def write_district(dst: Path) -> None:
    """The district's structure of this data center: its graph, equations and site.json (the model Heat Matching runs)."""
    d = dst / "silver" / "district_structure"
    d.mkdir(parents=True, exist_ok=True)
    write_graph(d / "causal_graph.json", DISTRICT_GRAPH)
    (d / "equations.json").write_text(json.dumps(DISTRICT_EQUATIONS, indent=2) + "\n")
    old = json.loads((d / "site.json").read_text()) if (d / "site.json").exists() else {}
    (d / "site.json").write_text(json.dumps({"sinks": [], **old, "twin_model": "xgb"}, indent=2) + "\n")


# Causal discovery on the drawn graph, as the Structure page's "Refine the drawn graph" (TempCaFe: tigramite PCMCI with
# partial correlation) does it, and the models trained after it: on the training year, which lags 1..6 of each drawn
# link are significant. The drawn graph (LINKS, every cause an hour before) is kept as causal_graph_drawn.json;
# causal_graph.json is the refined one the models are trained on: each drawn link gets the lags discovery found (a link
# with none keeps its drawn lag: no evidence, kept), a variable's own past is refined where the graph has it, no link
# is added or removed (web/src/pages/datacenter/structure/links.ts applyDiscoveredLags). Both carry the strengths found.
DISCOVERY = {"method": "pcmci", "min_lag": 1, "max_lag": 6, "alpha": 0.01, "data_fraction": 0.5}
DRAWN_GRAPH = "causal_graph_drawn.json"


def discover(data: Path) -> dict:
    """The discovery's answer on LINKS' drawn links (the app's own route, in-process)."""
    from fastapi.testclient import TestClient

    from backend.app import create_app

    api = TestClient(create_app(data))
    pairs = sorted({(p, t) for t, ps in LINKS.items() for p, _ in ps if p != t})
    body = {"links": [{"source": a, "target": b} for a, b in pairs], **DISCOVERY}
    r = api.post(f"/api/datasets/{ID}/graph/discover-lags", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def refine(res: dict) -> dict[str, list[tuple[str, tuple[int, ...]]]]:
    """LINKS with the discovered lags (applyDiscoveredLags); prints what changed."""
    found = {(x["source"], x["target"]): tuple(x["lags"]) for x in res["links"]}
    out: dict[str, list[tuple[str, tuple[int, ...]]]] = {}
    none, changed = [], []
    for t, ps in LINKS.items():
        out[t] = []
        for p, ks in ps:
            new = tuple(res["self"].get(t) or ks) if p == t else found.get((p, t)) or ks
            if p != t and not found.get((p, t)):
                none.append(f"{p}->{t}")
            elif new != ks:
                changed.append(f"{p}->{t} {list(ks)}->{list(new)}")
            out[t].append((p, new))
    n = sum(len(ps) for ps in LINKS.values())
    print(f"discovery ({DISCOVERY['method']}, alpha {DISCOVERY['alpha']}, lags 1-6, 2023): {n} drawn links")
    print(f"  lags changed ({len(changed)}):", "; ".join(changed) or "none")
    print(f"  no significant lag, kept at the drawn one ({len(none)}):", ", ".join(none) or "none")
    return out


def train(data: Path) -> dict[str, float]:
    """linear, phys and xgb and the ones compared with them, trained by the app's own route (in-process) on the first
    year; prints each one's free run over the held-out second year (stored as the evaluation Modelling shows) and
    returns the R² of the recovered heat (HEX_Hall_Q, calculated from the predicted m, T_in and T_out) per model."""
    from fastapi.testclient import TestClient

    from backend.app import create_app

    api = TestClient(create_app(data))
    base = f"/api/datasets/{ID}/models"
    df = pd.read_parquet(data / ID / f"df_{ID}.parquet")
    own = [c for c in df.columns if c != "time" and c not in DERIVED]  # not the district's prepared inputs
    for name, body in (MODELS | COMPARED).items():
        r = api.post(f"{base}/train", json={"name": name, "drivers": INPUTS, "variables": own, **body})
        assert r.status_code == 200, r.text
    r = api.post(f"{base}/evaluate", json={"names": list(MODELS | COMPARED), **EVALUATE})
    assert r.status_code == 200, r.text
    for name, m in r.json()["models"].items():
        print(name, {v: round(x, 3) for v, x in m["free_r2"].items() if x is not None})
    r2 = {}
    for name in MODELS | COMPARED:
        split = api.get(f"{base}/{name}").json()["split_index"]
        r = api.post(f"{base}/{name}/simulate", json={"start": split, "steps": len(df) - split, "columns": [HEX["q"]]})
        y, p = df[HEX["q"]].to_numpy()[split:], np.asarray(r.json()["scenario"][HEX["q"]], float)
        r2[name] = float(1 - ((y - p) ** 2).sum() / ((y - y.mean()) ** 2).sum())
    print("held-out R² of", HEX["q"], {k: round(v, 3) for k, v in r2.items()})
    # the district's own models, in its own structure: its demand on its prepared inputs (made again from the new data)
    api.delete(f"/api/datasets/{ID}/prepared/Is_Weekend")  # prepared before, a data column now (404 after)
    for step in PREPARED:
        api.delete(f"/api/datasets/{ID}/prepared/{step['name']}")  # 404 on the first run
        r = api.post(f"/api/datasets/{ID}/prepared", json=step)
        assert r.status_code == 200, r.text
    for name, body in (DISTRICT_MODELS | DISTRICT_COMPARED).items():
        r = api.post(f"{base}/train?scope=district", json={"name": name, **body})
        assert r.status_code == 200, r.text
    r = api.post(f"{base}/evaluate?scope=district", json={"names": list(DISTRICT_MODELS | DISTRICT_COMPARED), **EVALUATE})
    assert r.status_code == 200, r.text
    for name, m in r.json()["models"].items():
        print("district", name, {v: round(x, 3) for v, x in m["free_r2"].items() if x is not None})
    return r2


def main(data: Path = DATA, fit: bool = True) -> None:
    """Write data/sim_recovery_air on data/sim_1's hours and Frankfurt's weather (models are rewritten, site.json
    updated)."""
    dst = data / ID
    dst.mkdir(exist_ok=True)
    df = make(base_frame(data))
    df.to_parquet(dst / f"df_{ID}.parquet", index=False)
    targets = {c: [] for c in df.columns if c != "time" and c not in DERIVED} | {
        v: [(p, -k) for p, ks in ps for k in ks] for v, ps in LINKS.items()
    }
    src_site = json.loads((data / SOURCE / "site.json").read_text())
    site = {k: src_site[k] for k in ("building", "source") if k in src_site} | {
        "hex_option": "hall",
        # the heat pump sized for this data center: ~4.8 MW of heat from ~3.7 MW recovered at COP ~4.3
        "heat_components": {**HEAT_COMPONENTS, "hp": "hp_5mw"},
        "twin_model": "xgb",  # the data center's model Heat Matching runs
    }
    # what the app saved there since (placed instruments, the page's settings) stays, except the hall HEX's spots: the
    # drawing's defaults place them on its warm-water line (a saved spot would cover the HEX)
    if (dst / "site.json").exists():
        site |= json.loads((dst / "site.json").read_text())
    # the example's own district: rewritten with the demand (a sink the user added on the map stays beside it)
    # the example's own district (and its former single sink) rewritten with the demand; a sink the user added stays,
    # but never a Wärmeatlas building ("wah-"): © LEA Hessen, the example is committed
    ours = ("district", "osm-", "wah-")
    others = [x for x in site.get("sinks") or [] if not str(x.get("id")).startswith(ours)]
    # the year Heat Matching evaluates (the data's last, the models' test year)
    annual = float(df.loc[df["time"].dt.year == df["time"].dt.year.max(), "Heat_Demand"].sum()) / 1000
    site["sinks"] = [*district_sinks(annual), *others]
    # the standard example sits where sim_1 does, in the European Central Bank's building, whatever was saved since
    site["building"] = src_site.get("building")
    if site.get("source") and src_site.get("source"):
        site["source"] = {
            **site["source"],
            **{k: src_site["source"][k] for k in ("lat", "lon", "name") if k in src_site["source"]},
        }
    # and the inputs' row: laid out by the drawing over what the data has (no wind or sun any more)
    row = {"Out_Temp", "Out_Hum", "Out_Wind", "Out_Wind_Dir", "Out_Solar", "solar_radiation", "Hour", "Is_Weekend"}
    # and the spots of variables this example no longer has (the hall's humidity, the free-cooling share)
    row |= {"In_Hum", "FC_Share"}
    old = site.get("pid_layout") or {}
    site["pid_layout"] = {k: v for k, v in old.items() if not k.startswith("HEX_Hall_") and k not in row}
    if site.get("source"):  # the Site map's bubble: the heat it gives, recovered + rejected
        site["source"] = {
            **site["source"],
            # installed for the heat Heat Matching and Operation take, at the hall's recovery HEX (not the rejected
            # rest): at 20 % utilization (siteEdits.ts powerShare, 50 % idle: 60 % of the power) and 90 % of it used
            "power_kw": round(float(df[HEX["q"]].mean()) / ((0.5 + 0.5 * UTILIZATION) * HEAT_USED), -1),
            "utilization": UTILIZATION,
            "heat_used_share": HEAT_USED,
            "temp_c": round(float(df[HEX["t"]].mean())),  # the loop's warm water, what the heat distribution gets
        }
    for name, obj in (("dataset.json", DATASET), ("equations.json", EQUATIONS), ("site.json", site)):
        (dst / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    (dst / "streets.json").write_bytes(STREETS.read_bytes())
    write_district(dst)
    print(f"wrote {dst}")
    # the discovery (seconds) whether or not the models are trained: causal_graph.json is always the refined graph
    res = discover(data)
    strengths = res["link_strengths"]
    graph = lambda links: {c: [] for c in targets} | {v: [(p, -k) for p, ks in ps for k in ks] for v, ps in links.items()}  # noqa: E731
    on = lambda g: [x for x in strengths if (x["source"], x["lag"]) in g.get(x["target"], [])]  # noqa: E731
    write_graph(dst / DRAWN_GRAPH, targets, on(targets))  # the drawn graph, as LINKS: every cause an hour before
    refined = graph(refine(res))
    write_graph(dst / "causal_graph.json", refined, on(refined))  # what the models are trained on
    if fit:
        train(data)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--no-train"]
    main(Path(args[0]) if args else DATA, "--no-train" not in sys.argv)
