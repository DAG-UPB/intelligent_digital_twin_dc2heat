---
title: Heat pumps, heat exchangers and storage in the heat distribution
tags: [heat-pump, hex, storage, tank, components, cop, spf, sizing, heat-distribution]
summary: The three units between data center and district (direct HEX, heat pump, tank), their typical sizes and numbers, and the app's built-in formulas and component presets.
---

# Heat pumps, heat exchangers and storage

The heat distribution sits between the data center and the district. It holds three units,
each of which can be switched off: **direct HEX**, **heat pump**, **thermal storage**.

## Direct HEX

- Works only when the source is hotter than the network supply plus the approach (1–5 K). In practice
  that means liquid cooling (45–60 °C) into a 4G/LTDH network, or any source into a 5G loop.
- Electricity: pumps only (~1–2 % of the heat).
- Built-in: `T_cold_out = T_hot_in − approach`, `Q = eff · Q_hot` (preset `hex_approach`).
  ε-NTU version: preset `hex_entu`.

## Heat pump

| Topic | Typical |
|---|---|
| Sizes in DH | 0.5–90 MW per site; modules of 1–20 MW |
| Refrigerants | NH3 (≤ 90 °C), R134a / R1234ze / R1233zd (turbo), CO₂ (transcritical, high-temperature hot water) |
| Carnot fraction η_C | 0.5–0.68 for large units (see [temperatures](../temperatures/district-heating-and-heat-pumps.md)) |
| COP on DC waste heat | 3–5 into 70 °C; 2.5–3.5 into 90 °C |
| Minimum part load | 20–40 % (screw/turbo); not modelled in the app |
| Heat delivered | `Q_source + P_el`; `Q_source = Q_heat · (1 − 1/COP)` |

Electricity of the heat pump is the main running cost. It is the trade-off in every matching:
more coverage via the heat pump means more electricity.

Presets in `app/backend/core/component_library.py` (Carnot model, η_C learnable, `_heat_pump(...)`):

| id | Capacity | η_C | Max supply | Max lift |
|---|---|---|---|---|
| `hp_0_5mw` | 460 kW | 0.56 | 90 °C | 75 K |
| `hp_2mw` | 1.69 MW | 0.59 | 72 °C | 55 K |
| `hp_5mw` | 5 MW | 0.60 | 88 °C | 75 K |
| `hp_14mw` | 14 MW | 0.68 | 90 °C | 85 K |
| `hp_20mw` | 19.3 MW | 0.52 | 95 °C | 65 K |
| `hp_90mw` | 90.6 MW | 0.56 | 88 °C | 85 K |

Each η_C is the published COP / Carnot COP at the published operating point. The manufacturers' data
sheets and literature are cited in each preset and in `docs/concepts/components.md`. Full capacity up to
the max supply and max lift (the published points sit on them), 0 within 1 K above (a `clip` ramp, since the
equation language has no `if`).

**Dynamics (time lag).** Output follows a higher set point with a first-order lag, time constant τ (compressor start, condenser water warming up; typical tens of minutes for large DH units, minimum run and off times on top): `Q[t] = Q[t-1] + (Q_set − Q[t-1])·(1 − e^(−Δt/τ))`. In the app: `MatchOptions.hpTauH` (default 0.5 h; 0 = at once; going down is instant), the presets' `Q_heat` node with `tau_h`, and `OpPlant.tauH` in Operation's strategies (`pages/twin/operation.ts`).

## Operating strategies (Operation › Heat pump operation)

| Strategy | Rule | Typical result |
|---|---|---|
| Heat-led | HP follows demand, surplus charges the tank | baseline; most electricity at whatever price |
| Price rule | charge in hours at/below the day's median price, else tank first | small saving with a big tank and a wide spread; many starts |
| (all three) | the tank starts empty; from the period's last step with a demand on nothing is charged (`operate`, as `matchHeat`) | no heat bought only to be lost |
| MPC | 24 h look-ahead DP over tank level (21 levels, value interpolated) × HP set point (off…full in 10 % steps, and = demand), min cost or CO₂, terminal value λ = median horizon price ÷ mean COP (≤ backup price), first step applied, plant in the loop; heat-led instead where its plan (blind to τ) costs more over the period (`totals.heatLed`) | on the recovery example: −3 % a year with 0.5 MWh, −10 % with 8 h of storage and ×2 price swings (spring −24 %, summer −46 %, winter −4 %); many starts (no start penalty) |

Prices and grid CO₂ there are a synthetic day-ahead year (`syntheticPrice`), not market data. Port of the ideas of an earlier MPC prototype (receding horizon, terminal value, plant in the loop) without an LP solver.

## Storage

| Kind | Size | Bridges | Loss |
|---|---|---|---|
| Buffer tank (steel) | 10–5,000 m³ | hours to a day | ~0.5–2 %/day |
| Large tank (DH) | 5,000–50,000 m³ | days | |
| Pit storage (PTES) | 50,000–200,000+ m³ | seasons | 10–40 %/year |
| Borehole (BTES) / aquifer (ATES) | 10⁵–10⁶ m³ ground | seasons | high at first, works at low temperature (with heat pump) |

Capacity `E = V·ρ·cp·(T_supply − T_return)/3600`, e.g. 100 m³ at 70/40 °C ≈ 3.5 MWh.
Preset `storage_tank`: `E_max` from V and the network ΔT; standing loss `UA_loss·(T_mean − T_amb)`;
`E[t] = clip(E[t−1] + (Q_in − Q_out − P_loss)·Δt, 0, E_max)`.

**Operation's tank: two models** (`OpPlant.rc`, `pages/twin/operation.ts`, *Storage model* on the page).
*Energy* (bucket): kWh with a flat standing loss in %/h. *With temperature* (1-node RC, ported from the old idz
app's `thermalStorageControl.ts`): `C = E_max/(T_max − T_min)`, the level is `C·(T − T_min)`; it cools towards its
surroundings, `T → T_amb + (T − T_amb)·e^(−Δt/τ)` (default τ 48 h, so a hotter tank loses more); it charges and
discharges at most its kW (default E_max/4 h); it serves the network only with the heat above the supply temperature
(`max(T_min, T_supply)`). Defaults from the network (`defaultRc`): T_min = the lowest supply (≥ 30 °C), T_max =
highest supply + 20 K (≤ 95 °C), T_amb 20 °C.

**Charging costs COP** (RC only, `chargeCop`): the heat pump delivers into the tank `CHARGE_DT` = 5 K above the
tank's temperature (at least above the supply), so it lifts higher than for the demand:
`COP_charge = COP · Carnot(T_charge, T_src) / Carnot(T_supply, T_src)` (η cancels; lift ≥ 5 K). A kWh of heat takes
`1 − 1/COP` from the source, so heat at the lower COP takes less of it: the heat pump's limit at a scarce source is
`hpLimit` = demand at the step's COP + the rest of the source at `COP_charge` (≤ capacity). The plant step and the
MPC use both; the MPC charges less when charging is dear. Without a source temperature, and for the bucket: one COP
(`hpMax`), as before. Not yet: Heat Matching and Planning (`lib/matching.ts`) still use the bucket; the avoided DC
cooling is not in the objective.

## Built-in defaults (`DEFAULT_OPTIONS`, `app/web/src/lib/matching.ts`)

| Option | Default | Meaning |
|---|---|---|
| `recovery` | `auto` | direct when hot enough, else the heat pump |
| `physics` | true | temperature checks and the Carnot COP |
| `approach` | 5 K | direct HEX approach |
| `carnotEff` | 0.5 | η_C |
| `hexEff` | 0.9 | extraction HEX efficiency |
| `eta`, `fixedCop` | 0.8, 3.5 | simple mode (physics off) |
| `hpCapacity` | 150 kW | thermal output limit |
| `tankKwh`, `tankLossPct` | 500 kWh, 0.1 %/h | 0.1 %/h ≈ 2.4 %/day, the same default as Operation's tank (0.5 %/h, 11 %/day, until 2026-11-24 was pessimistic for a large insulated tank) |

The examples ship their own `site.json` `heat_components`. For example, `make_sim_cases.py` sets
`{hex: hex_approach, hp: hp_0_5mw, tank: storage_tank}`; `sim_recovery_air` uses the 5 MW heat pump (`hp_5mw`).

## In this app

- Units on/off and Model vs Calculation per part: `app/web/src/pages/heat/parts.ts`.
- Which component may replace a unit and the nodes it must have (`CONTRACT`): `app/web/src/pages/heat/partComponents.ts`.
- Components API: `/api/components` (`check`, `simulate`, `fit`); saved user components live in app/data/_components/ (local only, created on the first save).
- Heat distribution structure page: Heat Distribution › Structure and Modelling (`#/heat/structure`).

## See also

- [Heat matching](heat-matching.md)
- [District heating and heat pump temperatures](../temperatures/district-heating-and-heat-pumps.md)
- [Heat transfer basics](../interfaces/heat-transfer-basics.md)

## Sources

- A. David et al.: "Heat Roadmap Europe: large-scale electric heat pumps in district heating systems", Energies 10(4), 2017.
- Danish Energy Agency: *Technology Data for Energy Storage* and *… Generation of Electricity and District Heating* (ch. 40, heat pumps).
- IEA ES TCP / Solar District Heating: pit and borehole storage reports.
- Incropera et al., *Fundamentals of Heat and Mass Transfer*, ch. 11 (ε-NTU).
