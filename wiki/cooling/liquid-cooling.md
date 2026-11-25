---
title: Liquid cooling (direct-to-chip, immersion, CDU, W classes)
tags: [cooling, liquid, direct-to-chip, cold-plate, immersion, cdu, w-classes, heat-recovery, temperatures]
summary: Direct-to-chip and immersion cooling, the facility and technology water loops, ASHRAE W classes, and the high-temperature heat they offer for recovery.
---

# Liquid cooling

Water carries ~3,500 times more heat per volume than air (see [heat transfer](../interfaces/heat-transfer-basics.md)),
so a liquid loop at the chip can run warm and still keep the chip below its limit
(case or junction ~80–100 °C). Warm water means free cooling all year and recoverable heat at 40–60 °C.

## Loops

| Loop | Abbrev. | Fluid | Between |
|---|---|---|---|
| Technology cooling system | TCS | water or PG25 (propylene glycol 25 %), very clean | cold plates ↔ CDU |
| Coolant distribution unit | CDU | plate HEX + pumps, in-rack, in-row or central | TCS ↔ FWS; approach 2–5 K |
| Facility water system | FWS | water (glycol outside) | CDU ↔ plant (dry cooler, tower, HEX to a network) |

The **W class** is the facility water **supply** temperature the IT is designed for.

| ASHRAE class (2021) | Older name (2011) | FWS supply max | Typical heat rejection | Recovery temperature (return) |
|---|---|---|---|---|
| W17 | W1 | 17 °C | chiller + economiser | 22–27 °C |
| W27 | W2 | 27 °C | chiller + economiser | 32–37 °C |
| W32 | W3 | 32 °C | cooling tower / dry cooler, chiller rarely | 37–42 °C |
| W40 | – | 40 °C | dry cooler, no chiller in most climates | 45–50 °C |
| W45 | W4 | 45 °C | dry cooler all year | 50–55 °C |
| W+ | W5 | > 45 °C | dry cooler; built for heat reuse | 55–65 °C |

## Architectures

| Architecture | Captures | Typical temperatures | Density | Notes |
|---|---|---|---|---|
| **Direct-to-chip (cold plate)**, single-phase | 70–80 % of server heat (CPU, GPU, often memory, VRM); rest still air | FWS 25–45 °C in, ΔT 5–10 K | 30–130+ kW per rack (AI) | the remaining air share needs CRAH/rear door; a "hybrid" data center |
| Direct-to-chip, two-phase | same | refrigerant evaporates at the plate, ~15–50 °C | high | small market |
| **Single-phase immersion** | ~95–100 % (no server fans) | dielectric oil 35–50 °C; water side 30–45 °C | 50–100 kW per tank | fluid weight, servicing, warranty |
| **Two-phase immersion** | ~100 % | fluid boils at ~50–60 °C, condenser water 30–45 °C | 100+ kW | fluorinated fluids; PFAS restrictions make it rare |
| Rear-door HEX (water to the rack, not the chip) | the rack's air | 15–20 °C supply | up to 40–75 kW active | see [air cooling](air-cooling.md) |

## Heat recovery from liquid cooling

- Direct-to-chip facility return at **40–60 °C** can feed a 4G network (50–70 °C supply)
  with a small heat pump lift, or directly when the network runs at low temperature. It fits
  5G loops and buildings with floor heating directly.
- The air share (20–30 %) is still low grade (see [air cooling](air-cooling.md)), so a hybrid hall has
  **two** extraction points at different temperatures.
- Higher FWS temperature → better heat and more free cooling, but less margin on the chip; the
  operator's W class is a contract with the IT vendor.

## In this app

- Liquid-cooled examples: `sim_1_water`, `sim_box_water` (`dataset.json` `plant.cooling: "liquid"`).
- Extraction point `liquid` (`HEX_Liq_T_in`, `HEX_Liq_T_out`, `HEX_Liq_m`, `HEX_Liq_Q`, `cp` 4.18):
  - cold plates take 75 % of the IT heat on facility water;
  - the FWS is 40 °C (W40), rising with the wet bulb up to 45 °C (W45);
  - the return is ~45–54 °C. The rest goes through rear doors on chilled water to the `condenser` point.
- Generator and constants: `app/scripts/make_sim_cases.py` (`LIQUID_SHARE`, `T_FWS_MIN`, `T_FWS_MAX`).
- Calculation of the liquid source (`physicsSource` in `app/web/src/lib/matching.ts`):
  `Q = η · f · IT`, `T = clip(Out_Temp + facilityApproach, tFacility, 45) + liquidΔT − approach`
  (defaults f 0.75, tFacility 40 °C, liquidΔT 10 K). The constant `T_FACILITY_MAX = 45` is W45.
- Built-in drawing: `DrawnLiquid` + `liquidLayout.ts` in `app/web/src/pages/datacenter/structure/`.

## See also

- [Air cooling](air-cooling.md) · [Heat rejection](heat-rejection.md)
- [Temperatures in IT and cooling](../temperatures/it-and-cooling.md)
- [District heating temperatures](../temperatures/district-heating-and-heat-pumps.md)

## Sources

- ASHRAE TC 9.9: *Liquid Cooling Guidelines for Datacom Equipment Centers*, 2nd ed.; *Thermal Guidelines*, 5th ed., 2021 (W17–W+ classes).
- ASHRAE TC 9.9 white paper *Emergence and Expansion of Liquid Cooling in Mainstream Data Centers* (2021).
- Open Compute Project, Advanced Cooling Solutions: cold-plate and immersion requirements documents.
- EU Code of Conduct for Data Centre Energy Efficiency, Best Practice Guidelines (JRC).
