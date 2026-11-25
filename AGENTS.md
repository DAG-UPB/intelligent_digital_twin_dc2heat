# AGENTS.md: operating manual for AI agents and humans

**Intelligent Digital Twin** (DC2HEAT) is a local web app that learns a causal digital twin of a data center from its measurements. It asks what-if questions of that twin and matches the data center's waste heat against a district's heat demand. It is one Python process (FastAPI) plus a React page. It needs no database or cloud service and stays within a 2 GB memory budget.

Full technical documentation: `docs/` (Sphinx), served by the app at `/docs/` once built. API reference: `/api/docs` on the running app. Agents: search the agent wiki `wiki/` first (`wiki_search` / `wiki_read`, or grep; start at `wiki/index.md`) for domain facts and where they live in the code.

---

## Repository layout

| Path | What | Touch? |
|---|---|---|
| `app/` | **The app**: `backend/` (FastAPI), `web/` (Vite + React + TS), `tests/` (pytest), `scripts/` (dataset scripts: `make_sim_1_modified.py` air-cooled, `make_sim_cases.py` the free-cooling cases `sim_1_air` and `sim_1_water`, `make_sim_blank.py` the blank case `sim_blank`, `make_sim_box.py` the free-cooling cases in the new form `sim_box_air` and `sim_box_water`; `guard.sh`), `examples/` (one folder per example case with its generator and README: `recovery_air_cooled/make.py` writes `sim_recovery_air`, heat recovery up to the district loop's capacity as far as the loop's cold pipe lets it, with a closed energy balance and a PUE of ~1.21, ~38,000 MWh of heat a year (all its electricity; ~28,000 MWh of it recovered), and trains its models; `district_heat_demand/make.py` writes `sim_district_heat`, a separate district's demand on its own weather, to match against it in Heat Matching), `data/` (datasets) | yes |
| `app/data/` | One folder per data center. **Only `app/data/sim_*` may ever be committed**; everything else is real data and git-ignored | read only through the app; never open real data |
| `app/data/_local/` | The user's private, machine-local material, never committed: `map_examples.json` (extra Site-map examples, `GET /api/district/examples`) and `scripts/` (local import scripts). Missing on another computer: the app then shows only the built-in example (the simulations). Never name or describe real sites anywhere else in the repo | no |
| `docs/` | Technical documentation (Sphinx + MyST + sphinx-book-theme) | yes |
| `wiki/` | Agent wiki: dense domain knowledge (data centers, cooling, temperatures, district heating, the interfaces, modelling, profiles, the example datasets) and where each lives in the app; Markdown with `title`/`tags`/`summary` front matter, entry `wiki/index.md`, how to add a page `wiki/README.md`; read by the MCP tools `wiki_search` / `wiki_read` | yes |
| `.github/workflows/ci.yml` | What CI runs (lint, fast tests, typecheck, hook rules, vitest, build): GitHub Actions with this folder as the repository root; installs from the tracked `app/uv.lock` | yes |

---

## Run

```bash
cd app
./start.sh                           # http://localhost:7600 (builds web/dist if web/src changed, uv sync, uvicorn)
./start.sh examples                  # http://localhost:7612: the examples only (no data folder, no real data)
bash scripts/guard.sh ./start.sh     # the same under the 2 GB watchdog (kills the process tree above 2 GB)
kill $(lsof -ti tcp:7600)            # stop the one on 7600 (or Ctrl+C in its terminal); restart after a backend change
```

The first start installs everything (a few minutes); `start.sh` rebuilds the page only when `web/src` changed. Started by a person, it opens the browser on the Site map with Case 1 (`/?case=1#/twin/map`: `openStartCase` in `app/DataCenterPicker.tsx` picks the case before the first page renders). An agent starts it in the background without a browser (`NO_BROWSER=1 nohup bash scripts/guard.sh ./start.sh examples > /tmp/idt.log 2>&1 &`) and waits for `curl -sf localhost:7612/health`.

| Port | What |
|---|---|
| 7600 | Backend: API `/api/...`, OpenAPI `/api/docs`, built web app `/`, built docs `/docs/` |
| 7601 | `cd app/web && npm run dev`: Vite dev server with hot reload, proxies `/api` to 7600 |
| 7612 | `./start.sh examples`: the same app on the examples only (`scripts/examples_app.py`) |

`start.sh` sets `OMP_NUM_THREADS=1` (and friends) and disables telemetry (`OTEL_SDK_DISABLED`, `HF_HUB_DISABLE_TELEMETRY`). `PORT` overrides 7600. The watchdog limit is `GUARD_MB` (default 2048).

## Commands

| Task | Command (directory) |
|---|---|
| Setup | `uv sync` (`app/`) · `npm install` (`app/web/`) |
| Backend tests, fast | `bash scripts/guard.sh .venv/bin/python -m pytest -q` (`app/`) |
| Backend tests, slow (TabPFN, tigramite, gplearn) | `bash scripts/guard.sh .venv/bin/python -m pytest -q -m slow` (`app/`) |
| Lint / format Python | `.venv/bin/ruff check backend tests scripts` · `.venv/bin/ruff format backend tests scripts` (`app/`) |
| Typecheck / unit tests TS | `npm run typecheck` · `npm test` (`app/web/`) |
| React's hook rules | `npm run lint` (`app/web/`; ESLint with `eslint-plugin-react-hooks` only, `eslint.config.js`; in CI: no findings allowed) |
| Build the web app | `npm run build` → `app/web/dist` (`app/web/`) |
| End to end (needs a running app) | `npm run e2e`, or `E2E_BASE_URL=http://localhost:<port> npx playwright test e2e/<area>.spec.ts` (`app/web/`) |
| Docs | `uvx --with-requirements requirements.txt --from sphinx sphinx-build -W --keep-going -E -b html . _build/html` (`docs/`; needs nothing installed), or `bash build.sh -E` with `docs/requirements.txt` installed in your own venv (`uv sync` does not install Sphinx). Every warning is an error. The app mounts `/docs/` only if `docs/_build/html` existed at startup: restart it after the **first** build; later rebuilds are served without a restart |
| Container (Docker; the folder of this file) | `docker compose up --build` (examples only, http://localhost:7612) · `IDT_DATA=/path/to/data docker compose up --build data` (a data folder mounted at `/data`, http://localhost:7600; without `IDT_DATA` a Docker volume). `Dockerfile` (page with Node, docs with Sphinx, Python with `uv sync --frozen` without TabPFN/torch/Chronos unless `--build-arg ML=1` / `IDT_ML=1`; user `app`, `UID` build arg), `.dockerignore` (of `app/data` only `sim_*`), `compose.yaml` (published on 127.0.0.1 only, `mem_limit: 2g`, `PORT`, `IDT_ALLOWED_HOSTS`; healthcheck `/health`). `scripts/examples_app.py` listens on `IDT_HOST` (default 127.0.0.1) |
| MCP server (agents use the app as tools; needs the running app) | `.venv/bin/python -m backend.mcp_server` (`app/`); Claude Code starts it from `.mcp.json` (server `digital-twin`). `IDT_URL` overrides `http://127.0.0.1:7600` |
| What CI runs | `.github/workflows/ci.yml` (GitHub Actions, on every push and pull request; this folder is the repository root): ruff check + format check, fast pytest (`uv sync --frozen` from `app/uv.lock`, without TabPFN/torch), typecheck, lint (React's hook rules), vitest, build. No e2e, slow tests or docs build: run those yourself |
| Wärmeatlas import (once, for the Site map's heat-demand layer) | `bash scripts/guard.sh .venv/bin/python scripts/import_waermeatlas.py` (`app/`): downloads LEA's Frankfurt zip (255 MB) into the git-ignored `data/_external/waermeatlas/` and writes `buildings.sqlite` (R-tree, ~9 s, ~35 MB RSS); pass other LEA delivery names (e.g. `06411000_Darmstadt`) to add municipalities. Never commit it (© LEA Hessen) |
| Electricity market data (Operation's price and CO₂) | Nothing to run: put SMARD's CSV downloads (smard.de, CC BY 4.0, hourly, English or German export, any years) into `app/data/_market/elec_price/` (Großhandelspreise, day-ahead) and `app/data/_market/elec_generation/` (Realisierte Erzeugung); `IDT_MARKET_DATA` points elsewhere. Read on request by `core/market.py` (`GET /api/market/hourly`); git-ignored, never committed |

---

## Module map

### Backend (`app/backend/`)

| Module | Responsibility |
|---|---|
| `main.py` · `config.py` | `app = create_app(DATA_DIR, WEB_DIST, DOCS_HTML)` for `uvicorn backend.main:app` · paths, `ALLOWED_HOSTS` (env `IDT_ALLOWED_HOSTS`) |
| `app.py` | `create_app(data_dir, web_dist, docs_html, allowed_hosts)`: registry on `app.state`, Host check + same-site Origin check on writes, routers, `/health`, OpenAPI at `/api/docs`, static mounts (`/docs` → `/docs/`), NaN/inf → `null` |
| `deps.py` | `Dataset` (404), `Registry`, `dataframe`, `graph_path`, `read_graph`, `model_file`: core errors → status codes |
| `schemas.py` | Every pydantic request/response model; `Permissive` (`DistrictSettings`, `DatasetConfig`: files the web writes, described for OpenAPI, kept as they are). `tests/test_contract.py` checks that each model and the TS interface of the same name in `web/src/api` (or `dataset.ts`) name the same fields: rename both |
| `routers/datasets.py` · `graphs.py` · `training.py` · `site.py` · `project.py` · `pid.py` | One module-level `router` per concern: datasets + time series + dashboard summary · graph files + lag discovery · equations, train / evaluate / simulate · `site.json` · project export/import · P&ID upload/extract/preview |
| `mcp_server.py` | MCP server over stdio (stdlib only): one tool per API route, generated from the OpenAPI schema, calls proxied to the running app; plus `ui_snapshot` (the open page: images, controls, text, details, commands), `pid_view` (P&ID image with a 0..1 grid and the placed variables, zoom by region), `pid_place` (writes `site.json` `pid_layout`), `read_docs`, `wiki_search` / `wiki_read` (the agent wiki `wiki/`); `INSTRUCTIONS` is the agent's guide to the pages |
| `core/registry.py` | `DatasetRegistry`: scans the data folder and adds the examples of `app/data` it has no copy of (in every project, marked `example`; each keeps its own folder), cached data frames; `DatasetMeta.file(name)` is where a dataset's file lives |
| `core/storage.py` | **Every file location** of a data folder (flat: examples, version_1; structured: `datacenter_data/`, `models/`, `district_data/`, `heat_distribution_data/`, `status/`). Never join paths in a data folder elsewhere: ask `meta.file(...)` / `registry.storage`. The one module to replace for a database |
| `core/data_versions.py` · `routers/data_versions.py` | The user's data folder (`app/data_versions`, a git-ignored link) and its version folders, the examples (`app/data`); switch, browse folders, OS folder dialog, re-link |
| `core/documents.py` · `routers/documents.py` | The user's documents about a data center's physical structure (any file, kept as it is, never opened by the app) in its silver `documents/`, each with a note and the P&ID view it is about (`documents.json`): keep, list with their paths, open, describe, remove, a text written by an assistant |
| `core/import_folder.py` | A new data center from a folder (`GET /api/data-versions/scan`, `POST .../import`): data (CSV to parquet) to bronze, `dataset.json`, graphs or a starter graph to silver, its P&ID read; never into the examples, never over an existing data center |
| `core/live.py` · `routers/live.py` | Working live with an assistant: every successful write is announced to the open pages (SSE `/api/live/events`, tagged with the writing page's `X-Client-Id`); the page reports its screen (`PUT /api/live/ui`); MCP tools `ui_state` (what the user sees) and `ui_do` (click / fill any control, navigate, open_dataset, scroll, message, and the page commands of `COMMANDS`: P&ID and map gestures, Heat Matching's `set_window` / `set_part_way`, `set_profile_shape`), refused until the user connects the agent: Connect AI's one-time code (`POST /api/live/pair-code`, page only) → `connect_app` (`POST /api/live/pair`) → the token as `X-Agent-Token` (kept by `mcp_server.py`). `COMPUTE_ONLY` (POSTs that write nothing) lives here |
| `core/waermeatlas.py` · `routers/waermeatlas.py` | Wärmeatlas buildings of one map box from the local `buildings.sqlite` (R-tree; UTM 32N → WGS84) · `GET /api/district/buildings`, `GET /api/district/examples` |
| `core/map_examples.py` | The machine-local Site-map examples of `_local/map_examples.json` (validated; `[]` when missing) |
| `core/market.py` · `routers/market.py` | The electricity market by the hour from SMARD's CSV downloads in the market folder (`config.MARKET_DIR`: `app/data/_market/`, env `IDT_MARKET_DATA`): the DE/LU day-ahead price and the grid's CO₂ from the generation mix (`CO2_G_PER_KWH`, as the group's `pyest` package); `GET /api/market/hourly` |
| `core/dataset_files.py` | Folder-layout constants, graph read/write, name validation, `NOT_GRAPHS` |
| `core/derived.py` | Calculated columns (`dataset.json` `derived`, HEX heat Q = m·cp·ΔT): never modelled; computed from predicted parts in simulate |
| `core/prepare.py` · `routers/prepare.py` | Prepared variables (Dashboard › Prepare variables): combine / transform / time features / formula; recipe in `dataset.json` "prepared", values in `<dataset folder>/prepared/<file>.parquet` (silver), read back as extra columns by the registry; preview, add, remove (each answer lists the files written) |
| `core/resample.py` | Aggregated data files (Dashboard › Aggregate data): a delivered file at a coarser step, a method per variable; written to silver as `<file>__<step>.parquet`, listed as a data file (routers/prepare.py) |
| `core/twin/estimate.py` | Training-time estimate (AI modelling, under Train): `fit.plan` (the same plan fit() follows) × measured costs per learner; `POST .../models/estimate` |
| `core/recommend.py` | Preprocessing recommendations (gaps, meter counts, outliers, long tails, kelvin, near-duplicates, constant, irregular time), each with the prepared-variable step that fixes it |
| `core/summary.py` | Dashboard numbers of one data file: statistics, histograms, gaps, correlations, downsampled series, data-center KPIs (`dataset.json` `kpi`, chosen on the Dashboard: `PUT .../kpi`) |
| `core/model_store.py` | Saved models (`models/<name>.json` and its `.boosters/`): save whole under one lock per model file, load (boosters cached per file mtime, one TabPFN in memory), content hash, the free-run and simulation caches; `routers/training.py` gives the paths and maps `ModelMissing` to 404 |
| `core/limits.py` | **Every** memory and size limit |
| `core/causal_discovery.py` | `discover_lags`, `relag_graph` (tigramite PCMCI / PC) |
| `core/physics.py` · `core/symbolic.py` | Equation language + coefficient fit · symbolic regression (gplearn + sympy) |
| `core/components.py` · `core/component_library.py` · `routers/components.py` | Components (a plant part as a small causal graph): check, graph, run, fit of the learnable parameters · the presets (HEX, storage, DH heat pumps with sources, DC unit) · `/api/components` (saved in `app/data/_components/`, local only) |
| `core/rolling.py` | Rolling comparison: trained models (`twin.simulate`) and Chronos-2 rolled over a period day-ahead or free, with interventions, scored against the measurement; `POST .../models/compare` (`routers/training.py`); the card `web/src/pages/datacenter/modelling/RollingCard.tsx`. XGBoost and torch in one process need `OMP_NUM_THREADS=1` (start.sh sets it; else a segfault) |
| `core/foundation.py` · `routers/foundation.py` | Chronos-2 (pretrained forecaster, dependency group `foundation`, weights in the Hugging Face cache): a demand over a year, day-ahead on the measurement (`rolling`) or from a weather (`from_weather`); `POST .../foundation/demand`; Heat Matching's *Demand from* (`web/src/pages/heat/useFoundationDemand.ts`) |
| `core/twin/` | `graph.py` (drivers, inputs, step order), `learners.py` (linear, XGBoost, TabPFN), `fit.py`, `simulate.py`, `evaluate.py`; `__init__` re-exports |
| `pid/` | P&ID reader (stdlib only): `read_drawing`, `sniff`, `components_of`, `plant_fractions`; `instruments.py` (instrument bubbles: a circle with an ISA code); `construct.py` (the digital construct: the drawing as shapes with values, `pid_construct.json`, `GET/PUT .../pid/construct`); `dexpi.py` (DEXPI / Proteus XML, the standard machine-readable P&ID: read exactly, and drawn as the picture); `views.py` (the files of the P&ID's views: a picture and its construct per view, their backups, the view's area made the picture's shape) |

### Frontend (`app/web/src/`)

| Module | Responsibility |
|---|---|
| `main.tsx` · `app/App.tsx` | Entry · shell: top bar, sub-tabs, lazy page per route behind an `ErrorBoundary` |
| `app/routes.ts` | Hash routes `#/<tab>/<sub>`, `TABS`, `HOME` (default), `HELP`, the `OLD` alias table, `resolveRoute` |
| `app/theme.ts` · `app/TopBar.tsx` · `app/ConnectAi.tsx` · `app/ProjectPicker.tsx` · `app/DataCenterPicker.tsx` · `app/cases.ts` · `app/ProjectButtons.tsx` | Palette × light/dark, `useThemeKey` · header · Connect AI (the agent's one-time code, Disconnect) · project select (top bar, right: a data folder version) · the three systems' dataset selects and the Case select (right of the sub-tabs; a case: the three datasets and their models, examples plus the browser's `cases` key) · save/open project |
| `dataset.ts` | `DATASET`, the page's dataset (a live binding set by the shell with `openDataset` before the page renders; per page `localStorage["dataset:<tab>/<sub>"]`, else `localStorage["dataset"]`), `chooseDataset` (no reload), `switchDataset` (reloads), `datasetConfig()` |
| `api/` | **The only HTTP client**: `http.ts` (`getJson`/`postJson`/`putJson`/…, FastAPI `detail` errors) + one module per router |
| `lib/` | Logic with tests (pure, except `demandStore.ts` and `period.ts`, which load data through `src/api`): `demand.ts`, `demandStore.ts`, `matching.ts`, `sourceMap.ts`, `period.ts`, `format.ts`, `modelCatalog.ts`, `physicsLibrary.ts`, `plantLinks.ts`, `errors.ts`, `externalInputs.ts` (Heat Matching's weather and demand from another dataset), `networkTemps.ts` (the network's supply on a heating curve), `profile.ts` + `profilePresets.ts` (profile generator: a total per unit and period becomes a curve by hour, weekday, month and weather; standard profiles incl. BDEW gas SLP, cited; `siteDemand`: the site's sinks by their profiles), `learnedModels.ts` + `aalborgModel.json`, `helsinkiPublicModel.json` (standard profiles learned from measured buildings: homes from 3,021 Aalborg homes, offices and public buildings from 258 Helsinki service buildings) |
| `ui/` | Shared components and `ui.css`: Card, Field, NumberField, Slider, Segmented, Switch, Kpi, Dialog, ErrorBanner, ErrorBoundary, LineChart (uPlot), MaskIcon, ShapeBars (a shape to draw, one bar per value), CurveEditor (curves over a day to draw: points and lines) |
| `pages/district/` | Site map (Leaflet, `osm.ts`, `bubbles.ts`, Wärmeatlas layer `WaermeatlasPanel.tsx` + `waermeatlas.ts`; `SitePage` with `useSiteDocument` (the site, `dirty`, update, Save, Discard), `useLeavePrompt` and `useFloatingPanel`; the heat network card `HeatNetwork` with `useNetworkData` and `useNetworkLayer`), its dashboard, and `structure/`: its Structure and Modelling (`PidPage` with a `StructureSetup`, scope `district`; `districtLayout.ts`, `lib/districtLibrary.ts`) |
| `pages/heat/` | Heat distribution (flow diagram, cards, charts, `window.ts`, `parts.ts`: each part's Model or Calculation and the on/off units; `lib/ports.ts` (re-exported as `ports.ts`): the connection points between the parts, two temperatures + Q or ṁ, and the shared weather; `partComponents.ts`: a unit's component, its plant model) · `structure/`: the heat distribution's Structure and Modelling, the data center's `PidPage` with a `StructureSetup` (scope `heat`, `HeatDrawing`, `heatLayout.ts`: spots and taps). One module: change `PidPage` and its parts once, both pages change |
| `pages/twin/` | The Intelligent Digital Twin (the three parts together): Operation (`matchingSetup.ts`: what Heat Matching last ran, in the browser's `heat-matching` key, the plant Operation runs on by default; `PlantSketch.tsx`: that plant, small, top left; `planning.ts`: design options; `operation.ts` + `HeatPumpOperation.tsx`: the heat pump's control strategies, heat-led, price rule, MPC; `useOperationRuns`: the worker); Heat Matching (`HeatDistributionPage`, made of the heat distribution's parts in `pages/heat/`; each part runs its Model, read at its connection points, or a Calculation; `matchingInputs.ts`: the demand and the supply, pure; `useMatchRun`: the units' plant models and the matching; `SystemLoads.tsx`: the three model-and-system folders) |
| `pages/datacenter/dashboard/` · `structure/` (`PidPage` with `usePidViews`, `useVariableOps`, `useConstructEdits`, `usePidCommands` (the assistant's commands); `PidCanvas`'s props in four groups; built-in drawings: `DrawnEquipment` air-cooled, `DrawnLiquid` + `liquidLayout.ts` liquid-cooled) · `modelling/` (`PortsCard`: the part's connection points, on top; `approaches.ts`: each variable data-driven, physical or a profile, moved in `VariablesCard`; `ProfilesCard`: the profile ones) · `scenarios/` · `shared/` (also `ProfileGenerator`, in each structure's Modelling) | Visualization and Scenarios of every part (one module: `DashboardPage` with `scope`, also the heat distribution's and the district's; `partView.ts`: a part's variables and KPIs; `WhatIfCard`: levers → KPIs of any part's twin; statistics, charts, correlations; `dashboard.ts`) · Structure and Modelling (`structure/`: P&ID + causal graph, and under it `modelling/`'s TrainPage, also under the heat distribution's) · Scenarios (`step/`, `simulation/`) · causal mini map and HEX view used by Modelling and Scenarios |
| `lib/live.ts` · `api/live.ts` | The page's side of the live link: `effectOf` (refresh / reload on someone else's change), `useCommand` (what a page can do for the assistant), `useSnapshotDetail` (what it shows as numbers, merged over the parts on screen), `useReportPage` / `useUnsaved` (what it shows; unsaved edits hold back a refresh); `lib/snapshot.ts` (controls, text, images) and `app/assistant.ts` (the requests). The shell listens in `app/App.tsx` |
| `pages/help/` | Home, the landing page and default route (`home.ts`: one line per page) · What is this? · How to use (`guide.ts`: keep button names in step with the pages) |

---

## Conventions

- **Pure logic goes where it can be tested:** `backend/core/` (Python) or `web/src/lib/` (or a plain `.ts` next to the page), each with a test next to it. Routers and components stay thin.
- **One router per concern.** It parses the request, calls core, maps `ValueError` to 400/404/422 and does the dataset-folder I/O. Request/response models live in `schemas.py`. Routes have no return annotation (see `docs/architecture/backend.md`).
- **Import directions** (`web/src/imports.test.ts` fails otherwise): `lib/` imports no page, `api/` no value from `lib/`, `ui/` not `app/`, and nothing outside `pages/twin/` imports it. What cannot move yet is allow-listed there with its reason.
- **HTTP only through `web/src/api/`.** No `fetch` in pages. The one exception is the public OpenStreetMap services, called from `pages/district/osm.ts`.
- **UI primitives from `web/src/ui/`** and the shared classes (`.card`, `.field`, `.btn…`, `.page`, `.caps`). Colours come only from the CSS tokens in `index.css`. Do not copy inline style objects.
- **Tests next to modules:** `*.test.ts` beside the `.ts`; pytest in `app/tests/` with synthetic data only (`tests/synthetic.py`, `tests/pid/pid_drawings.py`).
- **Comments say why**, not what. Every module and public function gets a short docstring. Python is typed and ruff-clean; TypeScript is strict, with no `any` without a reason and no unused code.
- **Simple over clever:** no new runtime dependency unless unavoidable, no class hierarchy for one implementation. Heavy Python libraries are imported inside the function that needs them.
- **Docs follow code:** docs include code by `:pyobject:` / `:start-at:`. When you rename a function, fix the `literalinclude` and rebuild with `-W`.

## Hard rules

1. **Privacy.** Only `app/data/sim_*` may ever be committed. Never open, print, copy or `git add` anything else under `app/data/`. Never commit a P&ID drawing, `pid.png`, `pid_plant.json` or `pid_construct.json` (git-ignored for every dataset). Do not upload data or drawings anywhere over the network. A project file (`GET .../project`) of a real data center is confidential too: TabPFN models carry measured rows, so do the setpoint windows of a stored evaluation (`models/evaluation.json`), and `pid_plant.json` is included. Tests use synthetic data and synthetic drawings only.
2. **Memory.** The app has a 2 GB budget. Run servers and Python test suites under `app/scripts/guard.sh`. Limits live only in `backend/core/limits.py`.
3. **Lags.** Links start at lag 1; graph files store negative lags, the twin and lag discovery positive ones. Discovered lags are a suggestion: **never write them to a graph file automatically**, only the user's Save does.
4. **Stable contracts.** Keep HTTP URLs and JSON shapes, hash routes and the `OLD` aliases, `localStorage` keys (`dataset`, `dataset:<tab>/<sub>`, `theme`, `palette`), dataset file names and formats (`causal_graph*.json`, `dataset.json`, `site.json`, `streets.json`, `equations.json`, `models/*` (`models/evaluation.json` is the stored evaluation, not a model: `evaluation` is no model name), `pid.png`, `pid_plant.json`), the project format `"dc-twin-project"`, and the model names (`linear`, `linear_all`, `xgb`, `xgb_all`, `phys`, `sym`, `tabpfn`).
5. **Real data is read-only for tests and agents.** Every E2E spec calls `readOnly(context)` (`e2e/readonly.ts`), which aborts every non-GET `/api` request except the compute-only POSTs; a write a spec must see is mocked with `page.route`. Never press Save / Train / *Use as P&ID* / *Open project* against real data, and never call an MCP tool marked `[writes]` on real data unless the user asked for that change. MCP tool results go to the LLM's provider: a P&ID image or time series of a real data center leaves the machine that way (`docs/architecture/mcp.md`).
6. **Verify before you report**: run the checks of the area you touched and say what you could not check.
7. **Register every change** in `CHANGES.md` (below): a teammate and their agents work here too.

---

## Working here: a teammate and their agents

Read this section before your first change. It is how this repo is worked on, by people and by agents.

### Set up from a fresh clone

1. `uv sync` (`app/`; installs the dev and the `foundation` group: Chronos-2 runs locally, its weights, ~0.9 GB, download to the Hugging Face cache on its first run) · `npm install && npm run build` (`app/web/`).
2. The examples are committed under `app/data/sim_*`. What the app makes from them (`silver/`: prepared variables, the district's structure and its trained models) is git-ignored: regenerate the main example in full with `OMP_NUM_THREADS=1 bash scripts/guard.sh .venv/bin/python examples/recovery_air_cooled/make.py` (`app/`, about a minute: data, models, the district's structure and models). Every example's generator has a `README.md` next to it.
3. `./start.sh` makes a new person's project folder on its first start (`~/Documents/DC2HEAT-data/version_1`, or `IDT_DATA`) and links it as `app/data_versions`; a link already there is kept. Look at the app on the examples only: `./start.sh examples` (`app/`, port 7612: no data folder linked, no real data). Screenshots, end-to-end tests (`E2E_BASE_URL=http://localhost:7612 npx playwright test --project=app`) and experiments with the MCP tools go there, never to someone's 7600 with real data. It serves `web/dist`: `npm run build` after a frontend change.

### How to work

- **One change at a time**: make it, check it, show it (a screenshot from 7612), then the next. Ask before reorganising a page or the navigation. A large batch of changes made at once has been thrown away before.
- **Read before you change**: the module's docstring, its test, and every caller (`grep`). A bug is fixed where all callers pass through, not in the one the report names.
- **Run the checks of what you touched** (Commands above): Python → `ruff check` + `ruff format --check` + fast `pytest` (and `-m slow` when you touch learners, causal discovery or symbolic regression); web → `npm run typecheck`, `npm test`, `npm run build`; a page → its e2e spec on 7612; docs → the Sphinx build with `-W`. Say in your report what you ran and what you could not check.
- **Formatting**: ruff for Python. The TypeScript is wide (~160 characters a line) and not run through prettier; format a new file with `npx prettier --print-width 160`, never reformat an existing one.
- **German**: every static English text of a page (JSX text, `label`/`title`/`hint`/`aria-label` literals) needs its entry in `web/src/lib/i18n.de.ts`; `lib/i18n.guard.test.ts` fails otherwise and warns about entries no source has any more.
- **Numbers on screen** go through `fmt` (`web/src/lib/format.ts`, German: `12.345,6`). Do not format with `toFixed` or `toLocaleString` in a page.
- **Commit only when asked**, and never stage data that is not `app/data/sim_*` (Hard rules).

### Core modules: careful

Every page's results depend on these. Change them only with a test that shows the old and the new behaviour, keep their JSON shapes and the model names, run the slow tests, re-run `examples/recovery_air_cooled/make.py` and write in `CHANGES.md` how the example's numbers moved (R², coverage, CO₂).

| Module | Why it is core |
|---|---|
| `backend/core/twin/` (`graph`, `learners`, `fit`, `simulate`, `evaluate`) | Every model: training, free runs, the Scenarios page, Heat Matching's Model, the rolling comparison. Saved models (`models/*.json`, boosters) must still load |
| `backend/core/physics.py` · `core/symbolic.py` | The equation language; every saved `equations.json` must still parse |
| `backend/core/causal_discovery.py` | Lag discovery; its lags are suggestions, never written by itself (Hard rule 3) |
| `backend/core/prepare.py` · `core/storage.py` · `core/registry.py` | Prepared-variable recipes saved in datasets; where every file lives; what the app lists |
| `backend/core/rolling.py` · `core/foundation.py` | The rolling comparison and Chronos-2 (XGBoost and torch in one process need `OMP_NUM_THREADS=1`) |
| `web/src/lib/matching.ts` | The hour-by-hour matching of Heat Matching, Operation's design options and the Site map's Quick analysis |
| `web/src/pages/datacenter/scenarios/` · `modelling/` (`approaches.ts`, `TrainPage`) | Scenarios and the modelling page of all three parts (one module, three scopes) |
| `web/src/lib/demand.ts` · `lib/profile.ts` · `lib/profilePresets.ts` · `lib/learnedModels.ts` | Every district demand and profile |

### The Operation page (`web/src/pages/twin/`, `#/twin/planning`)

| File | What |
|---|---|
| `PlanningPage.tsx` | The page: the plant it runs on (top left, `PlantSketch.tsx`), *Runs on* Heat Matching / *Define here*, the key figures beside it, the design options and their comparison |
| `matchingSetup.ts` | What Heat Matching last ran (the browser's `heat-matching` key, written by `HeatDistributionPage.tsx` once its numbers settle): the data center's heat, the demand, the supply, the COP, the heat pump and storage. Operation runs on it by default; open Heat Matching once first |
| `HeatPumpOperation.tsx` | The strategies' card: the plant's settings, the scenarios (sizes, price spread, the what-ifs *Demand ×* and *DC heat ×*), the saving bars (`ui/BarChart.tsx`), by month, per year, a week or a month of hours |
| `operation.ts` · `operation.worker.ts` · `useOperationRuns.ts` | The worker's job (`operationJob`, each scenario's plant and prices) and its runs (`useOperationRuns`: one worker, 250 ms debounce, the latest answer wins); the plant step, heat-led, the price rule, the MPC (dynamic programming over the tank's level), the yearly and monthly breakdown, the price and CO₂ (SMARD's market data, `marketSeries` / `marketPrice`, else the synthetic year `syntheticPrice`); the runs go to a worker. The tank is a bucket (kWh, loss %/h) or, with `OpPlant.rc`, a 1-node RC tank with a temperature (`tankStep`: cooling with τ, kW limits, serves only above the supply); charging it costs COP (`chargeCop`, `hpLimit`, needs `OpSeries.supply` and `tSrc`) |
| `planning.ts` | The design options and their key figures (`matchHeat` runs) |

Tests: `operation.test.ts`, `planning.test.ts`, `e2e/operation.spec.ts`. Know before you change it: the MPC knows the next 24 h of demand and heat exactly (perfect foresight: its saving is an upper bound); its plan ignores the heat pump's start-up lag τ (an open decision: a start penalty), so where it would cost more than heat-led over the period (a slow heat pump, a short look-ahead) it runs heat-led (`totals.heatLed`, a note under the scenarios); the electricity price and the grid's CO₂ are SMARD's (day-ahead DE/LU, the generation mix's direct emissions) where the market folder has its files, else a synthetic German-shaped year; the best case beside the plant only compares scenarios at the page's price spread and without a what-if; its default fees (0.10 €/kWh) and backup price (0.076 €/kWh) follow the heat network's prices (`FEES_EUR_KWH`, `BACKUP_EUR_KWH`, checked by a test); its tank loss and τ are Heat Matching's; the RC tank is only here (Heat Matching and `lib/matching.ts` keep the bucket), and the data center's avoided cooling is counted only when a cooling concept is picked (*Data center cooling avoided*: `coolingPerKwh`, `rejectorWater`, the cooling concepts of a standalone data center model, a wet tower, dry, adiabatic or hybrid cooler with free cooling and a Carnot chiller, not its load profile; on the outdoor temperature and humidity Heat Matching saves in its setup; only when the heat pump takes the heat ahead of the cooling, extraction point `hall` (chilled water 6.67/12 °C) or `liquid` (the loop's temperature as its return, 10 K below as its supply); at the condenser the cooling runs as before and nothing is counted).

### The examples

| Dataset | What | Generator |
|---|---|---|
| `sim_recovery_air` | *Recovery · air cooled*: a 5 MW data center in the European Central Bank's building on Frankfurt's weather (ERA5, 2023 and 2024), PUE ~1.21, an IT load from ~10 % to 100 % (the hall's level held for weeks, so the twin answers a scenario at any load); its hall heat to a district loop (up to 4.3 MW) as far as the loop's cold pipe lets it (the pipe warms in summer), ~38,000 MWh of electricity → heat a year (~28,000 MWh of it recovered); its own seasonal district (~30,200 MWh, about 75 % covered through the 5 MW heat pump) with a structure, prepared inputs and the same six models as the data center's (`linear`, `phys`, `xgb`, `linear_all`, `xgb_all`, `sym`), each set with its stored evaluation (`models/evaluation.json`); the Site map's heat sinks around it and the streets for its heat network (`streets.json`, from `district_streets.json`, OpenStreetMap, ODbL). Case 1 | `app/examples/recovery_air_cooled/make.py` |
| `sim_district_heat` | A separate, smaller district's measured demand on its own weather (~5,500 MWh). Case 3 | `app/examples/district_heat_demand/make.py` |
| `sim_box_air`, `sim_box_water` | Small free-cooled data centers whose heat stays below their district's demand (no surplus: Operation's strategies cannot differ). Case 4 | `app/scripts/make_sim_box.py` |
| `sim_1`, `sim_1_modified`, `sim_1_air`, `sim_1_water`, `sim_blank` | EnergyPlus simulation A1 and its plant variants; a blank structure to draw | `app/scripts/make_sim_*.py` |

The cases (a data center, a heat distribution and a district with their models, one pick) are `EXAMPLE_CASES` in `web/src/app/cases.ts`.

### The change register (`CHANGES.md`)

Newest first, one entry per change you hand over: the date, who (person · agent), the area, what changed and why, the files, the checks you ran (and what you could not check), what stays open. Keep it short; the details are in the code and the docs.

---

## Recipes

Step-by-step versions with all details: `docs/development/working-with-agents.md`.

- **Add an endpoint:** logic in `backend/core/<module>.py` (raise `ValueError`) → route in `backend/routers/<area>.py` with `meta: Dataset`, `registry: Registry`, helpers from `deps.py` → models in `schemas.py` → new module? add it to the router loop in `create_app` → test in `tests/test_api_<area>.py` (`client`, `api` fixtures) → a case in `ROUTES` (good request + status) and the error cases in `BAD` of `tests/test_routes.py` (`test_every_route_is_listed` fails otherwise; the route needs a `summary` and a docstring for the OpenAPI check) → client in `web/src/api/<area>.ts` → row in `docs/architecture/api.md`. The route is an MCP tool automatically; a POST that only computes also goes into `COMPUTE_ONLY` (`backend/core/live.py`) and `COMPUTE_ONLY` (`web/src/api/http.ts`, also used by `e2e/readonly.ts`).
- **Add a page:** component in `web/src/pages/<tab>/` (logic in a tested `.ts`) → sub-route in `TABS` (`app/routes.ts`) → entry in `PAGES` (`app/App.tsx`) → route in `e2e/smoke.spec.ts` → a step with a `go` link to `<tab>/<sub>` in `pages/help/guide.ts` (required: `guide.test.ts` fails for a page the walkthrough does not visit). Never rename a route; add an `OLD` alias.
- **Add a model kind:** `fit_<kind>` in `core/twin/learners.py` + `LEARNERS` → `model` literal of `TrainRequest` (`schemas.py`) → booster save/load in `core/model_store.py` and the booster check in `core/twin/simulate.py` → limits in `limits.py` → tests (`slow` if heavy) → `ModelKind` (`web/src/api/models.ts`), `KINDS`/`STRUCTURES`/`TAG` (`web/src/lib/modelCatalog.ts`) → section in `docs/concepts/models.md`.
- **Add a component preset:** a dict in `PRESETS` (`backend/core/component_library.py`) with `id, name, kind, inputs, nodes, outputs, params, notes, source` (cite where the numbers come from); a heat pump of another size is one `_heat_pump(...)` call. `test_every_preset_checks_and_runs` checks it. For Heat distribution to offer it, the kind's nodes in `CONTRACT` (`web/src/pages/heat/partComponents.ts`) must exist. Add a row to the library table of `docs/concepts/components.md`.
- **Add an equation-library entry:** an object in `LIBRARY` (`web/src/lib/physicsLibrary.ts`) with `id, group, name, about, expr` (`{slot}`, `{self}`), `slots`, `coefs`, `target`; only the whitelisted functions; check with `POST /api/datasets/{id}/equations/check`.
- **Add a dataset:** `app/data/<id>/` with parquet file(s) (`time` + numeric columns), optional `dataset.json` and `causal_graph.json` → restart or `POST /api/datasets/refresh`. Only `sim_*` folders may be committed.

---

## Documentation

| Chapter | File |
|---|---|
| Overview and workflow | `docs/index.md` |
| User guide | `docs/user-guide.md` |
| Concepts | `docs/concepts/` (`dashboard`, `causal-graph`, `models`, `evaluation`, `scenarios-simulation`, `heat-distribution`, `components`, `district-demand`, `heat-network`, `simulated-heat-recovery`, `pid-extraction`, `datacenter-variables`) |
| Architecture | `docs/architecture/` (`overview`, `backend`, `frontend`, `api`, `mcp`, `data-and-privacy`) |
| Development | `docs/development/` (`development`, `testing`, `working-with-agents`) |
| Roadmap | `app/PLAN.md` |
