/** Placing one library equation: pick the predicted variable and a column per slot, learn or fix each coefficient, preview, add. */
import { fillEquation, type LibraryEquation } from "../../../lib/physicsLibrary";
import { Field } from "../../../ui/Field";

/** A library equation being placed: its target, the column picked for each slot, the coefficients fixed to a value. */
export interface Placing {
  id: string;
  target: string;
  picks: Record<string, string>;
  fixed: Record<string, number>;
}

function ColumnSelect({ label, value, columns, onChange }: { label: string; value: string; columns: string[]; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        {columns.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </Field>
  );
}

export function LibraryEditor({
  placing,
  columns,
  replaces,
  onChange,
  onPlace,
  onCancel,
  library,
}: {
  library: LibraryEquation[];
  placing: Placing;
  columns: string[];
  replaces: boolean; // the target already has an equation
  onChange: (p: Placing) => void;
  onPlace: (expr: string) => void;
  onCancel: () => void;
}) {
  const eq = library.find((x) => x.id === placing.id)!;
  const expr = fillEquation(eq, placing.target, placing.picks, placing.fixed);
  const setFixed = (k: string, value: number | null) => {
    const fixed = { ...placing.fixed };
    if (value == null) delete fixed[k];
    else fixed[k] = value;
    onChange({ ...placing, fixed });
  };

  return (
    <div className="train-placing" role="region" aria-label={`Place: ${eq.name}`}>
      <div className="train-placing__name">{eq.name}</div>
      <p className="muted train-placing__about">{eq.about}</p>
      <div className="train-placing__slots">
        <ColumnSelect label="Predicts" value={placing.target} columns={columns} onChange={(v) => onChange({ ...placing, target: v })} />
        {Object.entries(eq.slots).map(([k, sl]) => (
          <ColumnSelect key={k} label={`${k} · ${sl.label}`} value={placing.picks[k]} columns={columns} onChange={(v) => onChange({ ...placing, picks: { ...placing.picks, [k]: v } })} />
        ))}
      </div>
      <div className="caps train-placing__caption">Coefficients</div>
      <div className="train-placing__coefs">
        {Object.entries(eq.coefs).map(([k, c]) => {
          const isFixed = k in placing.fixed;
          return [
            <code key={`${k}n`} className="train-placing__coef">
              {k}
            </code>,
            <span key={`${k}l`} className="muted">
              {c.label} · typical {c.typical}
            </span>,
            <select
              key={`${k}m`}
              className="field field--sm"
              value={isFixed ? "fixed" : "learn"}
              onChange={(e) => setFixed(k, e.target.value === "fixed" ? c.typical : null)}
              aria-label={`${k}: learn or fix`}
            >
              <option value="learn">learn from data</option>
              <option value="fixed">fixed value</option>
            </select>,
            <input
              key={`${k}v`}
              type="number"
              step="any"
              className={`field field--sm train-placing__value${isFixed ? "" : " train-hidden"}`}
              disabled={!isFixed}
              value={placing.fixed[k] ?? c.typical}
              onChange={(e) => setFixed(k, Number(e.target.value))}
              aria-label={`${k} value`}
            />,
          ];
        })}
      </div>
      <code className="train-placing__preview">
        {placing.target}(t) = {expr}
      </code>
      <div className="train-placing__actions">
        <button type="button" className="btn btn--sm train-btn-phys" onClick={() => onPlace(expr)}>
          {replaces ? `Replace ${placing.target}'s equation` : "Add equation"}
        </button>
        <button type="button" className="btn btn--sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
