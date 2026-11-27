# Open heat demand sources

One folder per outside data source the Site map can show, each with its import script and a README. A script
downloads the source once into the git-ignored `app/data/_external/<source>/` and writes `buildings.sqlite` there, in
the format `backend/core/waermeatlas.py` reads (`write_db`). The Site map's heat demand layer (*Load heat demand in
view*) then shows every source imported on this machine side by side, each building and street with its source and
its credit line. Nothing is sent anywhere when the map loads them; only the download leaves the machine.

| Folder | Source | Content | Licence |
|---|---|---|---|
| `nrw/` | LANUK, Kommunale Wärmeplanung NRW (model 2024) | every heated building (outline, use, type, age class, space heating, hot water, 2030/2045 renovated) and the streets' heat line density, per municipality | dl-de/zero-2.0 |
| (`../scripts/import_waermeatlas.py`) | LEA, Wärmeatlas Hessen (2020) | buildings and heat lines per municipality | © LEA, no open licence: never commit, never publish |
| (`../scripts/import_pfa.py`) | BfEE, Plattform für Abwärme | waste heat sources (a layer of its own) | CC BY 4.0 |

`shp.py` reads the shapefiles inside a downloaded zip (stdlib only). Run every script from `app/` under the memory
guard, e.g. `bash scripts/guard.sh .venv/bin/python sources/nrw/fetch.py Bonn`. Tests: `tests/test_heat_sources.py`
(synthetic shapefiles only). The data itself is never committed, whatever its licence: it stays on the machine that
imported it.
