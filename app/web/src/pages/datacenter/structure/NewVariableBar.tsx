/** "+ Variable" bar, under its button: a name (suggesting the data columns not on the drawing yet, or a new one) and
 * Add; Enter adds too, Escape closes it. */
import { useState } from "react";

export function NewVariableBar({ columns, onAdd, onClose }: { columns: string[]; onAdd: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  return (
    <div className="pid-bar pid-vars__newbar">
      <input
        list="pid-columns"
        autoFocus
        value={name}
        placeholder="Variable name (a data column, or a new name)"
        aria-label="Variable name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => (e.key === "Enter" ? onAdd(name) : e.key === "Escape" && onClose())}
        className="field field--sm"
        style={{ width: 320 }}
      />
      <datalist id="pid-columns">
        {columns.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <button type="button" className="btn btn--primary" onClick={() => onAdd(name)}>
        Add
      </button>
      <span className="pid-hint">{columns.length} data columns not on the drawing yet.</span>
    </div>
  );
}
