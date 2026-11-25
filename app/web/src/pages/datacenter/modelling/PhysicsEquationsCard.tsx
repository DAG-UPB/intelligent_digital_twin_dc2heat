/**
 * Physical and semi-physical (gray-box) equations: one row per variable of that column under Variables, checked by
 * the server, plus the equation library (the Physical column's panel). They are trained as the Physics model.
 */
import { durationLabel } from "../../../lib/period";
import type { LibraryEquation } from "../../../lib/physicsLibrary";
import { EquationLibrary } from "./EquationLibrary";
import { nextCoef } from "./format";
import type { EqRow, Equations } from "./useEquations";

/** One equation: target, right-hand side, helpers to add terms, check result, remove. */
function EquationRow({ row, columns, lever, eq }: { row: EqRow; columns: string[]; lever?: string; eq: Equations }) {
  const c = eq.checks[row.id];
  const hint = `eq-check-${row.id}`;
  return (
    <div className="train-eq">
      <select className="field" value={row.target} onChange={(e) => eq.setTarget(row.id, e.target.value)} aria-label="Predicted variable">
        {/* a variable without data may have an equation too: it is then listed, though no other row can pick it */}
        {(columns.includes(row.target) ? columns : [row.target, ...columns]).map((col) => (
          <option key={col}>{col}</option>
        ))}
      </select>
      <span className="mono train-eq__eq">(t) =</span>
      <div className="train-eq__body">
        <input
          className="field mono"
          value={row.expr}
          placeholder={`a*${row.target}[t-1]${lever ? ` + b*${lever}[t-1]` : ""} + c`}
          onChange={(e) => eq.setExpr(row.id, e.target.value)}
          onBlur={() => eq.check(row)}
          aria-label={`Equation for ${row.target}`}
          aria-invalid={c && !c.ok ? true : undefined}
          aria-describedby={c ? hint : undefined}
        />
        <div className="train-eq__tools">
          <select
            className="field field--xs"
            value=""
            onChange={(e) => e.target.value && eq.append(row, `${nextCoef(row.expr)}*${e.target.value}[t-1]`)}
            aria-label="Add a term: learned coefficient times a variable"
          >
            <option value="">+ term: coefficient × variable…</option>
            {columns.map((col) => (
              <option key={col}>{col}</option>
            ))}
          </select>
          <button type="button" className="btn btn--xs" onClick={() => eq.append(row, nextCoef(row.expr))}>
            + constant to learn
          </button>
          {c && (
            <span id={hint} className={`train-eq__check ${c.ok ? "train-ok" : "train-bad"}`}>
              {c.ok ? `✓ uses ${c.uses.join(", ")} · learns ${c.coefficients.join(", ") || "nothing"}` : c.error}
            </span>
          )}
        </div>
      </div>
      <button type="button" className="btn btn--icon" onClick={() => eq.remove(row.id)} aria-label={`Remove the equation for ${row.target}`}>
        ✕
      </button>
    </div>
  );
}

export function PhysicsEquationsCard({
  columns,
  inputs,
  levers,
  stepSec,
  eq,
  library,
  trained,
}: {
  columns: string[];
  inputs: string[];
  levers: string[];
  stepSec: number;
  eq: Equations;
  library?: LibraryEquation[]; // this system's standard equations (default: the data center's)
  trained: boolean; // Physics is ticked under Train
}) {
  const target0 = columns.find((c) => !inputs.includes(c)) ?? columns[0] ?? "y";
  const example = `a * ${target0}[t-1]${levers[0] ? ` + b * ${levers[0]}[t-1]` : ""} + c`;
  const addRow = () => eq.add(columns.find((c) => !eq.rows.some((r) => r.target === c) && !inputs.includes(c)) ?? columns[0]);
  return (
    <div className="train-physics">
      {!trained && <p className="train-card__text train-bad">Physics is not ticked under Train: these equations are not trained.</p>}
      <p className="muted train-card__text train-card__text--tall">
        Write the right-hand side for a variable. <code>Name[t-1]</code> = data, one step back ({durationLabel(stepSec)}; <code>Name[t]</code> = same step); any
        other name (a, b, eta, c1, …) is a coefficient learned from the data; a number stays fixed. Use the buttons under an equation to add a term or a constant
        to learn. Functions: exp, log, sqrt, abs, tanh, sin, cos, arctan, minimum, maximum, clip. Variables without an equation use linear regression on the causal
        graph. A variable with an equation moves to this column. Example: <code>{example}</code>. Or start from a known component in the library.
      </p>
      {eq.rows.map((row) => (
        <EquationRow key={row.id} row={row} columns={columns} lever={levers[0]} eq={eq} />
      ))}
      <div>
        <button type="button" className="btn btn--sm" onClick={addRow}>
          + Add equation
        </button>
      </div>
      <EquationLibrary library={library} columns={columns} inputs={inputs} hasEquation={(t) => eq.rows.some((r) => r.target === t)} onPlace={eq.place} />
    </div>
  );
}
