---
title: Heat transfer basics (Q = m cp dT, cp of air and water, HEX approach, epsilon-NTU)
tags: [physics, heat-transfer, cp, mass-flow, hex, approach, effectiveness, ntu, units]
summary: The few formulas and constants every interface calculation uses - Q = m cp dT, cp and density of air and water, HEX approach and effectiveness - with ready numbers.
---

# Heat transfer basics

## Q = ṁ · cp · ΔT

`Q [kW] = ṁ [kg/s] · cp [kJ/(kg·K)] · ΔT [K]`

| Medium | cp kJ/(kg·K) | Density kg/m³ | Volumetric kJ/(m³·K) | 1 kg/s at ΔT 1 K |
|---|---|---|---|---|
| Water, 20–50 °C | 4.18 (4.18–4.19, varies < 0.3 %) | 990–998 | ~4,150 | 4.18 kW |
| Water/propylene glycol 25 % | ~3.9–4.0 | ~1,020 | ~4,000 | ~3.95 kW |
| Dry air, 20–40 °C | 1.006 | 1.15–1.2 | ~1.2 | 1.006 kW |
| Moist air (per kg dry air) | 1.006 + 1.86·x | | | |

Water carries **~3,500 times** more heat per volume than air.

Ready numbers:

| Heat | Water, ΔT 6 K | Water, ΔT 10 K | Air, ΔT 12 K |
|---|---|---|---|
| 100 kW | 4.0 kg/s (14 m³/h) | 2.4 kg/s | 8.3 kg/s (~25,000 m³/h) |
| 1 MW | 40 kg/s (144 m³/h) | 24 kg/s | 83 kg/s (~250,000 m³/h) |

A **small ΔT** makes Q sensitive: at ΔT 1.6 K a 0.2 K error in one temperature is a 12 % error in Q.
That is why the app models the parts (ṁ, T_in, T_out) and calculates Q (`derived`), and why Q is the
hardest variable to predict (see [evaluation](../modelling/evaluation-and-pitfalls.md)).

## Heat exchangers

| Term | Meaning | Typical |
|---|---|---|
| Approach | hot inlet − cold outlet (counterflow, the closest point) | plate HEX 1–3 K; air coil 3–8 K; tower 3–6 K above wet bulb |
| Effectiveness ε | `Q / Q_max`, `Q_max = C_min · (T_hot,in − T_cold,in)`, `C = ṁ·cp` | plate HEX 0.8–0.9; air coil 0.5–0.75 |
| NTU | `UA / C_min` | |
| ε-NTU (counterflow) | `ε = (1 − e^(−NTU(1−Cr))) / (1 − Cr·e^(−NTU(1−Cr)))`, `Cr = C_min/C_max` | |
| LMTD | `(ΔT₁ − ΔT₂) / ln(ΔT₁/ΔT₂)`, `Q = UA · LMTD` | |

On an air-to-water coil, air is nearly always `C_min`, so the air side limits the heat.

## Storage

Water tank capacity: `E [kWh] = V [m³] · ρ · cp · (T_supply − T_return) / 3600`.
For example, 100 m³ at 70/40 °C ≈ 100 · 998 · 4.18 · 30 / 3600 ≈ **3.5 MWh**.

## Energy and power

- kWh = kW × hours. A sum of hourly kW values / 1000 = MWh (`e = dt / 1000` in `matchHeat`).
- 1 ton of refrigeration = 3.517 kW. kW/ton = 3.517 / COP.
- Electricity in a data center ends up as heat: `P_IT + P_cooling ≈ Q_recovered + Q_rejected`.

## In this app

- `derived` in `dataset.json` uses `cp` 1.006 for air coils and 4.18 for water. `app/backend/core/derived.py` `add_derived`.
- Literature constants: `CP_AIR = 1.006`, `CP_WATER = 4.18` in `app/scripts/make_sim_1_modified.py`.
- Component presets *Plate heat exchanger (ε-NTU, counterflow)* and *Thermal storage tank*: `app/backend/core/component_library.py`.
- Heat source by ΔT mapping: `f = ṁ·cp` in kW/K (water: 1 kg/s ≈ 4.19 kW/K), `site.json` `heat_source_map` kind `delta`.

## See also

- [The interfaces between the three parts](three-parts.md)
- [Heat pumps and storage](../recovery/heat-pumps-and-storage.md)

## Sources

- F. P. Incropera, D. P. DeWitt, T. L. Bergman, A. S. Lavine: *Fundamentals of Heat and Mass Transfer*, ch. 11.
- ASHRAE Handbook Fundamentals 2021, ch. 1 (psychrometrics), ch. 33 (physical properties).
- IAPWS-IF97 (water properties).
