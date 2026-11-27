# The app

FastAPI backend (`backend/`) and Vite + React + TypeScript web page (`web/`), served together on port 7600. Datasets live in `data/<id>/` (only `data/sim_*` is in git).

## Run

```bash
./start.sh                          # http://localhost:7600 (builds web/dist when web/src changed)
bash scripts/guard.sh ./start.sh    # the same under the 8 GB memory watchdog (GUARD_MB to change it)
```

While working on the page, run the backend and the Vite dev server side by side:

```bash
uv run uvicorn backend.main:app --port 7600 --reload
cd web && npm run dev               # http://localhost:7601, proxies /api to :7600
```

## Check

```bash
bash scripts/guard.sh .venv/bin/python -m pytest -q          # fast backend tests (add -m slow for TabPFN, tigramite, gplearn)
.venv/bin/ruff check backend tests scripts && .venv/bin/ruff format --check backend tests scripts
cd web && npm run typecheck && npm test                      # types and unit tests
cd web && npm run e2e                                        # Playwright against a running app (E2E_BASE_URL)
```

| Where | What |
|---|---|
| `backend/` | `app.py` (`create_app`), `routers/` (HTTP), `core/` (twin, physics, symbolic, lag discovery, limits), `pid/` (P&ID reader) |
| `web/src/` | `app/` (shell, routes, theme), `api/` (the only HTTP client), `lib/` (pure logic), `ui/` (components), `pages/` |
| `tests/` | pytest on synthetic data |
| `scripts/` | Dataset scripts (`make_sim_1_modified.py`, `import_waermeatlas.py`) and `guard.sh`; local import scripts of the real data sets live in `data/_local/scripts/` |
| `PLAN.md` | Roadmap |

Rules, module map and recipes: [`../AGENTS.md`](../AGENTS.md). Methods and architecture: [`../docs/`](../docs/index.md); the running app serves the built docs at `/docs/` (built with `docs/requirements.txt`, see `AGENTS.md`; restart the app after the first build) and the API reference at `/api/docs`.
