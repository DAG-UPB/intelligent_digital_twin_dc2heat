"""Data folders of the app: the version folders of the user's shared data root, and the built-in examples.

The shared root is `app/data_versions`, a per-machine symlink to the user's data folder, set by
`scripts/link-data.sh` or from the app; git-ignored. Each of its sub-folders (`version_1`, `version_2`, ...) is laid
out like `app/data`: one folder per data center, and the app saves its graphs, models and site there. The repo's own
`app/data` (the simulations) is offered as the examples ("local"). The code only ever names the relative link.
"""

import re
import shutil
import subprocess
import sys
from pathlib import Path

from . import dataset_files as files
from .storage import Storage

LOCAL = "local"


def _natural(name: str) -> list:
    """Sort key that puts version_2 before version_10."""
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", name)]


def versions(root: Path | None) -> list[str]:
    """The version folders of the shared root, in natural order; [] when it is not linked on this machine."""
    if root is None or not root.is_dir():
        return []
    return sorted((p.name for p in root.iterdir() if p.is_dir() and not p.name.startswith((".", "_"))), key=_natural)


PROJECT_FILE = "project.json"  # in a version folder: {"name": "..."}, the project's name the app shows


def version_names(root: Path | None, found: list[str]) -> dict[str, str]:
    """The versions that carry a name of their own (their project.json "name"), by folder."""
    if root is None:
        return {}
    names = {v: str(files.read_json(root / v / PROJECT_FILE).get("name") or "").strip() for v in found}
    return {v: n for v, n in names.items() if n}


def default_version(root: Path | None) -> str:
    """The newest version of the user's folder; the examples only when no folder is linked."""
    found = versions(root)
    return found[-1] if found else LOCAL


def data_dir_of(version: str, local_dir: Path, root: Path | None) -> Path:
    """The data folder of a version; ValueError for an unknown one (the path is never built from the input)."""
    if version == LOCAL:
        return local_dir
    if version not in versions(root):
        raise ValueError(f"Data version '{version}' not found")
    assert root is not None  # versions() is empty without a root
    return root / version


def catalog(directory: Path) -> list[dict]:
    """The data centers of a data folder (id, name, kind from dataset.json), without loading any data."""
    storage = Storage.of(directory)
    out = []
    for dc in storage.dataset_ids():
        config = files.read_json(storage.dataset_dir(dc) / files.DATASET_CONFIG)
        out.append(
            {
                "id": dc,
                "name": config.get("name") or dc.replace("_", " ").title(),
                "kind": config.get("kind") or "simulation",
            }
        )
    return out


def with_examples(own: list[dict], examples: list[dict]) -> list[dict]:
    """A project's data centers and, after them, the examples it has no data center of the same id for (marked
    example): the examples are in every project; a project's own copy of one comes first."""
    ids = {d["id"] for d in own}
    return own + [{**e, "example": True} for e in examples if e["id"] not in ids]


def link_root(link: Path, target: Path) -> None:
    """Point the shared-root link at another folder; ValueError if it is not a folder or the link is a real one."""
    if not target.is_absolute() or not target.is_dir():
        raise ValueError(f"Not a folder: {target}")
    if link.exists() and not link.is_symlink():
        raise ValueError(f"{link.name} is a real folder, not a link: move it aside first")
    # a new link under a temporary name, then renamed over the old one: never a moment without a link
    tmp = link.with_name(f".{link.name}.tmp")
    tmp.unlink(missing_ok=True)
    tmp.symlink_to(target, target_is_directory=True)
    tmp.replace(link)


def is_version_name(name: str) -> bool:
    """version_1, version 2, Version3: how the folder picker recognises a data folder."""
    return re.fullmatch(r"version[_ -]?\d+", name, re.IGNORECASE) is not None


def subfolders(path: Path) -> tuple[Path, list[str]]:
    """(the folder, its visible sub-folder names) for the folder picker: names only, never files or contents."""
    path = path.expanduser().resolve()
    if not path.is_dir():
        raise ValueError(f"Not a folder: {path}")
    try:
        names = [p.name for p in path.iterdir() if p.is_dir() and not p.name.startswith(".")]
    except PermissionError as exc:
        raise ValueError(f"No access to {path}") from exc
    return path, sorted(names, key=lambda n: _natural(n.lower()))


_PROMPT = "Choose your data folder (it holds version_1, version_2, …)"


def native_picker_command(platform: str = sys.platform) -> list[str] | None:
    """The command that shows this OS's own folder dialog and prints the chosen path; None if there is none."""
    if platform == "darwin":
        # `activate` brings the dialog in front of the browser
        return ["osascript", "-e", "activate", "-e", f'POSIX path of (choose folder with prompt "{_PROMPT}")']
    if platform == "win32":
        ps = (
            "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; "
            f"$d.Description = '{_PROMPT}'; if ($d.ShowDialog() -eq 'OK') {{ $d.SelectedPath }}"
        )
        return ["powershell", "-NoProfile", "-STA", "-Command", ps]
    if shutil.which("zenity"):
        return ["zenity", "--file-selection", "--directory", f"--title={_PROMPT}"]
    return None


def pick_folder_natively(timeout: float = 600) -> str | None:
    """Show the OS folder dialog on this computer (the app's own machine) and wait; the chosen folder, None if cancelled.

    ValueError when this OS has no folder dialog the app can open.
    """
    command = native_picker_command()
    if command is None or shutil.which(command[0]) is None:
        raise ValueError("No folder dialog available on this computer: browse the list or paste the path")
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        return None
    chosen = done.stdout.strip()
    return chosen or None  # cancelled: non-zero exit (macOS "User canceled") or nothing printed


def read_choice(path: Path | None) -> str:
    """The version chosen last on this machine; "" when none was saved."""
    try:
        return path.read_text().strip() if path else ""
    except OSError:
        return ""


def write_choice(path: Path | None, version: str) -> None:
    """Remember the choice across restarts (a machine-local file, never in the shared folder)."""
    if path:
        files.write_atomic(path, version)
