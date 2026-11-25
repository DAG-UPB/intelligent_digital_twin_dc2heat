---
title: Wiki index (start here)
tags: [index, map, start]
summary: Entry page of the agents' wiki - every page grouped by topic, one line each.
---

# Wiki for agents: index

Dense domain knowledge for AI agents working on or with this app: how data centers, cooling and district heating
work, with numbers, and where each topic lives in the code. Human docs are in `docs/`. This wiki links to them instead of repeating them.
Search with `wiki_search`, read with `wiki_read` (MCP), or grep `wiki/`. How to add a page: [README](README.md).

## Data center

- [How a data center works](datacenter/overview.md): power chain, IT load rhythm, cooling chain, where heat appears.
- [Metrics: PUE, ERF, ERE, WUE, REF, CUE](datacenter/metrics.md): formulas, typical values, EnEfG/EU thresholds, how the app computes them.

## Cooling architectures

- [Air cooling](cooling/air-cooling.md): CRAC/CRAH, raised floor, containment, in-row, rear door; recovery temperatures.
- [Liquid cooling](cooling/liquid-cooling.md): direct-to-chip, immersion, CDU, W classes; 40–60 °C heat.
- [Chilled water, chillers, towers, dry coolers, free and adiabatic cooling](cooling/heat-rejection.md): approaches, COPs, water use.

## Temperatures

- [IT and cooling temperatures](temperatures/it-and-cooling.md): ASHRAE A1–A4/H1, W17–W+, CHW, condenser, the sims' ranges.
- [District heating and heat pumps](temperatures/district-heating-and-heat-pumps.md): 3G/4G/5G/LTDH, DHW limit, lift, Carnot COP table.

## Interfaces between the three parts

- [Data center → heat distribution → district](interfaces/three-parts.md): connection points, `ports.ts`, `heat_source`/`derived`/`kpi`.
- [Heat transfer basics](interfaces/heat-transfer-basics.md): Q = ṁ·cp·ΔT, cp of air vs water, HEX approach, ε-NTU, tank capacity.

## Heat recovery and matching

- [Heat matching](recovery/heat-matching.md): the `matchHeat` algorithm, coverage/surplus/unmet, CO₂ factors, seasonality.
- [Heat pumps, HEX and storage](recovery/heat-pumps-and-storage.md): the three units, presets `hp_*`, defaults.
- [Heat-network planning on the Site map](recovery/heat-network-planning.md): streets → route, buildings, DN, heat pump, BEW, NPV, break-even, LCOH.

## Modelling

- [Approaches and models](modelling/approaches.md): data-driven, physical, semi-physical, profile; `linear`/`xgb`/`tabpfn`/`phys`/`sym`.
- [Evaluation and R² pitfalls](modelling/evaluation-and-pitfalls.md): one-step vs free run, setpoint windows, traps.
- [Causal graphs and lag discovery](modelling/causal-graphs.md): lag signs, file format, PC/PCMCI, drivers.
- [Simulate with interventions and drivers](modelling/simulate-and-drivers.md): `simulate`, `drivers` from another dataset, Monte Carlo.

## Profiles

- [Heat demand profiles](profiles/heat-demand-profiles.md): BDEW SLP, degree days, hot water, day/week curves, VDI 4655, DIN EN 12831.
- [Profile generator, IT load, district demand](profiles/profile-generator.md): `lib/profile.ts`, presets, `lib/demand.ts`.

## Example datasets

- [The example datasets](datasets/examples.md): every `app/data/sim_*`, columns, plants, generators.
- [Matching `sim_recovery_air` with `sim_district_heat`](datasets/recovery-and-district.md): click path, MCP steps, expected numbers.

## The app

- [App map for agents](app/app-map.md): pages and routes, work order, MCP tools, safety rules.
- [Glossary (EN/DE)](glossary.md): Abwärme, Wärmenetz, Vorlauf/Rücklauf, Wärmepumpe, Wärmeatlas, abbreviations.
