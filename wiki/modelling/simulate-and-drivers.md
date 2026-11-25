---
title: Simulate - free runs, interventions, Monte Carlo and external drivers
tags: [modelling, simulate, scenarios, interventions, drivers, monte-carlo, what-if, free-run]
summary: How the twin is rolled forward (simulate), the intervention kinds, noise draws, and replacing drivers by series from another dataset (the drivers field) as Heat Matching does.
---

# Simulate: free runs, interventions and drivers

`simulate(df, model, start, steps, interventions, n_draws, seed, drivers)` in
`app/backend/core/twin/simulate.py`. API: `POST /api/datasets/{id}/models/{name}/simulate` (compute only; MCP tool `simulate`).

## A run

1. **History** before `start` is the real data. `start` is raised to the model's `max_lag`, and the run is cut at the end of the data.
2. **Drivers** follow the recorded data, unless replaced (`drivers`) or intervened. A scenario is a **replay of a real period with something changed**, not a forecast.
3. **Modelled variables** are predicted step by step, in step order (lag-0 parents first), from real history, drivers, or their own earlier predictions.
4. **Noise** `N(0, σ)` per draw when `n_draws > 1` (σ = training residual std; seeded). The response gives p05/p50/p95.
5. **Interventions** on the variable.
6. **Clamp** to `[min − span, max + span]` of the training period. A value at the clamp means the model left what it knows.

Free run = `simulate` from the split, one draw, no interventions (`free_run`).

## Request (`SimulateRequest` in `app/backend/schemas.py`)

| Field | Default | Meaning |
|---|---|---|
| `start` | – | row to start at |
| `steps` | 24 | rows, ≤ `SIMULATE_MAX_STEPS` 20000 |
| `columns` | all | variables to return (calculated `derived` Q can be asked for: computed per draw from predicted parts) |
| `interventions` | [] | `{variable, kind (set, shift, scale), value, start, end}`; offsets from the run start, `end` exclusive, null = to the end |
| `n_draws` | 1 | > 1: noisy runs, ≤ 200 |
| `baseline` | false | also return the run without interventions |
| `drivers` | {} | `{driver: [values]}`: replaces that driver's data from the (raised) start on, one value per step; a shorter series leaves the rest as measured; interventions still apply on top. A name that is not a driver of the model is a 400 error |

## Interventions

| Kind | On a driver | On a modelled variable |
|---|---|---|
| `set` | value = v in the window | prediction replaced by v (noise removed); downstream sees v |
| `shift` | u + v | ŷ + v · g |
| `scale` | u + (v − 1) · mean(u) | ŷ + (v − 1) · mean_train(y) · g |

`g = 1 − Σ(own-lag coefficients)`, so that an autoregressive variable settles at the new level and does not
compound the change each step. A calculated column cannot be intervened on.

## External drivers (another weather, another demand)

Use case: run the data center's learned model on **another** district's demand and weather.

- Heat Matching › *What if…* › **Weather from** / **Heat demand from** lists datasets with a weather column
  (`Out_Temp`, else `temperature_2m`) or a `kpi.heat_demand` column (`inputSources` in `app/web/src/lib/externalInputs.ts`).
- The series is aligned to the period's steps (`onPeriod`). If it does not cover the period, it is null (another year cannot stand in).
- It replaces the shared weather and the district's demand, and it goes into the data center's model as `drivers`
  (`useHeatSources(..., { drivers })` in `app/web/src/pages/twin/HeatDistributionPage.tsx`).
- Only works when the replaced variables **are drivers** of the chosen model. In `sim_recovery_air`, `Out_Temp`
  is a driver (of the free cooling, the cooling electricity, the building and the rejected heat) and `Heat_Demand` is none: the
  recovered heat follows the IT load, the hall and the loop's cold pipe (`Loop_T_cold`, an input), so another demand only changes what the heat distribution has to match.
- Models extrapolate badly. A demand or weather outside the training range gives flat (trees) or clamped results.

## Monte Carlo

`n_draws` noisy runs show how prediction errors accumulate. The band is not a physical uncertainty of the plant.
It assumes Gaussian, independent residuals, and it does not cover model-structure error.

## In this app

- Pages: Data Center › Visualization and Scenarios (Scenarios: replay with levers), the `WhatIfCard` on every part's dashboard,
  and Heat Matching (data center's Model free run, `linear` by default; *More options* › *Trained model*).
- Frontend client: `app/web/src/api/models.ts` (`drivers?: Record<string, number[]>`).

## See also

- [Evaluation](evaluation-and-pitfalls.md) · [Causal graphs and drivers](causal-graphs.md)
- [Heat matching](../recovery/heat-matching.md) · [Recovery and district example](../datasets/recovery-and-district.md)
- Human docs: `docs/concepts/scenarios-simulation.md`

## Sources

- J. Pearl: *Causality*, 2nd ed., 2009 (do-interventions on a structural causal model).
- L. Ljung: *System Identification*, 1999 (simulation vs prediction).
