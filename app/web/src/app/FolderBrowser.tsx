import { useEffect, useState } from "react";
import { browseFolders, pickFolder, type FolderListing } from "../api";
import { Field } from "../ui/Field";

/** A folder of this computer, browsed (folder names only, listed by the backend: a web page cannot see real paths),
 * chosen in the system's folder dialog, or pasted as a path. `hint` says what the folder listed holds. */
export function FolderBrowser({ path, onPath, onError, hint }: { path: string; onPath: (p: string) => void; onError: (e: string) => void; hint: (l: FolderListing) => string }) {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [picking, setPicking] = useState(false);
  const open = (to?: string) =>
    browseFolders(to)
      .then((l) => {
        setListing(l);
        onPath(l.path);
        onError("");
      })
      .catch((e: Error) => onError(e.message));
  useEffect(() => {
    open(path || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);
  /** The system's own folder dialog, opened by the backend on this computer; the in-app list stays as the fallback. */
  const browse = () => {
    setPicking(true);
    pickFolder()
      .then((r) => (r.path ? open(r.path) : undefined))
      .catch((e: Error) => onError(e.message))
      .finally(() => setPicking(false));
  };
  const join = (name: string) => (listing ? `${listing.path.replace(/[\\/]+$/, "")}/${name}` : name);
  return (
    <>
      <div className="folder-picker__row">
        <Field label="Folder path">
          <input
            type="text"
            value={path}
            onChange={(e) => onPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && open(path)}
            placeholder="Paste a path and press Enter, or browse"
            spellCheck={false}
          />
        </Field>
        <button type="button" className="btn btn--pill" onClick={browse} disabled={picking}>
          {picking ? "Choose in the Finder window…" : "Browse…"}
        </button>
      </div>
      <div className="folder-picker" role="list" aria-label="Folders">
        {listing?.parent && (
          <button type="button" role="listitem" className="folder-picker__item" onClick={() => open(listing.parent ?? undefined)}>
            ↑ Up
          </button>
        )}
        {listing?.folders.map((name) => (
          <button type="button" role="listitem" key={name} className="folder-picker__item" onClick={() => open(join(name))}>
            📁 {name}
          </button>
        ))}
        {listing && listing.folders.length === 0 && <span className="folder-picker__empty">No sub-folders</span>}
      </div>
      {listing && <p className="folder-picker__hint">{hint(listing)}</p>}
    </>
  );
}
