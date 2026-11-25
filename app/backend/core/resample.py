"""Aggregated data files (Dashboard › Aggregate data): one data file brought to a coarser time step, each variable
by its own method (mean, median, sum, min, max, last value), written as a new data file in the data center's silver
(core/storage.py). The delivered file is never changed; prepared variables are then made on the new file too.
"""

import re

import pandas as pd

STEPS = {"15s": "15s", "1min": "1min", "15min": "15min", "1h": "1h", "1d": "1D"}
METHODS = {"mean", "median", "sum", "min", "max", "last", "drop"}  # drop: leave the variable out
NAME = re.compile(r"[A-Za-z0-9_-]{1,80}")


def check(step: str, methods: dict[str, str], default: str, columns: list[str]) -> None:
    """ValueError with a reason for an unknown step or method, or variables the file does not have."""
    if step not in STEPS:
        raise ValueError(f"Unknown time step {step!r}: one of {', '.join(STEPS)}")
    bad = sorted({m for m in [default, *methods.values()] if m not in METHODS})
    if bad:
        raise ValueError(f"Unknown method {', '.join(bad)}: one of {', '.join(sorted(METHODS))}")
    unknown = [c for c in methods if c not in columns]
    if unknown:
        raise ValueError(f"Not variables of this file: {', '.join(unknown)}")
    if all(methods.get(c, default) == "drop" for c in columns):
        raise ValueError("Every variable is left out: keep at least one")


def _plan(columns: list[str], step: str, methods: dict[str, str], default: str) -> tuple[pd.Timedelta, dict[str, str]]:
    """(the step, variable -> method of the variables kept), checked."""
    check(step, methods, default, columns)
    how = {c: methods.get(c, default) for c in columns}
    return pd.Timedelta(STEPS[step]), {c: m for c, m in how.items() if m != "drop"}


def _coarser(times: pd.Series, rule: pd.Timedelta) -> None:
    own = times.diff().median()
    if pd.notna(own) and rule <= own:
        raise ValueError(f"The data already has one row every {own}: aggregate to a coarser step than that")


def _aggregate(df: pd.DataFrame, rule: pd.Timedelta, keep: dict[str, str]) -> pd.DataFrame:
    """One row per step that has data (labelled by its start), each variable by its method."""
    bins = df.set_index("time")[list(keep)].resample(rule, label="left", closed="left", origin="epoch")
    # a step with no value of a variable is a gap, not 0 (pandas sums an empty step to 0)
    out = bins.agg(keep).where(bins.count() > 0)
    return out.dropna(how="all").reset_index()


def resample(df: pd.DataFrame, step: str, methods: dict[str, str], default: str = "mean") -> pd.DataFrame:
    """The file at the coarser step: one row per step that has data (labelled by its start), each variable by its
    method; ValueError when the step is not coarser than the data's own."""
    if "time" not in df:
        raise ValueError("This data file has no time column")
    columns = [c for c in df.columns if c != "time" and pd.api.types.is_numeric_dtype(df[c])]
    rule, keep = _plan(columns, step, methods, default)
    _coarser(df["time"], rule)
    out = _aggregate(df, rule, keep)
    if len(out) < 2:
        raise ValueError("That step leaves fewer than 2 rows")
    return out


def resample_chunks(chunks, columns: list[str], step: str, methods: dict[str, str], default: str = "mean") -> pd.DataFrame:
    """resample() of a file read in chunks of rows (sorted by time), never whole: each chunk's finished steps are
    aggregated at once, and the rows of its last step wait for the next chunk, so every step is computed over all
    its rows and the result is the same as resample() of the whole file, for every method."""
    rule, keep = _plan(columns, step, methods, default)
    parts, pending, first = [], None, True
    for chunk in chunks:
        df = chunk if pending is None else pd.concat([pending, chunk], ignore_index=True)
        if not df["time"].is_monotonic_increasing:
            raise ValueError("The file's rows are not in time order: it cannot be aggregated while it is read")
        if first:
            _coarser(df["time"].head(1000), rule)
            first = False
        bucket = df["time"].dt.floor(rule)
        last = bucket.iloc[-1]
        done, pending = df[bucket < last], df[bucket == last]
        if len(done):
            parts.append(_aggregate(done, rule, keep))
    if pending is not None and len(pending):
        parts.append(_aggregate(pending, rule, keep))
    out = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
    if len(out) < 2:
        raise ValueError("That step leaves fewer than 2 rows")
    return out


def time_bound(text: str) -> pd.Timestamp:
    """A time window's bound as the data's times are: a readable date without a time zone; ValueError else."""
    try:
        t = pd.Timestamp(text)
    except ValueError:
        t = pd.NaT
    if pd.isna(t):
        raise ValueError(f"Not a date: {text!r} (e.g. 2024-03-01 or 2024-03-01 06:00)")
    if t.tzinfo is not None:
        raise ValueError(f"Give {text!r} without a time zone: the data's times have none")
    return t


def window(df: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp, columns: list[str] | None = None) -> pd.DataFrame:
    """The rows of a loaded data file from `start` up to (not including) `end`, with "time" and `columns` (none: all);
    KeyError for a column it does not have, ValueError when no row is in the window (a big CSV: csv_data.window)."""
    out = df[(df["time"] >= start) & (df["time"] < end)][["time", *(columns or [c for c in df if c != "time"])]]
    if out.empty:
        raise ValueError(f"No rows between {start} and {end}")
    return out
