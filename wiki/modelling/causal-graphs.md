---
title: Causal graphs with lags, PC/PCMCI lag discovery, drivers
tags: [modelling, causal-graph, lags, pcmci, pc, tigramite, parcorr, drivers, all-vs-all, tempcafe]
summary: What a lagged causal graph is in this app, the lag sign convention, the graph file format, how PC and PCMCI discover lags, and what drivers are.
---

# Causal graphs with lags

A link is `(parent, target, lag)`. Each modelled variable `y` gets
`ŷ_t = f_y(x¹_{t−τ1}, …, xᵐ_{t−τm})`. A variable may be its own parent (autoregressive) and may appear at several lags.

## Lag sign convention (the most common mistake)

| Where | Convention | One step back |
|---|---|---|
| Graph files `causal_graph*.json`, graph API, saved models `inputs[].lag` | **negative** | `-1` |
| Inside the twin (`app/backend/core/twin/`), equation language `Var[t-1]` | τ = \|lag\| ≥ 0 | `1` |
| Lag discovery request (`min_lag`, `max_lag`) and result | **positive**, ≥ 1 | `1` |

Lag 0 (same step) is accepted by the backend (topological order inside a step; lag-0 cycles are an error), but
the app's graphs use lags ≥ 1 (hard rule 3 in AGENTS.md).

## File format

```json
{"targets": {"In_Temp": [["In_Temp", -1], ["Cool_Set", -1], ["ITE_Ener", -1], ["IT_Load", -1], ["Out_Temp", -1]],
             "ITE_Ener": [["IT_Load", -1], ["ITE_Ener", -1], ["In_Temp", -1]]},
 "link_strengths": []}
```

Every `*.json` in a dataset folder is a graph except `site.json`, `dataset.json`, `equations.json`, `pid_plant.json`
(`NOT_GRAPHS` in `app/backend/core/dataset_files.py`). Variants: `causal_graph.json` (default), `_manual`, `_pcmci`, `_pc`, `_discovered`.

## Drivers

**Drivers** are variables taken from the data, not predicted: weather, setpoints (`Cool_Set`), IT load, demand.
`default_drivers` suggests every variable with no parent other than its own past (`app/backend/core/twin/graph.py`).
In a scenario or a free run, drivers follow the data unless intervened or replaced (see [simulate](simulate-and-drivers.md)).
`dataset.json` `actuators` and `levers` name the controllable ones (`levers` are scored in setpoint-change windows).

## Lag discovery (TempCaFe, PC / PCMCI)

The engineer draws **which** variable affects which. The data decides **how long** the effect takes.
`discover_lags` in `app/backend/core/causal_discovery.py` uses tigramite:

| Method | Idea | Strength |
|---|---|---|
| **PCMCI** (default) | PC₁ condition selection per variable, then the MCI test conditioned on the parents of both ends | low false positives on autocorrelated series |
| **PC** (time-lagged) | drop a link once any conditioning set makes the ends independent | faster on few variables; more false positives with autocorrelation |
| Test | ParCorr (partial correlation of residuals after linear regression on Z) | linear dependence only |

| Parameter | Default | Range |
|---|---|---|
| `method` | `pcmci` | `pcmci`, `pc` |
| `min_lag`, `max_lag` | 1, 5 | 1 ≤ min ≤ max ≤ 24 (`LAG_DISCOVERY_MAX_LAG`) |
| `alpha` | 0.01 | significance |
| `data_fraction` | 1.0 | first fraction of the rows, for speed |

- Only drawn links (plus every variable's own past) are candidates; discovery never adds a link you did not draw.
  *Blind* mode sends every ordered pair as candidates instead.
- The result comes back with `link_strengths`. **It is never written to a graph file automatically.** Only the
  user's Save writes (hard rule 3). Agents: present lags, do not save them.
- ParCorr is linear. A nonlinear or thresholded effect (`min`, on/off control) can be missed.
  On hourly data with daily cycles, a lag of 24 can look significant through the shared clock, not causation.

## Graph or all vs all

All vs all: every variable at lags 1..L (default 5) for each target. It fits as well or better,
but it learns correlations that break under interventions. 16 variables × 5 lags = 80 inputs, which is
why TabPFN has no all-vs-all model. The causal graph is the structure Scenarios rely on.

## In this app

- Page: Data Center › Structure and Modelling (`#/dc/pid`). The P&ID plus the causal graph; **Edit** (top right) shows the *Causal discovery* button.
- Through the open page (MCP `ui_do`): `set_links` `[{from, to, lags?}]`, `select_link`, then `click` *Edit* and *Causal discovery* (the page opens to view; *Done editing* hides the tools).
  Graph API tools: `get_graph`, `save_graph` `[writes]`, `discover_link_lags` (compute only).
- Whole-file re-lagging for scripts: `relag_graph` (writes `causal_graph_pcmci.json`/`_pc.json` in `app/scripts/make_sim_1_modified.py`).

## See also

- [Modelling approaches](approaches.md) · [Evaluation](evaluation-and-pitfalls.md) · [Simulate](simulate-and-drivers.md)
- Human docs: `docs/concepts/causal-graph.md`, `docs/concepts/datacenter-variables.md` (typical links in a data center)

## Sources

- J. Runge, P. Nowack, M. Kretschmer, S. Flaxman, D. Sejdinovic: "Detecting and quantifying causal associations in large nonlinear time series datasets", Science Advances 5(11), 2019 (PCMCI).
- P. Spirtes, C. Glymour, R. Scheines: *Causation, Prediction, and Search*, 2nd ed., 2000 (PC).
- tigramite documentation (J. Runge).
- J. Pearl: *Causality*, 2nd ed., 2009.
