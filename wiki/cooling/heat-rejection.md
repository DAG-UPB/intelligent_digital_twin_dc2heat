---
title: Chilled water, chillers, towers, dry coolers, free and adiabatic cooling
tags: [cooling, chilled-water, chiller, cop, cooling-tower, dry-cooler, free-cooling, economiser, adiabatic, evaporative, wue]
summary: The plant behind the room - chilled water loops, chiller COP, cooling towers, dry coolers, air- and water-side free cooling, adiabatic and evaporative cooling - with approaches, COPs and heat-recovery temperatures.
---

# The cooling plant: chilled water and heat rejection

## Chilled water (CHW)

| Design | Supply / return | Where |
|---|---|---|
| Classic comfort cooling | 6/12 °C or 7/12 °C | old halls, dehumidification needed |
| Raised data center CHW | 10/16, 12/18 °C | CRAH halls without containment |
| Warm CHW (free-cooling optimised) | 16/22 … 20/26 °C | contained halls, ASHRAE A1 inlet up to 27 °C |

Higher CHW → higher chiller COP (about +2–4 % per K) and more free-cooling hours. Above ~15 °C
supply no dehumidification happens at the coil (no condensate).

## Chillers

`COP = Q_cooling / P_el`. Carnot limit `COP_C = T_evap / (T_cond − T_evap)` (kelvin); real machines reach
about 0.45–0.6 of Carnot on fluid temperatures.

| Type | Rated point | COP (EER) | kW/ton |
|---|---|---|---|
| Water-cooled centrifugal | AHRI 550/590: CHW 6.7 °C out, CW 29.4 → 35 °C | 6–7 | 0.5–0.6 |
| Water-cooled screw | same | 5–6 | 0.6–0.7 |
| Air-cooled screw / scroll | 35 °C ambient | 2.8–3.5 | 1.0–1.25 |
| Any, on warm CHW (18 °C) and mild condenser | – | 7–10+ | < 0.5 |

Condenser heat = cooling load + compressor electricity = `Q · (1 + 1/COP)`. That is why the
condenser carries more heat than the IT and is warmer than the CHW, but only while the chiller runs.

## Heat rejection

| Device | Approach | Leaving water (typical design) | Water use | Fan power |
|---|---|---|---|---|
| **Cooling tower** (open, wet) | 3–6 K above **wet bulb** | 27–32 °C (CTI 35 → 29.4 °C at 25.6 °C wet bulb) | ~1.5–2 L per kWh rejected (evaporation ~1.5 + blowdown, drift) | 0.5–1.5 % of heat |
| Closed-circuit (fluid) cooler | 4–8 K above wet bulb | 28–34 °C | similar | 1–2 % |
| **Dry cooler** | 5–12 K above **dry bulb** | outdoor + 5–12 K | none | 1–3 % |
| **Adiabatic dry cooler** | wet pads/spray pre-cool the air to 2–4 K above wet bulb on hot days | lower than dry on peaks | only above a switch point (e.g. > 25 °C) | 1–3 % |
| Air-cooled condenser (DX/CRAC, air chiller) | condensing 10–15 K above dry bulb | refrigerant 40–55 °C | none | – |

Latent heat of water is 2.45 MJ/kg, so evaporating 1.47 kg rejects 1 kWh. Towers therefore drive
WUE (see [metrics](../datacenter/metrics.md)).

## Free cooling (economisers)

| Kind | How | Full free cooling when | Notes |
|---|---|---|---|
| **Water-side** (plate HEX) | tower or dry-cooler water cools the CHW through a plate HEX (approach 1–3 K) | loop water < CHW supply − approach | partial ("in series") when it is only below the CHW return: HEX pre-cools, chiller trims |
| Integrated free-cooling chiller | coil + compressor in one air-cooled unit | outdoor ~ CHW supply − 5…10 K | common in Europe |
| **Air-side direct** | filtered outside air into the hall | outdoor within the inlet envelope | humidity, pollution, filters; often with evaporative cooling |
| **Air-side indirect** | air-to-air HEX (plate, heat wheel); halls stay sealed | outdoor < supply − 2…4 K | often with evaporative spray on the outside air |
| **Evaporative / adiabatic** | water evaporates into the air (direct) or on the HEX (indirect) | wet bulb + approach below supply | WUE rises; in temperate climates on the few hottest days |

In Central Europe a plant with warm CHW (18/24 °C) can free-cool partially for most of the year and fully
for several thousand hours. The numbers depend strongly on climate and approach, so compute them from
weather data rather than quoting them.

**Heat recovery and free cooling compete.** Heat a recovery HEX takes never reaches the chiller or the tower,
which saves their electricity. But in winter, when the district wants most, the plant would have free-cooled
anyway, so the electricity saved per recovered kWh is small in winter and larger in summer.

## In this app

- Plant cases: `dataset.json` `plant` = `{cooling: air|liquid, heat_rejection: cooling_tower, free_cooling: plate_hex, chiller: trim}`.
- `app/scripts/make_sim_cases.py`:
  - constants: `T_CHWS, T_CHWR = 18, 24` °C, `PHE_APPROACH = 2` K, `ETA_CARNOT = 0.5`, `COP_MAX = 8`, `AUX = 0.02`;
  - free-cooled share: `FC_Share = clip((T_CHWR − PHE_APPROACH − T_tw) / (T_CHWR − T_CHWS), 0, 1)`, with `T_tw = T_wb + 4 K` (Stull wet bulb).
- `app/scripts/make_sim_1_modified.py`: `TOWER_APPROACH = 4` K (CTI 3.9 K), `T_CW_MIN = 27` °C, `DT_COND_DESIGN = 5.5` K (AHRI).
- Columns: `FC_Share`, `HVAC_Ener` (chiller + fans/pumps), `HEX_Cond_*` (condenser point, water `cp` 4.18).
- Condenser source in Heat Matching (`physicsSource`): `T = clip(Out_Temp + towerApproach, 15, 40) − approach`.
  It knows no free cooling, so it is a "chiller always on" estimate.
- Component preset *Data center as one unit* (a PUE rising above a free-cooling limit): `app/backend/core/component_library.py`.

## See also

- [Air cooling](air-cooling.md) · [Liquid cooling](liquid-cooling.md)
- [Temperatures in IT and cooling](../temperatures/it-and-cooling.md)
- [Heat pumps and storage](../recovery/heat-pumps-and-storage.md) (a chiller is a heat pump run for its cold side)

## Sources

- AHRI Standard 550/590 (I-P) / 551/591 (SI): chiller rating conditions.
- CTI (Cooling Technology Institute) STD-201; design 95/85/78 °F.
- ASHRAE Handbook HVAC Systems and Equipment (cooling towers, ch. 40); ASHRAE 90.4-2022; ASHRAE TC 9.9 *Thermal Guidelines*, 5th ed.
- R. Stull: "Wet-bulb temperature from relative humidity and air temperature", J. Appl. Meteor. Climatol. 50, 2011.
- S. T. Taylor: "Optimizing design & control of chilled water plants", ASHRAE Journal, 2011–2012 series.
- EU Code of Conduct for Data Centre Energy Efficiency, Best Practice Guidelines (JRC).
