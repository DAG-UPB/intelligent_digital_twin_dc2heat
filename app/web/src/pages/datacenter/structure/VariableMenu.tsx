/**
 * The Variables bar above the drawing: "+ Variable" (its name field opens under it) and "+ Add link", which variables
 * the drawing shows (search, and a dropdown to tick them, all / none, each with the short label it has on the drawing
 * next to its full name; chips keep only the ones made one way, as Modelling shows it), and the size of the
 * instruments. Clicking a name selects the variable (and shows it); dragging it onto the drawing places
 * it where it is dropped (PidCanvas).
 */
import { useState } from "react";
import { APPROACHES, type Approach } from "../modelling/approaches";
import { NewVariableBar } from "./NewVariableBar";
import { KINDS, type Notes } from "./notes";
import { WAYS } from "./roles";
import { SIZES } from "./shown";

/** The filter chips: Modelling's approaches, and the calculated variables (approach null) when there are any. */
type Way = Approach | "calculated";

/** The drag data type of a variable dragged from the menu onto the drawing. */
export const VARIABLE_DRAG = "application/x-pid-variable";

interface Props {
  vars: string[]; // every variable on the drawing
  shown: Set<string>;
  labels: Record<string, string>; // variable -> its label on the drawing
  selected: string | null;
  onShown: (next: Set<string>) => void;
  onSelect: (v: string) => void;
  addingVar: boolean;
  onToggleVar: () => void;
  newColumns: string[]; // the data columns "+ Variable" offers (not on the drawing yet)
  onAddVar: (name: string) => void;
  approach: Record<string, Approach | null>; // as Modelling shows it (useApproaches); null: calculated
  linking: boolean;
  onToggleLink: () => void;
  size: number;
  onSize: (size: number) => void;
  notes: Notes; // a marked kind is shown as its badge before the name
  edit: boolean; // edit mode: + Variable and + Add link
}

export function VariableMenu(p: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false); // the list's dropdown; a search opens it
  const [ways, setWays] = useState<Way[]>([]); // the chips on: only those ways listed; none on, all
  const q = query.trim().toLowerCase();
  const wayOf = (v: string): Way | undefined => (p.approach[v] === null ? "calculated" : p.approach[v]);
  const chips: { id: Way; label: string }[] = [
    ...APPROACHES.map((a) => ({ id: a.id, label: a.short })),
    ...(p.vars.some((v) => p.approach[v] === null) ? [{ id: "calculated" as const, label: "Calculated" }] : []),
  ];
  const on = ways.filter((w) => chips.some((c) => c.id === w)); // a Calculated chip gone with its variables is off
  const filtered = !!q || on.length > 0;
  const listed = p.vars.filter((v) => (!q || v.toLowerCase().includes(q) || p.labels[v]?.toLowerCase().includes(q)) && (!on.length || on.includes(wayOf(v)!)));
  const set = (vs: string[], on: boolean) => {
    const next = new Set(p.shown);
    for (const v of vs) {
      if (on) next.add(v);
      else next.delete(v);
    }
    p.onShown(next);
  };
  return (
    <section className="pid-vars" aria-label="Variables">
      {p.edit && (
        <div className="pid-vars__tools">
          <span className="pid-vars__new">
            <button type="button" className={p.addingVar ? "btn btn--sm btn--on" : "btn btn--sm"} aria-expanded={p.addingVar} onClick={p.onToggleVar}>
              + Variable
            </button>
            {p.addingVar && <NewVariableBar columns={p.newColumns} onAdd={p.onAddVar} onClose={p.onToggleVar} />}
          </span>
          <button type="button" className={p.linking ? "btn btn--sm btn--on" : "btn btn--sm"} onClick={p.onToggleLink}>
            {p.linking ? "Cancel link" : "+ Add link"}
          </button>
        </div>
      )}
      <input
        className="field field--sm"
        type="search"
        placeholder="Search variables"
        aria-label="Search variables"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value) setOpen(true);
        }}
      />
      <details className="pid-vars__drop" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="btn btn--sm">
          {p.vars.filter((v) => p.shown.has(v)).length} of {p.vars.length} shown
        </summary>
        <div className="pid-vars__pop">
          {/* how each is made, as Modelling shows it: any combination; Show / Hide then act on the ones listed */}
          <div className="chips" role="group" aria-label="Only the variables made this way">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                className={ways.includes(c.id) ? "chip chip--on" : "chip"}
                aria-pressed={ways.includes(c.id)}
                onClick={() => setWays((w) => (w.includes(c.id) ? w.filter((x) => x !== c.id) : [...w, c.id]))}
              >
                <span className="pid-vars__way" style={{ background: WAYS[c.id === "calculated" ? "off" : c.id] }} aria-hidden />
                {c.label} <span className="pid-muted">{p.vars.filter((v) => wayOf(v) === c.id).length}</span>
              </button>
            ))}
          </div>
          <div className="pid-vars__tools">
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => set(listed, true)}>
              Show {filtered ? "these" : "all"}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => set(listed, false)}>
              Hide {filtered ? "these" : "all"}
            </button>
          </div>
          <ul className="pid-vars__list" aria-label="Variables to show">
            {listed.map((v) => (
              <li
                key={v}
                className={v === p.selected ? "pid-vars__item pid-vars__item--on" : "pid-vars__item"}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(VARIABLE_DRAG, v);
                  e.dataTransfer.effectAllowed = "move";
                }}
                title="Drag onto the drawing to place it there"
              >
                <input type="checkbox" checked={p.shown.has(v)} aria-label={`Show ${v}`} onChange={(e) => set([v], e.target.checked)} />
                {p.notes[v]?.kind && (
                  <span className="pid-vars__kind" style={{ background: KINDS[p.notes[v].kind!].color }} title={KINDS[p.notes[v].kind!].label}>
                    {KINDS[p.notes[v].kind!].code}
                  </span>
                )}
                <button type="button" className="pid-vars__name" title={v} onClick={() => p.onSelect(v)}>
                  {p.labels[v] !== v ? (
                    <>
                      <b>{p.labels[v]}</b> <span className="pid-muted">{v}</span>
                    </>
                  ) : (
                    v
                  )}
                </button>
              </li>
            ))}
            {listed.length === 0 && <li className="pid-muted">No variable matches.</li>}
          </ul>
        </div>
      </details>
      <label className="pid-vars__size">
        Size
        <input
          type="range"
          min={SIZES.min}
          max={SIZES.max}
          step={0.05}
          value={p.size}
          onChange={(e) => p.onSize(Number(e.target.value))}
          aria-label="Instrument size"
        />
        <span className="pid-muted">{Math.round(p.size * 100)}%</span>
      </label>
    </section>
  );
}
