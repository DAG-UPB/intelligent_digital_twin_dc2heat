---
title: The example datasets (app/data/sim_*)
tags: [datasets, examples, simulation, sim_1, sim_1_air, sim_1_water, sim_recovery_air, sim_district_heat, sim_blank, sim_box]
summary: What each simulated dataset in app/data/sim_* is, its columns, sizes, plant, extraction points and models, and which script generates it.
---

# The example datasets

All are simulations, the only data an agent may open (AGENTS.md hard rule 1). Each has two years of hourly
data, 2023-01-01 to 2024-12-29 (17,472 rows). The weather is a simulated EnergyPlus year (`Out_Temp` −17 to 46 °C,
`Out_Hum` 11–100 %), hotter and more humid than Central Europe, with no solar column; `sim_recovery_air` has real
Frankfurt weather instead (ERA5, 2023 and 2024, with wind and solar, on the same hours). The examples are shown
in every project, marked `example` (`app/backend/core/registry.py`).

| id | Name (`dataset.json` `name`) | What | Generator |
|---|---|---|---|
| `sim_1` | Simulation 1 | EnergyPlus small data center, ~38 kW mean IT: room, cooling, weather; no heat columns | (source data) |
| `sim_1_modified` | Simulation 1 · with heat exchangers | sim_1 + `Heat_Demand` + two demand-limited recovery HEX: `hall` (air coil) and `condenser` | `app/scripts/make_sim_1_modified.py` |
| `sim_1_air` | Simulation 1 · air cooled, free cooling | A1 plant: CRAH on 18/24 °C CHW, plate-HEX free cooling, trim chiller, tower; points `hall`, `condenser` | `app/scripts/make_sim_cases.py` |
| `sim_1_water` | Simulation 1 · water cooled | W1 plant: cold plates (75 %) on 40–45 °C facility water + rear doors; points `liquid`, `condenser` | `app/scripts/make_sim_cases.py` |
| `sim_blank` | Blank · inputs and outputs only | `sim_1_air`'s data under generic names, no drawing (`blank: true`): draw a structure yourself | `app/scripts/make_sim_blank.py` |
| `sim_box_air` / `sim_box_water` | Box · air cooled / water cooled | `sim_1_air` / `sim_1_water` in the new form (`frame: true`): the DC as a box with its interface on the margins | `app/scripts/make_sim_box.py` |
| `sim_recovery_air` | Recovery · air cooled | 5 MW DC in Frankfurt (~3,600 kW mean IT, PUE ~1.21), recovery takes the hall's heat up to the loop's 4,333 kW as far as the loop's cold pipe lets it (the pipe warms in summer), energy balance closes every hour; ~38,000 MWh/a of heat (~28,000 MWh/a recovered) beside ~30,000 MWh/a of seasonal demand; district structure with its own models | `app/examples/recovery_air_cooled/make.py` |
| `sim_district_heat` | District · heat demand | a residential district's demand on its own weather, ~5,400–5,600 MWh/a | `app/examples/district_heat_demand/make.py` |

## Columns (two-year ranges)

| Column | Unit | `sim_1*` / box | `sim_recovery_air` |
|---|---|---|---|
| `ITE_Ener` | kW IT | 1.3–62.7 (mean 38.3) | 2,000 idle – 5,000 peak (mean 3,623) |
| `HVAC_Ener` | kW cooling | sim_1/_modified 0.1–33; _air 0.1–13.5; _water 0.1–4.3 | 7.3 % of IT (2,280–2,354 MWh/a) |
| `IT_Load` | 0–1 | 0–1 (mean 0.52) | mean ~0.54, +0.06 over the two years |
| `In_Temp`, `Cool_Set` | °C | 19.8–29.0; setpoint 22–29 | setpoint held one to four weeks, then changed |
| `Heat_Demand` | kW | 2–186 (mean 19): half the IT heat a year | 203–14,713 (29,861–30,223 MWh/a) |
| `FC_Share` | 0–1 | free-cooled share (_air, _water) | same rule, on the water the recovery leaves |
| `HEX_<P>_T_in/T_out/m/Q` | °C, kg/s, kW | per extraction point | `hall` only |
| `Heat_rejected` | kW | (`sim_blank`) | 8,797–8,927 MWh/a |
| `Elec_Loss_Ener`, `Building_Ener` | kW | – | 9.5 % and 3.5 % of IT; `kpi` `other_power` |
| `Loop_T_cold` | °C | – | the loop's cold pipe, an input: 6–8 in winter, ~20 in summer |

`sim_blank` uses the interface names: `IT_load` (%), `T_outdoor`, `humidity`, `IT_power`, `Cooling_power`,
`Supply_temp`, `Return_temp`, `Water_flow`, `Heat_recovered` (derived), `Heat_rejected`.

## dataset.json keys used

`kind: simulation`, `actuators` (`Cool_Set`, `IT_Load`), `levers` (`Cool_Set`), `heat` (heat-side columns),
`plant`, `heat_source`, `derived` (`cp` 1.006 for air coils, 4.18 for water), `kpi`, and `blank` / `frame` (the drawing form).
See [interfaces](../interfaces/three-parts.md).

## Files per folder

`df_<id>.parquet` (`time` + numeric columns), `dataset.json`, `causal_graph.json` (+ `_manual`, `_pcmci`, `_pc`,
`_discovered` in `sim_1`/`sim_1_modified`), `equations.json`, `models/<name>.json` (`linear`, `xgb`, `phys`, …), `site.json`
(`heat_components`, `hex_option`, layout). `sim_district_heat` has no `site.json`.

## Notable facts per case

- **`sim_1_modified`**: the condenser Q has a ΔT of ~1.6 K, so Q is hard to predict (free-run nMAE 0.2–0.7) while its parts are easy.
  `HVAC_Ener` does not see the recovery. Accuracy table in `docs/concepts/simulated-heat-recovery.md`.
- **`sim_1_air`**: the condenser carries heat only while the chiller runs, little in winter (free cooling).
- **`sim_1_water`**: the hottest source (`HEX_Liq_T_in` 40–54 °C). The direct HEX can feed a low-temperature network.
- Site map sinks of `sim_1_modified` (1, 256 MWh/a), `sim_1_water` and `sim_box_water` (75, 12,056 MWh/a each): the
  nearest OSM buildings of `app/examples/recovery_air_cooled/district_buildings.json` (ODbL), the total split by floor
  area, 60 °C. They were Wärmeatlas buildings once (© LEA Hessen, not publishable): never a `wah-` sink in a `sim_*`.
- **`sim_recovery_air`**: `ITE + HVAC + Elec_Loss + Building = HEX_Hall_Q + Heat_rejected` exactly. A 5 MW DC in Frankfurt
  (IT 2,000–5,000 kW, mean 3,616 kW, its load 0.1–1: the hall's level held for weeks; the 750 kW case scaled by `SCALE` = 5000/750); server fans +0.6 %/K of inlet air above 24 °C;
  ERA5 weather (UTC; people, offices and the IT's day on Frankfurt's clock). PUE 1.21 (1.20 winter, 1.23 summer): cooling 7.7 %,
  electrical losses 9.5 % (2N UPS ~93.5 % efficient, 3 % transformers, PDUs), building 3.5 % of IT.
  `HEX_Hall_Q = min(Q_LOOP = 4,333 kW, hall heat, ε·m·cp·(T_in − Loop_T_cold))` on the CHW return (18 °C supply, ~30 °C return)
  into the cold pipe of a 5G loop; `Loop_T_cold` (an input) is 6–8 °C in winter (all the hall's heat recovered) and ~20 °C in
  summer (~68 % recovered, the free cooling and the chiller take the rest). 27,483–28,472 MWh/a recovered (ERF 0.73); the loop and
  the ground take the summer's surplus. `Heat_Demand` has no children: UA 520 kW/K on the 72 h mean, 2 K soft heating limit at 16 °C,
  400 kW DHW (~10 %), ~30,000 MWh/a; Heat Matching covers ~75 % of it (2024, both on `xgb`, `hp_5mw`: 75.8 %).
  Models `linear`, `phys`, `xgb` and `linear_all`, `xgb_all`, `sym` are trained on 2023; free-run R² of `HEX_Hall_Q` on 2024 is
  0.801 / 1.000 / 0.991 / 0.898 / 0.989 / 0.760; their evaluation is stored (`models/evaluation.json`); the graph keeps
  the lags 1–6 h Causal discovery found on 2023 (`LINKS`). The district's structure (`silver/district_structure`: `Out_Temp_mean24`,
  `Out_Temp_mean72`, `Is_Weekend`, `Hour`, lag 0, no own past) has the same six models (free-run R² of `Heat_Demand`
  0.881 / 0.983 / 0.993 / 0.904 / 0.993 / 0.878); its `site.json` `twin_model` is `xgb`. Site map sinks: 150 OSM residential buildings around the ECB (`app/examples/recovery_air_cooled/district_buildings.json`, ODbL), each with its share of the generated 2024 demand by floor area (heating limit 16 °C, 10 % DHW), 70/40 °C; never Wärmeatlas (`wah-`) sinks in a committed example; the DC's map temperature is the mean `HEX_Hall_T_in`, 30 °C. `streets.json` (from `app/examples/recovery_air_cooled/district_streets.json`, 750 OSM ways, ODbL): the heat network's streets ([heat-network planning](../recovery/heat-network-planning.md)). Test: `app/tests/test_example_recovery_air.py`.
- **`sim_district_heat`**: UA 95 kW/K × max(0, 18.3 °C − T24) on the residential day curve + 110 kW DHW, ~2 % AR(1) noise.
  Its weather is sim_1's with the two years swapped + ~1 K noise. Peak 4,990 kW (2023). `phys` fits b ≈ 102 kW/K, c ≈ 18.3 °C,
  d ≈ 106 kW (free-run R² 0.85); `linear` 0.63. Test: `app/tests/test_example_district_heat.py`.

## Regenerate

From `app/`: `bash scripts/guard.sh .venv/bin/python <script> [data dir] [--no-train]`, then `POST /api/datasets/refresh`.
The `make_sim_*` scripts need `sim_1/` (and `sim_1_air/`, `sim_1_water/` for blank/box).

## See also

- [Recovery + district: how to match them](recovery-and-district.md)
- [Air cooling](../cooling/air-cooling.md) · [Liquid cooling](../cooling/liquid-cooling.md)
- [Evaluation pitfalls](../modelling/evaluation-and-pitfalls.md)
- Human docs: `docs/concepts/simulated-heat-recovery.md`, `app/examples/recovery_air_cooled/README.md`, `app/examples/district_heat_demand/README.md`

## Sources

- The generators' docstrings, which give the literature range of every constant (ASHRAE TC 9.9, AHRI 550/590, CTI, Stull 2011, Buffa et al. 2019, Barroso et al. 2018).
- ERA5 (Hersbach et al. 2020) from the Open-Meteo historical weather API, CC BY 4.0 (`sim_recovery_air`'s weather).
- U.S. DOE EnergyPlus (source simulation of `sim_1`).
