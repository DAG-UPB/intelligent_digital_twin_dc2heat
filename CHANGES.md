# Changes

Newest first, one entry per change: the date, who (person · agent), the area, what changed and why, the files, the
checks run (and what could not be checked), what stays open. Keep it short; the details are in the code and the docs.

## 2026-11-27 · owner · Claude · the app opens blank; NRW per municipality (Münster, Paderborn); a data check

- **Opens blank**: a fresh browser opens `sim_blank` (`DEFAULT_DATASET`, was the main example); Home's *New here?*
  card has *Start with the example* (`?case=1#/twin/map`: `openStartCase` puts Case 1 on), the tutorial beside it;
  `start.sh` opens Home. A browser that visited before also opens blank in every new tab or browser start (the Blank
  case; `reopened` in `cases.ts`: localStorage `app-opened`, sessionStorage `app-started`); a reload keeps the picks.
  Files: `dataset.ts`, `HomePage.tsx`, `main.tsx`, `DataCenterPicker.tsx`, `cases.ts` (+test), `i18n.de.ts`,
  `start.sh`, `dataset.test.ts`, e2e `shell-help` (new test), `operation` (renamed).
- **NRW one file per municipality** (`buildings_<AGS>_<name>.sqlite`): with Münster and Paderborn one file was 115 MB,
  over GitHub's 100 MB; now Bonn 44, Münster 42, Paderborn 27, Altenbeken 2 MB, and a municipality added on another
  machine is one more file. `find_dbs` reads every `buildings*.sqlite` of a source folder (not the PfA's file).
- **Data check** of every shared text file (company, site, people's names, paths, e-mails): only public citations,
  the data providers' credits, the fictitious ACME of the tests, the generic dataset kind `testbed`, the repository
  URL, and the main example's place (the European Central Bank's building, marked as a simulation everywhere). A
  utility's name in a test comment removed (`pfa.test.ts`).
Checks: ruff, pytest 886, vitest (730), typecheck, lint, build, e2e on 7614: shell-help, operation, smoke, tour,
german (85), district, network (18); Paderborn, Münster, Bonn and Frankfurt answer on the local app.

## 2026-11-27 · owner · Claude · the Hugging Face Space from GitHub

`.github/workflows/space.yml`: on every push to `main` (or by hand) the commit's files, without the history and
with the heat demand of Hessen and NRW (the owner's decision; `.dockerignore` now lets the two built files into the
image), with the Space's settings (`sdk: docker`, `app_port: 7612`, `license: gpl-3.0`) on top of README.md, are uploaded to the Space named by the repository variable
`HF_SPACE` with the secret `HF_TOKEN` (`hf upload --delete "*"`: one commit, the Space's history kept, no force push).
Without `HF_SPACE` it does nothing. Checks: the YAML parses; the snapshot step run locally; a Docker build context
holds exactly the two `buildings.sqlite`, no downloads.
Not checked: a run on GitHub and the Space's build (the variable, secret and Space are not set up yet).

## 2026-11-27 · owner · Claude · GPL licence, the heat demand committed, 8 GB and every core

- **Licence**: GPL-3.0-or-later (`LICENSE`, `app/pyproject.toml`, README). The heat demand data keeps its own terms.
- **Heat demand in the repository** (the owner's decision): `app/data/_external/waermeatlas/buildings.sqlite`
  (Frankfurt, © LEA, no open licence: never in a public copy; `.dockerignore` keeps `_external/` out of the image)
  and `.../nrw/buildings.sqlite` (Bonn, Altenbeken, dl-de/zero-2.0); the downloads stay git-ignored. Both import
  scripts no longer refuse to run when git does not ignore the file; each file records the downloads it was built from
  (`parts_of`/`set_parts` in `core/waermeatlas.py`) and a rebuild fetches the missing ones first, so adding a
  municipality on another machine does not drop the others. Hard rule 1 names the two files.
- **Memory budget 8 GB** (was 2): `guard.sh` default 8192, `compose.yaml` `mem_limit: 8g`, Hard rule 2, docs. The
  model knobs of `limits.py` (TabPFN 500 rows / 30 inputs, symbolic 3000 rows) stay as they were.
- **Every core**: `start.sh` and the Dockerfile no longer set `OMP_NUM_THREADS=1`; XGBoost has no `nthread` (every
  core, or `OMP_NUM_THREADS`). Measured: XGBoost on all cores then TabPFN with torch on 8 threads hangs (macOS), so
  TabPFN keeps one thread; Chronos-2 runs on mps beside XGBoost without trouble; gplearn on all cores was slower
  (3.6 vs 2.1 s), so `n_jobs=1` stays. XGBoost's predictions on 1 and 8 threads are identical (max diff 0.0): the
  examples' numbers do not move, `make.py` not re-run. CI keeps `OMP_NUM_THREADS=1`.
Checks: ruff, pytest 885 and `-m slow` 10 (both without the thread variables), docs `-W`, `uv lock --check`.
Not checked: the container with 8 GB and all cores, the app restarted under the new `start.sh` (one export removed).

## 2026-11-25 · owner · Claude · heat demand of other states: app/sources/, NRW first

The Site map's heat demand layer read one source (the Wärmeatlas Hessen). Now every source imported on this machine
has its own `app/data/_external/<source>/buildings.sqlite` (git-ignored) and the layer reads them all for a box
(`find_dbs`, `write_db` in `core/waermeatlas.py`); each building and street segment carries its `source`, each answer
the sources' credit lines (`sources`), and the map's attribution and texts name the sources in view (`creditOf`). A
building of another source gets the sink id `<source>-<id>` (Hessen's stay `wah-<id>`, as saved sites have them).
First source: `app/sources/nrw/fetch.py`, LANUK's Kommunale Wärmeplanung NRW (dl-de/zero-2.0), per municipality,
read inside the zip by a stdlib shapefile reader (`sources/shp.py`): Bonn 123,461 buildings, 7,932 street segments,
~25 s, 65 MB RSS. `reports/` and `research_notes/` (the data-source research) are git-ignored.
Files: `backend/core/waermeatlas.py`, `routers/waermeatlas.py`, `app/sources/` (README, `shp.py`, `nrw/`),
`tests/test_heat_sources.py`, `web/src/api/waermeatlas.ts`, `pages/district/` (`waermeatlas.ts`, `WaermeatlasPanel.tsx`,
`AreaBuildings.tsx`, `loadAreaBuildings.ts`, `HeatNetwork.tsx`, `useNetworkData.ts`, `network.ts`), `i18n.de.ts`,
docs `district-demand`, `data-and-privacy`, `AGENTS.md`, CI's ruff paths (+ `sources`), `.gitignore`.
Checks: ruff, pytest (884), typecheck, lint, vitest (730), build, docs `-W`, e2e `district` + `smoke` on 7614 (33),
Bonn loaded on the Site map in a browser (buildings, heat lines, LANUK credit). Open: Berlin, Hamburg, the Zensus 2022
+ Hotmaps grid (next, in that order); the layer's checkbox still says "Heat demand (Wärmeatlas)".

## 2026-11-25 · owner · Claude · economics review: Operation's best case and prices, the network's asset lives

A review of the economic calculations (every Case 1 figure reproduced by hand from the code; no unit or arithmetic
error) found choices that made the figures misleading; all fixed, each with a test showing old and new:
- **Best case** (`operation.ts summaryOf`): picked across price spreads, so the headline came from doubled price swings
  (2,048,559 €, −123,923 € vs heat-led). Now only scenarios at the page's spread (and still no what-if).
- **Prices** (`FEES_EUR_KWH` 0.10, `BACKUP_EUR_KWH` 0.076, were 0.14 and 0.11): electricity was about a third dearer
  than the heat network's (BDEW 179 €/MWh), the backup half again its peak boiler's (gas 60 + CO₂ 60 €/t at 95 %);
  a test keeps them in step with `networkCost.ts DEFAULT_PARAMS`. The boiler efficiency of Heat Matching's CO₂ (90 %:
  the buildings' own boilers) and the network's (95 %: a new peak boiler) differ on purpose and stay.
- **Bars** "Waste heat used" showed avoided backup heat (data center heat + the heat pump's electricity): now *Backup
  avoided*; `dcMwh` → `plantMwh`.
- **Operation's plant** takes Heat Matching's tank loss and τ (were the defaults), its plant-model COP clamped as
  `matchHeat` runs it; the price rule draws the tank after its standing loss (as the step does).
- **Network** (`networkCost.ts`): the grid connection fee had a residual value under the pipes' 40 years, the pumps too:
  the fee is now `soft` (paid once, no value left), the pumps their own 20 years. The residual value's escalation was
  checked and already follows VDI 2067 (not changed).
Case 1 moved: network NPV 2,762,387 € → 2.58 M€ (cost of heat 120 → 121 €/MWh; without residual unchanged 0.72 M€;
sensitivity table in `docs/concepts/heat-network.md` and the wiki re-read from the page). Operation on the synthetic
year: best case MPC · Storage of 4 h 1,611,583 € (−77,881 €, −4.6 % vs heat-led), heat-led as set above 2,149,417 →
1,689,639 €; plant heat 22,886 MWh (MPC buys ~970 MWh of backup where the price ÷ COP passes 0.076 €/kWh). Heat
Matching's figures unchanged (78.98 %, 23,700.9 MWh, 6,131.7 MWh). Checks below.

## 2026-11-25 · owner · Claude · page review: bugs found by clicking through every page

- Operation started a new year-long job every ~4 s while open (new input arrays each render, `PlanningPage`
  `opSeries` memo): now one job per change.
- Heat Matching ran a district with a measured demand on a default profile (Case 4: 2.37 GWh against 0.17 measured):
  `districtSource` takes the measurement until the variable is moved (`parts.ts`).
- Quick analysis' *As in Heat Matching* named this card's guess of the extraction point, not Heat Matching's.
- Scenarios mode: the KPI tiles showed the whole file over every year under a title without a period: now the
  period's (as Historical) and *test period* once a run is in; the step count formatted.
- Heat Matching named the data center's heat "Trained model · LR" without a trained model: *Measured* or *Site map*.
- German: "IT … kW · 2 Entnahmepunkte" (was "Entnahmepunkte: IT … · 2"), the year line, rows/other/reads/measured,
  "x % von … gedeckt", running hours; years as "J"; chart axes as every number ("12.500", "0,2"; `germanTicks`
  in `europeanTime`); no hyphenation inside buttons.
- No 404 for an unsaved starter graph's drivers; "1 start"; minus signs in the bars; the year line's dates in UTC
  (a week showed 8 days); no setpoint text without a change; the guide starts at Case 1.
Files: `pages/twin/` (`operation.ts`, `HeatPumpOperation.tsx`, `PlanningPage.tsx`, `matchingSetup.ts`,
`HeatDistributionPage.tsx`, `YearPicker.tsx`, `MatchDetail.tsx`), `pages/heat/` (`parts.ts`, `HeatFlowDiagram.tsx`),
`pages/district/` (`networkCost.ts`, `QuickWindow.tsx`), `pages/datacenter/` (`DashboardPage.tsx`, `WhatIfCard.tsx`,
`ResultsCard.tsx`, `useTrainSetup.ts`), `ui/LineChart.tsx`, `lib/` (`matching.ts`, `period.ts`, `i18n.de.ts`),
`index.css`, `pages/help/guide.ts`, tests beside them; docs `user-guide`, `heat-network`, wiki, `AGENTS.md`.
Checks: typecheck, lint, vitest (729), build, docs `-W`, e2e on 7614 181 of 181 (`heat.spec.ts` now expects the measured demand), the pages checked in a browser
(one Operation job, Case 4 0.16 GWh, German texts). Open: Operation's scenario names stay English in German (they are
typed values); overlapping labels in the P&ID and structure drawings; MAE without units for some variables; the
heat-lines 404 without a Wärmeatlas import (the route's documented answer).

## 2026-11-25 · owner · Claude · privacy: the testbed example removed

The Site map's second built-in example named a real site and organisation, and the real testbed's dataset folders, in
committed files (against Hard rule 1). It is gone: the entry in `frankfurtDataCenters.ts`, its German texts, its rows
in the About and Assistant pages, the tests' names (`dataset.test.ts`, `shell.test.ts`, `frankfurtDataCenters.test.ts`,
the e2e specs `district` and `assistant`, which now use the simulation example), and the mentions in `.gitignore`,
`AGENTS.md` and the docs (`user-guide`, `data-and-privacy`, `dashboard`, `causal-graph`, `district-demand`). The
generic dataset kind `testbed` stays. A real site belongs in the machine-local `_local/map_examples.json`. Still in
the first commit's history (pushed): rewriting it is the owner's call. Checks: typecheck, lint, vitest (723), docs
`-W`; e2e `district` and `assistant` on 7614.

## 2026-11-25 · owner · Claude · container: first build and run

`docker compose up --build` built (1.1 GB, without TabPFN/torch/Chronos-2) and ran: 178 of 181 e2e passed on it. Two
fixes from it. (1) A saved TabPFN model without TabPFN installed was a 500 that broke Evaluate for every model
(`sim_1_modified` ships one): `tabpfn_regressor` now raises `twin.NotInstalled`, `load_model` maps it to 501 (simulate,
the rolling comparison's per-run error), Evaluate scores the others and names it under `skipped` (the page shows the
reason), train answers 400. (2) `.dockerignore` kept `sim_blank`'s committed `pid_construct.json` out of the image.
Files: `core/twin/learners.py`, `core/twin/__init__.py`, `routers/training.py`, `tests/test_api_training.py`,
`web/src/api/models.ts`, `modelling/useTrainSetup.ts`, `.dockerignore`, `docs/architecture/api.md`. Checks: ruff,
pytest (879) and `-m slow` (10), typecheck, lint, vitest (723), build, docs `-W`, the container rebuilt: Evaluate on
`sim_1_modified` answers with `skipped`, `modelling.spec.ts` 5 passed. Expected on the default image: the Chronos-2
e2e (`operation.spec.ts:161`) fails without `IDT_ML=1`. Not checked: `IDT_ML=1` build, the `data` service. Example
numbers unchanged (no model or fit changed).

## 2026-11-25 · owner · Claude · web tests: CI's first run

CI's first run failed in `npm test`: `src/lib/staleBuild.test.ts` used the global `sessionStorage`, which Node has
only from version 25 (local machine), not in CI's Node 22. The test now stubs it with a Map, as `storage.test.ts`
does for `localStorage`. Files: `app/web/src/lib/staleBuild.test.ts`. Checks: vitest under Node 22 (723 passed),
typecheck, lint. Not checked: CI itself (runs after the push).

## 2026-11-24 · first commit of this repository

The Intelligent Digital Twin (DC2HEAT) as its own repository: the app (FastAPI backend, React page, MCP server), its
documentation, the agent wiki, the simulated examples (`app/data/sim_*`) and a container (`Dockerfile`,
`compose.yaml`). Earlier history stays in the repository the app came from.
