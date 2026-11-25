#!/usr/bin/env python
"""Copy a structured version (version_2) into a new bronze / silver version (core/storage.py).

    .venv/bin/python scripts/bronze_silver_version.py data_versions/version_2 data_versions/version_3

bronze gets the data as delivered, which the app never writes: every data file (datacenter_data/<dc>/*.parquet)
and the Wärmeatlas download (district_data/waermeatlas/). silver gets everything else, which the app prepares and
edits: each data center's dataset.json, graphs, P&ID and prepared variables, the models, the site, the components,
the saved project states. Only reads the source; refuses a target that already has files.
"""

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.core.storage import STRUCTURED_MARK, Storage  # noqa: E402

SKIP = shutil.ignore_patterns(".DS_Store")


def split(src: Path, dst: Path) -> dict[str, int]:
    """Copy `src` (structured) into `dst` (bronze / silver); how many files went where."""
    source = Storage.of(src)
    if source.bronze:
        raise ValueError(f"{src} already has bronze and silver")
    if not source.structured:
        raise ValueError(f"{src} is not structured: run structure_version.py first")
    if dst.exists() and any(p.name != ".DS_Store" for p in dst.iterdir()):
        raise ValueError(f"{dst} already has files: pick a new version folder")
    bronze, silver = dst / "bronze", dst / "silver"
    counts = {"bronze": 0, "silver": 0}

    def put(path: Path, layer: Path, rel: Path) -> None:
        target = layer / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        counts["bronze" if layer == bronze else "silver"] += 1

    for path in sorted(src.rglob("*")):
        if not path.is_file() or path.name == ".DS_Store":
            continue
        rel = path.relative_to(src)
        raw_data = rel.parts[0] == STRUCTURED_MARK and len(rel.parts) == 3 and path.suffix == ".parquet"
        atlas = rel.parts[:2] == ("district_data", "waermeatlas")
        put(path, bronze if raw_data or atlas else silver, rel)
    for folder in ("heat_distribution_data/components", "status", STRUCTURED_MARK):
        (silver / folder).mkdir(parents=True, exist_ok=True)
    return counts


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: bronze_silver_version.py <structured source version> <new version folder>")
    done = split(Path(sys.argv[1]), Path(sys.argv[2]))
    print(f"bronze: {done['bronze']} files (the data as delivered) · silver: {done['silver']} files (the app's)")
