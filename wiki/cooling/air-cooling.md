---
title: Air cooling (CRAC/CRAH, raised floor, containment, in-row, rear door)
tags: [cooling, air, crac, crah, raised-floor, containment, in-row, rear-door, heat-recovery, temperatures]
summary: The air-side cooling architectures, their supply and return temperatures, rack densities, and where and at what temperature heat can be extracted.
---

# Air cooling

Servers draw room air through the front with their own fans and blow it out at the back,
10–15 K warmer (up to ~20 K at high load). The air units cool it again. The temperature the
racks see is the **inlet** (cold-aisle) temperature; ASHRAE recommends 18–27 °C
(see [temperatures](../temperatures/it-and-cooling.md)).

## Architectures

| Architecture | How | Supply air | Return air | Rack density | Heat leaves as |
|---|---|---|---|---|---|
| **CRAC** with raised floor | DX unit: refrigerant coil + compressor in the room; supply under the floor, perforated tiles | 13–18 °C (legacy) | 22–30 °C | 2–8 kW | refrigerant → condenser outside (air-cooled, 40–50 °C condensing) |
| **CRAH** with raised floor | chilled-water coil + fans; no compressor in the room | 15–22 °C | 25–32 °C | 3–10 kW | chilled water 7/12 … 12/18 °C |
| **Hot/cold aisle containment** (HAC or CAC) | doors and roofs keep cold and hot air apart; no mixing | 18–27 °C | 30–45 °C | 5–20 kW | chilled water 14/20 … 20/26 °C |
| **Fan wall / AHU** (hyperscale) | large air handlers in a wall, often with direct or indirect air-side economiser | 20–27 °C | 32–45 °C | 5–20 kW | outside air, or water |
| **In-row cooler** | CRAH units between racks, short air path | 18–27 °C | 30–40 °C | 10–30 kW | chilled water |
| **Rear-door HEX** (passive or active) | water coil in the rack door; exhaust air cooled to room temperature | room 22–27 °C | (coil) 35–45 °C in | passive ~15–20 kW, active up to 40–75 kW | water 15–20 °C supply, 20–30 °C return |

Rules of thumb:

- Air volume: `V̇ = Q / (ρ · cp · ΔT)`. 1 kW at ΔT 12 K needs ~0.07 m³/s (~250 m³/h).
- Without containment, 20–40 % of the cold air bypasses the racks or recirculates. Supply then has
  to be colder, which costs chiller energy and free-cooling hours.
- Each +1 K of chilled-water supply saves about 2–4 % of chiller energy (rule of thumb) and adds free-cooling hours.
- CRAH fans are 1–4 % of the IT power (EC fans); a heat-recovery coil in the air path adds 50–150 Pa of pressure drop.

## Heat recovery from air cooling

| Where | Temperature you get | Notes |
|---|---|---|
| Hot aisle / CRAH return air (air-to-water coil) | water 25–35 °C (air 30–45 °C minus 3–8 K approach) | all the IT heat; low temperature; air is a poor heat carrier (`cp` 1.006 kJ/kg K) |
| Chilled-water return | 12–24 °C; warm CHW and containment 24–30 °C | the easiest tap; needs a heat pump for 3G/4G networks, fits 5G loops directly |
| Condenser water / refrigerant condenser | 30–38 °C, up to 45–50 °C if run hot | IT + compressor heat, only while the chiller runs; running it hot costs chiller COP (~2–3 % per K) |
| Desuperheater on the chiller | 50–70 °C | only ~10–15 % of the condenser heat |

Air-cooled heat is low grade. For a 3G/4G network it nearly always needs a heat pump; the lift is
the largest of all architectures (see [heat pumps](../recovery/heat-pumps-and-storage.md)).

## In this app

- Air-cooled examples: `sim_1_air`, `sim_box_air`, `sim_1_modified`, `sim_recovery_air` (`dataset.json` `plant.cooling: "air"`).
- Extraction point `hall` (`HEX_Hall_T_in`, `HEX_Hall_T_out`, `HEX_Hall_m`, `HEX_Hall_Q`):
  - in `sim_1_air`/`sim_1_modified` it is an air coil, so `cp` is 1.006 in `derived`;
  - in `sim_recovery_air` it is a water HEX on the chilled-water return (18 °C supply, ~30 °C return), so `cp` is 4.18.
- Built-in drawing of the air-cooled plant: `DrawnEquipment` in `app/web/src/pages/datacenter/structure/`.
- Calculation of the hall source in Heat Matching (`physicsSource` in `app/web/src/lib/matching.ts`):
  `Q = η · IT`, `T = In_Temp + rackΔT − approach` (defaults η 0.8, rackΔT 12 K, approach 3 K).
- Derivations and sources of the simulated coils: `docs/concepts/simulated-heat-recovery.md`.

## See also

- [Liquid cooling](liquid-cooling.md) · [Heat rejection and free cooling](heat-rejection.md)
- [Temperatures in IT and cooling](../temperatures/it-and-cooling.md)
- [Heat transfer basics](../interfaces/heat-transfer-basics.md)

## Sources

- ASHRAE TC 9.9: *Thermal Guidelines for Data Processing Environments*, 5th ed., 2021.
- ASHRAE Standard 90.4-2022: *Energy Standard for Data Centers*.
- EN 50600-2-3 (environmental control); EU Code of Conduct for Data Centre Energy Efficiency, Best Practice Guidelines (JRC, yearly).
- Upsite Technologies / AKCP application notes on ΔT across servers (10–15 K).
- Schneider Electric White Papers 130 (*Choosing between room, row and rack-based cooling*) and 135 (*Hot vs cold aisle containment*).
