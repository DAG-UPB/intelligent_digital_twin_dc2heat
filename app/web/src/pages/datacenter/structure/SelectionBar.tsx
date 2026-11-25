/**
 * What can be done with several selected variables (a box dragged on the drawing, shift-clicks, or the assistant's
 * select_variables), floating over the drawing: group them (mark them as one variable, e.g. their mean: a mark only,
 * no values are computed; the Dashboard lists the groups), mark what they are and how sure, hide them, delete them,
 * rename them in bulk (find and replace in the names shown; the data keeps its own names), or clear the selection.
 */
import { useState } from "react";
import { CONFIDENCE, GROUP_METHODS, KINDS, type Confidence, type Kind } from "./notes";

interface Props {
  selected: string[];
  suggest: (method: string) => string; // a name for the group
  onGroup: (name: string, method: string, hide: boolean) => boolean; // false: refused (the page says why)
  onKind: (kind: Kind | null) => void;
  onConfidence: (c: Confidence | null) => void;
  onHide: () => void;
  onDelete: () => void;
  onClear: () => void;
  // bulk renaming of the names shown: how many would change (or why not), and doing it
  preview: (find: string, replace: string, regex: boolean) => string;
  onRename: (find: string, replace: string, regex: boolean) => Promise<boolean>;
}

export function SelectionBar(p: Props) {
  const [grouping, setGrouping] = useState(false);
  const [method, setMethod] = useState<string>("mean");
  const [name, setName] = useState(() => p.suggest("mean"));
  const [hide, setHide] = useState(true);
  const group = () => p.onGroup(name.trim(), method, hide) && setGrouping(false);
  const [renaming, setRenaming] = useState(false);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [regex, setRegex] = useState(false);
  return (
    <div className="pid-selbar" role="group" aria-label="Selected variables">
      <div className="pid-selbar__row">
        <strong>{p.selected.length} selected</strong>
        <button
          type="button"
          className={grouping ? "btn btn--sm btn--on" : "btn btn--sm"}
          aria-expanded={grouping}
          onClick={() => setGrouping(!grouping)}
          disabled={p.selected.length < 2}
        >
          Group…
        </button>
        <button type="button" className={renaming ? "btn btn--sm btn--on" : "btn btn--sm"} aria-expanded={renaming} onClick={() => setRenaming(!renaming)}>
          Rename…
        </button>
        <select
          className="field field--sm"
          aria-label="Mark the kind"
          value=""
          onChange={(e) => p.onKind(e.target.value === "none" ? null : (e.target.value as Kind))}
        >
          <option value="">Kind…</option>
          {Object.entries(KINDS).map(([k, x]) => (
            <option key={k} value={k}>
              {x.code} · {x.label}
            </option>
          ))}
          <option value="none">— no kind —</option>
        </select>
        <select
          className="field field--sm"
          aria-label="Mark how sure"
          value=""
          onChange={(e) => p.onConfidence(e.target.value === "none" ? null : (e.target.value as Confidence))}
        >
          <option value="">How sure…</option>
          {Object.entries(CONFIDENCE).map(([k, x]) => (
            <option key={k} value={k}>
              {x.label}
            </option>
          ))}
          <option value="none">— not marked —</option>
        </select>
        <button type="button" className="btn btn--sm" onClick={p.onHide}>
          Hide
        </button>
        <button type="button" className="btn btn--sm pid-delete" onClick={p.onDelete}>
          Delete…
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={p.onClear}>
          Clear
        </button>
      </div>
      {grouping && (
        <div className="pid-selbar__row">
          <label className="pid-selbar__field">
            Name
            <input className="field field--sm" value={name} onChange={(e) => setName(e.target.value)} aria-label="Group name" />
          </label>
          <label className="pid-selbar__field">
            Method
            <select
              className="field field--sm"
              aria-label="Group method"
              value={method}
              onChange={(e) => {
                setMethod(e.target.value);
                setName(p.suggest(e.target.value));
              }}
            >
              {GROUP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="pid-selbar__field">
            <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} />
            Hide the grouped ones
          </label>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={group}
            disabled={!name.trim()}
            title="Marks them as one variable; no values are computed"
          >
            Make group
          </button>
        </div>
      )}
      {renaming && (
        <div className="pid-selbar__row">
          <label className="pid-selbar__field">
            Find
            <input
              className="field field--sm"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              aria-label="Find in the names"
              placeholder="e.g. UDPARDUINO//"
            />
          </label>
          <label className="pid-selbar__field">
            Replace with
            <input className="field field--sm" value={replace} onChange={(e) => setReplace(e.target.value)} aria-label="Replace with" placeholder="(nothing)" />
          </label>
          <label className="pid-selbar__field" title="A regular expression; the replacement may use $1, $2, ...">
            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
            Pattern
          </label>
          <span className="pid-muted">{find ? p.preview(find, replace, regex) : "the data keeps its own names"}</span>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            disabled={!find}
            onClick={() => p.onRename(find, replace, regex).then((ok) => ok && (setRenaming(false), setFind(""), setReplace("")))}
          >
            Rename
          </button>
        </div>
      )}
    </div>
  );
}
