---
title: Evaluation - one-step vs free run, setpoint changes, and R2 pitfalls
tags: [modelling, evaluation, r2, nmae, rmse, free-run, one-step, pitfalls, overfitting, leakage]
summary: How the app scores a twin (one-step, free run, setpoint-change windows), what R2 and nMAE do and do not tell you, and the common traps when reading them.
---

# Evaluation and R² pitfalls

A twin is useful for what-if only if it behaves right **on its own**, over many steps, and **when a lever moves**.

| Score | Inputs | Where | Saved as |
|---|---|---|---|
| **One-step** | real past values of every input | at training | `variables.<v>.r2_train`, `r2_test`, `nmae_test` in `models/<name>.json` |
| **Free run** | real drivers, its **own** predictions for modelled variables, from the split on | `POST .../models/evaluate` | `free_r2`, `free_nmae`, `free_mae`, `free_wape`, `free_mase` |
| **Setpoint changes** | the same free run, the `horizon` steps (default 168) after each lever change > 2 % of its range (≤ 50 per lever) | same | `events[].nmae`, `events[].rmse` |

The split is **chronological** (default 0.5: first half trains, second half tests). It is never shuffled.
TabPFN's free run covers only the first 720 steps (`TABPFN_FREE_STEPS`).
Code: `app/backend/core/twin/evaluate.py`, `app/backend/core/twin/simulate.py` (`free_run`).

## Metrics

- `R² = 1 − Σ(y − ŷ)² / Σ(y − ȳ)²`, over the test rows. 1 is perfect, 0 is "the mean of the period", **negative** is worse than the mean (common in free runs).
- `nMAE = mean|y − ŷ| / mean|y|_train`, a fraction of the variable's typical size.
- `RMSE` in the variable's unit (event windows).

## Pitfalls

| Trap | What happens | Do instead |
|---|---|---|
| **One-step R² with an own-lag parent** | `y[t-1]` predicts `y[t]` with R² 0.95+ for any slow variable (temperatures, demand). It says nothing about the model | look at the free run, compare with a persistence baseline `ŷ_t = y_{t-1}` |
| **R² on a variable with small variance in the test period** | a constant setpoint, or a summer test for a heating variable: tiny errors give R² ≪ 0 or undefined | use nMAE or RMSE; check the test period's variance |
| **R² on a variable with large variance** | demand with a strong season: R² 0.9 although daily errors are large | score per season or per week; nMAE |
| **nMAE of temperatures in °C** | scale is mean \|y\| ≈ 25 °C, so 1 K error reads as 4 % | compare RMSE in K |
| **Calculated Q from small ΔT** | parts at free-run nMAE ≤ 0.09, Q at 0.2–0.7 (`sim_1_modified`) | judge Q and the parts separately |
| **All-vs-all beats the graph on test** | correlations hold in the test data but not under interventions | judge on setpoint-change windows |
| **Leakage through same-step parents** | a lag-0 link from a measured consequence of y | links start at lag 1 (hard rule 3) |
| **Test period not representative** | 2023 train / 2024 test both include winters; a 3-month file does not | at least one full year if the season matters |
| **XGBoost / TabPFN outside the range** | flat at the training extreme | check with drivers beyond the training range; prefer physics there |
| **Comparing a model to its own generator** | `phys` with the generator's equations gives R² = 1 on simulations | treat sims as tests of the method, not of reality |
| **Event windows inherit drift** | the window is cut from the one free run, not restarted at the event | a good event score needs a good free run |

Rules of thumb for the sims: temperatures and flows reach free-run nMAE ≤ 0.09; heat behind a capacity limit
is hard for `linear` and easy for `xgb` and `phys`: on `sim_recovery_air` the recovery is `min(4,333 kW, hall heat, what the loop's cold pipe lets it take)`,
so the recovered heat gets free-run R² 0.801 with `linear` against 0.991 (`xgb`) and 1.000 (`phys`), the free-cooling share 0.649 against 0.956 and 1.000. Full tables: `docs/concepts/simulated-heat-recovery.md` (Model accuracy).

## Stored evaluation and the results on the page

- **Stored.** The Modelling page sends `store: true` with every Evaluate; the answer goes to `models/evaluation.json`
  with `names`, `levers`, `horizon` and a SHA-256 per model (its JSON and its boosters' content; hidden files skipped).
  `GET .../models/evaluation` returns it while every hash matches, else `null`. The page shows it on open only if the
  names are exactly the saved models and the levers match `dataset.json`; it then adopts the stored window. Text:
  "The stored evaluation of the N saved models (unchanged since)" + *Evaluate again*.
- **Not checked:** the data file. Data changed under unchanged models keeps old scores until someone evaluates.
- **Reserved name:** `evaluation` (training it: 400), never in the model list. Above 2 MB
  (`EVALUATION_STORED_MAX_BYTES`) the `events` are dropped, the scores kept.
- **Contains measured values** (`events[].actual`): a real data center's file is confidential; it travels in a project file.
- **e2e:** `app/web/e2e/readonly.ts` rewrites `store` to false, so specs never write it.
- **Per variable:** a variable picked (drawing, causal map or columns) gets *Results · <var>* under the Variables card:
  each saved model's free-run MAE (unit), WAPE, R², MASE, nMAE, best first and marked, *Inspect* (fit dialog). No
  results: it says why (input, calculated, no data, not modelled, profile, no model, not evaluated).
  `app/web/src/pages/datacenter/modelling/VariableResults.tsx`, ranking `candidatesOf` in `ranking.ts`.
- **Per column:** under the Data-driven settings, each variable's best data-driven model; under the Physical
  settings, the physics model's scores (hidden when no model of that approach is saved).
- **Assistant:** the page snapshot has `stored_evaluation` (`loaded` | `saved` | `none`) and `picked` with every model's scores.
- `sim_recovery_air` ships its six models' evaluation (`Cool_Set`, window 24, ~0.6 MB); its district's lies in the
  git-ignored `silver/district_structure/models/` (made by `make.py`).

## Free run vs one-step, in one picture

```
one-step:  ŷ_t = f(x_{t-τ}),  x measured             -> fit quality
free run:  ŷ_t = f(x̂_{t-τ}),  x̂ = data for drivers,
                                     own prediction otherwise -> what the twin can do alone
```

Simulations clamp each variable to its training range ± one span (`simulate.py`). A clamp-bound
run is a red flag, not a result.

## In this app

- UI: Data Center › Structure and Modelling, the models below the graph (`TrainPage`, `app/web/src/pages/datacenter/modelling/TrainPage.tsx`): Train, then Evaluate.
- API/MCP: `train`, `evaluate` (marked a read: `COMPUTE_ONLY` in `app/backend/core/live.py`; the page's `store: true` also writes `models/evaluation.json`, a cache, with no change event; the MCP tool never stores: `app/backend/mcp_server.py` offers no `store` and drops it), the stored evaluation (`GET .../models/evaluation`), `simulate`. Free runs are cached per model file mtime (`app/backend/core/model_store.py`).
- Limits (`MAX_EVENTS` 50, `EVALUATE_MAX_HORIZON` 2000, `TABPFN_ROWS` 500, `SIMULATE_MAX_STEPS` 20000): `app/backend/core/limits.py`.

## See also

- [Modelling approaches](approaches.md)
- [Causal graphs](causal-graphs.md)
- [Simulate with drivers](simulate-and-drivers.md)
- Human docs: `docs/concepts/evaluation.md`, `docs/concepts/models.md`

## Sources

- R. J. Hyndman, G. Athanasopoulos: *Forecasting: Principles and Practice*, 3rd ed. (naive baselines, scaled errors).
- R. J. Hyndman, A. B. Koehler: "Another look at measures of forecast accuracy", Int. J. Forecasting 22, 2006.
- L. Ljung: *System Identification*, 1999 (simulation vs prediction error).
- J. Pearl: *Causality*, 2nd ed., 2009 (interventions vs observations).
