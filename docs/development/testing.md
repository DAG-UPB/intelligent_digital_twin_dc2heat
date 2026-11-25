# Testing

Three layers of tests, none of which needs real data-center data or a real P&ID drawing.

| Layer | Tool | Where | Command |
|---|---|---|---|
| Backend unit + API | pytest | `app/tests/` | `cd app && .venv/bin/python -m pytest -q` |
| Web pure logic | vitest | `app/web/src/**/*.test.ts` | `cd app/web && npm test` |
| End-to-end smoke | Playwright (Chrome) | `app/web/e2e/` | `cd app/web && npm run e2e` (needs a running app) |

Plus static checks: `ruff check backend tests scripts` (and `ruff format`) for Python, `npm run typecheck` for TypeScript. `npm run check` runs typecheck, vitest and the production build (`web/dist`) in one go. `.github/workflows/ci.yml` is the reference for what CI runs (see below).

---

## Backend (pytest)

Configuration lives in `app/pyproject.toml`: tests are in `tests/`, both `app/` and `app/scripts/` are on the import path, and **tests marked `slow` are skipped by default**.

```bash
cd app
.venv/bin/python -m pytest -q            # fast tests (seconds)
.venv/bin/python -m pytest -q -m slow    # slow tests only: TabPFN, gplearn, tigramite (minutes, more memory)
```

Run both under the 2 GB watchdog, `bash scripts/guard.sh .venv/bin/python -m pytest -q` (see {doc}`development`). The `slow` marker is for tests that load torch/TabPFN, run gplearn or run tigramite: `test_tabpfn.py`, `test_causal_discovery.py`, single tests in `test_symbolic.py`, `test_twin.py` and `test_api_graphs.py`, and the lag-discovery case of `test_routes.py`.

### Synthetic fixtures

`tests/synthetic.py` builds a small dataset with **known dynamics**, so a test can check that the twin recovers them:

$$
\begin{aligned}
u_t &\sim \mathcal{N}(0, 1) && \text{noise driver} \\
s_t &\in \{0, 1, 2\},\ \text{steps every 50 h} && \text{lever} \\
y_t &= 0.8\, y_{t-1} + 0.5\, u_{t-1} + 0.3\, s_{t-1} + \varepsilon_t && \\
z_t &= 2\, y_t + 1 + \varepsilon'_t && \text{same step: evaluated after } y
\end{aligned}
$$

600 hourly rows, with the matching causal graph (including the lag-0 link $y \to z$) and a `dataset.json` whose lever is `s`. `tests/conftest.py` writes it into pytest's `tmp_path` as dataset `sim_x` and gives every test a `TestClient` over `create_app(tmp_path)` — the real app over a temporary data folder, without the web page or the docs.

P&ID tests use drawings built in code (`tests/pid/pid_drawings.py`): minimal valid PDFs with uncompressed content streams and small SVGs, so no real (confidential) drawing is ever needed. `test_pid_read_drawing.py` compares the reader's output on them against golden snapshots.

<details>
<summary><b>Source code:</b> <code>tests/synthetic.py</code> (make_frame), <code>tests/conftest.py</code> (client)</summary>

```{literalinclude} ../../app/tests/synthetic.py
:language: python
:pyobject: make_frame
```

```{literalinclude} ../../app/tests/conftest.py
:language: python
:pyobject: client
```

</details>

### What is covered

| File | Covers |
|---|---|
| `test_twin.py` | fit / simulate / free run / evaluate on systems with known dynamics |
| `test_physics.py` | Equation parsing, the safety whitelist, the coefficient fit |
| `test_symbolic.py` | gplearn programs as equations, the symbolic fit (slow) |
| `test_tabpfn.py` | TabPFN models (slow) |
| `test_causal_discovery.py` | Lag discovery (slow) |
| `test_dataset_files.py` | Graph names and files, graph read/write, legacy migration, model names |
| `test_registry.py` | Dataset discovery and the data-frame cache |
| `test_summary.py` | The Dashboard summary (`core/summary.py`): statistics, gaps, completeness, pairwise and constant-column correlations, downsampling, KPIs and their units, and `GET .../summary` |
| `test_api_datasets.py`, `test_api_graphs.py`, `test_api_training.py`, `test_api_site_project.py` | The behaviour of each HTTP route, error cases included |
| `test_routes.py` | Every route is listed in `ROUTES` (`test_every_route_is_listed` fails for a route added without a case); the OpenAPI reference has a summary, description and tag on each operation; good input (`ROUTES`), bad input (`BAD`) and an unknown dataset (404) answer with the right status |
| `test_contract.py` | The contract with the web (no code generator): every pydantic model and the TypeScript interface of the same name in `web/src/api` (and `dataset.ts`) name the same fields; OpenAPI describes `DistrictSettings` and `DatasetConfig` (permissive: keys of their own kept, an odd value kept as it was, written back unchanged); every committed example's `site.json` and `dataset.json` loads and round-trips |
| `test_app.py` | API docs URL, static sites (and the `/docs` redirect), JSON without NaN, the Host check and the same-site Origin check on writes |
| `test_scripts.py` | The heat demand and the demand-limited HEX of `make_sim_1_modified.py` (values, demand limit, energy balance) and of the plant cases of `make_sim_cases.py` (free cooling, the chiller's heat only while it runs), the git privacy guard and the memory watchdog |
| `test_example_recovery_air.py`, `test_example_district_heat.py` | The example generators in `app/examples/` (`sim_recovery_air`, `sim_district_heat`): the hourly energy balance (IT, cooling, electrical losses and the building in) and $Q$ from its parts, the recovery that takes the hall's heat up to the loop as far as the loop's cold pipe lets it, the free cooling on the water the recovery leaves, the cooling plant that takes the rest (more in summer, when the pipe is warm), the size (a 5 MW data center) and a real facility's PUE beside a demand with its own noise, the district's weather and rhythm, graphs and equations at lag 1 |
| `pid/test_pid_*.py` | Readers, extractors, plant graph, `read_drawing` end to end, the P&ID routes |

---

## Web (vitest)

Pure logic of the web app lives in plain `.ts` modules with a `*.test.ts` file next to it (`src/lib/`, `src/api/`, `src/app/`, page helpers). vitest picks up `src/**/*.test.ts` (configured in `vite.config.ts`).

```bash
cd app/web
npm test            # vitest run
npm run typecheck   # tsc --noEmit
```

---

## End to end (Playwright)

The specs in `app/web/e2e/` drive the real app in the installed Google Chrome (`channel: "chrome"`, 1440 × 900, `app/web/playwright.config.ts`), with the dataset `sim_1_modified` selected through `localStorage`. They run against an app that is **already running**, by default the backend-served app on port 7600:

```bash
cd app && ./start.sh                                # or any running instance
cd app/web && npm run e2e                           # all specs, E2E_BASE_URL=http://localhost:7600
E2E_BASE_URL=http://localhost:7611 npx playwright test e2e/heat.spec.ts   # one area, another instance
```

The assistant specs are their own Playwright project (`assistant`, one worker): the app connects one agent at a time,
and the assistant works the tab in front, so they must not share the app with other open pages. Run them on their own,
on a freshly started app: `npx playwright test --project=app`, then `npx playwright test --project=assistant`.

| Spec | Covers |
|---|---|
| `smoke.spec.ts` | Every route (`#/home/start`, `#/twin/map`, `#/twin/matching`, `#/twin/planning`, `#/dc/dashboard`, `#/dc/pid`, `#/heat/dashboard`, `#/heat/structure`, `#/district/dashboard`, `#/district/structure`, `#/help/about`, `#/help/guide`, `#/help/assistant`) renders with no console error, no page error and no HTTP status ≥ 500; regression checks: bare `#/dc` opens the first sub, a palette change rebuilds the charts, replay does not rebuild them, the P&ID import dialog takes focus and closes on Escape |
| `dashboard.spec.ts` | Dashboard on `sim_1_modified`: overview and KPI cards, the variables table and its sorting, the time-series charts, the period filter and the variable chips, the 15 × 15 heatmap with cell titles, a cell click opens its scatter, the similarity order |
| `shell-help.spec.ts` | Header in one row with centred tabs, Home right of the logo, named tools, help navigation, theme and palette, a failing page shows an error box |
| `district.spec.ts` | Site map interactions (no OSM look-ups: external servers), the Quick analysis window and its forest as soccer fields (gone when hidden), the examples and the Wärmeatlas layer (mocked), the profile generator and the district's Modelling |
| `network.spec.ts` | The Site map's Heat distribution card on `sim_recovery_air`: plan the network on the stored streets, its metres, NPV and break-even, its pipes and station on the map (*On the map* off and on), the costs dialog (a higher heat price raises the NPV, BEW off, the funding gap, back to the defaults), drag the station; with the streets route mocked to 404, the *Load streets from OpenStreetMap* button and the box it would send (never clicked: an external server). Its assumptions live in the browser, nothing is saved |
| `heat.spec.ts` | Heat Matching: the three columns and their pipes, the shared weather, extraction points, window navigation, physics source, Model or Calculation of every part, the units switched off, what if (the year, the weather, each part's lever) |
| `structure.spec.ts` | Structure and Modelling (the structure): select and edit links, add a link, drag, stage slider, + Variable, Save as, heat-recovery choice, plant panel and lag discovery (both mocked) |
| `modelling.spec.ts` | Modelling (under the structure): settings, variables, equations and library, results; on `sim_recovery_air` the stored evaluation shown with no evaluate request, a variable picked on the drawing and in the columns with its models' scores (an input and a calculated column say why they have none), the Data-driven column's list, *Inspect* |
| `scenarios.spec.ts` | Scenarios: replay controls, mini map, a what-if run, a short test-period simulation |
| `graph-side.spec.ts` | The causal graph panel on the left: resize and close it, a variable picked there is selected on the drawing or shown on the Dashboard |
| `heat-structure.spec.ts` | The heat distribution's Structure and Modelling: its drawing and variables, its own graph files, causal discovery, Modelling under it, the new form |
| `components.spec.ts` | A plant model picked under the heat distribution's Connection points runs on Heat Matching |
| `matching-inputs.spec.ts` | Heat Matching's *Weather from* and *Heat demand from*: another dataset's series go into the data center's model |
| `operation.spec.ts` | Operation's heat pump operation (three strategies, the look-ahead no dearer than heat-led, storage and objective), Heat Matching's model per part and the network's temperatures (a heating curve) |
| `assistant.spec.ts` | Working live with an assistant: it sees and works the Structure and Modelling page, draws the construct, places instruments, moves the Site map |
| `assistant-pages.spec.ts` | The assistant's page details and commands on Heat Matching, the Site map's quick analysis, the dashboard and Structure and Modelling |
| `api.spec.ts` | The OpenAPI page at `/api/docs` and the shapes of the read-only endpoints |

```{important}
**E2E tests are read-only.** They run against the user's real data folder: every spec calls `readOnly(context)` from `e2e/readonly.ts` first, which **aborts every `/api` request that is not a GET before it is sent**, except the compute-only POSTs that write nothing (`COMPUTE_ONLY` in `src/api/http.ts`, the list the read cache uses too: `models/evaluate`, `models/<name>/simulate`, `equations/check`, `graph/discover-lags`, …) and the live link (the page's reports and answers, and Connect AI's `live/pair-code` and `live/pair`). A spec that needs to see a write mocks it with `page.route` (page routes take precedence over the context route), for example the graph save and lag discovery in `structure.spec.ts`, the site save in `district.spec.ts` and Re-prepare (`models/train`) in `scenarios.spec.ts`. Evaluate goes through with its `store` set to false: the page asks to store every evaluation beside the models (`models/evaluation.json`), a spec never does. A new spec must call `readOnly` in its `beforeEach` too.
```

Playwright matches names as substrings by default, so use `exact: true` for short button names: "Play" also matches "Playback speed …".

---

## Continuous integration

`.github/workflows/ci.yml` (GitHub Actions) runs on every push and pull request, in two jobs. Its paths are relative to the repository root, the folder that holds `AGENTS.md`; `app/uv.lock` is tracked for `uv sync --frozen`.

| Job | Steps (working directory) |
|---|---|
| `backend` (`app/`) | `uv sync --frozen` **without** TabPFN and its torch/CUDA stack (only the slow tests need them, and they are imported lazily) → `ruff check backend tests scripts` → `ruff format --check backend tests scripts` → `pytest -q` (fast suite) |
| `frontend` (`app/web/`) | `npm ci` → `npm run typecheck` → `npm test` → `npm run build` |

CI does not run the `slow` tests or the e2e specs: they need minutes, more memory, a running app or the real data. Run them locally before a change that touches models, lag discovery or the pages. The checkout contains only the tracked simulations (`app/data/sim_*`), and the tests create their own synthetic data.

If a future update of `uv.lock` pulls in new CUDA wheels, add them to `HEAVY` in `ci.yml`. Otherwise the backend job installs them, which still works but is slower.
