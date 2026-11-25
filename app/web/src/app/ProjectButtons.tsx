/** Save the project state into the data folder (a new file per save, a history), or open a saved one (replaces the
 * current project, which is backed up). */
import { useRef, useState } from "react";
import { openProject, saveProject } from "../api";
import { DATASET } from "../dataset";
import { errorMessage } from "../lib/errors";

export default function ProjectButtons() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await saveProject(DATASET);
      setSaved(`Saved in your data folder: ${r.path}`);
      setTimeout(() => setSaved(null), 6000);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const open = async (file: File) => {
    setError(null);
    try {
      const project = JSON.parse(await file.text());
      if (!confirm(`Open "${file.name}"? It replaces the current site, graphs, equations and models (they are kept in a backup).`)) return;
      setBusy(true);
      await openProject(DATASET, project);
      window.location.reload();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <>
      {/* icon buttons until the header has room for the labels (CSS; aria-label and title keep the name) */}
      <button className="btn btn--pill btn--ghost topbar__project" onClick={save} disabled={busy} aria-label="Save project" title="Save project: store the current state (site, graphs, equations, models) as a new file in your data folder, status/<data center>/. It contains the trained models (TabPFN ones include a sample of the measurements): keep files of real data centers confidential.">
        <span aria-hidden>⤓</span>
        <span className="topbar__label">Save project</span>
      </button>
      <button className="btn btn--pill btn--ghost topbar__project" onClick={() => fileInput.current?.click()} disabled={busy} aria-label="Open project" title="Open project: load a saved project file (your data folder, status/<data center>/)">
        <span aria-hidden>⤒</span>
        <span className="topbar__label">Open project</span>
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) open(f);
        }}
      />
      {saved && (
        <button role="status" className="topbar__error topbar__notice" title="Click to dismiss" onClick={() => setSaved(null)}>
          {saved}
        </button>
      )}
      {error && (
        <button role="alert" className="topbar__error" title="Click to dismiss" onClick={() => setError(null)}>
          {error}
        </button>
      )}
    </>
  );
}
