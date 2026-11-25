---
title: How a data center works
tags: [datacenter, power, ups, it-load, cooling, heat-balance, basics]
summary: The power chain from grid to server, the IT load and its daily and weekly rhythm, the cooling chain, and where the heat appears.
---

# How a data center works

A data center turns electricity into computing and heat. In practice all of the electricity
becomes heat inside the building (the energy that leaves as data or light is negligible). The
cooling plant moves that heat outside, where it is rejected to the air or reused.

## Power chain

| Stage | Typical values | Losses (become heat) |
|---|---|---|
| Grid connection | MV 10–30 kV; very large sites 110 kV | – |
| Transformer MV/LV | 400/230 V AC | ~1 % |
| Main LV switchboard, gensets | diesel backup, start in 10–15 s | – |
| UPS (static, double conversion) | battery for 5–15 min | 3–6 % (ECO mode ~1–2 %) |
| PDU / busway, rack PDU | 230/400 V to the rack | ~1 % |
| Server PSU | 80 PLUS Platinum/Titanium | 4–8 % |
| IT (CPU, GPU, memory, disks, fans) | rack 5–15 kW air, 30–130+ kW liquid (AI) | – |

Redundancy is N, N+1, 2N or 2(N+1). Availability is graded in EN 50600-1 classes 1–4, or Uptime
Institute Tier I–IV. Redundant plant runs at part load, so UPS and chiller efficiency matter at
30–60 % load and not only at the rated point.

## IT load

- **Server power curve.** Roughly linear: `P = P_idle + (P_peak − P_idle) · u`, with u the
  utilisation from 0 to 1. Idle is about 30–60 % of peak (Barroso et al.), so facility IT power
  moves much less than CPU utilisation does.
- **Daily rhythm.** Enterprise and web loads peak in business hours. The swing in facility IT
  power is typically ±5–20 % around the mean. Batch and backup jobs run at night.
- **Weekly rhythm.** Weekends dip by a few per cent (enterprise). Cloud and colocation are flatter.
- **HPC and AI training.** Nearly flat and high (70–95 % of capacity), with steps when jobs start or stop.
- **Long term.** Colocation halls fill over years. Contracted capacity is often used at only 40–70 %
  in the first years, which matters for sizing heat recovery.
- **Consequence for heat reuse.** The waste heat is a near-constant base load. The district's
  demand is strongly seasonal (see [seasonality](../recovery/heat-matching.md#seasonality)).

## Cooling chain

| Step | What moves the heat | Page |
|---|---|---|
| Chip → air or liquid | server fans; cold plates; immersion fluid | [air](../cooling/air-cooling.md), [liquid](../cooling/liquid-cooling.md) |
| Room air → water | CRAH coil, in-row cooler, rear-door HEX (CRAC: straight to refrigerant) | [air](../cooling/air-cooling.md) |
| Facility water / chilled water loop | pumps, buffer tank, CDU | [plant](../cooling/heat-rejection.md) |
| Lift (when the outside is too warm) | chiller compressor; adds its electricity to the heat | [plant](../cooling/heat-rejection.md) |
| Rejection | cooling tower (wet), dry cooler, adiabatic dry cooler | [plant](../cooling/heat-rejection.md) |
| Reuse | HEX or heat pump to a heating network | [interfaces](../interfaces/three-parts.md) |

## Where the heat appears (extraction points)

| Point | Medium | Typical temperature | Share of the heat |
|---|---|---|---|
| Hot aisle / CRAH return air | air | 30–45 °C | all IT heat (air-cooled) |
| Chilled-water return | water | 12–24 °C (warm CHW up to ~27 °C) | IT heat + fans |
| Condenser water (chiller to tower) | water | 30–38 °C (up to 45–50 °C if run hot) | IT + chiller electricity, **only while the chiller runs** |
| Direct-to-chip facility water | water/glycol | 40–60 °C return | 70–80 % of server heat |
| Immersion | dielectric → water | 35–50 °C | ~95–100 % |
| UPS / transformer rooms | air | 25–35 °C | a few % |

Energy balance, every step: `P_IT + P_cooling (+ losses) ≈ Q_recovered + Q_rejected`.

## In this app

- The data center's standard interface: `DC_INTERFACE` in `app/web/src/pages/heat/ports.ts`
  (`IT_load` in; `IT_power`, `Cooling_power`, `Heat_rejected` out). `Heat_rejected ≈ IT_power + Cooling_power − recovered`.
- Simulation columns: `ITE_Ener` (IT kW), `HVAC_Ener` (cooling kW), `IT_Load` (0–1), `In_Temp`,
  `Cool_Set`, `Out_Temp`, `Out_Hum` (see [datasets](../datasets/examples.md)).
- `dataset.json` `kpi`: `it_power`, `cooling_power`, `heat_demand`, `reuse` (per extraction point), `power_unit`.
- The server power curve in code: `app/examples/recovery_air_cooled/make.py` (2,000 kW idle, 5,000 kW peak).
- Human docs: `docs/concepts/datacenter-variables.md` (stages, variable names, where they go on the P&ID).

## See also

- [Metrics: PUE, ERF, WUE, REF](metrics.md)
- [Air cooling](../cooling/air-cooling.md) · [Liquid cooling](../cooling/liquid-cooling.md) · [Heat rejection](../cooling/heat-rejection.md)
- [Temperatures in IT and cooling](../temperatures/it-and-cooling.md)
- [IT load profiles](../profiles/profile-generator.md#it-load-and-waste-heat)

## Sources

- EN 50600-1 (availability classes), EN 50600-2-2 / -2-3 (power, environmental control).
- L. A. Barroso, U. Hölzle, P. Ranganathan: *The Datacenter as a Computer*, 3rd ed., 2018 (server power curve, idle share).
- X. Fan, W.-D. Weber, L. A. Barroso: "Power provisioning for a warehouse-sized computer", ISCA 2007.
- Uptime Institute: Tier Standard: Topology; Global Data Center Survey (yearly).
