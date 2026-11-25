"""The Dashboard's numbers for one data file: how much data, descriptive statistics, correlations, a
downsampled view of every variable, its weekly profile and where it is missing, the data-center KPIs the data
supports, and preprocessing recommendations (core/recommend.py).

Pure and vectorised (pandas / numpy): the real data sets hold tens of thousands of rows of ~40 columns.
NaN in the result is fine: the app's JSON response turns it into null.
"""

import re

import numpy as np
import pandas as pd

from .recommend import recommend

TIME_FORMAT = "%Y-%m-%dT%H:%M:%S"  # every timestamp the API sends (backend/deps.py:times too)
MAX_POINTS = 600  # per variable in "series"
BINS = 20  # histogram bins
GAP_FACTOR = 1.5  # a step longer than 1.5 x the median step is a gap
DURATION_POINTS = 101  # load duration curve: the value exceeded 0 %, 1 %, ..., 100 % of the time
ACF_LAGS = 48  # autocorrelation up to this many steps back
# (response key, row of DataFrame.describe)
STATS = [("mean", "mean"), ("std", "std"), ("min", "min"), ("p25", "25%"), ("median", "50%"), ("p75", "75%"), ("max", "max")]

# The simulations' own column names (EnergyPlus model of the paper): powers in kW per hourly step.
# Only exact names: a real dataset gets its KPI columns from dataset.json "kpi".
SIM_COLUMNS = {"it_power": "ITE_Ener", "cooling_power": "HVAC_Ener", "heat_demand": "Heat_Demand"}
SIM_HEAT = re.compile(r"^HEX_\w+_Q$")
KPI_NOTE = (
    "Choose which variables are the IT power, the cooling power and the reused heat (Choose the KPI variables; saved "
    'as dataset.json "kpi") to see PUE, ERF, ERE and the energy KPIs.'
)
NO_REUSE_NOTE = "No reused-heat variable (choose one under Choose the KPI variables): ERF and ERE are not shown."
POINT_NAMES = {"hall": "hall HEX", "condenser": "condenser HEX"}


def role_of(name: str, config: dict) -> str:
    """The variable's role from dataset.json: heat, lever, actuator, or measured."""
    for role, key in (("heat", "heat"), ("lever", "levers"), ("actuator", "actuators")):
        if name in (config.get(key) or []):
            return role
    return "measured"


def kpi_columns(columns: list[str], config: dict, hex_option: str | None = None) -> dict:
    """Which column plays which KPI role, and the power unit: dataset.json "kpi", else the simulations' names.

    Returns {it_power, cooling_power, heat_demand: column | None, heat_power: [columns] (the reused heat, summed),
    other_power: [columns] (the facility's other electricity, summed; [] when none), reuse_point: str | None,
    power_unit: str | None}. Without a heat_power the reused heat is one point of kpi
    "reuse" ({option: column}) or of heat_source: site.json hex_option, else "condenser", else the first (the points
    are alternative designs, so only one counts); with neither, every HEX_*_Q of a mapping-less dataset.
    """
    mapping = config.get("kpi") or {}
    out: dict = {}
    for key, sim_name in SIM_COLUMNS.items():
        col = mapping.get(key) or (sim_name if not mapping else None)
        out[key] = col if col in columns else None
    heat = mapping.get("heat_power")
    reuse = mapping.get("reuse") or {k: p.get("q") for k, p in (config.get("heat_source") or {}).items()}
    points = {k: q for k, q in reuse.items() if q in columns}
    out["reuse_point"] = None
    if heat is None and points:
        out["reuse_point"] = next((k for k in (hex_option, "condenser") if k in points), next(iter(points)))
        heat = points[out["reuse_point"]]
    elif heat is None and not mapping:
        heat = [c for c in columns if SIM_HEAT.match(c)]
    out["heat_power"] = [c for c in ([heat] if isinstance(heat, str) else heat or []) if c in columns]
    other = mapping.get("other_power")  # only from the mapping: no simulation names it
    # a variable counts once: a repeat, or the IT, cooling or reused heat named again, would count twice (or break kpis)
    taken = {out["it_power"], out["cooling_power"], *out["heat_power"]}
    other = dict.fromkeys([other] if isinstance(other, str) else other or [])
    out["other_power"] = [c for c in other if c in columns and c not in taken]
    out["power_unit"] = mapping.get("power_unit") or ("kW" if config.get("kind") == "simulation" and not mapping else None)
    return out


def kpis(num: pd.DataFrame, hours: np.ndarray, cols: dict) -> tuple[list[dict], str | None]:
    """The data-center KPIs over the whole file that the mapped columns support, and a note on what is missing.
    `hours`: each row's duration (`row_hours`), for the energies.

    PUE (ISO/IEC 30134-2), ERF (ISO/IEC 30134-6) and ERE (The Green Grid WP#29) over the rows where every column
    they use has a value. E_DC is IT + cooling, so all three are partial, unless the facility's other electricity
    (other_power: UPS and distribution losses, lighting, building) is mapped too: then it is the total facility's.
    """
    it, cool, heat, demand = cols["it_power"], cols["cooling_power"], cols["heat_power"], cols["heat_demand"]
    other = cols["other_power"] if cool else []  # completes E_DC, so it counts only with the cooling
    if not it:
        return [], KPI_NOTE
    pu = cols["power_unit"]
    e_unit, scale = {"W": ("kWh", 1e3), "kW": ("MWh", 1e3), "MW": ("GWh", 1e3)}.get(pu or "", (f"{pu}h", 1))
    out: list[dict] = []
    used = [it, *([cool] if cool else []), *other, *heat]
    # one column in two roles (the reused heat bounded by the IT power): selected once, else rows[it] is a frame
    rows = num[list(dict.fromkeys(used))].dropna()
    w = pd.Series(hours, index=num.index)[rows.index]  # each row by its own duration, also in the ratios
    e_it = (rows[it] * w).sum()
    e_dc = e_it + ((rows[cool] * w).sum() if cool else 0.0)
    if other:
        e_dc += (rows[other].sum(axis=1) * w).sum()
    e_reuse = (rows[heat].sum(axis=1) * w).sum() if heat else 0.0
    where = (POINT_NAMES.get(cols["reuse_point"], cols["reuse_point"]) + " · ") if cols["reuse_point"] else ""
    total = "IT + cooling + other" if other else "IT + cooling"
    if cool and e_it > 0:
        label, note = ("PUE", "total facility ÷ IT") if other else ("PUE (partial)", "IT + cooling only")
        out.append({"label": label, "value": e_dc / e_it, "unit": None, "note": f"{note} · ISO/IEC 30134-2"})
    if cool and heat and e_dc > 0:
        out.append(
            {"label": "ERF", "value": e_reuse / e_dc, "unit": None, "note": f"{where}reused / ({total}) · ISO/IEC 30134-6"}
        )
        out.append(
            {
                "label": "ERE",
                "value": (e_dc - e_reuse) / e_it if e_it > 0 else None,
                "unit": None,
                "note": f"({total} − reused) / IT · Green Grid",
            }
        )
    if pu:  # an energy without a power unit would be a made-up number
        out.append(
            {
                "label": "IT energy, total",
                "value": (num[it] * hours).sum() / scale,
                "unit": e_unit,
                "note": f"{it} × step, summed",
            }
        )
        if heat:
            reused = num[heat].sum(axis=1, min_count=1)
            note = f"{where}{' + '.join(heat)}"
            if demand:
                both = pd.concat([reused, num[demand]], axis=1).dropna()
                # hour by hour: heat beyond an hour's demand covers nothing (a summer surplus does not heat in winter)
                if both.iloc[:, 1].sum() > 0:
                    met = both.min(axis=1).sum() / both.iloc[:, 1].sum()
                    note += f" · {100 * met:.0f} % of {demand} covered"
            out.append({"label": "Heat reused, total", "value": (reused * hours).sum() / scale, "unit": e_unit, "note": note})
    return out, None if heat else NO_REUSE_NOTE


def histogram(finite: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(counts, edges) of BINS bins over finite values; none when there are no values or their range is past what a
    float holds (1e308 and −1e308: numpy finds no finite bins)."""
    with np.errstate(over="ignore"):
        span = finite.max() - finite.min() if len(finite) else np.nan
    if not np.isfinite(span):
        return np.array([]), np.array([])
    return np.histogram(finite, bins=BINS)


def row_hours(steps: np.ndarray) -> np.ndarray:
    """Each row's duration in hours: the shorter of its steps to the rows before and after it, so a file of mixed
    resolutions counts each part at its own step, and a gap (no rows) holds no energy. `steps`: the seconds between
    the rows (one fewer than rows; none: a single row counts nothing)."""
    if not len(steps):
        return np.zeros(1)
    return np.minimum(np.append(steps, steps[-1]), np.insert(steps, 0, steps[0])) / 3600


def autocorrelation(x: np.ndarray, lags: int) -> list[float]:
    """Autocorrelation at lags 1..lags (FFT; gaps count as the mean): how strongly a variable follows its own past."""
    v = x[np.isfinite(x)]
    if len(v) < 3 or np.std(v) == 0:
        return [float("nan")] * lags
    z = np.where(np.isfinite(x), x - v.mean(), 0.0)
    n = len(z)
    f = np.fft.rfft(z, 2 * n)
    ac = np.fft.irfft(f * np.conj(f))[: lags + 1]
    return (ac[1:] / ac[0]).tolist()


def shapes(num: pd.DataFrame, time: pd.Series) -> dict:
    """The Dashboard's extra views of every variable: load duration curve, daily profile with its 10-90 % band,
    autocorrelation and monthly means."""
    q = np.linspace(1, 0, DURATION_POINTS)
    duration = {c: np.nanquantile(num[c].to_numpy(), q).tolist() if num[c].notna().any() else [] for c in num.columns}
    hour = time.dt.hour.to_numpy()
    by_hour = num.groupby(hour)
    lo, mid, hi = (by_hour.quantile(0.1), by_hour.mean(), by_hour.quantile(0.9))
    hours = pd.RangeIndex(24)
    daily = {c: {k: f[c].reindex(hours).tolist() for k, f in (("p10", lo), ("mean", mid), ("p90", hi))} for c in num.columns}
    lags = min(ACF_LAGS, max(1, len(num) // 4))
    acf = {c: autocorrelation(num[c].to_numpy(), lags) for c in num.columns}
    months = num.groupby(time.dt.month.to_numpy()).mean().reindex(pd.RangeIndex(1, 13))
    monthly = {c: months[c].tolist() for c in num.columns}
    return {"duration": duration, "daily": daily, "acf": acf, "monthly": monthly}


def summarize(df: pd.DataFrame, config: dict, max_points: int = MAX_POINTS, hex_option: str | None = None) -> dict:
    """Everything the Dashboard shows for one data file (see docs/concepts/dashboard.md); hex_option (site.json)
    picks the heat_source point whose heat counts as reused."""
    if "time" not in df.columns:
        raise ValueError("The data file has no 'time' column")
    num = df.drop(columns="time").select_dtypes(include=["number", "bool"]).astype(float)
    num = num.replace([np.inf, -np.inf], np.nan)
    time = df["time"]
    rows = len(df)

    steps = time.diff().dt.total_seconds().to_numpy()[1:]
    step = float(np.median(steps)) if len(steps) else None
    long = steps[steps > GAP_FACTOR * step] if step else steps[:0]
    start, end = (time.min(), time.max()) if rows else (None, None)

    stats = num.describe(percentiles=[0.25, 0.5, 0.75]).T if rows else None
    variables = []
    for name in num.columns:
        col = num[name].to_numpy()
        finite = col[~np.isnan(col)]
        counts, edges = histogram(finite)
        s = stats.loc[name] if stats is not None else {}
        variables.append(
            {
                "name": name,
                "role": role_of(name, config),
                "calculated": name in (config.get("derived") or {}),  # Q = m cp (T_in - T_out), not a model target
                "prepared": name in {p["name"] for p in config.get("prepared") or []},  # made on the Dashboard
                "count": int(len(finite)),
                "missing": int(rows - len(finite)),
                **{k: float(s[src]) if len(finite) else None for k, src in STATS},
                "histogram": {"edges": edges.tolist(), "counts": counts.tolist()},
            }
        )

    cols = kpi_columns(list(num.columns), config, hex_option)
    kpi_list, kpi_note = kpis(num, row_hours(steps) if rows else np.zeros(0), cols)
    # bins of consecutive rows, each shown as its mean at its first timestamp
    bins = min(rows, max_points)
    idx = np.arange(rows) * bins // max(rows, 1)
    means = num.groupby(idx).mean()
    series = {
        "time": time.groupby(idx).first().dt.strftime(TIME_FORMAT).tolist(),
        "columns": {c: means[c].tolist() for c in means.columns},
    }
    # share of missing values per variable in the same bins: where in time the data is incomplete
    missing_map = {c: v.tolist() for c, v in num.isna().groupby(idx).mean().items()}
    # mean by weekday (Monday first) and hour: the weekly rhythm of each variable, 7 x 24
    profile = None
    if rows:
        grid = pd.MultiIndex.from_product([range(7), range(24)])
        by = num.groupby([time.dt.dayofweek.to_numpy(), time.dt.hour.to_numpy()]).mean().reindex(grid)
        profile = {c: by[c].to_numpy().reshape(7, 24).tolist() for c in by.columns}

    return {
        "rows": rows,
        "start": start.strftime(TIME_FORMAT) if start is not None else None,
        "end": end.strftime(TIME_FORMAT) if end is not None else None,
        "resolution_seconds": step,
        "duration_hours": (end - start).total_seconds() / 3600 if rows else 0.0,
        "completeness": float(num.notna().to_numpy().mean()) if num.size else None,
        "gaps": {"count": int(len(long)), "longest_hours": float(long.max()) / 3600 if len(long) else 0.0},
        "variables": variables,
        "correlation": {"names": list(num.columns), "matrix": num.corr().to_numpy().tolist()},
        "series": series,
        "missing_map": missing_map,
        "profile": profile,
        "kpis": kpi_list,
        "kpi_note": kpi_note,
        "kpi_columns": cols,  # which column plays which KPI role: the Dashboard's what-if recomputes them on the twin
        "recommendations": recommend(df, config),
        **(shapes(num, time) if rows >= 4 else {"duration": {}, "daily": {}, "acf": {}, "monthly": {}}),
    }
