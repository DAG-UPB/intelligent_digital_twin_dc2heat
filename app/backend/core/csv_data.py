"""Delivered CSV data files: read what the app needs to list them without loading them.

A data center delivered as one big CSV (gigabytes, hundreds of columns) must not be read into memory to be listed:
the app's budget is 2 GB. `csv_meta` reads only the header, the first rows (which columns are numbers, the time
column, the step) and the last line (the end of the time span); the row count is estimated from the file size.
`read_csv_data` loads a CSV small enough to fit (CSV_LOAD_MAX_BYTES) and refuses a bigger one with a message that
says what to do, so the pages that need the values (Dashboard, training) explain instead of crashing the app.
What to do with a big one: `chunks` reads it a block of rows at a time, for aggregating it (core/resample.py
resample_chunks) or for `window`, the rows of one period (a day, a week) as a data file of their own.

German exports (`;` or tab separated with a decimal comma in the first rows: "1.234,5") have their numbers read as
core/market.py `_number` reads SMARD's German files. The times of a file are read in one format, the one that reads
most of them (day first for "01.02.2024"); a time that is not readable in it is refused, not dropped. Times with a UTC
offset ("+02:00", "Z") are read as UTC, without the offset, so a clock change neither repeats nor drops an hour.
"""

from __future__ import annotations

import csv
import io
import re
from pathlib import Path

import pandas as pd

from .limits import CSV_CHUNK_ROWS, CSV_LOAD_MAX_BYTES, CSV_WINDOW_MAX_CELLS

TIME_NAMES = ("time", "timestamp", "datetime", "date_time", "date", "zeit")
HEAD_BYTES = 1 << 20  # the first rows: enough for the header and ~1000 rows of a wide file
SAMPLE_ROWS = 1000
TAIL_BYTES = 1 << 16
DECIMAL_COMMA = re.compile(r"[+-]?[\d.]*\d,\d+")  # "1,5", "1.234,5": only in a German export
GERMAN_NUMBER = r"[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?"  # not "01.02.2024": its groups are not of three
OFFSET = r"(?:Z|[+-]\d\d:?\d\d)$"
NUMERIC_DATE = re.compile(r"\d{1,2}([./])\d{1,2}[./]\d{2,4}")  # "01.02.2024" or "02/01/2024": day or month first


def time_format(values: pd.Series) -> tuple[str | None, bool]:
    """The one date format for all these values (the one that reads most of them; day first is tried first for
    "01.02.2024") and whether they carry a UTC offset."""
    text = values.dropna().astype(str).str.strip()
    text = text[text != ""]
    if text.empty:
        return None, False
    utc = bool(text.str.contains(OFFSET).any())
    first = text.iloc[0]
    m = NUMERIC_DATE.match(first)
    order = (False,) if m is None else (True, False) if m.group(1) == "." else (False, True)
    formats = dict.fromkeys(f for f in (pd.tseries.api.guess_datetime_format(first, dayfirst=d) for d in order) if f)
    if not formats:
        return None, utc
    return min(formats, key=lambda f: int(to_times(text, f, utc).isna().sum())), utc


def to_times(values: pd.Series, fmt: str | None, utc: bool) -> pd.Series:
    """Values as naive datetimes in one format (unreadable: NaT); with an offset as UTC; numbers as unix times."""
    if pd.api.types.is_numeric_dtype(values) or (fmt is None and pd.to_numeric(values, errors="coerce").notna().all()):
        return _unix(values)
    times = pd.to_datetime(values, format=fmt, errors="coerce", utc=utc)
    return times.dt.tz_convert(None) if utc else times


UNIX_UNITS = (("s", 1e8, 1e10), ("ms", 1e11, 1e13), ("us", 1e14, 1e16), ("ns", 1e17, 1e19))


def _unix(values: pd.Series) -> pd.Series:
    """Numbers as unix times, the unit (s, ms, µs, ns) by their size: the years 1973 to 2286 in each. Other numbers (a
    row number, 20240101) are not times: NaT, not a date in January 1970."""
    num = pd.to_numeric(values, errors="coerce")
    size = num.abs().median()
    unit = next((u for u, lo, hi in UNIX_UNITS if lo <= size < hi), None)
    if unit is None:
        return pd.Series(pd.NaT, index=values.index, dtype="datetime64[ns]")
    return pd.to_datetime(num, unit=unit, errors="coerce")


def step_seconds(times: pd.Series) -> float | None:
    """The data's step: the median step between rows (seconds), not the first one; None for fewer than two rows."""
    steps = pd.to_datetime(times).diff().dropna()
    return float(steps.median().total_seconds()) if len(steps) else None


def as_times(values: pd.Series) -> pd.Series:
    """A time column as naive datetimes: kept when it already is (with a time zone: as UTC, as offsets are read),
    else read in its one format (`time_format`)."""
    if not pd.api.types.is_datetime64_any_dtype(values):
        return to_times(values, *time_format(values))
    times = pd.to_datetime(values)
    return times.dt.tz_convert(None) if times.dt.tz is not None else times


def _german(text: str, sep: str) -> bool:
    """A German export: not comma separated, and a decimal comma among its first rows' fields."""
    if sep == ",":
        return False
    lines = text.splitlines()[1 : SAMPLE_ROWS + 1]
    return any(DECIMAL_COMMA.fullmatch(f.strip().strip('"')) for line in lines for f in line.split(sep))


def _numbers(df: pd.DataFrame) -> pd.DataFrame:
    """A German export read as text: each column whose values are all German numbers ("1.234,5", "-", empty) as
    numbers, as core/market.py `_number` reads them; the time and the text columns stay text."""
    for c in df.columns:
        if pd.api.types.is_numeric_dtype(df[c]):
            continue
        text = df[c].astype("string").str.strip()
        empty = text.isna() | text.isin(["", "-"])
        if empty.all() or not (text.str.fullmatch(GERMAN_NUMBER) | empty).all():
            continue
        df[c] = pd.to_numeric(text.where(~empty).str.replace(".", "", regex=False).str.replace(",", ".", regex=False))
    return df


def _read(source, sep: str, german: bool, **kwargs) -> pd.DataFrame:
    """pd.read_csv of a delivered file: a German export's columns as text first, then its numbers (`_numbers`), as
    pandas' own thousands="." would also read a date "01.02.2024" as the number 1022024."""
    if not german:
        return pd.read_csv(source, sep=sep, **kwargs)
    return _numbers(pd.read_csv(source, sep=sep, dtype=str, keep_default_na=False, **kwargs))


def time_column(df: pd.DataFrame) -> str | None:
    """The time column: one named like time / timestamp / date, else the first of three that reads as dates."""
    lower = {str(c).lower(): c for c in df.columns}
    named = next((lower[n] for n in TIME_NAMES if n in lower), None)
    if named is not None:
        return named
    for c in df.columns[:3]:
        if not pd.api.types.is_numeric_dtype(df[c]) and to_times(df[c], *time_format(df[c])).notna().mean() > 0.9:
            return c
    return None


def with_time(df: pd.DataFrame, name: str) -> pd.DataFrame:
    """The frame with its time column as "time" (datetimes, sorted); ValueError when it has none, or a time that
    cannot be read in the format of the others (a row is never dropped silently; an empty time is)."""
    col = time_column(df)
    if col is None:
        raise ValueError(f"{name}: no time column (time, timestamp, datetime, date, or a column of dates)")
    out = df.rename(columns={col: "time"})
    raw = out["time"]
    times = as_times(raw)
    if not pd.api.types.is_datetime64_any_dtype(raw):
        text = raw.astype("string").str.strip()
        bad = times.isna() & text.notna() & (text != "")
        if bad.any() and not bad.all():
            raise ValueError(
                f"{name}: {int(bad.sum())} of {len(raw)} times in {col!r} cannot be read in the format of the others "
                f"(the first: {text[bad].iloc[0]!r}). Correct them, or write every time as 2024-01-31 13:00"
            )
    if times.isna().all():
        raise ValueError(f"{name}: the time column {col!r} has no readable dates")
    out["time"] = times
    return out.dropna(subset=["time"]).sort_values("time").reset_index(drop=True)


def _delimiter(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample.splitlines()[0], delimiters=",;\t").delimiter
    except (csv.Error, IndexError):
        return ","


def csv_meta(path: Path) -> dict:
    """{columns (numeric, without time), start, end, resolution_seconds, row_count (estimated)} from the first
    and last bytes of a CSV only."""
    size = path.stat().st_size
    with path.open("rb") as f:
        head = f.read(HEAD_BYTES).decode("utf-8", errors="replace")
        f.seek(max(0, size - TAIL_BYTES))
        tail = f.read().decode("utf-8", errors="replace")
    complete = head if size <= HEAD_BYTES else head[: head.rfind("\n") + 1]  # no half row at the end of the head
    sep = _delimiter(complete)
    sample = _read(io.StringIO(complete), sep, _german(complete, sep), nrows=SAMPLE_ROWS)
    col = time_column(sample)
    numeric = [c for c in sample.columns if c != col and pd.api.types.is_numeric_dtype(sample[c])]
    start = end = None
    resolution = None
    if col is not None:
        fmt, utc = time_format(sample[col])
        times = to_times(sample[col], fmt, utc).dropna()
        if len(times):
            start = times.min()
            steps = times.sort_values().diff().dropna()
            resolution = int(steps.median().total_seconds()) if len(steps) else None
        last = [line for line in tail.splitlines() if line.strip()][-1:]
        if last:
            row = next(csv.reader([last[0]], delimiter=sep), [])
            idx = list(sample.columns).index(col)
            end = to_times(pd.Series([row[idx]]), fmt, utc).iloc[0] if idx < len(row) else None
    rows_in_head = max(1, len(sample))
    per_row = len(complete.encode()) / (rows_in_head + 1)  # + the header line
    return {
        "columns": [str(c) for c in numeric],
        "start": start.isoformat() if start is not None and not pd.isna(start) else "",
        "end": end.isoformat() if end is not None and not pd.isna(end) else "",
        "resolution_seconds": resolution,
        "row_count": int(size / per_row) if size > HEAD_BYTES else len(sample),
    }


def read_csv_data(path: Path) -> pd.DataFrame:
    """A delivered CSV with its time column as "time"; ValueError when it is too big to load here."""
    size = path.stat().st_size
    if size > CSV_LOAD_MAX_BYTES:
        raise ValueError(
            f"{path.name} is {size / 2**30:.1f} GB of CSV: too big to load within the app's memory "
            f"(limit {CSV_LOAD_MAX_BYTES // 2**20} MB). Its variables are listed and the P&ID can be matched to "
            "them; for the Dashboard and training, convert it to parquet (or aggregate it) first."
        )
    with path.open("rb") as f:
        head = f.read(HEAD_BYTES).decode("utf-8", errors="replace")
    sep = _delimiter(head)
    return with_time(_read(path, sep, _german(head, sep)), path.name)


def chunks(path: Path, columns: list[str] | None = None, rows: int = CSV_CHUNK_ROWS):
    """The CSV a block of rows at a time: frames of "time" and the numeric columns (or only `columns`)."""
    meta = csv_meta(path)
    with path.open("rb") as f:
        head = f.read(HEAD_BYTES).decode("utf-8", errors="replace")
    sep = _delimiter(head)
    german = _german(head, sep)
    sample = _read(io.StringIO(head[: head.rfind("\n") + 1]), sep, german, nrows=SAMPLE_ROWS)
    col = time_column(sample)
    if col is None:
        raise ValueError(f"{path.name}: no time column")
    wanted = [c for c in (columns or meta["columns"]) if c in meta["columns"]]
    if columns and len(wanted) < len(columns):
        raise ValueError(f"Not variables of {path.name}: {', '.join(sorted(set(columns) - set(wanted)))}")
    fmt, utc = time_format(sample[col])
    text_opts = {"dtype": str, "keep_default_na": False} if german else {}
    for chunk in pd.read_csv(path, sep=sep, usecols=[col, *wanted], chunksize=rows, **text_opts):
        chunk = _numbers(chunk) if german else chunk
        chunk = chunk.rename(columns={col: "time"})
        chunk["time"] = to_times(chunk["time"], fmt, utc)
        # a column of numbers in the first rows may hold a word further down ("NaN", "error"): that value is a gap
        text = [c for c in wanted if not pd.api.types.is_numeric_dtype(chunk[c])]
        if text:
            chunk[text] = chunk[text].apply(pd.to_numeric, errors="coerce")
        yield chunk.dropna(subset=["time"])[["time", *wanted]]


def window(path: Path, start: pd.Timestamp, end: pd.Timestamp, columns: list[str] | None = None) -> pd.DataFrame:
    """The rows from `start` up to (not including) `end`, read in chunks; reading stops past the end when the file
    is in time order. ValueError when there are none, or more than fit (CSV_WINDOW_MAX_CELLS values)."""
    if not start < end:
        raise ValueError("The window's end must come after its start")
    parts, cells = [], 0
    for chunk in chunks(path, columns):
        part = chunk[(chunk["time"] >= start) & (chunk["time"] < end)]
        if len(part):
            parts.append(part)
            cells += part.size
            if cells > CSV_WINDOW_MAX_CELLS:
                raise ValueError(
                    f"That window holds more than {CSV_WINDOW_MAX_CELLS:,} values: choose a shorter one or fewer variables"
                )
        if len(chunk) and chunk["time"].is_monotonic_increasing and chunk["time"].iloc[-1] >= end:
            break
    if not parts:
        raise ValueError(f"No rows between {start} and {end}")
    return pd.concat(parts, ignore_index=True).sort_values("time", kind="stable").reset_index(drop=True)


def demo(tmp: Path) -> None:
    """Self-check: a ; separated CSV gives its numeric columns, span and step from its ends only."""
    p = tmp / "d.csv"
    p.write_text("Zeit;a;b;note\n2024-01-01 00:00;1;2;x\n2024-01-01 01:00;3;4;y\n2024-01-01 02:00;5;6;z\n")
    m = csv_meta(p)
    assert m["columns"] == ["a", "b"] and m["resolution_seconds"] == 3600, m
    assert (m["start"], m["end"]) == ("2024-01-01T00:00:00", "2024-01-01T02:00:00"), m
    assert list(read_csv_data(p).columns) == ["time", "a", "b", "note"]
    got = window(p, pd.Timestamp("2024-01-01 01:00"), pd.Timestamp("2024-01-01 02:00"), ["b"])
    assert got.to_dict("list") == {"time": [pd.Timestamp("2024-01-01 01:00")], "b": [4]}, got
    assert sum(len(c) for c in chunks(p, rows=2)) == 3
