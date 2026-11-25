"""The user's documents about a data center's physical structure: keep, list, open, describe, remove.

Any file, kept as it is in the data center's silver folder (`documents/`, git-ignored) and never opened by the app:
an assistant reads it from its path with its own tools (whose answers go to its model provider; the files may be
confidential). A replaced or removed document is backed up to the data center's `.backup/` first.
"""

from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from ..core import dataset_files as files
from ..core.documents import INFO, TEXT_KINDS, checked_name, read_info, write_info
from ..core.limits import DOC_MAX_BYTES
from ..deps import Dataset, read_body
from ..schemas import DocumentInfo, DocumentText

router = APIRouter(prefix="/api/datasets/{dataset_id}/documents", tags=["documents"])

DOCUMENT_BODY = {
    "requestBody": {
        "required": True,
        "description": "The file as the raw request body",
        "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}},
    }
}
ABOUT = (
    "The user's documents about this data center's physical structure (equipment and sensor lists, schematics, how "
    "its parts connect), kept as they are. Read the ones that matter from `path` with your own file tools before "
    "building constructs and causal links, and say which you used; `view` says which view of the P&ID one is about "
    "(none: the whole data center). Confidential: read only what the task needs."
)


def _path(meta, name: str) -> Path:
    try:
        return meta.storage.documents_dir(meta.id) / checked_name(name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _existing(meta, name: str) -> Path:
    path = _path(meta, name)
    if not path.is_file():
        raise HTTPException(404, f"No document {name}")
    return path


def _backup(meta, path: Path) -> str | None:
    """Move a document to .backup/<time>-document-<name> (before it is replaced or removed)."""
    if not path.exists():
        return None
    backup = meta.directory / files.BACKUP_DIR / f"{files.backup_stamp()}-document-{path.name}"
    backup.parent.mkdir(parents=True, exist_ok=True)
    path.replace(backup)
    return backup.relative_to(meta.directory).as_posix()


def _keep(meta, path: Path, data: bytes, note: str, view: str) -> dict:
    if len(data) > DOC_MAX_BYTES:
        raise HTTPException(413, f"File too large (limit {DOC_MAX_BYTES // 2**20} MB)")
    if len(note) > 500 or len(view) > 40:
        raise HTTPException(422, "The note: at most 500 characters; the view: a view id")
    backup = _backup(meta, path)
    path.parent.mkdir(parents=True, exist_ok=True)
    files.write_atomic(path, data)
    write_info(path.parent, {**read_info(path.parent), path.name: {"note": note, "view": view}})
    return {"name": path.name, "path": str(path.resolve()), "bytes": len(data), "backup": backup}


@router.get("", summary="List the data center's documents")
def list_documents(meta: Dataset):
    """The documents kept about this data center: name, where the file is (`path`, to read it), size, when, the note
    of what it holds and the view of the P&ID it is about."""
    folder = meta.storage.documents_dir(meta.id)
    info = read_info(folder)
    found = (
        sorted(p for p in folder.iterdir() if p.is_file() and p.name != INFO and not p.name.startswith("."))
        if folder.is_dir()
        else []
    )
    docs = [
        {
            "name": p.name,
            "path": str(p.resolve()),
            "bytes": p.stat().st_size,
            "modified": datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="seconds"),
            "note": info.get(p.name, {}).get("note", ""),
            "view": info.get(p.name, {}).get("view", ""),
        }
        for p in found
    ]
    return {"documents": docs, "about": ABOUT}


@router.post("/{name}", summary="Keep a document about the data center", openapi_extra=DOCUMENT_BODY)
async def upload_document(meta: Dataset, name: str, request: Request, note: str = "", view: str = ""):
    """Keep a file (any kind: PDF, Word, Excel, pictures, text, ...) about this data center's physical structure, as
    it is, with a note of what it holds and the view of the P&ID it is about (empty: the whole data center). One of
    the same name is replaced (backed up first). The app does not open it."""
    return _keep(meta, _path(meta, name), await read_body(request, DOC_MAX_BYTES), note, view)


@router.put("/{name}/text", summary="Save a text document about the data center")
def save_text_document(meta: Dataset, name: str, body: DocumentText):
    """Keep a text written here (or by an assistant) as a document: .txt, .md, .csv or .json, e.g. which variable is
    which sensor of a rack. One of the same name is replaced (backed up first)."""
    path = _path(meta, name)
    if path.suffix.lower() not in TEXT_KINDS:
        raise HTTPException(400, f"A text document is one of {', '.join(sorted(TEXT_KINDS))}: upload other files instead")
    return _keep(meta, path, body.text.encode(), body.note, body.view)


# every document opens in a sandbox (CSP), so an uploaded vendor page or drawing never acts as the app: a list of the
# kinds a browser runs scripts in always misses one (.xht, .xsl, .rdf, ...). Not a PDF: Chrome's PDF viewer does not
# open in a sandbox, and it runs no script with the app's rights
UNSANDBOXED = {".pdf"}


@router.get("/{name}", summary="Get a document's file")
def get_document(meta: Dataset, name: str):
    """The document as it was kept (to open it in the browser)."""
    path = _existing(meta, name)
    headers = {"X-Content-Type-Options": "nosniff"}
    if path.suffix.lower() not in UNSANDBOXED:  # shown, but its scripts never run with the app's own rights
        headers["Content-Security-Policy"] = "sandbox"
    return FileResponse(path, filename=path.name, content_disposition_type="inline", headers=headers)


@router.put("/{name}/info", summary="Describe a document")
def set_document_info(meta: Dataset, name: str, body: DocumentInfo):
    """What a document holds and the view of the P&ID it is about ("" for none)."""
    path = _existing(meta, name)
    write_info(path.parent, {**read_info(path.parent), path.name: {"note": body.note, "view": body.view}})
    return {"name": path.name, "note": body.note, "view": body.view}


@router.delete("/{name}", summary="Remove a document")
def remove_document(meta: Dataset, name: str):
    """Remove a document (moved to the data center's .backup/ first) and its note."""
    path = _existing(meta, name)
    backup = _backup(meta, path)
    write_info(path.parent, {k: v for k, v in read_info(path.parent).items() if k != path.name})
    return {"removed": True, "backup": backup}
