"""The electricity market by the hour: SMARD's day-ahead price (DE/LU) and the grid's CO₂ from its generation mix.

Reads the CSV downloads someone dropped into the market folder (core/market.py); nothing is fetched or written.
"""

from fastapi import APIRouter, HTTPException, Query, Request

from ..core import market
from ..core.limits import MARKET_MAX_HOURS

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/hourly", summary="Day-ahead price and grid CO₂ by the hour")
def hourly(
    request: Request,
    start: int = Query(description="First hour, unix seconds (UTC)"),
    end: int = Query(description="End, unix seconds (UTC), excluded"),
):
    """The DE/LU day-ahead price (€/MWh) and the generation mix's CO₂ (g/kWh) for each hour from `start` to `end`,
    null where the files have none, with the files read and the span they cover; without SMARD files all null and a
    "hint" where to put them. 400 for a bad or too long span."""
    if end <= start:
        raise HTTPException(400, "end must be after start")
    if end - start > MARKET_MAX_HOURS * 3600:
        raise HTTPException(400, f"At most {MARKET_MAX_HOURS} hours at once.")
    folder = request.app.state.market_dir
    if folder is None:
        raise HTTPException(404, "No market data folder on this app.")
    try:
        return market.hourly(folder, start, end)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
