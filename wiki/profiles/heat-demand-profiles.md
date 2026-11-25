---
title: Heat demand profiles (BDEW SLP, degree days, hot water, day and week curves, VDI 4655)
tags: [profiles, heat-demand, bdew, slp, siglinde, degree-days, dhw, hot-water, vdi4655, din-en-12831, district]
summary: How a building's or district's heat demand is shaped over the year, week and day - BDEW gas standard load profiles, heating degree days, hot-water base, VDI 4655 typical days, DIN EN 12831 peak - with typical numbers.
---

# Heat demand profiles

Heat demand = **space heating** (weather-driven) + **domestic hot water (DHW)** (a year-round base) + losses.

## Annual numbers (typical, Germany)

| Quantity | Typical |
|---|---|
| Space heating, unrenovated stock | 150–250 kWh/(m²·a) |
| Space heating, stock average | 120–150 kWh/(m²·a) |
| New build (GEG) / passive house | 30–60 / ≤ 15 kWh/(m²·a) |
| Hot water per person | 500–800 kWh/a (~12.5 kWh/(m²·a) as a planning value) |
| DHW share of residential demand | 10–25 % (higher in new or renovated buildings) |
| Per dwelling (heating + DHW) | 5,000 (new) – 25,000 (old single-family) kWh/a |
| Full-load hours, residential district | ~1,600–2,200 h/a (peak ≈ annual / 1,800 h) |
| Peak / mean ratio of a district | ~2.5–4 |

## Weather: heating degree days and the heating limit

- **Heating limit** (*Heizgrenztemperatur*): no space heating above a daily mean outdoor temperature of
  ~15 °C (old stock), 12 °C (new), 10 °C (passive). In the US the base is 65 °F = 18.3 °C.
- **Degree days** (VDI 4710 / VDI 3807): `G20/15 = Σ (20 − T_m)` over days with `T_m < 15 °C`. Germany has ~3,500–4,000 K·d/a.
  Heating degree days `HGT15 = Σ (15 − T_m)` over the same days.
- Space heating per day ∝ `max(0, T_limit − T_mean)`. Buildings respond to the **24 h or multi-day mean** (thermal mass), not the hourly value.
- **Design peak** (DIN EN 12831-1): the heat load in W at the national design outdoor temperature (−10 to −16 °C in Germany).
  It sizes peaks. It is not an annual energy.

## BDEW gas standard load profiles (SLP, SigLinDe)

Used by German gas grid operators for customers without interval metering (< 1.5 GWh/a, < 500 kW). Per day:

`E_day = KW · h(T) · F_WT`

- `KW` is the customer value (annual energy / Σ h); `F_WT` the weekday factor (Monday first).
- `h(T) = A / (1 + (B / (T − T0))^C) + D + max(mH·T + bH, mW·T + bW)`, with `T0 = 40 °C`.
- `T` is the **allocation temperature** `(T_d + 0.5·T_{d−1} + 0.25·T_{d−2} + 0.125·T_{d−3}) / 1.875` of daily means.
- Types: households `HEF` (single-family, < 50 MWh/a), `HMF` (multi-family); trade and commerce, e.g. `GKO`
  (offices, public bodies, banks), `GHA` (retail), `GBH` (accommodation), `GGA` (restaurants), `GBA` (bakeries), …
- The sigmoid flattens at low temperature (saturation) and keeps a hot-water base `D` at high temperature.
- Within the day: BDEW hourly factors by temperature band, or a drawn shape.

## Day and week curves (residential)

| Feature | Typical |
|---|---|
| Night setback | 22–5 h, 20–40 % lower |
| Morning peak | 6–8 h (weekends ~2 h later) |
| Evening peak | 17–21 h |
| DHW draws | morning 6–9 h and evening 18–21 h peaks on a small base |
| Weekend | residential +0–10 %; offices −50–90 % (frost protection only) |
| Offices, schools | 7–18 h on weekdays, preheating before opening |

## VDI 4655

Reference load profiles of single- and multi-family houses (heating, DHW, electricity) for sizing CHP and
heat pumps. They use **ten typical days** (season winter/transition/summer × workday/Sunday × clear/cloudy, where
it applies) at 1-min resolution, scaled per **DWD test reference year** climate zone by the annual demand.
They are good for day shapes. They are not used in the app; `lib/profile.ts` takes hour, weekday and month shapes plus a weather driver instead.

## District level

- A district is the sum of buildings plus **network losses** (3G: 10–25 % of sales) and is smoother than one
  building (diversity: peaks do not coincide; simultaneity factor 0.5–0.8 for many buildings).
- Summer demand ≈ DHW + losses: 15–30 % of the annual mean. That is the base a data center can always serve.

## In this app

- Homes' default: `aalborg-residential`, the Aalborg model learned from measured homes; it beat BDEW and the app's curves on measured homes and on Flensburg. Offices, schools, public buildings: `helsinki-public`, learned from measured Helsinki service buildings; it beat BDEW GKO03 there. Shops BDEW GHA03, industry flat ([profile generator](profile-generator.md)).
- BDEW presets `bdew-hef03`, `bdew-hmf03`, `bdew-gko03`, `bdew-gha03` (TUM Sigmoid coefficients, linear part 0): `app/web/src/lib/profilePresets.ts`.
  `slpH` and `dailyTemperatures` (allocation temperature) in `app/web/src/lib/profile.ts`.
- Degree-day driver: `{kind: "below", limit}` (space heating), `{kind: "above", limit}` (cooling), `linear`, `slp`.
- District demand generator: `app/web/src/lib/demand.ts` (`max(0, limit − T_24h) × day curve` + DHW curve; defaults:
  200 houses × 12,000 kWh, limit 15 °C, DHW 20 %, weekend 1.05). Human docs: `docs/concepts/district-demand.md`.
- `sim_district_heat`: UA 95 kW/K × `max(0, 18.3 − T24)` + 110 kW DHW, ~5,400–5,600 MWh/a (see [datasets](../datasets/examples.md)).

## See also

- [The profile generator in the app](profile-generator.md)
- [Heat matching and seasonality](../recovery/heat-matching.md)
- [Glossary](../glossary.md)

## Sources

- BDEW/VKU/GEODE: Leitfaden *Abwicklung von Standardlastprofilen Gas* (as cited in `profilePresets.ts`), TUM Sigmoid data sheets.
- M. Hellwig: *Entwicklung und Anwendung parametrisierter Standard-Lastprofile*, Dissertation TU München, 2003 (SigLinDe origin).
- VDI 4655:2021 *Reference load profiles of residential buildings for power, heat and domestic hot water*.
- VDI 4710 Blatt 2 / VDI 3807 Blatt 1 (degree days); DWD Testreferenzjahre.
- DIN EN 12831-1:2017 and DIN/TS 12831-1 (design heat load); GEG 2024 (building energy act).
- ASHRAE Handbook Fundamentals, ch. 14 (climatic design, degree days base 65 °F).
