/** "Save as…" bar: a new graph file name (checked before saving: must end with .json) and Save; Enter saves too. */
import { useState } from "react";
import { graphNameError } from "./links";

export function SaveAsBar({ initial, onSave }: { initial: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const error = graphNameError(name);
  const save = () => !error && onSave(name.trim());
  return (
    <div className="pid-bar">
      <label className="pid-bar">
        New graph file
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} className="field field--sm" style={{ width: 280 }} aria-label="New graph file name" aria-invalid={!!error} />
      </label>
      <button type="button" className="btn btn--primary" onClick={save} disabled={!!error}>
        Save
      </button>
      <span className={error && name.trim() ? "pid-hint pid-hint--error" : "pid-hint"} role={error ? "status" : undefined}>
        Keeps the current file as it is. {error ?? "Must end with .json."}
      </span>
    </div>
  );
}
