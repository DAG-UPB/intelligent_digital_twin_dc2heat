---
title: District heating temperatures (3G/4G/5G, LTDH) and heat pump lift and COP
tags: [temperatures, district-heating, 3gdh, 4gdh, 5gdhc, ltdh, heat-pump, cop, carnot, lift, dhw, legionella]
summary: Supply and return temperatures of district heating generations, the hot-water constraint, and how lift sets a heat pump's COP via the Carnot fraction, with worked numbers and the app's formula.
---

# District heating temperatures and heat pump COP

## Network generations

| Generation | Era | Supply | Return | Carrier / notes |
|---|---|---|---|---|
| 1G | 1880–1930 | steam, up to ~200 °C | condensate | steam |
| 2G | 1930–1970s | > 100 °C | 70–80 °C | pressurised hot water |
| **3G** | 1970s– (most German networks) | 70–120 °C, sliding with outdoor (e.g. 110 °C at −12 °C, 70–80 °C in summer) | 40–60 °C | pre-insulated steel pipes |
| **4G / LTDH** | 2020s– | 50–70 °C | 25–40 °C | low losses, renewables, waste heat; low-temperature-ready buildings |
| ULTDH | – | 35–50 °C | 20–30 °C | booster heat pumps for hot water in each building |
| **5GDHC** (cold / anergy network) | 2010s– | 5–30 °C (ambient loop, often 10–25 °C) | a few K below | decentral heat pumps in each building; bidirectional, also cooling |

- **Hot water constraint.** Large DHW systems keep ≥ 60 °C at the storage outlet and ≥ 55 °C in the
  circulation (DVGW W 551, legionella). So a network must supply about 65 °C, unless the buildings boost
  locally (heat pump, electric) or use fresh-water stations with small volumes.
- **Return temperature** decides capacity (`Q = ṁ·cp·ΔT`) and how much low-grade heat a network can take.
  A 70/40 network has twice the ΔT of a 70/55 one.
- **Heat losses** are ~10–25 % of the heat sold (3G); lower in 4G, near zero or even negative in 5G.
- **Where data center heat fits:** 5G loops directly (chilled-water return, 12–30 °C); 4G with a heat pump,
  or directly from liquid cooling at 45–60 °C; 3G always with a heat pump (lift 40–70 K).

## Heat pumps: lift, COP and the Carnot fraction

`COP_heating = Q_heat / P_el`. Carnot: `COP_C = T_sink / (T_sink − T_source)` in kelvin. A real machine
reaches `COP = η_C · COP_C`, with the Carnot fraction (exergetic efficiency) **η_C**:

| Machine | η_C (typical) |
|---|---|
| Small domestic air/water | 0.35–0.45 |
| Domestic brine/water | 0.45–0.55 |
| Large DH heat pumps (NH3, R134a, 0.5–90 MW) | 0.5–0.68 (app presets 0.52–0.68) |

Use fluid temperatures (source inlet, sink outlet) for a quick estimate. Lorenz (log-mean) temperatures
handle the glide better when ΔT on each side is large.

Worked COPs at η_C = 0.5 (the app's default), sink = network supply:

| Source | Sink | Lift | COP_C | COP (η 0.5) |
|---|---|---|---|---|
| 12 °C (5G loop) | 70 °C | 58 K | 5.9 | 3.0 |
| 20 °C (CHW return) | 70 °C | 50 K | 6.9 | 3.4 |
| 30 °C (hot aisle water) | 70 °C | 40 K | 8.6 | 4.3 |
| 30 °C | 90 °C (3G winter) | 60 K | 6.1 | 3.0 |
| 45 °C (D2C) | 70 °C | 25 K | 13.7 | 6.9 |
| 30 °C | 55 °C (4G) | 25 K | 13.1 | 6.6 |

- Heat delivered = source heat + electricity: `Q_heat = Q_source · COP / (COP − 1)`.
- Single-stage practical lift is ~50–60 K; large units reach 85–90 °C supply, a few more with special refrigerants.
- **SPF** (seasonal performance factor, *Jahresarbeitszahl*) = annual heat / annual electricity: the honest yearly COP.
- Each 1 K less lift is roughly +2–3 % COP. So the return temperature of the network and the source
  temperature of the data center matter as much as the machine.

## In this app

- `carnotCop` in `app/web/src/lib/matching.ts`: `COP = clamp(η_C · (T_supply + 273.15) / max(T_supply − T_src, 5 K), 1.1, 8)`; `DEFAULT_OPTIONS.carnotEff = 0.5`.
- Direct use (no heat pump) when `T_src ≥ T_supply + approach` (approach default 5 K); with a HEX component, when its `T_cold_out ≥ T_supply`.
- District network temperatures: `DistrictSettings.supplyTemp` / `returnTemp` in `app/web/src/lib/demand.ts` (default **70/40 °C**), set per heat sink on the Site map.
  Generic port names are `T_dh_supply`, `T_dh_return`, `m_dh` (`app/web/src/pages/heat/ports.ts`).
- Heat pump presets `hp_0_5mw` … `hp_90mw` with η_C from published operating points: `app/backend/core/component_library.py`, table in `docs/concepts/components.md`.
- The recovery example's district side is the cold pipe of a 5G loop, `Loop_T_cold` (an input; `LOOP_*` in `app/examples/recovery_air_cooled/make.py`):
  6–8 °C in winter, ~20 °C in summer, when the loop gets more heat than the buildings' heat pumps take out.

## See also

- [Heat pumps and storage in the matching](../recovery/heat-pumps-and-storage.md)
- [Temperatures in IT and cooling](it-and-cooling.md)
- [The interfaces between the three parts](../interfaces/three-parts.md)

## Sources

- H. Lund et al.: "4th Generation District Heating (4GDH)", Energy 68, 2014.
- S. Buffa et al.: "5th generation district heating and cooling systems: a review", Renew. Sustain. Energy Rev. 104, 2019.
- A. David, B. V. Mathiesen, H. Averfalk, S. Werner, H. Lund: "Heat Roadmap Europe: large-scale electric heat pumps in district heating systems", Energies 10(4), 2017.
- Danish Energy Agency: *Technology Data for Generation of Electricity and District Heating*, ch. 40 (heat pumps).
- DVGW Arbeitsblatt W 551 (drinking water heating, legionella).
- AGFW Hauptbericht (yearly statistics of German district heating).
