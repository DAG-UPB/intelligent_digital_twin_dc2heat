/** Preprocessing recommendations (backend/core/recommend.py): what to fix before modelling, each fix one click away. */
import type { PreparedStep, Recommendation } from "../../../api";

const LABEL: Record<string, string> = {
  gaps: "Gaps",
  counter: "Meter count",
  outliers: "Outliers",
  skewed: "Long tail",
  kelvin: "Kelvin?",
  duplicate: "Near-duplicates",
  constant: "Constant",
  time_gaps: "Irregular time",
};

export function Recommendations({ items, onPrepare }: { items: Recommendation[]; onPrepare: (step: PreparedStep) => void }) {
  if (!items.length) return <p className="muted dash__note">Nothing found to fix: no gaps, outliers, meter counts or near-duplicates stand out.</p>;
  return (
    <ul className="dash-recs">
      {items.map((r, i) => (
        <li key={i} className={`dash-rec dash-rec--${r.severity}`}>
          <span className={`pill pill--sm dash-rec__kind dash-rec__kind--${r.severity}`}>{LABEL[r.kind] ?? r.kind}</span>
          <span className="dash-rec__text">{r.text}</span>
          {r.step && (
            <button type="button" className="btn btn--pill" onClick={() => onPrepare(r.step!)} title={`Open it in Prepare variables as ${r.step.name}`}>
              Prepare {r.step.name}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
