# HTTP API

Every route is under `/api` and speaks JSON (except the P&ID uploads, which take the file as the raw request body, and the image routes). The running app also serves the **interactive OpenAPI page at [`/api/docs`](http://localhost:7600/api/docs)** (schema at `/api/openapi.json`), generated from the code — use it to try a request. URLs and JSON shapes are a contract with the web app: they are kept stable.

`{id}` is a dataset id (its folder name, e.g. `sim_1_modified`). Lags in graphs and models are negative (`-1` = one step back); lags in the lag-discovery request are positive step counts — see {doc}`../concepts/causal-graph`.

---

## Datasets

| Method | Path | Purpose | Request | Response |
|---|---|---|---|---|
| GET | `/api/datasets` | Every dataset with its schema and `dataset.json` | — | `{datasets: [{id, name, files, columns, time_range: {start, end}, row_count, resolution_seconds, config}]}` |
| POST | `/api/datasets/refresh` | Re-scan the data folder (new or removed datasets) | — | `{status, datasets}` (count) |
| GET | `/api/datasets/{id}/data` | Time series | query `file` (default: first file), `columns` (comma-separated, default: all) | `{time: [...], columns: {name: [...]}, count}`; 400 for unknown columns, 404 for a file not in the dataset |
| GET | `/api/datasets/{id}/summary` | The Dashboard of one data file ({doc}`../concepts/dashboard`); cached until the file or `dataset.json` changes; `kpi_columns` names the column of each KPI role (the what-if recomputes the KPIs on the twin) | query `file` (default: first file) | `{file, rows, start, end, resolution_seconds, duration_hours, completeness, gaps: {count, longest_hours}, variables: [{name, role, count, missing, mean, std, min, p25, median, p75, max, histogram: {edges, counts}}], correlation: {names, matrix}, series: {time, columns}, kpis: [{label, value, unit, note}], kpi_note}`; 404 for a file not in the dataset, 422 without a `time` column |
| PUT | `/api/datasets/{id}/kpi` | Choose the variables of the KPIs (Dashboard, *Choose the KPI variables*): saved as `dataset.json` `kpi` in silver | `{it_power?, cooling_power?, other_power?: column \| [...], heat_power: [...], heat_demand?, reuse?: {option: column}, power_unit?: W \| kW \| MW}` (`other_power`: the facility's other electricity, summed; with it PUE is the full one); `{}` removes it | the mapping; 422 for a name that is not a variable, reused heat without the IT power, or an `other_power` that is the IT, cooling or reused heat again |
| POST | `/api/datasets/{id}/resampled` | Aggregate a delivered data file to a coarser step (Dashboard, *Aggregate data*); a delivered CSV too big to load is read in chunks (`core/resample.py` `resample_chunks`), with the same result | `{step, default, methods, source?, name?}` | `{did, step, recipe, files}`; 400 for an unknown step or method |
| POST | `/api/datasets/{id}/window` | Keep one period of a delivered data file (all or some variables) as a new data file in silver; a big CSV is read in chunks, and reading stops past the end | `{start, end, columns?, source?, name?}` | `{did, step, recipe, files}`; 400 for no rows, end before start, or more than `CSV_WINDOW_MAX_CELLS` values |
| GET | `/api/data-versions/scan` | What a folder would bring as a new data center (names only, nothing copied) | query `path` | `{id, name, kind, data: [...], drawing, graphs, settings}`; 400 if not a folder |
| POST | `/api/data-versions/import` | Add a data center from a folder into the data version open (`core/import_folder.py`): data (CSV to parquet) to bronze, `dataset.json` and graphs (or a starter graph) to silver, its P&ID read like *Import P&ID* | `{path, id, name, kind, read_pid}` | `{id, data, variables, graphs, pid}`; 400 for a taken id, no readable data, or the examples folder |
| GET | `/api/datasets/{id}/pid.png` | The data center's P&ID image | — | PNG, or 404 |

## Causal graphs

| Method | Path | Purpose | Request | Response |
|---|---|---|---|---|
| GET | `/api/datasets/{id}/graph/files` | Graph files of the dataset | — | `{dataset_id, files: [...]}` |
| GET | `/api/datasets/{id}/graph` | Read a graph | query `source` (default `causal_graph.json`) | `{source, targets: {target: [{parent, lag}]}, link_strengths: [{source, target, lag, value}]}`; `source: null` and empty targets when there is no default graph |
| POST | `/api/datasets/{id}/graph/save` | Write a graph | `{file_name, targets, link_strengths}` | `{dataset_id, file_name, file_path, edge_count}`; 400 for an invalid or reserved name |
| GET | `/api/datasets/{id}/graph/drivers` | Suggested drivers of a graph | query `source` | `{drivers: [...]}` |
| POST | `/api/datasets/{id}/graph/discover-lags` | Significant lags of drawn links (writes nothing) | `{links: [{source, target}], method: "pcmci"\|"pc", min_lag, max_lag, alpha, data_fraction, file}` | `{links: [{source, target, lags, p: {lag: p}}], self: {var: [lags]}, skipped: [{source, target}], link_strengths: [{source, target, lag, value}]}`; `link_strengths` has one entry per significant lag (own past too) in the graph file's shape (negative lag, `value` = ParCorr partial correlation), so a save after a discovery keeps them |

## Equations and models

| Method | Path | Purpose | Request | Response |
|---|---|---|---|---|
| GET | `/api/datasets/{id}/equations` | Physics equations | — | `{equations: {variable: expression}}` |
| PUT | `/api/datasets/{id}/equations` | Replace them | `{variable: expression}` | `{equations}`; 400 if a key is not a column |
| POST | `/api/datasets/{id}/equations/check` | Parse one equation (always 200) | `{target, expr}` | `{ok: true, uses: ["Var[t-1]", ...], coefficients: [...]}` or `{ok: false, error}` |
| GET | `/api/datasets/{id}/models` | Names of the trained models (not the stored evaluation) | — | `{models: [...]}` |
| GET | `/api/datasets/{id}/models/evaluation` | The last evaluation stored (`models/evaluation.json`, {doc}`../concepts/evaluation`), while the models it scored are unchanged (a SHA-256 of each model's file and boosters) | — | The evaluate response plus `{names, levers, horizon, hashes: {name: sha256}}`; `null` when none is stored or a model it scored has changed or gone |
| GET | `/api/datasets/{id}/models/{name}` | A trained model (without in-memory keys) | — | The saved model ({doc}`../concepts/models`); 404 if not trained |
| POST | `/api/datasets/{id}/models/train` | Fit and save a model | `{name, model, structure, graph_file, file, drivers, variables, split_fraction, max_lag, equations}` | The saved model; 400 for a bad name or a fit error |
| POST | `/api/datasets/{id}/models/evaluate` | Free-run and setpoint-change scores; with `store` the answer is also written to `models/evaluation.json` (only the scores, without `events`, when it would pass 2 MB); a model whose library is not installed (TabPFN) is left out under `skipped`, 501 when none is left | `{names (≥ 1), levers, horizon (1–2000), store (default false)}` | `{models: {name: {free_r2, free_nmae, free_mae, free_wape, free_mase, nmae_test, r2_test, structure, kind}}, skipped?: {name: reason}, events: [{lever, start, from, to, steps, time, actual, pred, rmse, nmae}]}` |
| POST | `/api/datasets/{id}/models/{name}/simulate` | Run a scenario | `{start, steps (1–20000), columns, interventions: [{variable, kind, value, start, end}] (offsets from the run's start, ≥ 0), n_draws (1–200), baseline, drivers: {driver: [values]}}` | `{start, steps, time, actual, scenario, baseline?}`; per column a list, or `{p05, p50, p95}` when `n_draws > 1`. `columns` may name a calculated column (`dataset.json` → `derived`) whose parts the model has: computed per draw; it cannot be intervened on. `drivers` puts other series in for the model's drivers from the start on (Heat Matching's weather and demand from another dataset); 400 for a name that is not a driver |

Train request defaults: `name: "linear"`, `model: "linear"`, `structure: "graph"`, `graph_file: "causal_graph.json"`, `split_fraction: 0.5`, `max_lag: 5` (1–48, all vs all only), `drivers: null` (= suggested from the graph), `variables: null` (= every column).

## Site and project

| Method | Path | Purpose | Request | Response |
|---|---|---|---|---|
| GET | `/api/datasets/{id}/site` | The site (map, source, sinks, P&ID layout) | — | `Site` (empty if none saved) |
| PUT | `/api/datasets/{id}/site` | Save it (validated) | `Site` | the saved `Site` |
| GET | `/api/datasets/{id}/site/streets` | The streets and paths stored with the dataset (`streets.json`, OpenStreetMap, ODbL), where the Site map plans the heat network ({doc}`../concepts/heat-network`) | — | `Streets` `{about, source, bbox: [south, west, north, east], ways: [[[lat, lon], ...], ...]}`; 404 when the dataset has none |
| GET | `/api/datasets/{id}/weather/open-meteo` | Hourly outdoor temperature at the site from Open-Meteo (cached in `weather_open_meteo.json`) | query `start`, `end` (YYYY-MM-DD) | `Weather` `{lat, lon, start, end, source, times, temperature}`; 404 without a site location, 400 for a bad range, 502 when Open-Meteo cannot be reached |
| GET | `/api/district/buildings` | Wärmeatlas Hessen buildings in a map box, from the local import (biggest demand first, at most 3000) | query `bbox=south,west,north,east` (degrees, at most 2 × 2 km) | `{buildings: [{id, lat, lon, use, type, age, age_share, area_m2, heating_kwh, hot_water_kwh, total_kwh, heating_2030_kwh, heating_2045_kwh, outline}], truncated}`; 400 for a malformed or too large box ("Zoom in"), 404 before `scripts/import_waermeatlas.py` has run |
| GET | `/api/district/heat-lines` | Wärmeatlas Hessen street segments with their heat line density (Wärmeliniendichte) in a map box, from the local import (densest first, at most 3000) | query `bbox=south,west,north,east` (degrees, at most 2 × 2 km) | `{lines: [{id, name, kind, length_m, mwh_per_m, mwh, line}], truncated}` (`line`: its parts, `[lat, lon]` points); 400 for a malformed or too large box, 404 before `scripts/import_waermeatlas.py` (or, for an older import, `--rebuild`) has run |
| GET | `/api/market/hourly` | The DE/LU day-ahead price (€/MWh) and the generation mix's CO₂ (g/kWh) by the hour, from SMARD's CSV downloads in the market folder (`core/market.py`) | query `start`, `end` (unix seconds, end excluded, at most 3 years) | `{times, price_eur_mwh, co2_g_kwh, files: {price, co2}, span: {price, co2}, covered: {price, co2}, hint}` (null where the files have none; without any files all null and `hint` says where to put them); 400 for a bad span |
| GET | `/api/district/heat-sources` | Waste heat sources of the Plattform für Abwärme (§ 17 EnEfG, CC BY 4.0) in a map box, from the local import (largest first, at most 2000) | query `bbox=south,west,north,east` (degrees, at most 40 × 40 km) | `{sources: [{id, company, site, street, plz, city, name, mwh, max_kw, temp_c, temp_range, hours_per_day, weekend, availability, predictable, control, note, months_mwh, lat, lon, geo}], truncated}` (`geo`: `address` or `postcode`); 400 for a malformed or too large box, 404 before `scripts/import_pfa.py` has run |
| GET | `/api/district/examples` | The machine-local example data centers of the Site map (`app/data/_local/map_examples.json`) | — | `[{name, address, lat, lon, heatKw, basis, source, buildings?, labelLeft?}]`; `[]` when the file is missing, malformed or too large |
| GET | `/api/datasets/{id}/project` | Export the project | — | `{format: "dc-twin-project", version: 1, dataset, saved, files: {path: {text} \| {base64}}}` |
| POST | `/api/datasets/{id}/project/save` | Save the project state (the top bar's *Save project*) into the data folder's status folder, a new file per save | — | `{path, files}`: the file, relative to the data folder version |
| POST | `/api/datasets/{id}/project` | Open a project (current files backed up) | the same document | `{files, backup}`; 400 for another format, another dataset, unexpected paths, or a file that would break the app (JSON that does not parse or is no object, a `site.json` the Site page cannot read, a graph file that is no graph), before anything is written |

## Components

Presets and the user's saved components (`app/data/_components/<id>.json`, local only), {doc}`../concepts/components`. `{cid}` is a component id (letters, digits, `_`, `-`; 422 otherwise). `Component` = `{id, name, kind, inputs: [{name, unit, default}], nodes: [{name, unit, equation, init}], outputs, params: [{name, value, fixed, unit, note}], notes, source, preset}`.

| Method | Path | Purpose | Request | Response |
|---|---|---|---|---|
| GET | `/api/components` | The presets (`preset: true`), then the saved components | — | `{components: [Component]}` |
| GET | `/api/components/{cid}` | One component | — | `Component`; 404 if there is none |
| PUT | `/api/components/{cid}` | Save as the user's component `cid` (checked first) | `Component` | the saved `Component`; 400 for a preset id or a component that does not check |
| DELETE | `/api/components/{cid}` | Delete a saved component | — | `{deleted}`; 400 for a preset, 404 if there is none |
| POST | `/api/components/check` | Parse every equation (always 200, writes nothing) | `Component` | `{ok, error, nodes: {name: {ok, error, uses, params}}, links: [{source, target, lag}], order, missing}` |
| POST | `/api/components/simulate` | Run a component as edited (writes nothing) | `{component, inputs: {name: number \| [numbers]}, steps (1–20000), outputs}` | `{series: {name: [...]}}` (inputs and the nodes run); 400 if it does not check or the inputs do not fit |
| POST | `/api/components/fit` | Learn the non-fixed parameters from a CSV (not stored) | `{component, csv (≤ 20 MB, ≤ 100 000 rows), mapping: {name: column}}` | `{params, learned, quality: {node: {r2, nmae, rows}}, rows}`; 400 for an unreadable CSV, unknown columns, no measured node or an unmeasured feedback |

## P&ID

| Method | Path | Purpose | Request | Response |
|---|---|---|---|---|
| POST | `/api/pid/extract` | Read a drawing, or only an area of it (query `crop=x0,y0,x1,y1`, fractions of the page, y down); stores nothing. Query `summary=true`: what its construct would hold, in a few kB | PDF, SVG or DEXPI (Proteus XML) bytes | Payload + `{components, links}`; with `summary`: `{shapes, by_role, by_kind, labelled, texts, more_texts}`; 413 above 50 MB, 422 if unreadable |
| POST | `/api/pid/preview` | Render a drawing (stores nothing) | PDF, SVG or DEXPI bytes (DEXPI: drawn from its own graphics) | PNG; 503 if `pdftoppm` / `rsvg-convert` is missing |
| POST | `/api/datasets/{id}/pid` | Use as the data center's P&ID (query `crop`: only that area is read and kept as the picture); the old one is backed up to `.backup/<time>-pid/` and the instruments placed on it go back to the tray | PDF, SVG, DEXPI or PNG bytes | `{pid_image, bytes, components, backup}` |
| DELETE | `/api/datasets/{id}/pid` | Remove the P&ID picture, plant graph and construct (backed up first; instruments back to the tray) | — | `{removed, backup}` |
| GET | `/api/datasets/{id}/pid/plant` | The stored plant graph | — | `{components, links, pipes}` (empty lists if none) |
| GET | `/api/datasets/{id}/pid/construct` | The digital construct (shapes over the drawing) | — | `{shapes, saved}`; `saved` false: a first guess from `pid_plant.json`, or no shapes |
| PUT | `/api/datasets/{id}/pid/construct` | Replace the construct | `{shapes}` (each with optional `props`: its values, name → number or text) | `{shapes, saved}`; 422 for a bad shape |
| POST | `/api/datasets/{id}/pid/views/{view_id}` | Use a drawing as the picture of one view of the P&ID (an area in `site.json` `pid_views`), stored as `pid_views/<view_id>.png`; a PDF, SVG or DEXPI file is also read like the P&ID, its construct stored as `pid_views/<view_id>.construct.json` (query `crop`: only that area); an older picture and construct are backed up to `.backup/`; the view's area in `site.json` takes the picture's shape | PDF (first page), SVG, DEXPI or PNG bytes | `{view, width, height, bytes, backup, area, shapes}` (`area` null: the view is not in `site.json`); 400 for a bad id |
| GET | `/api/datasets/{id}/pid/views/{view_id}.png` | The picture of one view | — | PNG, or 404 |
| PUT | `/api/datasets/{id}/names` | Names shown in place of variables' own, one or many (`""` gives the own name back); saved as `dataset.json` `names` (silver), the data and everything built on it keep the own names | `{names: {variable: name}}` | `{names}` (all now set); 422 for an unknown variable, a name shown twice, another variable's own name, or more than 80 characters |
| GET | `/api/datasets/{id}/documents` | The user's documents about the data center's physical structure (in its silver `documents/`, kept as they are) | — | `{documents: [{name, path, bytes, modified, note, view}], about}`; `path`: where an assistant reads the file |
| POST | `/api/datasets/{id}/documents/{name}` | Keep any file as it is (query `note`: what it holds, `view`: the P&ID view it is about); one of the same name is backed up first; the app does not open it | The file's bytes | `{name, path, bytes, backup}`; 400 for a bad name, 413 above 50 MB |
| PUT | `/api/datasets/{id}/documents/{name}/text` | Keep a text written here or by an assistant (`.txt`, `.md`, `.csv`, `.json`) | `{text, note?, view?}` | `{name, path, bytes, backup}` |
| GET | `/api/datasets/{id}/documents/{name}` | The file as it was kept (to open it in the browser; every kind but a PDF in a sandbox: its scripts do not run) | — | The file; 404 |
| PUT | `/api/datasets/{id}/documents/{name}/info` | What a document holds and the view it is about (`""`: none) | `{note, view}` | `{name, note, view}` |
| DELETE | `/api/datasets/{id}/documents/{name}` | Remove a document (moved to `.backup/` first) | — | `{removed, backup}` |
| GET | `/api/datasets/{id}/pid/views/{view_id}/construct` | The construct read from a view's picture (fractions of that picture) | — | `{shapes}`; empty for a PNG picture |
| PUT | `/api/datasets/{id}/pid/views/{view_id}/construct` | Replace a view's construct (checked like the P&ID's; the older one backed up first) | `{shapes}` | `{shapes, saved}`; 404 without a picture, 422 for a bad shape |
| POST | `/api/datasets/{id}/pid/views/{view_id}/copy` | Give a view another view's picture and construct (query `source`); its own backed up first, its area takes the picture's shape | — | `{view, source, backup, area}`; 404 when `source` has no picture |
| DELETE | `/api/datasets/{id}/pid/views/{view_id}` | Remove a view's picture and construct (backed up first; the area stays in `site.json`) | — | `{removed, backup}` |

**The heat distribution's structure (query `scope`).** The P&ID routes above with a `{id}` (picture, plant graph, construct, views), `GET .../pid.png`, the graph routes `GET .../graph/files`, `GET .../graph`, `POST .../graph/save` and `GET`/`PUT .../site` take `scope=dc` (the default: the data center's own, as without it), `scope=heat` or `scope=district` (its own folder, `<silver>/district_structure/`). With `heat` they read and write the heat distribution's own structure: the same files in a folder of their own, `<silver>/heat_structure/` (made on the first write). It holds the picture, construct, views, graph files and a `site.json` with its layout, notes and views. The data center's files are never touched. Any other scope is refused (422). Lag discovery and drivers stay with the data center's data.

## Other

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | `{status: "ok", datasets: n}`, plus `unreadable: {data center: why}` when a data center was left out because its data file could not be read |
| GET | `/api/docs`, `/api/openapi.json` | Interactive API documentation and its schema |
| GET | `/docs/` | This documentation, when built (`docs/_build/html`) |
| GET | `/` | The built web app (`app/web/dist`) |

---

## Conventions

- **Unknown dataset:** `404 "Dataset '<id>' not found"` on every dataset route.
- **Validation errors** (missing fields, out-of-range numbers, empty `names`): `422` with FastAPI's list of messages.
- **Domain errors** (bad file name, fit failure, unknown variable): `400` with a readable `detail`.
- **Non-finite numbers** in a response become `null`.
- **File names** sent by the client are validated (no `/`, `\`, `..`; graph names end in `.json` and are not one of the reserved files; model names are `[A-Za-z0-9_-]{1,64}` and not `evaluation`, the stored evaluation's name); data files are looked up among the dataset's own files only.

<details>
<summary><b>Source code:</b> <code>backend/schemas.py</code> (LagDiscoveryRequest, CausalGraphSaveRequest)</summary>

```{literalinclude} ../../app/backend/schemas.py
:language: python
:pyobject: LagDiscoveryRequest
```

```{literalinclude} ../../app/backend/schemas.py
:language: python
:pyobject: CausalGraphSaveRequest
```

</details>

<details>
<summary><b>Source code:</b> <code>backend/schemas.py</code> (EvaluateRequest), <code>backend/routers/training.py</code> (evaluate)</summary>

```{literalinclude} ../../app/backend/schemas.py
:language: python
:pyobject: EvaluateRequest
```

```{literalinclude} ../../app/backend/routers/training.py
:language: python
:pyobject: evaluate
```

</details>
