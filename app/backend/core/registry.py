"""The datasets of the app: every data center of the data directory that has a data (parquet) file, and the
examples (app/data) the data directory has no data center of the same id for: they are in every project. Each keeps
its own folder: an example's files are read and written where it lives.

A data file is read with the variables the user prepared from it (core/prepare.py) as extra columns. Data frames
are loaded once and kept in memory (the first file of each dataset at discovery, the others on first use).
"""

import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from . import csv_data
from .csv_data import csv_meta, read_csv_data
from .dataset_files import migrate_legacy_graph
from .storage import Storage


@dataclass
class DatasetMeta:
    """What the app knows about a dataset; schema fields come from its first parquet file."""

    id: str
    name: str
    directory: Path
    files: list[str]
    columns: list[str]
    time_range: tuple[str, str]
    row_count: int
    resolution_seconds: int | None
    storage: Storage
    example: bool = False  # one of the examples, from app/data, in a project of the user's
    scope_dir: Path | None = None  # another structure of the data center (deps.get_structure): all its files are here
    home: Path | None = None  # then the data center's own folder (its dataset.json)

    @property
    def own_directory(self) -> Path:
        """The data center's own folder, also for another structure of it (dataset.json is the data center's)."""
        return self.home or self.directory

    def file(self, rel: str) -> Path:
        """The place of one of its files, named as in a project file ("site.json", "models/xgb.json", ...)."""
        return self.scope_dir / rel if self.scope_dir else self.storage.file(self.id, rel)

    def data_file(self, stem: str) -> Path:
        """One of its data files: delivered (bronze in a bronze / silver version) or aggregated (silver)."""
        return next(
            (p for p in self.storage.data_files(self.id) if p.stem == stem), self.storage.data_dir(self.id) / f"{stem}.parquet"
        )


def load_parquet(path: Path) -> pd.DataFrame:
    """A data file (parquet, or a delivered CSV small enough to load: core/csv_data.py) with its "time" column as
    datetimes, its rows in time order (the twin takes a row for a step). ValueError for a CSV too big to load."""
    if path.suffix.lower() == ".csv":
        return read_csv_data(path)
    df = pd.read_parquet(path)
    if "time" in df.columns:
        df["time"] = csv_data.as_times(df["time"])  # also unix times (numbers), not 1970
        if not df["time"].is_monotonic_increasing:
            df = df.sort_values("time", kind="stable").reset_index(drop=True)
    return df


def load_data(storage: Storage, dc: str, path: Path) -> pd.DataFrame:
    """A data file with the variables prepared from it as extra columns (rows in the same order, as prepare writes
    them); a prepared file that no longer matches its data file (other rows) is left out until prepared again."""
    df = load_parquet(path)
    prepared = storage.prepared_file(dc, path.stem)
    if prepared.exists():
        extra = load_parquet(prepared)
        same_rows = len(extra) == len(df) and ("time" not in extra or "time" not in df or extra["time"].equals(df["time"]))
        if same_rows:
            new = [c for c in extra.columns if c != "time" and c not in df.columns]
            df = pd.concat([df, extra[new].set_axis(df.index)], axis=1)
    return df


def _read_dataset(directory: Path, parquet_files: list[Path], storage: Storage) -> tuple[DatasetMeta, pd.DataFrame | None]:
    """A dataset's metadata from its first data file (loaded, and returned for the cache); a CSV is described from
    its header and ends only, and not loaded (None)."""
    if parquet_files[0].suffix.lower() == ".csv":
        m = csv_meta(parquet_files[0])
        meta = DatasetMeta(
            id=directory.name,
            name=directory.name.replace("_", " ").title(),
            directory=directory,
            files=[f.stem for f in parquet_files],
            columns=m["columns"],
            time_range=(m["start"], m["end"]),
            row_count=m["row_count"],
            resolution_seconds=m["resolution_seconds"],
            storage=storage,
        )
        return meta, None
    first = load_data(storage, directory.name, parquet_files[0])
    time_range, resolution = ("", ""), None
    if "time" in first.columns:
        time = first["time"]
        time_range = (time.min().isoformat(), time.max().isoformat())
        step = csv_data.step_seconds(time)
        resolution = int(step) if step is not None else None
    meta = DatasetMeta(
        id=directory.name,
        name=directory.name.replace("_", " ").title(),
        directory=directory,
        files=[f.stem for f in parquet_files],
        # the variables of a big CSV listed after it (an aggregated file may keep only some): all are on the P&ID
        columns=list(
            dict.fromkeys(
                [c for c in first.columns if c != "time"]
                + [c for f in parquet_files[1:] if f.suffix.lower() == ".csv" for c in csv_meta(f)["columns"]]
            )
        ),
        time_range=time_range,
        row_count=len(first),
        resolution_seconds=resolution,
        storage=storage,
    )
    return meta, first


class DatasetRegistry:
    """Dataset metadata by id, and a thread-safe cache of their data frames."""

    def __init__(self, data_dir: Path, examples_dir: Path | None = None) -> None:
        self.data_dir = data_dir
        self.examples_dir = examples_dir
        self.storage = Storage.of(data_dir)
        self.datasets: dict[str, DatasetMeta] = {}
        self.unreadable: dict[str, str] = {}  # data centers left out at the last scan: a data file could not be read
        self._frames: dict[tuple[str, str], pd.DataFrame] = {}
        self._lock = threading.Lock()

    def discover(self) -> None:
        """(Re-)scan the data directory. Datasets whose folder is gone are dropped, cached frames cleared. A data
        center whose first data file cannot be read is left out (listed in `unreadable`): one broken delivery must
        not keep the app or the other data centers from opening. The state changes at once, at the end."""
        datasets, frames, unreadable = {}, {}, {}
        own = Storage.of(self.data_dir)
        roots = [(own, False)]
        if self.examples_dir is not None and self.examples_dir.resolve() != self.data_dir.resolve():
            roots.append((Storage.of(self.examples_dir), True))
        for storage, example in roots:
            for dc in storage.dataset_ids():
                if dc in datasets:  # the project's own copy of an example comes first
                    continue
                directory, parquet_files = storage.dataset_dir(dc), storage.data_files(dc)
                # a CSV too big to load goes last: the pages open a file they can load (an aggregated one) by default
                parquet_files.sort(key=lambda f: f.suffix.lower() == ".csv" and f.stat().st_size > csv_data.CSV_LOAD_MAX_BYTES)
                if storage.bronze:  # a data center new in bronze gets its own folder in silver
                    directory.mkdir(parents=True, exist_ok=True)
                if parquet_files:
                    try:
                        migrate_legacy_graph(directory)
                        meta, first = _read_dataset(directory, parquet_files, storage)
                    except Exception as exc:  # noqa: BLE001 - any parser or file error: skip this one data center
                        logging.getLogger(__name__).warning("data center %s left out: %s", dc, exc)
                        unreadable[dc] = f"{type(exc).__name__}: {exc}"
                        continue
                    meta.example = example
                    datasets[meta.id] = meta
                    if first is not None:
                        frames[(meta.id, meta.files[0])] = first
        with self._lock:
            self.storage, self.datasets, self._frames, self.unreadable = own, datasets, frames, unreadable

    def get_dataframe(self, dataset_id: str, file_name: str) -> pd.DataFrame:
        """One data file of a dataset; FileNotFoundError if the dataset has no such file."""
        meta = self.datasets[dataset_id]
        # only the dataset's own parquet files: never a path built from user input
        if file_name not in meta.files:
            raise FileNotFoundError(f"File '{file_name}' not found")
        key = (dataset_id, file_name)
        with self._lock:
            if key not in self._frames:
                self._frames[key] = load_data(meta.storage, meta.id, meta.data_file(file_name))
            return self._frames[key]
