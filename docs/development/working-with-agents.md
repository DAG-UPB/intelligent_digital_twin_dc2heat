# Working on the code (humans and AI agents)

This page is the short contract for anyone changing the app, whether a developer or an AI coding agent. It says where things live, how to add the common kinds of feature step by step, and which rules are not negotiable. The same rules, with the commands and the module map on one page, are in `AGENTS.md` at the root of the repository (`CLAUDE.md` points to it). A teammate (or their agents) starting here reads its section *Working here* first: setting up from a clone with the examples complete, the examples-only app on port 7612 (`app/scripts/examples_app.py`) to look at and test against, the core modules to be careful with, the Operation page's files, and the change register `CHANGES.md`, where every change handed over is noted.

---

## Who owns what

The code is split by folder, and each folder has one kind of responsibility. When several people or agents work at the same time, each takes **whole folders or files**, and asks the owner for a change anywhere else rather than editing it.

| Folder | Contains | Must not contain |
|---|---|---|
| `app/backend/core/` | Pure computation on data frames, arrays and dicts: the twin, equations, symbolic regression, lag discovery, dataset files, limits. Raises `ValueError` with a readable message. | FastAPI, HTTP status codes |
| `app/backend/pid/` | The P&ID reader: drawing file → plant graph. Standard library only. | FastAPI, network calls |
| `app/backend/routers/` | One module per area of the API: parse the request, call core, map errors to status codes, read/write the dataset folder | Science |
| `app/backend/deps.py`, `schemas.py`, `app.py` | Shared dependencies, request/response models, app assembly | |
| `app/tests/` | pytest, synthetic data only | Real data, real drawings |
| `app/web/src/api/` | The **only** place that calls `fetch` (through `http.ts`) | UI |
| `app/web/src/lib/` | Pure TypeScript logic with a `*.test.ts` next to it | React |
| `app/web/src/ui/` | Shared components (Card, Field, Slider, Dialog, LineChart, …) and their styles | Page-specific logic |
| `app/web/src/pages/<section>/` | Pages and their parts: `district/`, `heat/`, `datacenter/{structure,modelling,scenarios}/`, `help/` | Raw `fetch`, copied inline styles |
| `app/web/src/app/` | Shell: layout, top bar, routes, theme | |
| `docs/` | This documentation | |

**Where does pure logic go?** If it can be tested without HTTP or a browser, it goes in `backend/core/` (Python) or `web/src/lib/` (TypeScript) with a test next to it — not in a router or a component.

---

## How to …

### … add an API endpoint

1. **Logic** in `app/backend/core/<module>.py`: a plain function with type hints and a docstring; raise `ValueError("what is wrong")` on bad input.
2. **Route** in `app/backend/routers/<area>.py`. Take the dataset as `meta: Dataset` (from `backend/deps.py`, answers 404 for an unknown id) and the registry as `registry: Registry`; use the helpers in `deps.py` for data files, graph files and model names. Turn `ValueError` into `HTTPException(400 | 404 | 422, str(exc))`.
3. **Models**: request/response pydantic models in `app/backend/schemas.py`, with a `description` on every field (it shows on the OpenAPI page at `/api/docs`).
4. **New router module?** Give it a module-level `router = APIRouter(prefix=..., tags=[...])` and add the module to the loop in `create_app` (`app/backend/app.py`), which runs before the static mounts.
5. **Test** in `app/tests/test_api_<area>.py` with the `client` and `api` fixtures (`client.get(f"{api}/...")`), including the error cases.
6. **Route list**: add the route with a good request and its status to `ROUTES`, and its error cases to `BAD`, in `app/tests/test_routes.py`. `test_every_route_is_listed` fails for a route that is not there, and `test_openapi_reference_is_complete` fails for one without a `summary`, a docstring (its description) and a tag.
7. **Client** in `app/web/src/api/<area>.ts` with `getJson` / `postJson` / `putJson` from `http.ts`; it is re-exported by `api/index.ts`.
8. **Docs**: add a row to {doc}`../architecture/api`.

### … add a page

1. Write the component in `app/web/src/pages/<tab>/…` (pure logic in `src/lib/` with a test).
2. Add a sub-route to the tab in `TABS` in `app/web/src/app/routes.ts` (`{ id, label }`).
3. Map `"<tab>/<sub>"` to the component in `PAGES` in `app/web/src/app/App.tsx`.
4. Add the route to `ROUTES` in `app/web/e2e/smoke.spec.ts`.
5. Add a step to the walkthrough in `app/web/src/pages/help/guide.ts`, with a `go` link to `"<tab>/<sub>"`. This is required: `guide.test.ts` fails when a page of `TABS` is not visited by the walkthrough.
6. Never rename or remove an existing route: moved pages keep their old address through the `OLD` alias table in `routes.ts`.

### … add a model kind

1. **Learner** in `app/backend/core/twin/learners.py`: `fit_<kind>(X, y, tr, ok) -> Learned` (X has a column of ones first; return predictions for every row). Import heavy libraries inside the function. Register it in `LEARNERS`.
2. **Request**: add the kind to the `model` literal of `TrainRequest` in `app/backend/schemas.py`.
3. **Persistence**: if the kind has a non-JSON learned part, return it as `booster` (and `sample` if it must be refit from rows). Then extend the places that know the booster kinds: saving in `save` / `_save_boosters`, loading in `load` / `_load_boosters` in `core/model_store.py`, and the `kind in ("xgboost", "tabpfn")` check in `core/twin/simulate.py`.
4. **Memory**: put any size limit in `app/backend/core/limits.py`; check the peak under the watchdog.
5. **Tests** in `app/tests/test_twin.py` and `test_api_training.py` (mark `slow` if it loads a big library).
6. **Web**: add the kind to `ModelKind` in `app/web/src/api/models.ts`, and to `KINDS`, `STRUCTURES` (with a new fixed model name and colour) and `TAG` in `app/web/src/lib/modelCatalog.ts`.
7. **Docs**: a section in {doc}`../concepts/models`.

### … add an equation-library entry

The physics equation library (the "known equations" offered in Modelling) is `LIBRARY` in `app/web/src/lib/physicsLibrary.ts`. Each entry has:

| Field | Meaning |
|---|---|
| `id`, `group`, `name`, `about` | Identity and the explanation shown to the user |
| `expr` | The right-hand side in the equation language, with `{slot}` for a data variable and `{self}` for the predicted variable; both become `Name[t-1]` |
| `slots` | `{slot: {label, guess}}`: what each slot means, and a regex that picks a default column |
| `coefs` | `{name: {label, typical}}`: every other name in `expr`, learned from data or fixed by the user |
| `target` | Regex of the variables the entry is offered for |

Use only the functions the backend allows (`exp log sqrt abs tanh sin cos arctan minimum maximum Min Max clip pdiv`, see {doc}`../concepts/models`). Check a filled-in expression with `POST /api/datasets/{id}/equations/check`.

### … add a component preset

The component presets (used by *Heat distribution*) are `PRESETS` in `app/backend/core/component_library.py`: plain dicts in the shape of `Component` (`backend/schemas.py`) with `id, name, kind, inputs, nodes, outputs, params, notes, source`.

1. Write the nodes in the equation language ({doc}`../concepts/components`): `Name[t]` for inputs and earlier nodes, `Name[t-1]` for state, a parameter for every other name. Mark the parameters a user should fit with `fixed: False`.
2. Cite where the equations and numbers come from in `source`, and the arithmetic (e.g. published COP ÷ Carnot COP) in `notes`. A heat pump of another size is one `_heat_pump(...)` call.
3. `tests/test_components.py:test_every_preset_checks_and_runs` checks and runs every preset.
4. To be offered on Heat distribution, the preset needs the kind's two nodes in `CONTRACT` (`app/web/src/pages/heat/partComponents.ts`): `COP`, `Q_max` (heat pump), `Q`, `T_cold_out` (heat exchanger), `E_max`, `loss_pct` (storage).
5. Add a row to the library table of `docs/concepts/components.md`.

### … add a dataset (data center)

1. Create `app/data/<id>/` with at least one parquet file: a `time` column (datetimes) and numeric columns. Any folder with a parquet file is a dataset, and the folder name is its id. The **first** file (sorted) gives the columns, time range and resolution.
2. Optional, next to it: `dataset.json` (display `name`, `kind` = `simulation` / `testbed` / `real` for the picker group, `actuators`, `heat`, `levers`, `heat_source`) and a `causal_graph.json`. Without a graph, Structure and Modelling starts empty and the twin has nothing to train on (see {doc}`../architecture/data-and-privacy`).
3. Make the app see it: restart, or `POST /api/datasets/refresh`.
4. **Privacy:** only a simulation may be committed, and its folder must be named `sim_*`. Every other folder under `app/data/` is ignored by git (`.gitignore`). Never rename a real dataset to `sim_*`. A script that writes datasets must refuse to write a non-simulation into a path git would track, as the local import scripts in `app/data/_local/scripts/` do.
5. For a reproducible dataset, write a script in `app/scripts/` (paths from `$IDT_*` environment variables, not hard-coded), with a test in `app/tests/test_scripts.py` that uses synthetic data.

### … change a limit

Change the constant in `app/backend/core/limits.py` (nowhere else), run the affected tests under the watchdog, and update {doc}`../concepts/evaluation` or {doc}`../concepts/models` if the number is quoted there.

---

## Rules

1. **Privacy.** Never open, print, copy or commit anything under `app/data/` except the simulations `app/data/sim_*`. Never commit a P&ID drawing, `pid.png` or `pid_plant.json`. Tests use synthetic data and synthetic drawings only. Nothing about a data center leaves the machine.
2. **Memory.** Run servers and Python test suites under the 8 GB watchdog, `bash app/scripts/guard.sh <cmd>` ({doc}`development`). Heavy libraries are imported lazily; limits live in `limits.py`.
3. **Lags.** Graph files store negative lags; inside the twin and in lag discovery they are positive (see {doc}`../concepts/causal-graph`). Links start at lag 1. Discovered lags are a suggestion: **never write them to a graph file automatically** — only the user's save does.
4. **Stable contracts.** Keep these byte-identical unless a migration is planned: HTTP URLs and JSON shapes, hash routes (and the `OLD` aliases), `localStorage` keys, dataset file names and formats (`causal_graph*.json`, `dataset.json`, `site.json`, `equations.json`, `models/*`, `pid.png`, `pid_plant.json`), the project format (`"dc-twin-project"`), and the model names (`linear`, `linear_all`, `xgb`, `xgb_all`, `phys`, `sym`, `tabpfn`).
5. **Style.** Comments say *why*, not what. Short docstrings on every module and public function. Python: type hints on public functions, `ruff check` and `ruff format` clean. TypeScript: strict, no `any` without a reason, no unused code.
6. **Verify before you report.** Run the checks of the area you touched ({doc}`testing`) and say honestly what you could not check.
7. **Docs follow code.** Code shown in this documentation is included from the source by function name (`:pyobject:`), so renaming or moving a function breaks the docs build (`-W` turns that into an error). Update the `literalinclude` and the text with it.
