---
title: Modelling approaches (data-driven, physical, semi-physical, profile) and the app's models
tags: [modelling, data-driven, physical, semi-physical, grey-box, linear, xgboost, tabpfn, physics, symbolic, residual, approaches]
summary: When to use a data-driven, physical, semi-physical (grey-box) model or a profile, how each maps to the app's approaches and the model names linear/xgb/tabpfn/phys/sym, and their strengths and failure modes.
---

# Modelling approaches

The twin is **one small model per variable**, each predicting its variable one step ahead from the
parents the causal graph allows (see [causal graphs](causal-graphs.md)). Each variable is made in one of four ways.

| Approach (`approaches.ts`) | Colour token (light) | What | Needs |
|---|---|---|---|
| `off`, *Not modelled* | `--way-off` #94A3B8 grey | taken from the data as it is, or ignored | – |
| `data`, *Data-driven* | `--way-data` #2563EB blue | learned on the graph's parents (linear, XGBoost, TabPFN) | data for the variable |
| `physics`, *Physical and semi-physical* | `--way-physics` #14b8a6 teal | an equation; fixed numbers (physical) or fitted coefficients (semi-physical) | an equation in `equations.json` |
| `profile`, *Measurement or profile* | `--way-profile` #EA580C orange | a measured input, or a curve from the profile generator | a total and shapes |

Colours: tokens in `app/web/src/index.css` (dark theme has lighter variants), mapped in `WAYS`
(`app/web/src/pages/datacenter/structure/roles.ts`). Defaults per part (`STARTS`): data center `data`,
heat distribution `physics`, district `off` (its heat demand a `profile`). A calculated column (`derived`)
has no approach; an input (no causes in the graph) can only be `data` (from the data), `profile` or `off`.

## Which approach when

| Situation | Choose | Why |
|---|---|---|
| Many years of good data, behaviour stays in the data's range | data-driven (XGBoost, linear) | cheapest, accurate inside the range |
| Little data, a new plant, or a design study | physical | no data needed; extrapolates if the physics is right |
| Known structure, unknown constants (HEX effectiveness, COP share, UA) | **semi-physical** | physics extrapolates, data calibrates; few parameters |
| Physics is good but leaves a pattern (daily rhythm, unknown loads) | grey-box + residual model | physics for the trend, a data model for the rest |
| Operator setpoints, weather, IT load (inputs) | data or profile | they are drivers, not modelled |
| Planning without measurements (district demand) | profile | BDEW / degree-day curves |
| Thresholds, saturation, `min(...)` (demand-limited recovery) | XGBoost, TabPFN, or physics with `minimum` | a straight line cannot follow a kink |

## The model kinds (fixed names, AGENTS.md hard rule 4)

| Name | Kind | Structure | Idea | Notes |
|---|---|---|---|---|
| `linear` | linear | causal graph | least squares on the parents | **used by Scenarios and Heat Matching by default**; readable coefficients |
| `linear_all` | linear | all vs all | every variable at lags 1..L | baseline the graph must beat |
| `xgb` / `xgb_all` | xgboost | graph / all | gradient-boosted trees, fixed params (depth 4, eta 0.05, 300 rounds) | nonlinear; **cannot extrapolate** beyond training values |
| `phys` | physics | graph | your equation, coefficients by `scipy.optimize.least_squares`; variables without an equation are linear | grey box |
| `sym` | symbolic | graph | linear part exact, gplearn searches the nonlinear rest (+ − × max min) → sympy formula | readable formula; slow |
| `tabpfn` | tabpfn | graph | pretrained transformer, in-context on 500 training rows | small data; free run only 720 steps; ~14 ms/step |

Code: `app/backend/core/twin/learners.py` (`LEARNERS`), `app/backend/core/twin/fit.py`, `app/backend/core/physics.py`
(equation language: `Var[t-k]`, any other name is a coefficient; functions `exp log sqrt abs tanh sin cos arctan
minimum maximum Max Min clip pdiv`), `app/backend/core/symbolic.py`. Catalogue and chart colours: `app/web/src/lib/modelCatalog.ts`.
Equation library for the UI: `app/web/src/lib/physicsLibrary.ts`.

## Semi-physical in practice

Write the structure, let the data fit the constants:

```
condenser Q:  eta * (ITE_Ener[t-1] + HVAC_Ener[t-1])
In_Temp:      a*In_Temp[t-1] + b*(Cool_Set[t-1] - In_Temp[t-1]) + c*ITE_Ener[t-1]
Heat_Demand:  a*Heat_Demand[t-1] + (1 - a)*(b*maximum(0, c - Out_Temp[t-1]) + d)   (sim_district_heat: b≈102 kW/K, c≈18.3 °C, d≈106 kW)
```

- Keep the coefficients physical (an effectiveness in 0–1, a UA > 0). A fit outside that range means the structure is wrong.
- Coefficients are fitted **one step ahead** on the training rows (start 1.0 each). Judge them in the free run.
- **Residual model**: fit physics first, then a data model on `y − physics`. The app has no dedicated
  residual kind. Approximate it by a `phys` equation with a learned term, or a prepared variable for the residual.

## Failure modes

- Data-driven models learn correlations. Under an intervention (a setpoint outside the training mix) they can be wrong
  while scoring well on test data. The causal graph limits this (see [evaluation](evaluation-and-pitfalls.md)).
- Trees and TabPFN cannot extrapolate: a warmer climate or a bigger IT load gives the training maximum.
- Physical models are only as good as their boundary: unmodelled loads, sensor offsets, control logic (on/off, staging).
- An equation's `min`, `clip` or limit makes the fit non-smooth. Start values matter; check the fitted numbers.

## See also

- [Evaluation and R² pitfalls](evaluation-and-pitfalls.md)
- [Causal graphs and lag discovery](causal-graphs.md)
- [Simulate with drivers and interventions](simulate-and-drivers.md)
- [Profiles](../profiles/profile-generator.md)
- Human docs: `docs/concepts/models.md`, `docs/concepts/components.md`

## Sources

- L. Ljung: *System Identification: Theory for the User*, 2nd ed., 1999 (white/grey/black box).
- H. Madsen, J. Holst: "Estimation of continuous-time models for the heat dynamics of a building", Energy and Buildings 22, 1995 (grey-box RC models).
- T. Chen, C. Guestrin: "XGBoost: a scalable tree boosting system", KDD 2016.
- N. Hollmann et al.: "Accurate predictions on small data with a tabular foundation model" (TabPFN v2), Nature 637, 2025.
- gplearn documentation (genetic programming symbolic regression); SymPy.
