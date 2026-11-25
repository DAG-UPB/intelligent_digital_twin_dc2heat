/**
 * Which variables the models use and how each is made, in four columns: data-driven (on the causal graph),
 * physical and semi-physical (an equation), a measurement or a profile, and not modelled (approaches.ts). A click on a
 * column (its title, or anywhere but on a variable) opens its settings (training, equations, profiles) under the
 * columns, one at a time, in its colour; another click closes them. A variable moves between them by dragging it or
 * by its select. Inputs (no causes in the graph: actuators, weather; the graph decides) taken from the data and
 * calculated columns (the HEX heat Q = m·cp·ΔT) are not modelled either: they sit in that column, marked, beside the
 * ones left out; an input can be given a profile instead. "+ Add variable" puts a data column missing from the graph file
 * into it, as a node without links.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { APPROACHES, columnOf, whyNot, type Approach } from "./approaches";

const ABOUT: Record<Approach, string> = {
  data: "Learned from the data on the causal graph (each variable from its parents), by the models ticked under Train.",
  physics: "An equation per variable: coefficients learned from the data (semi-physical) or fixed numbers only (physical). Written below.",
  profile: "A total over a period, shaped by the clock and the weather. Set below; the models and the twin do not use it yet.",
  off: "Not predicted: inputs taken from the data (no causes in the graph), calculated columns (computed from others), and variables left out of the models (faded).",
};

export function VariablesCard({
  variables,
  columns,
  modelled,
  inputs,
  approach,
  choices,
  onMove,
  onAll,
  addable,
  onAdd,
  selected,
  onPick,
  onShow,
  panels,
  initialOpen,
}: {
  variables: string[];
  columns: string[];
  modelled: string[];
  inputs: string[]; // taken from the data (no causes in the graph)
  approach: Record<string, Approach | null>; // null: calculated, made by none
  choices: Record<string, Approach[]>; // where each variable may go
  onMove: (v: string, to: Approach) => void;
  onAll: (on: boolean) => void; // Select all / None
  addable: string[]; // data columns not in the selected graph file yet
  onAdd: (v: string) => Promise<string | null>; // the confirmation, or null when it failed
  selected: string | null; // picked on the causal graph map: highlighted and scrolled into view
  onPick: (v: string) => void; // a click on a variable: picked on the causal graph and the drawing too
  onShow: (v: string) => void; // a double click: up to the drawing, there
  panels: Partial<Record<Approach, { label: string; node: ReactNode }>>; // each column's settings, opened under the columns
  initialOpen: Approach | null;
}) {
  const [toAdd, setToAdd] = useState("");
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [open, setOpen] = useState<Approach | null>(initialOpen);
  const toggle = (a: Approach) => setOpen((o) => (o === a ? null : a));
  // a variable moved to a column with settings opens them, so it is seen there (its equation row, its profile)
  const move = (v: string, to: Approach) => {
    onMove(v, to);
    if (panels[to]) setOpen(to);
  };
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) list.current?.querySelector(`[data-var="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const add = async () => {
    setAdding(true);
    const msg = await onAdd(toAdd);
    setAdding(false);
    setNote(msg);
    if (msg) setToAdd("");
  };

  const kindOf = (c: string) => ({ calculated: columns.includes(c) && !modelled.includes(c), noData: !columns.includes(c), input: inputs.includes(c) });
  const columnIn = (c: string) => columnOf(approach[c], inputs.includes(c));
  // what a variable dropped on a column becomes: an input dropped on Not modelled is taken from the data again, and
  // it is never data-driven (the graph gives it no causes)
  const dropAs = (c: string, col: Approach): Approach | null => (inputs.includes(c) ? (col === "off" ? "data" : col === "data" ? null : col) : col);
  const label = (c: string, a: Approach) => (a === "data" && inputs.includes(c) ? "From the data" : APPROACHES.find((x) => x.id === a)!.short);

  const chip = (c: string) => {
    const picked = c === selected ? " train-var--picked" : "";
    const ways = choices[c] ?? [];
    const state = !columns.includes(c) ? "no data" : !modelled.includes(c) ? "calculated" : null;
    return (
      <div
        key={c}
        data-var={c}
        className={`train-var${approach[c] === "off" ? " train-var--off" : ""}${state === "no data" ? " train-var--nodata" : ""}${picked}`}
        draggable={ways.length > 1}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", c);
          setDragging(c);
        }}
        onDragEnd={() => setDragging(null)}
        onClick={(e) => (e.target as HTMLElement).tagName !== "SELECT" && onPick(c)}
        onDoubleClick={(e) => (e.target as HTMLElement).tagName !== "SELECT" && onShow(c)}
        title={
          state === "calculated"
            ? "Calculated from its heat exchanger's m, T_in and T_out: Q = ṁ·cₚ·(T_in − T_out)"
            : state
              ? "No data: in the graph, but not a column of the data, so it cannot be learned (dashed)"
              : undefined
        }
      >
        <span className="train-var__use">{c}</span>
        {(state === "calculated" || (approach[c] === "data" && inputs.includes(c))) && <span className="train-var__data muted">{state ?? "from data"}</span>}
        {ways.length > 1 && (
          <select className="field field--xs" value={approach[c] ?? ""} onChange={(e) => move(c, e.target.value as Approach)} aria-label={`Approach of ${c}`}>
            {/* every approach, the ones it cannot have greyed out with the reason */}
            {APPROACHES.map((a) => {
              const why = ways.includes(a.id) ? null : whyNot(kindOf(c), a.id);
              return (
                <option key={a.id} value={a.id} disabled={!!why}>
                  {why ? `${a.short}: ${why}` : label(c, a.id)}
                </option>
              );
            })}
          </select>
        )}
      </div>
    );
  };

  return (
    <div className="card">
      <div className="train-vars__head">
        <span className="caps">Variables · how each is made</span>
        <button type="button" className="btn btn--sm" onClick={() => onAll(true)}>
          Select all
        </button>
        <button type="button" className="btn btn--sm" onClick={() => onAll(false)}>
          None
        </button>
        <span className="train-vars__add">
          <select
            className="field field--sm"
            value={toAdd}
            onChange={(e) => setToAdd(e.target.value)}
            aria-label="Data column to add to the graph"
            disabled={!addable.length}
          >
            <option value="">{addable.length ? "Data column not in the graph…" : "Every data column is in the graph"}</option>
            {addable.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button type="button" className="btn btn--sm" onClick={add} disabled={!toAdd || adding}>
            + Add variable
          </button>
        </span>
      </div>
      <p className="muted train-vars__note">
        Drag a variable to another column, or pick its approach. Click it to find it on the causal graph, double-click to go up to it on the drawing. Hover a
        column's title for what it means; a click on a column opens its settings below.
      </p>
      {note && (
        <p role="status" className="train-vars__note train-ok">
          {note}
        </p>
      )}
      <div ref={list}>
        <div className="train-ways">
          {APPROACHES.map((a) => {
            const here = variables.filter((c) => columnIn(c) === a.id);
            const as = dragging && columnIn(dragging) !== a.id ? dropAs(dragging, a.id) : null;
            const drop = !!as && !!choices[dragging!]?.includes(as);
            // dragged over a column it cannot go to: say why
            const no = dragging && columnIn(dragging) !== a.id && !drop ? whyNot(kindOf(dragging), a.id) : null;
            return (
              <section
                key={a.id}
                aria-label={a.label}
                className={`train-way train-way--${a.id}${drop ? " train-way--drop" : ""}${no ? " train-way--no" : ""}${open === a.id ? " train-way--open" : ""}`}
                onDragOver={(e) => drop && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drop) move(dragging!, as!);
                  setDragging(null);
                }}
                // a click on the column (not on a variable in it) opens its settings below, a second one closes them
                onClick={(e) => panels[a.id] && !(e.target as Element).closest("button, select, input, a, .train-var") && toggle(a.id)}
              >
                {panels[a.id] ? (
                  <button type="button" className="train-way__title" title={ABOUT[a.id]} aria-expanded={open === a.id} onClick={() => toggle(a.id)}>
                    {a.label} <span className="muted">· {here.length}</span>
                  </button>
                ) : (
                  <div className="train-way__title" title={ABOUT[a.id]}>
                    {a.label} <span className="muted">· {here.length}</span>
                  </div>
                )}
                {no && (
                  <p className="train-way__no">
                    Not {dragging}: {no}
                  </p>
                )}
                <div className="train-vars">{here.map(chip)}</div>
              </section>
            );
          })}
        </div>
        {/* the open column's settings, full width under the columns, in its colour */}
        {open && panels[open] && (
          <section aria-label={panels[open]!.label} className={`train-panel train-way--${open}`}>
            {panels[open]!.node}
          </section>
        )}
      </div>
    </div>
  );
}
