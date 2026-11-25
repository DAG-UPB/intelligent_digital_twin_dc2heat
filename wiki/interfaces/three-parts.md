---
title: The interfaces between data center, heat distribution and district
tags: [interfaces, ports, connection-points, heat-source, derived, kpi, weather, dataset-json, site-json]
summary: What crosses each boundary of the app's three parts (two temperatures plus Q or m, the shared weather), and where each is defined in ports.ts, dataset.json and site.json.
---

# The interfaces between the three parts

The twin has three parts in the order the heat flows. They are joined at fixed **connection points**,
whatever model each part has inside.

```
 weather (T_outdoor needed; humidity, solar_radiation) ── shared by all three ──┐
                                                                                 ▼
 DATA CENTER ──waste heat──► HEAT DISTRIBUTION ──district heat──► DISTRICT
 IT_load in                  HEX · heat pump · tank             heat demand (profile or data)
 IT_power, Cooling_power,    P_el_hp (electricity in)           T_dh_supply / T_dh_return
 Heat_rejected out
```

## What crosses each boundary

Each point is **two temperatures plus the heat Q or the mass flow ṁ**; `Q = ṁ · cp · (T_supply − T_return)` gives the fourth.

| Point | From → to | Supply | Return | Heat | Flow | Defined by |
|---|---|---|---|---|---|---|
| Waste heat (one per extraction point) | data center → heat distribution | `t_in` (hot side in) | `t_out` | `q` | `m` | `dataset.json` `heat_source` |
| same, generic names | | `T_dc_supply` | `T_dc_return` | `Q_dc` | `m_dc` | `WASTE` / `heatPoints` in `ports.ts` |
| District heat | heat distribution → district | `T_dh_supply` | `T_dh_return` | `Q_demand` (district: `kpi.heat_demand`, or `Q_houses`) | `m_dh` | `heatPoints`, `districtPoint` |
| Weather | all three | `T_outdoor` (needed) | – | – | – | `WEATHER`; more: `wind_speed`, `wind_direction`, `hour` |

The data center also has its own inputs and outputs (`DC_INTERFACE`): `IT_load` (in, %), and out
`IT_power`, `Cooling_power` (kW) and `Heat_rejected` (kW, ≈ IT + cooling − recovered).

**Why the weather is shared:** outdoor temperature drives free cooling and the condenser (data center),
the network temperature and losses (distribution), and the demand (district). Humidity drives the
cooling tower's wet bulb; solar radiation the buildings' gains. If the data has no weather, the
Site map's weather is used (data, Open-Meteo, or a typical year).

## Mapping to the files

`dataset.json` (per dataset; see `sim_1_air`):

```json
"heat_source": {"hall": {"q": "HEX_Hall_Q", "t": "HEX_Hall_T_in", "t_in": "HEX_Hall_T_in", "t_out": "HEX_Hall_T_out", "m": "HEX_Hall_m"},
                "condenser": {"q": "HEX_Cond_Q", "t": "HEX_Cond_T_in", "t_in": "...", "t_out": "...", "m": "HEX_Cond_m"}},
"derived": {"HEX_Hall_Q": {"m": "HEX_Hall_m", "t_in": "HEX_Hall_T_in", "t_out": "HEX_Hall_T_out", "cp": 1.006},
            "HEX_Cond_Q": {"m": "HEX_Cond_m", "t_in": "HEX_Cond_T_in", "t_out": "HEX_Cond_T_out", "cp": 4.18}},
"kpi": {"it_power": "ITE_Ener", "cooling_power": "HVAC_Ener", "heat_demand": "Heat_Demand",
        "reuse": {"hall": "HEX_Hall_Q", "condenser": "HEX_Cond_Q"}, "power_unit": "kW"}
```

| Key | Meaning | Code |
|---|---|---|
| `heat_source` | extraction points → columns (`t` is the source temperature the matching uses, = `t_in`) | `dcPoints` in `ports.ts` |
| `derived` | calculated columns `Q = m · cp · (t_in − t_out)`: never a model target or input; computed from predicted parts | `app/backend/core/derived.py` |
| `kpi` | which column is IT power, cooling power, demand, reused heat | `app/backend/core/summary.py` |
| `plant` | cooling kind, heat rejection, free cooling, chiller | the built-in drawing |
| `site.json` `heat_source_map` | the user's mapping when `heat_source` is missing: `{kind: column, q, t, t_out}` or `{kind: delta, hot, cold}` | `app/web/src/lib/sourceMap.ts` |
| `site.json` `hex_option` | which extraction point is the reused one | |
| `site.json` `heat_components` | `{hex, hp, tank}` → component id that replaces the built-in formula | `app/web/src/pages/heat/partComponents.ts` |

Point ids `hall`, `condenser`, `liquid` have titles in `pointTitle` (`ports.ts`). Others get
`<Id> · heat source`. With no `heat_source` and no mapping, the point is `waste` under the generic
names, with nothing delivered yet.

## How each variable at a point is delivered

`deliveryOf` in `ports.ts` returns one of `data` (data-driven model), `physics`, `profile`, `measured` (a data
column left as it is), `calculated` (Q from ṁ and ΔT), `setting` (the district's supply/return from the Site
map), `weather` (Site map weather), or `missing`. `missingRoles` asks for both temperatures and Q or ṁ.
Modelling's *Connection points* card (`app/web/src/pages/datacenter/modelling/PortsCard.tsx`) shows this,
and missing ones are red.

## Units and conventions

- Q in kW per step, energy kWh = kW × step hours; ṁ in kg/s; T in °C; `cp` in kJ/(kg·K).
- The data center's **supply** at the waste-heat point is the **hot** side leaving the data center (`t_in` of the recovery HEX).
- Every lag ≥ 1: a value of hour t is caused by hour t−1 (AGENTS.md hard rule 3).

## See also

- [Heat transfer basics (Q = ṁ·cp·ΔT, cp of air vs water)](heat-transfer-basics.md)
- [Heat matching](../recovery/heat-matching.md)
- [App map for agents](../app/app-map.md)
- Human docs: `docs/concepts/heat-distribution.md` (connection points, extraction points).

## Sources

- The app's code: `app/web/src/pages/heat/ports.ts`, `app/backend/core/derived.py`, `docs/concepts/heat-distribution.md`.
- Q = ṁ·cp·ΔT: F. P. Incropera, D. P. DeWitt et al., *Fundamentals of Heat and Mass Transfer*.
