# Changes

Newest first, one entry per change: the date, who (person · agent), the area, what changed and why, the files, the
checks run (and what could not be checked), what stays open. Keep it short; the details are in the code and the docs.

## 2026-11-25 · David · Claude · container: first build and run

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

## 2026-11-25 · David · Claude · web tests: CI's first run

CI's first run failed in `npm test`: `src/lib/staleBuild.test.ts` used the global `sessionStorage`, which Node has
only from version 25 (local machine), not in CI's Node 22. The test now stubs it with a Map, as `storage.test.ts`
does for `localStorage`. Files: `app/web/src/lib/staleBuild.test.ts`. Checks: vitest under Node 22 (723 passed),
typecheck, lint. Not checked: CI itself (runs after the push).

## 2026-11-24 · first commit of this repository

The Intelligent Digital Twin (DC2HEAT) as its own repository: the app (FastAPI backend, React page, MCP server), its
documentation, the agent wiki, the simulated examples (`app/data/sim_*`) and a container (`Dockerfile`,
`compose.yaml`). Earlier history stays in the repository the app came from.
