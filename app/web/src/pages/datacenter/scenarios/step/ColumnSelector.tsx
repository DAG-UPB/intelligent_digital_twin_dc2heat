/** The variables the replay plots: a toggle chip per column, plus All and None; `head` above them (the period), as on Historical. */
import type { ReactNode } from "react";

interface Props {
  head?: ReactNode;
  columns: string[];
  selected: string[];
  onToggle: (col: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export function ColumnSelector({ head, columns, selected, onToggle, onSelectAll, onDeselectAll }: Props) {
  return (
    <div className="dash-filters">
      {head}
      <div className="dash-filters__head">
        <span className="caps">Visualization variables</span>
        <button type="button" className="btn btn--ghost btn--xs" onClick={onSelectAll}>
          All
        </button>
        <button type="button" className="btn btn--ghost btn--xs" onClick={onDeselectAll}>
          None
        </button>
      </div>
      <div className="chips" role="group" aria-label="Visualization variables">
        {columns.map((col) => {
          const on = selected.includes(col);
          return (
            <button key={col} type="button" aria-pressed={on} className={on ? "chip chip--on" : "chip"} onClick={() => onToggle(col)}>
              {col}
            </button>
          );
        })}
      </div>
    </div>
  );
}
