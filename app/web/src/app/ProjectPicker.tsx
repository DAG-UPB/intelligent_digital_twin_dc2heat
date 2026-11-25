/**
 * The project, in the top bar before Save / Open: a data folder version of the user's data folder (newest
 * first) or the examples of the repo (app/data), then "Change data folder…". A project holds many data centers; each
 * page picks its own among them (DataCenterPicker, under the sub-tabs). Switching the project reloads the app. Real
 * data never leaves this machine.
 */
import { useState } from "react";
import { putDataRoot, type DataVersions } from "../api";
import { DATASET, projectDataset, switchDataset, switchDataVersion } from "../dataset";
import { Dialog } from "../ui/Dialog";
import { ErrorBanner } from "../ui/ErrorBanner";
import { LOCAL, versionLabel } from "./DataCenterPicker";
import { FolderBrowser } from "./FolderBrowser";

const CHANGE = "__change_folder__";

/** Pick this computer's data folder. It holds version_1, version_2, ..., each one folder per data center. */
function DataFolderDialog({ onClose }: { onClose: () => void }) {
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const use = async () => {
    setBusy(true);
    try {
      const state = await putDataRoot(path);
      switchDataset(projectDataset(state.folders[state.current] ?? [], DATASET));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog label="Change data folder" onClose={onClose} className="dialog--narrow">
      <h2>Data folder</h2>
      <p>
        The folder with your data on this computer. It holds one folder per version (version_1, version_2, …), each with one folder per data center. What you
        save in the app is saved there. Only you use it: everyone picks their own.
      </p>
      <FolderBrowser
        path={path}
        onPath={setPath}
        onError={setError}
        hint={(l) => (l.versions.length > 0 ? `Data folder with ${l.versions.join(", ")}` : "No version_… folders here yet: pick the folder that holds them.")}
      />
      <ErrorBanner error={error} />
      <div className="dialog__actions">
        <button type="button" className="btn btn--pill" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn--pill btn--primary" onClick={use} disabled={busy || !path.trim()}>
          Use this folder
        </button>
      </div>
    </Dialog>
  );
}

export default function ProjectPicker({ project }: { project: DataVersions | null }) {
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  const current = project?.current ?? LOCAL;
  const choose = (v: string) => {
    if (v === CHANGE) return setChanging(true);
    if (v !== current) switchDataVersion(v).catch((e: Error) => setError(e.message));
  };
  const folders = project ? [...[...project.versions].reverse(), LOCAL] : [current];
  return (
    <div className="topbar__picker topbar__project-picker">
      <span className="topbar__picker-label" aria-hidden>
        <span className="subtabs__picker-caps">Project</span> {versionLabel(current, project?.names)}
      </span>
      <select
        value={current}
        onChange={(e) => choose(e.target.value)}
        aria-label="Project"
        title={error || `Project: ${versionLabel(current, project?.names)} (its data centers: under the sub-tabs)`}
      >
        {folders.map((f) => (
          <option key={f} value={f}>
            {versionLabel(f, project?.names)}
            {project ? ` (${project.folders[f]?.filter((d) => !d.example).length ?? 0} data centers)` : ""}
          </option>
        ))}
        <optgroup label="Data folder">
          <option value={CHANGE}>{project?.linked ? "Change data folder…" : "Set data folder…"}</option>
        </optgroup>
      </select>
      {changing && <DataFolderDialog onClose={() => setChanging(false)} />}
    </div>
  );
}
