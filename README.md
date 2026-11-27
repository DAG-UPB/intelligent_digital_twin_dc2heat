# Intelligent Digital Twin

A local planning tool of the **DC2HEAT** project. It shows how much of a data center's waste heat could heat a district, and how changes inside the data center would change that heat.

- **Data Center:** the P&ID and the causal graph of the plant, AI models learned from the measurements (linear, XGBoost, physics equations, symbolic regression, TabPFN), and what-if scenarios with uncertainty bands.
- **Heat Distribution:** the waste heat at an extraction point, through a direct heat exchanger or a heat pump and a storage tank, matched step by step against the district's demand.
- **District:** heat sinks on a map, with their heat demand generated from houses, weather and daily curves.

The app is one Python process (FastAPI) that serves a React web page. It uses no database and no cloud service, and it stays within an 8 GB memory budget.

## Quick start

Needs Python ≥ 3.12 with [uv](https://docs.astral.sh/uv/) (`brew install uv` or `curl -LsSf https://astral.sh/uv/install.sh | sh`) and Node.js with npm (`brew install node`). Then, from the repository:

```bash
cd app
./start.sh             # your app: http://localhost:7600 (your data folder, or the examples without one)
./start.sh examples    # the examples only, no real data: http://localhost:7612 (to look around, test, take screenshots)
```

The first start installs everything (Python packages, the web page's packages, a build of the page) and takes a few minutes; for someone new it also makes their project folder, `~/Documents/DC2HEAT-data/version_1`, where the app saves their work (`IDT_DATA=/somewhere ./start.sh` puts it elsewhere; *Set data folder…* changes it later; the examples are in every project); later starts take seconds and rebuild the page only when its sources changed. Stop it with Ctrl+C. Under the 2 GB memory watchdog: `bash scripts/guard.sh ./start.sh`. Another port: `PORT=7700 ./start.sh`.

Once it answers, the browser opens on the Site map with **Case 1 · Recovery, trained models**: a 5 MW data center in the European Central Bank's building with its district around it, its models loaded (`NO_BROWSER=1 ./start.sh` skips that; a reload keeps your own choice). Press **?** for the in-app help; the API reference is at `/api/docs`. The complete example (the district's models) is made once with `OMP_NUM_THREADS=1 bash scripts/guard.sh .venv/bin/python examples/recovery_air_cooled/make.py` (in `app/`, about a minute).

If something goes wrong: *address already in use* → the app already runs (open it, or stop the other one: `kill $(lsof -ti tcp:7600)`); the page looks old → `cd web && npm run build`; Chronos-2 (the pretrained forecaster) downloads its weights (~0.9 GB) the first time it is used.

### Your data folder

Each person points the app at **their own data folder** on their computer: a folder with one sub-folder per version (`version_1`, `version_2`, …), each laid out like `app/data` (one folder per data center). It can live anywhere, also in a synced folder. Everything you save in the app (graphs, models, site, P&ID) is saved into the version you have open.

Set it once per computer in the app: data-center menu (top right) › *Set data folder…*, then browse to the folder and press *Use this folder*. Or from a terminal:

```bash
cd app
bash scripts/link-data.sh /path/to/your/data_folder
```

From `version_2` on, a version is organised by topic (`app/scripts/structure_version.py` builds one from a flat version, without changing the source):

| Folder | What the app keeps there |
|---|---|
| `datacenter_data/<data center>/` | the data (`*.parquet`), `dataset.json`, causal graphs, P&ID |
| `models/<data center>/physics/` · `trained/` | physics equations · trained models (physics-based and data-driven) |
| `district_data/<data center>/` · `waermeatlas/` · `map_examples.json` | site (map, heat sinks, page settings) · Wärmeatlas buildings · Site-map examples |
| `heat_distribution_data/components/` | your heat-distribution components |
| `status/<data center>/` | **Save project**: every save is a new, dated file (a history); **Open project** loads one back |

From `version_3` on, a version separates the data as delivered from the app's work (`app/scripts/bronze_silver_version.py` builds one from a structured version, without changing the source):

| Folder | What |
|---|---|
| `bronze/` | the data as delivered: `datacenter_data/<data center>/*.parquet` and the Wärmeatlas download. The app never writes here |
| `silver/` | everything the app prepares and edits, in the layout above: settings, graphs, P&ID, models, site, components, saved states, and the **prepared variables** (`datacenter_data/<data center>/prepared/`) |

The Dashboard's *Edit the data* section makes new data from the delivered one: **prepared variables** (combine, transform, time features, formulas; or one click from a recommendation) and **aggregated data files** (one row every 15 s, 1 min, 15 min, 1 h or 1 day; each variable by mean, median, sum, min, max or last value). Both are saved in the data center's silver (in the examples and older versions: a `silver/` folder inside the data center, git-ignored), with their recipe in `silver/.../recipe.json`; the delivered files are never changed. An aggregated file is then a data file like the others.

Older versions and the examples keep everything in the data center's folder. All file locations are decided in one module, `app/backend/core/storage.py`, so the folders can later be replaced by a database without touching the rest of the app.

Both create `app/data_versions`, a git-ignored link: the code only ever uses that relative path, never anyone's machine path, and nobody gets someone else's folder. The menu then lists the data centers of every version (newest first) and, last, the **Examples** of the repo (`app/data`, the simulations). Without a data folder the app opens the examples; with one it opens your newest version and remembers your last choice on this computer (`app/.data_version`).

Development (tests, lint, dev server, docs): see [`app/README.md`](app/README.md) and [`AGENTS.md`](AGENTS.md).

## In a container

Needs Docker (with Compose). From this folder:

```bash
docker compose up --build                                  # the examples only: http://localhost:7612
IDT_DATA=/path/to/your/data_folder docker compose up --build data   # your data folder: http://localhost:7600
```

The image (`Dockerfile`) builds the page, the documentation (served at `/docs/`) and the Python environment from
`app/uv.lock`. It leaves out TabPFN, torch and Chronos-2 (several GB): those models then say they are not installed;
`IDT_ML=1 docker compose up --build` includes them. Of `app/data` only the simulations (`sim_*`) go into the image
(`.dockerignore`). The `data` service mounts `IDT_DATA` at `/data` (one sub-folder per version, as above; an empty
folder gets a `version_1`; without `IDT_DATA` a Docker volume is used); the app saves into it, so it must be writable
by the container's user (uid 1000; `docker compose build --build-arg UID=$(id -u)` for yours). SMARD's market CSVs go
into `<data folder>/_market/elec_price/` and `elec_generation/`. The container has a memory limit of 8 GB and a
health check on `/health`. `PORT` changes the port (the same on both sides: the app's `/mcp` calls itself on it).

**The app has no login.** Its only protection is that it answers to `localhost` alone (`IDT_ALLOWED_HOSTS`, checked
on every request, and writes only from a page on such a host), and compose publishes the port on 127.0.0.1 only.
Anyone who can reach the port can read and change everything in the mounted folder. Do not publish it on a network;
if you must (a machine you alone use), add its name to `IDT_ALLOWED_HOSTS` and change the `ports:` entry knowingly.

## AI agents (MCP)

An AI assistant can use the app as tools through the [Model Context Protocol](https://modelcontextprotocol.io): every
API route, plus the open page, the P&ID view, the docs and the agent wiki (`docs/architecture/mcp.md`). Two ways, both
against a running app (`./start.sh`, or the container):

- **Over HTTP, nothing to install:** the app serves MCP at `/mcp`. In Claude Code:
  `claude mcp add --transport http digital-twin http://localhost:7612/mcp` (7600 for the `data` service), or in an
  `.mcp.json`: `{"mcpServers": {"digital-twin": {"type": "http", "url": "http://localhost:7612/mcp"}}}`.
- **Over stdio, from a checkout** (`cd app && uv sync` first): `app/backend/mcp_server.py`, which proxies every call to
  the app at `IDT_URL` (default `http://127.0.0.1:7600`). Claude Code in this repository picks up `.mcp.json` (server
  `digital-twin`); against the container add `"env": {"IDT_URL": "http://localhost:7612"}` to it:

  ```json
  {
    "mcpServers": {
      "digital-twin": {
        "command": "bash",
        "args": ["-c", "cd \"$(git rev-parse --show-toplevel)/app\" && exec .venv/bin/python -m backend.mcp_server"],
        "env": {"IDT_URL": "http://localhost:7612"}
      }
    }
  }
  ```

**Pairing.** The data tools work at once. To let the agent see and work the page you have open, press **Connect AI**
in the app's top bar: it shows a six-digit code, valid once for 10 minutes; tell it to the agent ("connect to the app
with code 123 456"). *Disconnect* (the same button) or a restart ends it. This is consent for the page, not access
control: any program that can reach the app's port can call its API. What a tool returns (P&ID images, time series,
project files) goes to the agent's model provider: use it on real data only when that is fine for that data.

## Documentation

- [`AGENTS.md`](AGENTS.md): the operating manual for developers and AI agents (layout, commands, module map, rules, recipes).
- [`docs/`](docs/index.md): technical documentation (methods, equations, architecture, API, testing). Build it with `cd docs && uvx --with-requirements requirements.txt --from sphinx sphinx-build -W --keep-going -E -b html . _build/html` (or `bash build.sh -E` with `docs/requirements.txt` installed), and the app serves it at <http://localhost:7600/docs/> (restart the app after the first build).
- [`app/PLAN.md`](app/PLAN.md): roadmap.

## Privacy

Everything runs on your machine, and measurements, models and drawings never leave it. Only the simulated datasets (`app/data/sim_*`) and the Site map's heat demand of Frankfurt (Wärmeatlas Hessen, © LEA, not for a public copy) and of Bonn and Altenbeken (NRW, dl-de/zero-2.0) are in this repository. Real data-center data and every P&ID drawing (`pid.png`, `pid_plant.json`) are git-ignored and must never be committed. Internet access is limited to the Site map, which calls OpenStreetMap / Esri tiles and OpenStreetMap address and building look-ups from the browser, plus the web fonts (Google Fonts), TabPFN's one-time weight download, and the MathJax / Mermaid scripts of the documentation site (jsDelivr). No data is sent. A saved project file is **not** free of measured data (TabPFN models keep up to 1000 measured rows per variable, and `pid_plant.json` is included): treat a project of a real data center as confidential. See `docs/architecture/data-and-privacy.md`.

## Repository

| Path | What |
|---|---|
| `app/` | The app: `backend/`, `web/`, `tests/`, `scripts/`, `data/` |
| `docs/` | Technical documentation (Sphinx) |
| `wiki/` | The agent wiki (domain knowledge for AI agents, read by the MCP tools) |
| `Dockerfile` · `compose.yaml` · `.dockerignore` | The container (above) |

## Licence

The code and documentation are free software under the GNU General Public License, version 3 or (at your option) any
later version: see [`LICENSE`](LICENSE). The heat demand data under `app/data/_external/` keeps its own terms and is
not covered by it: the Wärmeatlas Hessen is © LEA LandesEnergieAgentur Hessen GmbH (no open licence; keep it out of
any public copy), the Kommunale Wärmeplanung NRW is © LANUK NRW under dl-de/zero-2.0.
