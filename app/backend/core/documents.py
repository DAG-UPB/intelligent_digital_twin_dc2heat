"""The user's documents about a data center's physical structure (Physical structure › Documents): descriptions,
equipment and sensor lists, schematics, any file. Kept as they are in the data center's silver folder (`documents/`,
git-ignored), never opened or converted by the app: an assistant reads them with its own tools. Each can have a note
of what it holds and belong to one view of the P&ID (`documents.json`), so the information sits with its drawing.
"""

import json
import re
from pathlib import Path

from .dataset_files import read_json, write_atomic

INFO = "documents.json"  # name -> {note, view}
TEXT_KINDS = {".txt", ".md", ".csv", ".json"}  # what can also be saved as a text written here, not only uploaded
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ._()+,&-]{0,119}")


def checked_name(name: str) -> str:
    """The file name, or ValueError: letters, digits, spaces and ._()+,&- (no folders), at most 120 characters."""
    if not NAME.fullmatch(name) or ".." in name or name.casefold() == INFO:  # one file on macOS and Windows
        raise ValueError("A document name is 1 to 120 letters, digits, spaces or ._()+,&- (no folders)")
    return name


def read_info(folder: Path) -> dict[str, dict]:
    """name -> {note, view} (a note alone, as first written, reads as {note})."""
    raw = read_json(folder / INFO)
    return {k: v if isinstance(v, dict) else {"note": v} for k, v in raw.items()}


def write_info(folder: Path, info: dict[str, dict]) -> None:
    """Keep the documents' info, without empty entries."""
    kept = {k: {f: x for f, x in v.items() if x} for k, v in info.items()}
    folder.mkdir(parents=True, exist_ok=True)
    write_atomic(folder / INFO, json.dumps({k: v for k, v in kept.items() if v}, indent=2, ensure_ascii=False))
