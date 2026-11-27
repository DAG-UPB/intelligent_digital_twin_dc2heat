# Data and privacy

All state of the app is files in `app/data/`. There is one folder per data center (a *dataset*); any folder that holds at least one parquet file is a dataset, and its folder name is its id.

---

## Dataset folder

```text
app/data/<id>/
├── *.parquet                    the measurements (file id = file stem); a "time" column + numeric columns
├── dataset.json                 display name, kind, actuators, heat variables, levers, P&ID image
├── causal_graph.json            the default causal graph
├── causal_graph_<variant>.json  other graphs (manual, pcmci, pc, dk_1..dk_5, discovered, user-saved)
├── equations.json               physics equations {variable: right-hand side}
├── site.json                    map, heat source and sinks, P&ID layout
├── streets.json                 the streets for the Site map's heat network (OpenStreetMap; an example's only)
├── weather_open_meteo.json      cached Open-Meteo temperatures (derived, git-ignored, only when chosen)
├── models/
│   ├── <name>.json              a trained model (fit result + training settings)
│   ├── evaluation.json          the last evaluation stored, while its models are unchanged (not a model)
│   └── <name>.boosters/         XGBoost boosters (<var>.json) or TabPFN context rows (<var>.npz)
├── pid.png                      the P&ID drawing as an image
├── pid_plant.json               the plant graph read from the drawing
├── pid_views/<view>.png         the pictures of the P&ID's views (site.json pid_views holds their areas)
├── pid_views/<view>.construct.json  the construct read from a view's picture (a PDF, SVG or DEXPI file)
└── .backup/<YYYYmmdd-HHMMSS>/   files replaced when a project was opened
```

| File | Written by | Read by | Format |
|---|---|---|---|
| `*.parquet` | Import scripts (outside the app) | Registry | Columns: `time` (datetime) and numeric variables. Metadata (columns, time range, row count, resolution) comes from the **first** file. |
| `dataset.json` | Import scripts; `POST .../pid` sets `pid_image` | `GET /api/datasets` (as `config`) | See below |
| `causal_graph*.json` | Scripts; `POST .../graph/save` | Graph routes, training | {doc}`../concepts/causal-graph` |
| `graph_manual.json` | Old versions | Renamed to `causal_graph.json` at discovery (if that is missing) | Legacy graph |
| `equations.json` | `PUT .../equations` | Training (physics) | `{"In_Temp": "a*In_Temp[t-1] + ..."}` |
| `site.json` | `PUT .../site` | Site, demand and heat pages | See below |
| `models/<name>.json` | `POST .../models/train` | Evaluate, simulate | {doc}`../concepts/models` |
| `models/<name>.boosters/` | `POST .../models/train` | Model loading | XGBoost JSON / numpy `.npz` (`X`, `y`) |
| `models/evaluation.json` | `POST .../models/evaluate` with `store` (Modelling sends it on every Evaluate) | `GET .../models/evaluation`, while every model it scored has the content hash it was stored with | The evaluate answer (the scores and each setpoint window's measured and predicted curves) plus the model names, levers, window and each model's SHA-256; above 2 MB without the windows ({doc}`../concepts/evaluation`). Never listed as a model; `evaluation` is not a model name |
| `streets.json` | An example's generator (`examples/recovery_air_cooled/make.py` copies `district_streets.json`) | `GET .../site/streets` (Site map › Heat distribution) | `{about, source, bbox, ways}`: OpenStreetMap ways as `[lat, lon]` lines; `source` carries the attribution (© OpenStreetMap contributors, ODbL 1.0) and the query. Not a causal graph (`NOT_GRAPHS`). Streets fetched on the page are never written here ({doc}`../concepts/heat-network`) |
| `weather_open_meteo.json` | `GET .../weather/open-meteo` (cache) | The same route | `{lat, lon, start, end, source, times, temperature}`; derived, git-ignored for every dataset, not in a project file ({doc}`../concepts/district-demand`) |
| `pid.png`, `pid_plant.json` | `POST .../pid` | `GET .../pid.png`, `GET .../pid/plant` | {doc}`../concepts/pid-extraction` |
| `<silver>/documents/*`, `documents.json` | `POST .../documents/{name}`, `PUT .../documents/{name}/text` | `GET .../documents`, `GET .../documents/{name}` | The user's documents about the physical structure, kept as they are (never opened by the app), with their notes and views; confidential, git-ignored, not in a project file |
| `<silver>/heat_structure/` | The same routes with `scope=heat` | The same routes with `scope=heat` | The heat distribution's own structure: its picture, construct, views, graph files and `site.json` layout, like the data center's; git-ignored (silver), not in a project file yet |
| `pid_views/<view>.png` | `POST .../pid/views/{view}` | `GET .../pid/views/{view}.png` | A view's own picture, drawn inside its area of the P&ID; git-ignored like `pid.png`, not in a project file |
| `.backup/<time>/` | `POST .../project` | — (manual recovery) | Same relative paths as the replaced files |

### `dataset.json`

| Field | Meaning | Example (`sim_1_modified`) |
|---|---|---|
| `name` | Display name | `"Simulation 1 · with heat exchangers"` |
| `kind` | `simulation`, `testbed` or `real` | `"simulation"` |
| `actuators` | Variables an operator controls (shown green) | `["Cool_Set", "IT_Load"]` |
| `heat` | Heat-related variables (shown orange) | `["Heat_Demand", "HEX_Hall_T_in", "HEX_Hall_T_out", "HEX_Hall_m", "HEX_Hall_Q", …, "HEX_Cond_Q"]` (see {doc}`../concepts/simulated-heat-recovery`) |
| `levers` | Setpoints scored by evaluation (setpoint-change windows) | `["Cool_Set"]` |
| `pid_image` | `"pid.png"` when the data center has a P&ID image, else `null` | `null` |
| `names` | Names shown in place of the variables' own (`PUT .../names`); the data keeps its own names | none |
| `heat_source` | Optional: per extraction point (`hall`, `condenser`; a liquid-cooled data center's `liquid`) the heat (`q`) and source temperature (`t`) variables, and optionally the hot side's `t_in`, `t_out` and mass flow `m`. The Structure and Modelling page and the Scenarios lists show only the variables of the point `site.json` → `hex_option` selects (its `q`, when calculated, as a read-out) | `{"hall": {"q": "HEX_Hall_Q", "t": "HEX_Hall_T_in", "t_in": "HEX_Hall_T_in", "t_out": "HEX_Hall_T_out", "m": "HEX_Hall_m"}, "condenser": {...}}` |
| `derived` | Optional: calculated columns, never modelled nor drawn as graph nodes: `{column: {m, t_in, t_out, cp}}` is $Q = m \cdot c_p \cdot (T_{in} - T_{out})$ (kW from kg/s, kJ/(kg·K), K). A predicted value is computed from the predicted parts | `{"HEX_Cond_Q": {"m": "HEX_Cond_m", "t_in": "HEX_Cond_T_in", "t_out": "HEX_Cond_T_out", "cp": 4.18}, …}` |
| `kpi` | Optional: the columns behind the Dashboard's data-center KPIs (`it_power`, `cooling_power`, `other_power` (the facility's other electricity: UPS and distribution losses, lighting, building; a list, summed; with it PUE is the full one), `heat_power` (the reused heat: a column or a list, summed) or `reuse` (`{option: column}`, one counted: `site.json` → `hex_option`), `heat_demand`) and the power unit (`power_unit`, e.g. `"kW"`). Without it the simulations' column names and `heat_source` are used; see {doc}`../concepts/dashboard` | `{"it_power": "ITE_Ener", "cooling_power": "HVAC_Ener", "heat_demand": "Heat_Demand", "reuse": {"hall": "HEX_Hall_Q", "condenser": "HEX_Cond_Q"}, "power_unit": "kW"}` |

Every field is optional for the backend, which passes the file through as `config` in `GET /api/datasets`. The `name` of a list entry itself is always the folder name in title case (`sim_1` → `Sim 1`); the display name is `config.name`.

### `site.json`

| Field | Meaning |
|---|---|
| `building` | The data center's building: `name`, `osm_id`, `outline` (`[lat, lon]` ring) |
| `source` | The heat source bubble: `id`, `name`, `lat`, `lon`, `temp_c`, `power_kw`, optional `outline`, `area`, `demand` |
| `sinks` | Heat sinks, same fields as `source`; `area: true` for a whole district drawn on the map; `demand` holds the demand-generator settings |
| `pid_layout` | `{variable: {x, y, tag}}`: where each variable's instrument sits on the P&ID and its ISA tag |
| `hex_option` | `condenser`, `hall` or `liquid`: which heat exchanger recovers the heat (also the reused heat of the Dashboard's ERF) |
| `district` | Heat-demand generator settings of the district (web model) |
| `outdoor` | Outdoor temperature of the heat demand: `data` (default), `synthetic` or `open-meteo` ({doc}`../concepts/district-demand`) |
| `heat_source_map` | Which columns are heat and temperature of the source, when `dataset.json` has no `heat_source` (Data Center › Modelling › Connection points) |
| `heat_parts` | Heat distribution: which parts are switched on, `{hex, hp, tank}` (a missing key, or no `heat_parts`, means on; {doc}`../concepts/heat-distribution`) |

Unknown keys are dropped on load (old files with a `blocks` key still load).

<details>
<summary><b>Source code:</b> <code>backend/schemas.py</code> (HeatPoint, Site)</summary>

```{literalinclude} ../../app/backend/schemas.py
:language: python
:pyobject: HeatPoint
```

```{literalinclude} ../../app/backend/schemas.py
:language: python
:pyobject: Site
```

</details>

---

## Project files

A **project** is everything built on top of a dataset — site, causal graphs, equations, models with their boosters — in one JSON document, so it can be saved, shared or restored. The parquet files are not in it: the project names its dataset and can only be opened on a dataset of the same id. *Save project* in the top bar writes it into the data folder (`POST .../project/save`): `status/<id>/<id>-project-<date>_<time>.json` in a structured version, `_status/<id>/` in a flat folder (`core/storage.py` `status_dir`), a new file at every save, so the saved states are a history. *Open project* loads such a file; `GET .../project` returns the same document without writing it. The prepared variables' `recipe.json` is not in a project (their values are not either), and a structure's files (`heat_structure/`, `district_structure/`) land in that structure's folder whatever the layout of the version they came from.

```{warning}
**A project of a real data center is confidential.** It is not free of measured data:

- a trained **TabPFN** model keeps up to 1000 measured rows (inputs and target) per modelled variable as its context (`models/tabpfn.boosters/<var>.npz`, see {doc}`../concepts/models`);
- every model file holds per-variable statistics of the training data (minimum, maximum, mean, error spread) and the time where training ends;
- the stored evaluation (`models/evaluation.json`) keeps the **measured** curve of every modelled variable in each window after a setpoint change, beside the predicted one;
- **`pid_plant.json`**, the plant graph read from the P&ID drawing (component tags, positions, pipes), is included, although git never tracks it.

Share a project only where the data and the drawing may be shared.
```

```json
{
  "format": "dc-twin-project",
  "version": 1,
  "dataset": "sim_1_modified",
  "saved": "2026-10-22T18:04:00",
  "files": {
    "causal_graph.json": {"text": "{\"targets\": ...}"},
    "models/linear.json": {"text": "..."},
    "models/tabpfn.boosters/In_Temp.npz": {"base64": "..."}
  }
}
```

Which files: every `*.json` at the top of the folder (an example's `streets.json` too: public OpenStreetMap data), `models/<name>.json`, and `models/<name>.boosters/<var>.json|.npz` (names of letters, digits, `_`, `-`). Note that this pattern includes `dataset.json` and `pid_plant.json`, but not `pid.png` or the parquet files. Opening a project first **moves** every current project file to `.backup/<time>/`, then writes the project's files; paths outside the pattern or containing `..` are refused.

<details>
<summary><b>Source code:</b> <code>backend/routers/project.py</code> (ALLOWED, open_project)</summary>

```{literalinclude} ../../app/backend/routers/project.py
:language: python
:start-at: FORMAT = "dc-twin-project"
:end-before: def _project_files
```

```{literalinclude} ../../app/backend/routers/project.py
:language: python
:pyobject: open_project
```

</details>

---

## Privacy

The measurements of a real data center, the models learned from them and its P&ID drawings can be commercially sensitive. The rules below are enforced in code and in git, not left to discipline.

**Only simulations go to GitHub.** The repository's `.gitignore` ignores everything under `app/data/` except the simulation folders `app/data/sim_*`. Inside those, backups (`.backup/`), P&ID files (`pid.png`, `pid_plant.json`, `pid_views/`) and the derived Open-Meteo cache (`weather_open_meteo.json`) are ignored too — drawings are never committed, not even for a simulation.

```{literalinclude} ../../.gitignore
:language: text
:start-at: "# Real data-center"
:end-at: app/data/*/pid_plant.json
```

**Outside data: the Wärmeatlas Hessen.** `scripts/import_waermeatlas.py` downloads LEA's building heat-demand data once into `app/data/_external/waermeatlas/` (the zip and the unpacked GeoPackage, git-ignored, and the `buildings.sqlite` index, committed so that the team has it without the download: the owner's decision). The data is © LEA Hessen without an open licence: it must never go into a public copy of the repository, a public Space or the Docker image (`.dockerignore` leaves `_external/` out). *Load heat demand in view* on the Site map sends the map box to the **local** backend only, which reads it from that file: the area you look at is not sent anywhere ({doc}`../concepts/district-demand`). The open atlases of `app/sources/` (NRW: `sources/nrw/fetch.py`) work the same way: downloaded once into `app/data/_external/<source>/` and read locally; NRW's `buildings.sqlite` is committed (dl-de/zero-2.0), the downloads are not. A file records the downloads it was built from (`parts_of`), so adding a municipality on another machine downloads those first instead of dropping them.

**Outside data: OpenStreetMap streets.** The Site map's heat network runs along OpenStreetMap's streets and paths (© OpenStreetMap contributors, Open Database License 1.0). An example stores them as `streets.json`, with that attribution in its `source` field, and the card names it under the plan; the committed `sim_recovery_air/streets.json` is a copy of `app/examples/recovery_air_cooled/district_streets.json`, fetched once with one Overpass query. For a data center without stored streets the page asks Overpass only when you click *Load streets from OpenStreetMap*, sending the box of the heat sinks plus 150 m; the answer stays in the page and is never written to the dataset.

**Outside data: SMARD's electricity market.** Operation's price and CO₂ come from SMARD's CSV downloads (CC BY 4.0) that the user puts into `app/data/_market/elec_price/` and `app/data/_market/elec_generation/` (`config.MARKET_DIR`, env `IDT_MARKET_DATA` for another folder). Git-ignored like all of `app/data/`; nothing is fetched.

**Machine-local material: `app/data/_local/`.** The user's private, machine-local material lives in `app/data/_local/` and is never committed (git-ignored like all of `app/data/`; it holds no parquet file, so it is never listed as a dataset). If it is missing, the app shows only the built-in example (the simulations). Today it holds:

- `map_examples.json`: further example data centers for the Site map, a JSON array in the shape of the built-in ones (`name`, `address`, `lat`, `lon`, `heatKw`, `basis`, `source`, optional `buildings` and `labelLeft`), served by `GET /api/district/examples` (invalid entries are skipped; a missing, malformed or too large file gives `[]`).
- `scripts/`: the import scripts of the real data sets. They refuse to write a non-simulation dataset unless git would ignore it (`git check-ignore`).

A test checks the ignore rules (`tests/test_scripts.py:test_privacy_guard`).

**Your components: `app/data/_components/`.** Components saved through the API (`PUT /api/components/{id}`) are `<id>.json` files there, git-ignored like all of `app/data/` (a fitted one carries numbers learned from your data). The CSV of *Fit to my data* goes only to the local backend, is read in memory and never stored ({doc}`../concepts/components`).

**Local processing.** The backend computes everything in its own process. `start.sh` turns off the telemetry of the libraries that have it (`OTEL_SDK_DISABLED=true`, `HF_HUB_DISABLE_TELEMETRY=1`). P&ID drawings are read locally and their temporary files deleted (see {doc}`../concepts/pid-extraction`).

**Only the local machine may call the API.** The server listens on `127.0.0.1`, but that alone does not stop a website in the browser from reaching it: a site whose name is made to resolve to `127.0.0.1` (DNS rebinding) could read the data, and any site can send a "simple" cross-site POST (for example `text/plain` to the raw-body P&ID routes) without a preflight. Two checks in `create_app` close this:

- **Host check** (Starlette's `TrustedHostMiddleware`): a request whose `Host` header is not one of the allowed host names gets `400 Invalid host header`.
- **Origin check on writes:** a `POST`, `PUT`, `PATCH` or `DELETE` whose `Origin` header names another host (or is `null`, as from a sandboxed frame or a local file) gets `403 Cross-site request refused`. Requests without an `Origin` (curl, scripts, the tests) are not affected.

The allowed host names are `localhost`, `127.0.0.1`, `[::1]` and `testserver` (FastAPI's `TestClient`), the same for both checks. To reach the app under another name, set **`IDT_ALLOWED_HOSTS`** to a comma-separated list before starting it (for example `IDT_ALLOWED_HOSTS=localhost,127.0.0.1,mybox.local`); `*` turns both checks off.

The documentation site is served on the same origin as the API (`/docs/`), so the scripts it loads from a CDN could call the API too: `docs/conf.py` pins them to exact versions, and MathJax is also checked by its hash (`integrity`).

**What does go over the network.** No measurement, model, graph or drawing is sent anywhere. These requests do leave the machine, and each one reveals the user's IP address to the service:

| Request | From | When | What it contains |
|---|---|---|---|
| Map tiles (OpenStreetMap, Esri World Dark Gray Canvas and World Imagery) and address / building look-ups (OpenStreetMap Nominatim, Overpass) | the browser | on the Site map | map positions and search text |
| The streets of the heat network (Overpass, `overpass-api.de`) | the browser | only on a click of *Load streets from OpenStreetMap* on the Site map's Heat distribution card, for a data center without stored streets | the box (south, west, north, east) of the heat sinks plus 150 m, at most 3 km across |
| The Wärmeatlas Hessen zip of Frankfurt (255 MB, `scripts/import_waermeatlas.py`) | the import script | once, when you run it | nothing but the download request |
| An NRW municipality's zip of LANUK's Kommunale Wärmeplanung (`sources/nrw/fetch.py`, opengeodata.nrw.de) | the import script | once per municipality, when you run it | the download folder's listing request and the download |
| Hourly outdoor temperature (Open-Meteo archive and forecast API, `backend/core/weather.py`) | the backend | on Heat Distribution and the Heat matching, only when the site's outdoor temperature is *Open-Meteo at the site* (`site.json` → `outdoor`) and the cache does not fit | the data center's coordinates (4 decimals) and the evaluated period's first and last date |
| Web fonts (Google Fonts, `app/web/index.html`) | the browser | every page of the app | nothing but the request (and a `localhost` referrer) |
| TabPFN's pretrained weights | the backend (`tabpfn` package) | once, the first time TabPFN is used | no data |
| MathJax and Mermaid (jsDelivr CDN, exact versions pinned in `docs/conf.py`) | the browser | pages of this documentation site | nothing |
| Swagger UI (jsDelivr CDN, FastAPI's default) | the browser | the API reference at `/api/docs` | nothing |

<details>
<summary><b>Source code:</b> <code>start.sh</code></summary>

```{literalinclude} ../../app/start.sh
:language: bash
```

</details>
