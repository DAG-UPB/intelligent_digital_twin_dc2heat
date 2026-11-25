---
title: Data center metrics (PUE, ERF, ERE, WUE, REF, CUE)
tags: [metrics, kpi, pue, erf, ere, wue, ref, enefg, en50600, regulation]
summary: Definitions, typical values and legal thresholds of the data center KPIs, and how the app computes PUE (partial, or full with the facility's other electricity), ERF and ERE.
---

# Data center metrics

All are ratios of **energy** over a period (normally a year), not of power at one instant.
EN 50600-4-x and ISO/IEC 30134-x define the same KPIs with the same numbers.

| KPI | Formula | Best | Typical | Standard |
|---|---|---|---|---|
| **PUE** Power Usage Effectiveness | E_total facility / E_IT | 1.0 | 1.5–1.6 average (surveys); 1.1–1.2 hyperscale; 1.3–1.4 good new enterprise | EN 50600-4-2, ISO/IEC 30134-2 |
| **pPUE** partial PUE | (E_IT + E_subsystem) / E_IT | 1.0 | cooling only: 1.05–1.4 | EN 50600-4-2 |
| **ERF** Energy Reuse Factor | E_reused / E_total | 1.0 | 0 for most sites; 0.1–0.6 for schemes in operation | EN 50600-4-6, ISO/IEC 30134-6 |
| **ERE** Energy Reuse Effectiveness | (E_total − E_reused) / E_IT = PUE · (1 − ERF) | 0 | ≤ PUE; can fall below 1 | The Green Grid WP#29 |
| **WUE** Water Usage Effectiveness | site water [L] / E_IT [kWh] | 0 | 0 (dry/closed loop) to ~2 L/kWh (evaporative) | Green Grid WP#35, ISO/IEC 30134-9 |
| **REF** Renewable Energy Factor | E_renewable / E_total | 1.0 | depends on the tariff/PPA | EN 50600-4-3, ISO/IEC 30134-3 |
| **CUE** Carbon Usage Effectiveness | kg CO₂ / E_IT | 0 | grid factor × PUE | ISO/IEC 30134-8 |
| **CER** Cooling Efficiency Ratio | heat removed / cooling energy | high | 5–30 | EN 50600-4-7, ISO/IEC 30134-7 |

Notes that agents get wrong:

- PUE says nothing about the efficiency of the IT itself. Moving fans from the facility into the
  servers lowers PUE without saving energy.
- The ERF counts only heat that is actually **used** outside the data center's own boundary, not
  heat offered. Heat-pump electricity for upgrading belongs to the recipient's side in most schemes;
  state the boundary you use.
- PUE varies with the season (free cooling) and the IT load (fixed losses). A month's PUE is not a year's.
- ERE < 1 is possible with heavy reuse; ERF is the KPI the law uses.

## Legal thresholds (Germany and EU)

German **Energieeffizienzgesetz (EnEfG, 2023), § 11** for data centers from 300 kW of non-redundant
nominal connected load (check the current text, amendments have been under discussion):

| Requirement | Value |
|---|---|
| Existing (started before 1 July 2026): PUE | ≤ 1.5 from 1 July 2027; ≤ 1.3 from 1 July 2030 (annual mean) |
| New (started from 1 July 2026): PUE | ≤ 1.2 (reached within two years of start) |
| New: ERF | ≥ 10 % (start from 1 July 2026), ≥ 15 % (from 1 July 2027), ≥ 20 % (from 1 July 2028) |
| Electricity from renewables | 50 % from 2024, 100 % from 2027 |
| Also | energy management system, annual reporting to a register, offer waste heat to network operators |

**EU:** Energy Efficiency Directive (EU) 2023/1791, Art. 12: data centers from 500 kW report
KPIs yearly into a European database. Delegated Regulation (EU) 2024/1364 lists them
(energy, PUE, ERF, WUE, REF, temperatures) and counts only reused heat.

## In this app

- `app/backend/core/summary.py` `kpis()` computes over the rows where all columns are present:
  - **PUE (partial)** = (IT + cooling) / IT, because the data usually holds only those two meters (ISO/IEC 30134-2);
  - **ERF** = reused / (IT + cooling) (ISO/IEC 30134-6);
  - **ERE** = (IT + cooling − reused) / IT (Green Grid).
- With `other_power` mapped (the facility's other electricity: UPS and distribution losses, lighting,
  building; a column or a list, summed) and the cooling, E_total = IT + cooling + other: the card is
  **PUE** (total facility ÷ IT, the full ISO/IEC 30134-2 one), ERF = reused / E_total, ERE = (E_total − reused) / IT.
  Without it everything stays partial. The web recomputes the same per period and per Scenarios run
  (`web/src/pages/datacenter/dashboard/whatIf.ts` `kpisOf`); the formulas with the bound names are
  `web/src/pages/datacenter/modelling/kpiVariables.ts` `kpiFormulas`.
- Which column plays which role: `dataset.json` `kpi` = `{it_power, cooling_power, other_power, heat_demand, heat_power, reuse: {point: column}, power_unit}`,
  set on the Dashboard (*Choose the KPI variables*, `PUT .../kpi`) or in Modelling's KPI variables card. Without `heat_power` the reused
  heat is one point of `reuse`, chosen by `site.json` `hex_option`, else `condenser`, else the first.
- Heat distribution and district KPIs (COP, waste heat used, demand covered, CO₂ saved): `app/web/src/lib/partKpis.ts`,
  see [heat matching](../recovery/heat-matching.md#kpis).
- `sim_recovery_air` maps `other_power` (`Elec_Loss_Ener`, `Building_Ener`), so its Dashboard shows the full PUE;
  its numbers move with `examples/recovery_air_cooled/make.py`: read them on the Dashboard (`GET .../summary`).

## See also

- [How a data center works](overview.md)
- [Heat matching and its KPIs](../recovery/heat-matching.md)
- [Glossary](../glossary.md)

## Sources

- EN 50600-4-2 (PUE), -4-3 (REF), -4-6 (ERF), -4-7 (CER); ISO/IEC 30134-2, -3, -6, -7, -8, -9.
- The Green Grid: White Paper #29 *ERE: a metric for measuring the benefit of reuse energy* (2010); WP#35 *WUE* (2011); WP#49 *PUE: a comprehensive examination* (2012).
- Energieeffizienzgesetz (EnEfG) vom 13.11.2023, BGBl. 2023 I Nr. 309, §§ 11–13.
- Directive (EU) 2023/1791, Art. 12 and Annex VII; Commission Delegated Regulation (EU) 2024/1364.
- Uptime Institute Global Data Center Survey (average PUE ~1.55–1.6 since 2019).
