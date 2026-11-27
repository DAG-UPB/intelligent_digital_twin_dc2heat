# Development setup

## Prerequisites

| Tool | Why |
|---|---|
| Python ≥ 3.12 and [uv](https://docs.astral.sh/uv/) | Backend; `uv` manages the virtual environment from `app/pyproject.toml` and `app/uv.lock` |
| Node.js and npm | Web app (`app/web`): Vite, React, TypeScript, vitest, Playwright |
| Google Chrome | Playwright end-to-end tests run in the installed Chrome (`channel: "chrome"`) |
| `pdftoppm` (poppler) and `rsvg-convert` (librsvg) | Optional: rendering P&ID drawings to PNG (preview, "use as P&ID"). Without them those routes answer 503. |
| Ghostscript (`gs`) | Only for the machine-local import scripts in `app/data/_local/scripts/` (render P&ID figures) |

## Setup

```bash
cd app
uv sync                 # backend + dev tools (pytest, ruff, httpx) into app/.venv
cd web && npm install   # web app
```

## Running

**The whole app, as users run it:**

```bash
cd app
./start.sh                          # http://localhost:7600
bash scripts/guard.sh ./start.sh    # the same, under the 8 GB watchdog (below)
```

The app answers only requests addressed to `localhost`, `127.0.0.1` or `[::1]`, and refuses writes sent from a page of another site (see {doc}`../architecture/data-and-privacy`). To open it under another host name, set `IDT_ALLOWED_HOSTS` (comma-separated, for example `localhost,127.0.0.1,mybox.local`) before starting it.

`start.sh` rebuilds the web app when any file in `web/src` (or `web/index.html`) is newer than the last build, syncs the Python environment, and starts one uvicorn process on port `7600` (override with `PORT`). It leaves the math libraries their threads (XGBoost and numpy use every core; TabPFN's torch keeps one, as two OpenMP runtimes in one process hang on macOS; set `OMP_NUM_THREADS=1` to hold the app to one core) and disables telemetry.

**While developing the web app**, run the backend and the Vite dev server side by side:

```bash
cd app && uv run uvicorn backend.main:app --port 7600 --reload
cd app/web && npm run dev     # http://localhost:7601, proxies /api to :7600
```

| Port | What |
|---|---|
| 7600 | The backend (API, built web app at `/`, docs at `/docs/`, OpenAPI at `/api/docs`) |
| 7601 | Vite dev server (hot reload), proxies `/api` to 7600 |

**The documentation** (this site):

Sphinx and its extensions are **not** part of the app's environment (`uv sync` does not install them); they are listed in `docs/requirements.txt`. Either run Sphinx through `uvx`, which needs nothing installed, or install the requirements once into an environment of your own:

```bash
cd docs
# no installation: uvx fetches Sphinx and docs/requirements.txt into a cached environment
uvx --with-requirements requirements.txt --from sphinx sphinx-build -W --keep-going -E -b html . _build/html
# or, with the requirements installed (python -m venv .venv && .venv/bin/pip install -r requirements.txt, then activate it)
bash build.sh -E        # sphinx-build -W --keep-going: every warning is an error; -E rebuilds everything
```

The backend serves `docs/_build/html` at `/docs/` (the bare `/docs` redirects there). Whether the folder exists is checked **once, at startup**: after the *first* build, restart the app. Later rebuilds need no restart, because the files are read from disk on every request; reload the page.

## The 8 GB watchdog

The app has a memory budget of 8 GB (see {doc}`../architecture/overview`). TabPFN in particular can exceed it with too many inputs or rows. When you run the server or a heavy test run during development, run it under **`app/scripts/guard.sh`** instead of letting the machine swap. The script sums the resident memory (RSS) of the whole process tree every 0.5 s, kills the tree when the sum goes over the limit, and finally prints `peak RSS: <n> MB, exit <rc>`. It exits with the command's own exit code.

```bash
cd app
bash scripts/guard.sh ./start.sh                                  # the app, 8 GB limit
bash scripts/guard.sh .venv/bin/python -m pytest -q               # fast tests
GUARD_MB=12288 bash scripts/guard.sh .venv/bin/python -m pytest -q -m slow   # another limit (MB)
```

Because it samples every 0.5 s, a very short spike can slip past it. When a limit has to move, change it in `backend/core/limits.py` and check the peak again.

<details>
<summary><b>Source code:</b> <code>scripts/guard.sh</code></summary>

```{literalinclude} ../../app/scripts/guard.sh
:language: bash
```

</details>

## Dataset scripts

`app/scripts/make_sim_1_modified.py` creates a dataset folder; run it from `app/`. Import scripts for the real data sets are machine-local: they live in `app/data/_local/scripts/` and are not part of the repository ({doc}`../architecture/data-and-privacy`). They ask git before writing a dataset that is not a simulation, and refuse unless the target would be ignored.

### `scripts/make_sim_1_modified.py`

Creates `sim_1_modified` from `sim_1`: the same data plus a heat demand (`Heat_Demand`) and two demand-limited heat-recovery exchangers, each with four hot-side variables: inlet and outlet temperature, mass flow and heat (`HEX_Hall_T_in`, `HEX_Hall_T_out`, `HEX_Hall_m`, `HEX_Hall_Q`, and the same for `HEX_Cond_*`). Every value of hour $t$ comes from the row one hour back. The model, its equations and the literature behind each parameter are in {doc}`../concepts/simulated-heat-recovery`; `check()` asserts the energy balance $Q = \dot m\, c_p\, (T_{in} - T_{out})$, the demand limit and plausible ranges on every run. The script writes the data, the manual graph of `sim_1` plus the new links at lag 1 as `causal_graph.json`, its PCMCI and PC re-lagged versions, `dataset.json` and `equations.json`, and copies `site.json` if there is none. Retrain the models afterwards (Modelling on Structure and Modelling, or `POST /api/datasets/sim_1_modified/models/train`).

```bash
.venv/bin/python scripts/make_sim_1_modified.py [data dir]
```

The data dir defaults to `$IDT_DATA_DIR`, else `app/data`; it must contain `sim_1/`.

<details>
<summary><b>Source code:</b> <code>scripts/make_sim_1_modified.py</code> (add_hex, heat_demand)</summary>

```{literalinclude} ../../app/scripts/make_sim_1_modified.py
:language: python
:pyobject: add_hex
```

```{literalinclude} ../../app/scripts/make_sim_1_modified.py
:language: python
:pyobject: heat_demand
```

</details>

### `scripts/make_sim_cases.py`

Creates the two plant cases from `sim_1` on the same outdoor plant (a cooling tower, a chiller that runs only when needed and a plate HEX for free cooling), only the inside different, with the heat demand of `make_sim_1_modified.py`:

- `sim_1_air` (A1, air-cooled): the CRAH on chilled water, a water-cooled chiller with a cooling tower and a plate HEX for free cooling; `FC_Share` (the free-cooled share) and the plant's own `HVAC_Ener`; extraction points `hall` and `condenser` (heat there only while the chiller runs).
- `sim_1_water` (W1, water-cooled): cold plates on facility water, cooled by the tower through a plate HEX all year (40–45 °C supply), the rear doors on the plant's chilled water; extraction points `liquid` (the facility water) and `condenser` (the rear doors' share, while the chiller runs).

It writes the data, `causal_graph.json` (lag 1), `dataset.json` (with `plant`: how the plant is built, which picks the built-in drawing), `equations.json` and a copy of `site.json`; the asserts check the energy balance and the ranges. Details: {doc}`../concepts/simulated-heat-recovery`. Retrain the models afterwards (`linear` and `phys` are committed).

```bash
.venv/bin/python scripts/make_sim_cases.py [data dir]
```

### `examples/`: example cases with their generators

`app/examples/` has one folder per example case, each with its generator `make.py` and a `README.md`. Unlike the scripts above, a generator also trains the models it ships (`--no-train` writes only the data):

- `recovery_air_cooled/make.py` writes `sim_recovery_air` (*Recovery · air cooled*): a 5 MW air-cooled data center in Frankfurt (ERA5 weather of 2023 and 2024) whose recovery heat exchanger, on the chilled-water return, takes the hall's heat up to the district loop's capacity (4,333 kW) as far as the loop's cold pipe lets it (the pipe warms in summer), with an energy balance that closes every hour and a PUE of 1.21 (IT, cooling, electrical losses and the building); about 38,000 MWh of heat a year (~28,000 MWh recovered) beside a seasonal district demand of about 30,000 MWh, six models (`linear`, `phys`, `xgb`, `linear_all`, `xgb_all`, `sym`) with their stored evaluation (`models/evaluation.json`), the streets for the Site map's heat network (`streets.json`), and the district's structure (prepared inputs, graph, equation and the same six models).
- `district_heat_demand/make.py` writes `sim_district_heat` (*District · heat demand*): a separate district's hourly demand on its own weather (about 5,500 MWh a year), to match against it in Heat Matching (*What if…* → *Weather from*, *Heat demand from*).

Details: {doc}`../concepts/simulated-heat-recovery`. Tests: `tests/test_example_recovery_air.py`, `tests/test_example_district_heat.py`.

```bash
OMP_NUM_THREADS=1 bash scripts/guard.sh .venv/bin/python examples/recovery_air_cooled/make.py   # data + models, about a minute
bash scripts/guard.sh .venv/bin/python examples/district_heat_demand/make.py --no-train # data only
```

Then `POST /api/datasets/refresh` on the running app.
