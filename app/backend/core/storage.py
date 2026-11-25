"""Where every file of a data folder lives. The one module to replace when the files move into a database.

The rest of the app names files the way a project file does ("site.json", "equations.json", "models/xgb.json",
"causal_graph.json", ...) and asks a `Storage` for their place; it never builds a path in a data folder itself.

Three layouts, told apart by a `datacenter_data/` folder, or `bronze/` + `silver/` folders:

flat (the examples in app/data, and version_1)::

    <dc>/                       everything of a data center (dataset_files.py)
    _components/  _external/waermeatlas/  _local/map_examples.json  _status/<dc>/

structured (version_2 on)::

    datacenter_data/<dc>/                   data (*.parquet), dataset.json, causal graphs, P&ID
    models/<dc>/physics/equations.json      physics equations
    models/<dc>/trained/<name>.json         trained models (physics-based and data-driven) and their boosters
    district_data/<dc>/                     site.json (map, heat sinks, page settings), weather cache
    district_data/waermeatlas/              Wärmeatlas buildings (scripts/import_waermeatlas.py)
    district_data/map_examples.json         example data centers of the Site map
    heat_distribution_data/components/      the user's heat-distribution components
    status/<dc>/<dc>-project-<time>.json    saved project states, one file per save

bronze / silver (version_3 on): the data as delivered stays untouched in bronze; everything the app prepares and
edits is in silver, laid out as the structured layout above. A version may come as bronze alone: silver is made on
first use. In bronze the data may also be CSV, listed from its header and ends without being loaded (csv_data.py)::

    bronze/datacenter_data/<dc>/*.parquet   the measured / simulated data, never written by the app
    bronze/datacenter_data/<dc>/*.csv       the same, as delivered CSV
    bronze/district_data/waermeatlas/       the Wärmeatlas download and its buildings
    silver/...                              dataset.json, graphs, P&ID, prepared variables, models, site, status

Whatever the app makes from the data (prepared variables, aggregated data files, and the recipe of both) goes to the
data center's silver folder, never next to or into the delivered files: <dc>/silver/ in the flat and structured
layouts (git-ignored for the examples), the data center's own folder in silver in a bronze / silver version::

    <silver of dc>/recipe.json                   how the prepared variables and aggregated files were made
    <silver of dc>/prepared/<file>.parquet       the prepared variables of one data file
    <silver of dc>/resampled/<file>__<step>.parquet   a data file aggregated to a coarser time step
    <silver of dc>/documents/                    the user's documents about the data center (core/documents.py)
"""

from dataclasses import dataclass
from pathlib import Path

from . import dataset_files as files

STRUCTURED_MARK = "datacenter_data"
SILVER = "silver"
PREPARED_DIR = "prepared"
RESAMPLED_DIR = "resampled"
RECIPE = files.RECIPE
DOCUMENTS_DIR = "documents"


@dataclass(frozen=True)
class Storage:
    """The places of a data folder's files; `structured` picks the layout, `bronze` the untouched raw data."""

    root: Path  # where the app reads and writes (silver, in a bronze / silver version)
    structured: bool
    bronze: Path | None = None  # bronze / silver: the data as delivered, read only

    @classmethod
    def of(cls, root: Path) -> "Storage":
        """The storage of a data folder, its layout read from the folder."""
        if (root / "bronze").is_dir():  # silver is made on first use: a new version may hold only the delivery
            return cls(root / "silver", True, root / "bronze")
        return cls(root, (root / STRUCTURED_MARK).is_dir())

    @property
    def version_root(self) -> Path:
        """The data folder itself (the version), above silver and bronze."""
        return self.root.parent if self.bronze else self.root

    @property
    def datasets_dir(self) -> Path:
        """Where the data-center folders are (each with its parquet files)."""
        return self.root / STRUCTURED_MARK if self.structured else self.root

    def dataset_dir(self, dc: str) -> Path:
        """A data center's own folder: dataset.json, graphs, P&ID (silver in a bronze / silver version)."""
        return self.datasets_dir / dc

    def data_dir(self, dc: str) -> Path:
        """Where a data center's data files are (bronze in a bronze / silver version)."""
        return self.bronze / STRUCTURED_MARK / dc if self.bronze else self.dataset_dir(dc)

    def work_dir(self, dc: str) -> Path:
        """The data center's silver: where everything made from its data goes (never the delivered files)."""
        return self.dataset_dir(dc) if self.bronze else self.dataset_dir(dc) / SILVER

    def documents_dir(self, dc: str) -> Path:
        """The user's documents about the data center's physical structure (core/documents.py): silver."""
        return self.work_dir(dc) / DOCUMENTS_DIR

    def data_files(self, dc: str) -> list[Path]:
        """Its data files: the delivered ones (sorted; the first is the default), then the aggregated ones (silver).
        In bronze a delivery may also be CSV (core/csv_data.py: listed without being loaded). dataset.json "data_file"
        (a stem) makes that file the default instead: the delivery stays in bronze as it came, the data prepared from
        it in silver is what the app works on."""
        delivered, made = self.data_dir(dc), self.work_dir(dc) / RESAMPLED_DIR
        patterns = ("*.parquet", "*.csv") if self.bronze else ("*.parquet",)
        found = sorted(p for pat in patterns for p in delivered.glob(pat)) if delivered.is_dir() else []
        found += sorted(made.glob("*.parquet")) if delivered.is_dir() and made.is_dir() else []
        pick = files.read_json(self.dataset_dir(dc) / files.DATASET_CONFIG).get("data_file")
        return sorted(found, key=lambda p: p.stem != pick) if pick else found  # stable: the rest keep their order

    def resampled_file(self, dc: str, stem: str) -> Path:
        """An aggregated data file (core/resample.py)."""
        return self.work_dir(dc) / RESAMPLED_DIR / f"{stem}.parquet"

    def prepared_file(self, dc: str, stem: str) -> Path:
        """The variables prepared from one data file (core/prepare.py)."""
        return self.work_dir(dc) / PREPARED_DIR / f"{stem}.parquet"

    def recipe_file(self, dc: str) -> Path:
        """How the prepared variables and aggregated files of a data center were made."""
        return self.work_dir(dc) / RECIPE

    def dataset_ids(self) -> list[str]:
        """The data centers: every folder with data files (in silver or, for new ones, only in bronze)."""
        bases = [self.datasets_dir, *([self.bronze / STRUCTURED_MARK] if self.bronze else [])]
        names = {d.name for b in bases if b.is_dir() for d in b.iterdir() if d.is_dir()}
        return sorted(n for n in names if self.data_files(n))

    def file(self, dc: str, rel: str) -> Path:
        """The place of a data center's file, named as in a project file; folders are created on first use."""
        if not self.structured:
            return self.dataset_dir(dc) / rel
        top, _, rest = rel.partition("/")
        if rel == files.EQUATIONS:
            path = self.root / "models" / dc / "physics" / rel
        elif top == files.MODELS_DIR:
            path = self.root / "models" / dc / "trained" / rest
        elif rel in (files.SITE, files.WEATHER):
            path = self.root / "district_data" / dc / rel
        else:
            return self.dataset_dir(dc) / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def project_files(self, dc: str) -> dict[str, Path]:
        """Every existing file of a data center by its project name (not the backups); the caller filters."""
        found: dict[str, Path] = {}
        bases = [("", self.dataset_dir(dc))]
        if self.structured:
            bases += [
                ("", self.root / "models" / dc / "physics"),
                (f"{files.MODELS_DIR}/", self.root / "models" / dc / "trained"),
                ("", self.root / "district_data" / dc),
            ]
        for prefix, base in bases:
            for p in base.rglob("*") if base.is_dir() else []:
                if p.is_file() and files.BACKUP_DIR not in p.relative_to(base).parts:
                    found[prefix + p.relative_to(base).as_posix()] = p
        return found

    @property
    def components_dir(self) -> Path:
        """Where the saved components go (routers/components.py), shared by every data center."""
        return self.root / ("heat_distribution_data/components" if self.structured else "_components")

    @property
    def pfa_db(self) -> Path:
        """The local Plattform für Abwärme sources database (scripts/import_pfa.py writes it), beside the Wärmeatlas."""
        return self.waermeatlas_db.parent.parent / "pfa" / "sources.sqlite"

    @property
    def waermeatlas_db(self) -> Path:
        """The local Wärmeatlas buildings database (scripts/import_waermeatlas.py writes it)."""
        if self.bronze:
            return self.bronze / "district_data" / "waermeatlas" / "buildings.sqlite"
        return self.root / ("district_data/waermeatlas" if self.structured else "_external/waermeatlas") / "buildings.sqlite"

    @property
    def map_examples_file(self) -> Path:
        """The machine-local Site-map examples (core/map_examples.py)."""
        return self.root / ("district_data" if self.structured else "_local") / "map_examples.json"

    def status_dir(self, dc: str) -> Path:
        """Where the saved project states of a data center go (a history: one file per save)."""
        return self.root / ("status" if self.structured else "_status") / dc
