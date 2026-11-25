"""The heat-reuse site of a dataset (site.json): map, heat source and sinks, P&ID layout; weather at the site."""

import json
from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from ..core import dataset_files as files
from ..core import weather
from ..deps import Dataset, Structure
from ..schemas import Site, Streets, Weather

router = APIRouter(prefix="/api/datasets", tags=["site"])

WAERMEATLAS = "wah-"  # the Wärmeatlas's buildings as sinks (© LEA Hessen): never into an example, sim_* is committed
BLANK = "sim_blank"  # the Blank case: nothing on its map, ever (its P&ID layout, notes and model choices are saved)


@router.get("/{dataset_id}/site", response_model=Site, summary="Get the site")
def get_site(meta: Structure):
    """The saved site, or an empty one."""
    path = meta.file(files.SITE)
    return Site.model_validate_json(path.read_text()) if path.exists() else Site()


@router.put("/{dataset_id}/site", response_model=Site, summary="Save the site")
def save_site(meta: Structure, site: Site):
    """Validate and save the site; echoes what was saved. An example (sim_*) takes no Wärmeatlas building, and the
    Blank example no building, source or sink on its map: 422."""
    if meta.id == BLANK and meta.scope_dir is None and (site.building or site.source or site.sinks):
        raise HTTPException(422, "Blank stays blank: save a project file instead")
    if meta.id.startswith("sim_") and any(s.id.startswith(WAERMEATLAS) for s in site.sinks):
        raise HTTPException(
            422, "Wärmeatlas buildings are not saved into an example (it is committed): save a project file instead"
        )
    files.write_atomic(meta.file(files.SITE), json.dumps(site.model_dump(), indent=2))
    return site


@router.get("/{dataset_id}/site/streets", response_model=Streets, summary="Streets around the site")
def get_streets(meta: Dataset):
    """The streets and paths a heat network can run along (streets.json, from OpenStreetMap), stored with an example;
    404 when the dataset has none (the Site map then fetches them from OpenStreetMap on a click, never stored)."""
    path = meta.file(files.STREETS)
    if not path.exists():
        raise HTTPException(404, "No streets stored with this dataset: fetch them from OpenStreetMap on the Site map")
    return Streets.model_validate_json(path.read_text())


@router.get("/{dataset_id}/weather/open-meteo", response_model=Weather, summary="Hourly outdoor temperature at the site")
def open_meteo(
    meta: Dataset,
    start: Annotated[date, Query(description="First date of the period, YYYY-MM-DD")],
    end: Annotated[date, Query(description="Last date of the period, YYYY-MM-DD")],
):
    """Hourly temperature_2m at the data center's location from Open-Meteo (only the coordinates and dates are sent).

    Cached next to the site (weather_open_meteo.json) and fetched again only for other coordinates or dates.
    """
    try:
        where = weather.site_location(files.read_json(meta.file(files.SITE)))
        if where is None:
            raise HTTPException(404, "The site has no location: pick the data center's building on the Site map first")
        return weather.cached_hourly(meta.file(files.WEATHER), *where, start, end)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except weather.WeatherUnavailable as exc:
        raise HTTPException(502, str(exc)) from exc
