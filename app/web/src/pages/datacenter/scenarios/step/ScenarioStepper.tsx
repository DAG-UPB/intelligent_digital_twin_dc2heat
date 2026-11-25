/** A running what-if: reveal one more predicted step at a time, with a step count and a progress bar. */
export function ScenarioStepper({ step, total, loading, onStep }: { step: number; total: number; loading: boolean; onStep: () => void }) {
  return (
    <div className="whatif__stepper">
      <button type="button" className="btn btn--primary" onClick={onStep} disabled={loading || step >= total}>
        {loading ? "Computing…" : "Step Forward"}
      </button>
      <div>
        <div className="whatif__count">
          {step} / {total}
        </div>
        <div className="whatif__label">steps</div>
      </div>
      <div className="progress" role="progressbar" aria-label="What-if steps" aria-valuemin={0} aria-valuemax={total} aria-valuenow={step}>
        <span style={{ width: `${total ? (step / total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}
