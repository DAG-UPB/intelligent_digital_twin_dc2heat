/**
 * "Add a data center from a folder…": pick a folder of this computer (its data files, a P&ID, maybe a
 * dataset.json and causal graphs), see what it brings, and add it to the data version open. The backend copies it
 * (CSV becomes parquet, the data goes to bronze, the rest to silver), reads its P&ID like Import P&ID and builds a
 * starter graph of every variable; the folder itself is not changed. Then the app opens the new data center.
 */
import { useEffect, useState } from "react";
import { importDataCenter, scanFolder, type FolderScan } from "../api";
import { switchDataset } from "../dataset";
import { Dialog } from "../ui/Dialog";
import { ErrorBanner } from "../ui/ErrorBanner";
import { Field } from "../ui/Field";
import { FolderBrowser } from "./FolderBrowser";

const KINDS = [
  ["real", "Real data center"],
  ["testbed", "Testbed"],
  ["simulation", "Simulation"],
] as const;

export function AddDataCenterDialog({ version, onClose }: { version: string; onClose: () => void }) {
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [found, setFound] = useState<FolderScan | null>(null);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("real");
  const [readPid, setReadPid] = useState(true);
  const [busy, setBusy] = useState(false);

  // what the folder in view would bring (names only), updated as the user browses
  useEffect(() => {
    if (!path.trim()) return setFound(null);
    let live = true;
    scanFolder(path)
      .then((f) => {
        if (!live) return;
        setFound(f);
        setId(f.id);
        setName(f.name);
        setKind(f.kind);
      })
      .catch(() => live && setFound(null));
    return () => {
      live = false;
    };
  }, [path]);

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await importDataCenter({ path, id, name, kind, read_pid: readPid });
      if (r.pid?.error) window.alert(`The data is in, but its P&ID could not be read: ${r.pid.error}`);
      switchDataset(r.id); // reloads into the new data center
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const ok = !!found && found.data.length > 0 && /^[a-z][a-z0-9_]{0,47}$/.test(id) && name.trim() !== "";
  return (
    <Dialog label="Add a data center" onClose={onClose} className="dialog--narrow">
      <h2>Add a data center from a folder</h2>
      <p>
        Pick the folder of a data center or project: its data files (.parquet or .csv, also one folder down), its P&ID (a DEXPI .xml, an SVG or a PDF),
        and its dataset.json and causal graphs if it has them. They are copied into {version}; the folder itself is not changed.
      </p>
      <FolderBrowser path={path} onPath={setPath} onError={setError} hint={() => (found?.data.length ? `${found.data.length} data file${found.data.length === 1 ? "" : "s"} here` : "No data files here")} />
      {found && found.data.length > 0 && (
        <div className="add-dc">
          <ul className="add-dc__found" aria-label="What the folder brings">
            <li>
              <b>Data:</b> {found.data.join(", ")}
            </li>
            <li>
              <b>P&ID:</b> {found.drawing ?? "none (draw one later, or import it on Physical structure)"}
            </li>
            {found.settings && (
              <li>
                <b>Settings:</b> {found.settings}
              </li>
            )}
            <li>
              <b>Causal graphs:</b> {found.graphs.length ? found.graphs.join(", ") : "none: a starter graph with every variable is made"}
            </li>
          </ul>
          <div className="add-dc__fields">
            <Field label="Name">
              <input type="text" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </Field>
            <Field label="Id (folder name)">
              <input type="text" className="field" value={id} onChange={(e) => setId(e.target.value.toLowerCase())} spellCheck={false} maxLength={48} />
            </Field>
            <Field label="Kind">
              <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {found.drawing && (
            <label className="add-dc__check">
              <input type="checkbox" checked={readPid} onChange={(e) => setReadPid(e.target.checked)} />
              Read {found.drawing} as its P&ID (structure, instruments and pipes)
            </label>
          )}
        </div>
      )}
      <ErrorBanner error={error} />
      <div className="dialog__actions">
        <button type="button" className="btn btn--pill" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn--pill btn--primary" onClick={add} disabled={busy || !ok}>
          {busy ? "Adding… (reading the P&ID can take a minute)" : "Add data center"}
        </button>
      </div>
    </Dialog>
  );
}
