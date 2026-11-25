/** What-if setup at the playhead: number of steps, the intervention variables' constant override values (the variables
 * are picked on the page, in the panel on the left when `side`), and Run. */
interface Props {
  playheadIndex: number;
  totalPoints: number;
  steps: number;
  onSteps: (n: number) => void;
  chosen: string[];
  side: boolean;
  overrides: Record<string, string>;
  onOverride: (col: string, value: string) => void;
  onRun: () => void;
}

export function ScenarioSetup({ playheadIndex, totalPoints, steps, onSteps, chosen, side, overrides, onOverride, onRun }: Props) {
  return (
    <div className="whatif__setup">
      <p>
        Paused at index {playheadIndex} / {totalPoints}. Give the intervention variables (picked {side ? "in the panel on the left" : "above"}) a value and
        run a scenario from this point.
      </p>

      <label className="step__row whatif__label">
        Steps
        <input className="field whatif__steps" type="number" min={1} max={200} value={steps} onChange={(e) => onSteps(Number(e.target.value))} />
      </label>

      {chosen.length > 0 && (
        <div className="whatif__section">
          <div className="caps">Override Values (constant for all steps)</div>
          {chosen.map((col) => (
            <label key={col} className="whatif__override">
              <span>{col}</span>
              <input className="field" type="number" step="any" value={overrides[col] ?? ""} onChange={(e) => onOverride(col, e.target.value)} placeholder="leave empty for ground truth" />
            </label>
          ))}
        </div>
      )}

      <button type="button" className="btn btn--primary whatif__run" onClick={onRun}>
        Run What-If
      </button>
    </div>
  );
}
