/** The intervention rows of a test-period run: variable, set/shift/scale, value, from/to dates, Remove. */
import type { Row } from "./horizons";

interface Props {
  rows: Row[];
  variables: string[];
  withTime: boolean; // sub-hourly data: pick date and time, else a date
  onChange: (rows: Row[]) => void;
}

export function InterventionRows({ rows, variables, withTime, onChange }: Props) {
  const set = (i: number, patch: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const dateType = withTime ? "datetime-local" : "date";
  return (
    <>
      {rows.length === 0 && <div className="muted">None: the run shows the model's forecast against what really happened.</div>}
      {rows.map((r, i) => (
        <div key={i} className="intervention" role="group" aria-label={`Intervention ${i + 1}`}>
          <select className="field" aria-label="Variable" value={r.variable} onChange={(e) => set(i, { variable: e.target.value })}>
            {variables.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <select className="field" aria-label="Kind" value={r.kind} onChange={(e) => set(i, { kind: e.target.value as Row["kind"] })}>
            <option value="set">set to</option>
            <option value="shift">shift by</option>
            <option value="scale">scale by ×</option>
          </select>
          <input className="field intervention__value" aria-label="Value" value={r.value} onChange={(e) => set(i, { value: e.target.value })} />
          <label className="intervention">
            from
            <input type={dateType} className="field" value={r.from} onChange={(e) => set(i, { from: e.target.value })} />
          </label>
          <label className="intervention">
            to
            <input type={dateType} className="field" value={r.to} onChange={(e) => set(i, { to: e.target.value })} />
          </label>
          <button type="button" className="btn" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
    </>
  );
}
