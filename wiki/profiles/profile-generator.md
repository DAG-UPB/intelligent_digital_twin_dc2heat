---
title: The app's profile generator, IT load profiles and district demand
tags: [profiles, profile-generator, it-load, waste-heat, district-demand, presets, app, demand-ts]
summary: How lib/profile.ts turns a total per period into a curve (hour, weekday, month, weather driver), the presets including BDEW and the data center waste-heat shape, IT load profiles, and the district demand generator.
---

# Profile generator, IT load profiles and district demand

## The generator (`app/web/src/lib/profile.ts`, pure)

A **total over a period** (for all, or per unit × units) is spread over time so the period sums exactly to it.

| Field (`ProfileSpec`) | Meaning |
|---|---|
| `total`, `unit` | e.g. 12000 kWh (curve in kW: `rateUnit`), 8760 MWh, m³ |
| `per` | `day`, `week`, `month`, `year` |
| `perUnit`, `units` | total per house/flat/office × the number |
| `parts[]` | e.g. space heating + hot water, each with a `share` (normalised) |

Each `ProfilePart` has `hour` (24 or 48 values, shape only), `weekday` (7, Monday first), `month` (12) and a `driver`:

| Driver | Daily factor |
|---|---|
| `none` | 1 |
| `below` `{limit}` | `max(0, limit − T_mean)`: heating degree days |
| `above` `{limit}` | `max(0, T_mean − limit)`: cooling degree days |
| `linear` `{ref, slope}` | `max(0, 1 + slope·(T_mean − ref))` |
| `slp` `{A, B, C, D, T0, mH, bH, mW, bW}` | BDEW SigLinDe `h(T_allocation)` |
| `learned` `{model, lat?, lon?}` | not a daily factor: each step's weight from a model learned from measured buildings (`lib/learnedModels.ts`: `aalborg-residential`, `helsinki-public`), its own day shape |

Step weight = daily factor × hour shape (mean 1) × weekday × month (`weightsOf`). The window shown is scaled on the
period of the total that contains its start (`periodOf`, UTC, weeks start on Monday).

## Presets (`app/web/src/lib/profilePresets.ts`)

| id | Shape | Source |
|---|---|---|
| `heat-demand`, `heat-demand:<sink>` | the Site map's heat sinks (site.json), all or one | the site |
| `aalborg-residential` | **homes' default** (Site map houses, flats, unknown types, drawn areas): the Aalborg model, a ridge regression learned from 3,021 measured Aalborg homes (AI); hour of week (CET), smoothed heating degrees, cold × hour and weekend, clear-sky sun | Schaffer et al. 2022 |
| `helsinki-public` | **offices', schools' and public buildings' default** (and any named non-residential use): the Helsinki model, the same features learned from 258 measured Helsinki service buildings (AI) | City of Helsinki, Nuuka Open API |
| `residential` | app's district curves: heating below 15 °C, peaks, night setback; DHW all year | `lib/demand.ts` defaults |
| `bdew-hef03`, `bdew-hmf03`, `bdew-gko03`, `bdew-gha03` | BDEW gas SLP (sigmoid, weekday factors) | BDEW/VKU/GEODE, TUM Sigmoid |
| `dc-waste-heat` | flat: 1.04 in 8–19 h, 0.97 else; Sat 0.97, Sun 0.96; 8760 MWh/a | app's shape, no standard |
| `cooling` | above 18 °C, day 1 / night 0.3 | app's shape |
| `office-hours` | 8–18 h 1, else 0.2, no weather | app's shape |
| `constant` | flat | – |

## IT load and waste heat

- The data center's waste heat ≈ IT + cooling electricity: flat over the year, ±5–20 % over the day, a few % at weekends.
  The `dc-waste-heat` preset is that starting shape. Measured `ITE_Ener` is always better.
- Server power is linear in utilisation from an idle floor (30–60 % of peak): `P = P_idle + (P_peak − P_idle)·u`.
- In the sims, `IT_Load` (0–1) has a business-hours peak, an evening bump, a weekend dip and AR(1) noise
  (`app/examples/recovery_air_cooled/make.py`). `sim_recovery_air`: ~0.54, growing by 0.06 over the two years; ITE 2,000–5,000 kW, mean 3,623 kW.
- For a new data center without data: total = IT capacity × expected utilisation × 8760 h, plus PUE − 1 for cooling.
  Plan for the multi-year ramp-up of colocation (see [overview](../datacenter/overview.md)).

## Where profiles are used

- **Modelling** of every part: a variable's approach `profile` (`app/web/src/pages/datacenter/modelling/approaches.ts`),
  listed in `ProfilesCard.tsx` and made in `ProfileGenerator` (`app/web/src/pages/datacenter/shared/ProfileGenerator.tsx`).
- **District**: the heat demand starts as a profile (`startOf`: district demand → `profile`).
- **Heat Matching**: the district's demand comes from its profile, measured data, or another dataset (*Heat demand from*).
  Its *Calculation* sums the Site map's sinks, each by its own standard profile (`siteDemand`, `lib/profilePresets.ts`), or by its curves without one.

## Which profile is right (reverse test, 2026-11-12)

Profiles scaled to the measured year, on 3,018 measured Aalborg homes and Flensburg's city network:
over a district the Aalborg model misses by
10 % hourly / 8 % daily (Flensburg 15 / 11 %), BDEW HEF03/HMF03 by 17-19 / 12-15 % (wrong by ±10-20 % month by month, flat
within the day), the app's `residential` curves by 40 / 20 % (day shape 3-4× too strong, peak +47 to +77 %). For one house
every profile misses by ~45 % hourly: there the annual demand counts.
On Helsinki's service buildings (held-out half, 2025, a kind summed) the Helsinki model misses offices / schools / day care by
18 / 12 / 12 % hourly, BDEW GKO03 by 28 / 25 / 31 % with its peak a third too low; `office-hours` by 85-102 %. Shops keep
BDEW GHA03 (too few measured), industry gets `constant` (its heat follows shifts, not weather).

## District demand generator (`app/web/src/lib/demand.ts`)

`space heating(t) ∝ max(0, heating limit − T_out,24h mean) × daily curve(t)` and `hot water(t) ∝ DHW curve(t)`.
They are scaled so the period sums to `houses × kWh per house × hours/8760`, split by the DHW share.

| `DistrictSettings` | Default | |
|---|---|---|
| `houses` × `kwhPerHouse` | 200 × 12,000 kWh/a | typical per dwelling: old 25,000, single-family 18,000, terraced 12,000, flat 7,000, new 5,000 |
| `heatingLimit` | 15 °C | |
| `dhwShare` | 0.2 | |
| `morningPeak`, `eveningPeak`, `nightSetback` | 0.6, 0.5, 0.3 | night 22–5 h |
| `weekendFactor` | 1.05 | weekend morning ~2 h later |
| `supplyTemp`, `returnTemp` | 70 / 40 °C | the network the heat must reach |
| `heatingDay`, `hotWaterDay` | drawn curves (48 half-hours) | replace the parametric curves |
| `profile` | a preset id | replaces the curves |

Settings live per heat sink in `site.json`; the Site map's Wärmeatlas layer can supply buildings' demand.
Details: `docs/concepts/district-demand.md`.

## See also

- [Heat demand profiles (domain)](heat-demand-profiles.md)
- [Modelling approaches](../modelling/approaches.md)
- [Heat matching](../recovery/heat-matching.md)

## Sources

- BDEW/VKU/GEODE Leitfaden *Abwicklung von Standardlastprofilen Gas*, TUM Sigmoid data sheets (as cited in the code).
- L. A. Barroso, U. Hölzle, P. Ranganathan: *The Datacenter as a Computer*, 3rd ed., 2018.
- VDI 4655:2021 (day shapes, for comparison).
