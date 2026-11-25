---
title: Temperatures in IT and cooling (ASHRAE A1-A4, H1, W classes, CHW, condenser)
tags: [temperatures, ashrae, a1, a2, a3, a4, h1, w-classes, chilled-water, condenser, humidity, reference]
summary: One-page reference of the temperatures inside a data center - IT inlet classes, liquid W classes, air rise, chilled water, condenser and rejection - with the app's values.
---

# Temperatures in IT and cooling

## ASHRAE air classes (server inlet, cold aisle)

From ASHRAE TC 9.9 *Thermal Guidelines*, 5th ed. (2021); values summarised, check the book for the full envelopes.

| Class | Recommended | Allowable dry bulb | Allowable humidity | Max dew point |
|---|---|---|---|---|
| A1 (enterprise) | 18–27 °C | 15–32 °C | 8–80 % RH, −12 °C DP min | 17 °C |
| A2 (volume servers) | 18–27 °C | 10–35 °C | 8–80 % RH | 21 °C |
| A3 | 18–27 °C | 5–40 °C | 8–85 % RH | 24 °C |
| A4 | 18–27 °C | 5–45 °C | 8–90 % RH | 24 °C |
| H1 (high density, 2021) | 18–22 °C | 15–25 °C | 8–80 % RH | 17 °C |

- The recommended humidity for all classes is −9 °C to 15 °C dew point and up to 60 % RH (70 % allowed where gaseous contamination is low, 2021).
- Maximum rate of change: 20 K/h (5 K/h with tape drives), and no more than 5 K in 15 min. Altitude derating: the maximum drops 1 K per 300 m above 900 m.
- Most operators run 22–27 °C. EU CoC best practice: operate within the recommended range, design for the allowable one.

## Liquid (facility water supply) classes

| 2021 class | 2011 name | FWS supply | Typical cooling equipment |
|---|---|---|---|
| W17 | W1 | ≤ 17 °C | chiller, water-side economiser |
| W27 | W2 | ≤ 27 °C | chiller, economiser |
| W32 | W3 | ≤ 32 °C | cooling tower, chiller as trim |
| W40 | – | ≤ 40 °C | dry cooler, chiller in hot climates only |
| W45 | W4 | ≤ 45 °C | dry cooler |
| W+ | W5 | > 45 °C | dry cooler, heat reuse |

## Air and water inside the plant

| Where | Typical | Notes |
|---|---|---|
| Air rise across servers ΔT | 10–15 K (up to 20 K) | the app uses 12 K |
| Hot aisle / CRAH return | 30–45 °C | contained halls at the top end |
| Legacy raised-floor supply | 13–18 °C | without containment |
| Chilled water supply / return | 6/12 … 20/26 °C | the app uses 18/24 °C (`make_sim_cases.py`) |
| CRAH coil approach (return air − leaving water) | 3–8 K | the recovery example uses 6 K |
| Condenser water to / from chiller | 29.4 / 35 °C (AHRI rating) | from 27 °C (tower bypass) to 40–50 °C if run hot |
| Cooling tower leaving water | wet bulb + 3–6 K | CTI design: 25.6 °C WB → 29.4 °C |
| Dry cooler leaving water | dry bulb + 5–12 K | |
| Plate HEX approach | 1–3 K | |
| Refrigerant condensing (air-cooled) | 40–55 °C | |
| Direct-to-chip return | 35–60 °C | W40 + 10 K ≈ 50 °C |
| Chip case / junction limit | ~80–100 °C | vendor-specific |

## Outdoor design values (Germany, typical)

| Value | Typical | Use |
|---|---|---|
| Cooling design dry bulb | 32–35 °C (extreme 38–40 °C) | dry cooler sizing |
| Cooling design wet bulb | 21–23 °C | cooling tower sizing |
| Heating design outdoor temperature (DIN EN 12831 / DIN/TS 12831-1) | −10 to −16 °C by location | district peak load |
| Annual mean | 8–11 °C | free-cooling hours |

## In this app

- Air inlet: `In_Temp`, setpoint `Cool_Set` (22–29 °C in the sims); humidity `In_Hum`. `sim_recovery_air` follows the outdoor dew point over ~8 h, held at −9 to 15 °C dew point (make-up air unit).
- Outdoor: `Out_Temp`, `Out_Hum` (the sims' weather is a simulated EnergyPlus year: −17 to 46 °C, hotter than Central Europe;
  `sim_recovery_air` has Frankfurt's real weather of 2023 and 2024, ERA5, with `Out_Wind`, `Out_Wind_Dir`, `Out_Solar`).
  The shared weather variables are `T_outdoor`, `humidity`, `solar_radiation` (`WEATHER` in `app/web/src/lib/ports.ts`).
- Extraction temperatures in the sims (2-year range):

| Dataset · point | T_in (hot side) | T_out |
|---|---|---|
| `sim_1_air` · hall (air) | 32–41 °C | 28–41 °C |
| `sim_1_air` · condenser (water) | 27–48 °C | 27–48 °C |
| `sim_1_water` · liquid (water) | 40–54 °C | 40–54 °C |
| `sim_recovery_air` · hall (CHW return) | ~30 °C (mean) | 18 °C when all is recovered, warmer in summer |

## See also

- [District heating and heat pump temperatures](district-heating-and-heat-pumps.md)
- [Air cooling](../cooling/air-cooling.md) · [Liquid cooling](../cooling/liquid-cooling.md) · [Heat rejection](../cooling/heat-rejection.md)

## Sources

- ASHRAE TC 9.9: *Thermal Guidelines for Data Processing Environments*, 5th ed., 2021; *Liquid Cooling Guidelines*, 2nd ed.
- AHRI 550/590; CTI STD-201.
- DIN EN 12831-1:2017 with DIN/TS 12831-1 (national design outdoor temperatures).
- EU Code of Conduct for Data Centre Energy Efficiency, Best Practice Guidelines (JRC).
