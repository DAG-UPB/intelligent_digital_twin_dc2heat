/** The equation library: known component equations by group; picking one opens its editor above the list. */
import { useState } from "react";
import { LIBRARY, guessColumn, type LibraryEquation } from "../../../lib/physicsLibrary";
import { LibraryEditor, type Placing } from "./LibraryEditor";

/** `library`: the standard equations of this system (the data center's, or the heat distribution's: lib/heatLibrary). */
export function EquationLibrary({
  columns,
  inputs,
  hasEquation,
  onPlace,
  library = LIBRARY,
}: {
  library?: LibraryEquation[];
  columns: string[];
  inputs: string[];
  hasEquation: (target: string) => boolean;
  onPlace: (target: string, expr: string) => void;
}) {
  const [placing, setPlacing] = useState<Placing | null>(null);
  const groups = [...new Set(library.map((x) => x.group))];

  /** Start placing an equation: guess the predicted variable (not an input) and a column for each slot. */
  const pick = (id: string) => {
    const eq = library.find((x) => x.id === id)!;
    const picks = Object.fromEntries(Object.entries(eq.slots).map(([k, sl]) => [k, guessColumn(sl.guess, columns)]));
    setPlacing({ id, target: guessColumn(eq.target, columns.filter((c) => !inputs.includes(c))), picks, fixed: {} });
  };

  return (
    <>
      {placing && (
        <LibraryEditor
          library={library}
          placing={placing}
          columns={columns}
          replaces={hasEquation(placing.target)}
          onChange={setPlacing}
          onPlace={(expr) => {
            onPlace(placing.target, expr);
            setPlacing(null);
          }}
          onCancel={() => setPlacing(null)}
        />
      )}
      <details className="train-lib">
        <summary className="caps">Equation library · click a component, then pick the variables it uses</summary>
        {groups.map((g) => (
          <div key={g} className="train-lib__group">
            <div className="train-lib__group-name">{g}</div>
            <div className="train-lib__grid">
              {library.filter((x) => x.group === g).map((eq) => (
                <button
                  key={eq.id}
                  type="button"
                  title={eq.about}
                  className={`train-lib__item${placing?.id === eq.id ? " train-lib__item--on" : ""}`}
                  aria-pressed={placing?.id === eq.id}
                  onClick={() => pick(eq.id)}
                >
                  <span className="train-lib__name">{eq.name}</span>
                  <code className="train-lib__expr">{eq.expr.replace(/[{}]/g, "")}</code>
                </button>
              ))}
            </div>
          </div>
        ))}
      </details>
    </>
  );
}
