"""The district on the Site map: buildings with their heat demand (the Wärmeatlas Hessen and the open atlases of
app/sources/), one map box at a time, and the machine-local example data centers.

Reads the local SQLite files the import scripts made; the map box is never sent anywhere.
"""

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Query, Request

from ..core import data_versions, map_examples, pfa, waermeatlas
from ..core.storage import Storage
from ..deps import Registry

router = APIRouter(prefix="/api/district", tags=["district"])


BBOX = Query(max_length=100, description="south,west,north,east in degrees (WGS84), at most 2 × 2 km")


def _in_box(request: Request, registry: Registry, bbox: str, query: Callable[..., dict], which: str = "waermeatlas_db") -> dict:
    """Parse the box, find the newest import (the open data folder's own, else the examples' or any version's: the
    same city for every project) and run `query` on it; its errors as 400 (bad box) and 404 (not imported)."""
    try:
        south, west, north, east = (float(v) for v in bbox.split(","))
    except ValueError as exc:
        raise HTTPException(400, "bbox must be four numbers: south,west,north,east") from exc
    local, root = request.app.state.local_dir, request.app.state.versions_dir
    others = [getattr(Storage.of(local), which), *(getattr(Storage.of(root / v), which) for v in data_versions.versions(root))]
    own = getattr(registry.storage, which)
    # the heat demand: every source's folder beside the Wärmeatlas one (<folder>/<source>/buildings.sqlite)
    if which == "waermeatlas_db":
        db = waermeatlas.find_dbs([p.parent.parent for p in (own, *others)])
    else:
        db = waermeatlas.find_db(own, others)
    try:
        return query(db, south, west, north, east)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/buildings", summary="Buildings with heat demand in a map box")
def buildings(request: Request, registry: Registry, bbox: str = BBOX):
    """The buildings in the box (outline, use, age class, floor area, heat demand kWh/a, `source`) of every local
    import (the Wärmeatlas Hessen, the open atlases of app/sources/), at most 3000, and `sources`: each one's credit line.

    400 for a malformed or too large box ("Zoom in"), 404 when nothing has been imported. Each source's newest import
    of the open data folder, the examples or any version: the same city for every project.
    """
    return _in_box(request, registry, bbox, waermeatlas.buildings_in)


@router.get("/heat-lines", summary="Street segments with their heat line density in a map box")
def heat_lines(request: Request, registry: Registry, bbox: str = BBOX):
    """The street segments in the box with their heat line density (Wärmeliniendichte, MWh per m and year: the heat
    of the buildings the source assigns to the segment over its length), densest first, at most 3000, each with its
    `source`, and `sources`: each one's credit line.

    400 for a malformed or too large box ("Zoom in"), 404 when the data, or its street segments, has not been imported.
    """
    return _in_box(request, registry, bbox, waermeatlas.heat_lines_in)


@router.get("/heat-sources", summary="Waste heat sources of the Plattform für Abwärme in a map box")
def heat_sources(
    request: Request,
    registry: Registry,
    bbox: str = Query(max_length=100, description="south,west,north,east in degrees (WGS84), at most 40 × 40 km"),
):
    """The reported waste heat potentials (§ 17 EnEfG, Plattform für Abwärme, CC BY 4.0) in the box, largest first, at
    most 2000: company and site, the potential, MWh/a, maximum kW, mean temperature and range, availability, the
    twelve months' MWh, and the place geocoded from its address (or its postcode only: `geo`).

    400 for a malformed or too large box, 404 when the table has not been imported (scripts/import_pfa.py).
    """
    return _in_box(request, registry, bbox, pfa.sources_in, "pfa_db")


@router.get("/examples", summary="Local example data centers for the map")
def examples(registry: Registry):
    """The example data centers of `_local/map_examples.json` in the data directory, drawn next to the built-in ones.

    The file is the user's own and never committed: [] when it is missing, too large or malformed.
    """
    return map_examples.map_examples(registry.storage.map_examples_file)
