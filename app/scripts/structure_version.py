#!/usr/bin/env python
"""Copy a flat data folder (version_1, app/data) into a new version with the structured layout (core/storage.py).

    .venv/bin/python scripts/structure_version.py data_versions/version_1 data_versions/version_2

Only reads the source; refuses a target that already has files. Per data center (a folder with parquet files):

    <dc>/ data, dataset.json, graphs, P&ID   -> datacenter_data/<dc>/
    <dc>/equations.json                      -> models/<dc>/physics/
    <dc>/models/*                            -> models/<dc>/trained/
    <dc>/site.json, weather_open_meteo.json  -> district_data/<dc>/

and the shared folders: _external/waermeatlas -> district_data/waermeatlas, _local/map_examples.json ->
district_data/, _components -> heat_distribution_data/components. Anything else is copied unchanged and listed.
"""

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.core import dataset_files as files  # noqa: E402
from backend.core.storage import STRUCTURED_MARK, Storage  # noqa: E402

SKIP = {".DS_Store"}


def _copy(src: Path, dst: Path) -> None:
    if src.is_dir():
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns(*SKIP), dirs_exist_ok=True)
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def structure(src: Path, dst: Path) -> list[str]:
    """Copy `src` (flat) into `dst` (structured); the names of what was copied unchanged."""
    if Storage.of(src).structured:
        raise ValueError(f"{src} is already structured")
    if dst.exists() and any(p.name not in SKIP for p in dst.iterdir()):
        raise ValueError(f"{dst} already has files: pick a new version folder")
    out = Storage(dst, structured=True)
    (dst / STRUCTURED_MARK).mkdir(parents=True)
    for folder in ("heat_distribution_data/components", "district_data", "models", "status"):
        (dst / folder).mkdir(parents=True, exist_ok=True)

    unchanged = []
    for item in sorted(src.iterdir()):
        if item.name in SKIP:
            continue
        if item.is_dir() and any(item.glob("*.parquet")):  # a data center
            for f in item.iterdir():
                if f.name in SKIP:
                    continue
                if f.name == files.MODELS_DIR and f.is_dir():
                    for m in f.iterdir():
                        if m.name not in SKIP:
                            _copy(m, out.file(item.name, f"{files.MODELS_DIR}/{m.name}"))
                elif f.name in (files.EQUATIONS, files.SITE, files.WEATHER):
                    _copy(f, out.file(item.name, f.name))
                else:
                    _copy(f, out.dataset_dir(item.name) / f.name)
        elif item.name == "_external" and (item / "waermeatlas").is_dir():
            _copy(item / "waermeatlas", out.waermeatlas_db.parent)
            rest = [p for p in item.iterdir() if p.name not in ("waermeatlas", *SKIP)]
            for p in rest:
                _copy(p, dst / "district_data" / p.name)
                unchanged.append(f"_external/{p.name} -> district_data/{p.name}")
        elif item.name == "_local":
            for p in item.iterdir():
                if p.name == "map_examples.json":
                    _copy(p, out.map_examples_file)
                elif p.name not in SKIP:
                    _copy(p, dst / "_local" / p.name)
                    unchanged.append(f"_local/{p.name}")
        elif item.name == "_components":
            _copy(item, out.components_dir)
        else:
            _copy(item, dst / item.name)
            unchanged.append(item.name)
    return unchanged


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: structure_version.py <flat source folder> <new version folder>")
    source, target = Path(sys.argv[1]), Path(sys.argv[2])
    kept = structure(source, target)
    print(f"Structured {source} -> {target}: {len(list((target / STRUCTURED_MARK).iterdir()))} data centers")
    for name in kept:
        print(f"  copied unchanged: {name}")
