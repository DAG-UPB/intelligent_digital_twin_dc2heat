/**
 * Aggregate data: a delivered data file at a coarser time step (15 s, 1 min, 15 min, 1 h, 1 day), each variable by
 * its method (mean, median, sum, min, max, last value, or left out), saved as a new data file in silver
 * (backend/core/resample.py); the delivered file is never changed. Aggregated files can be opened on every page.
 */
import { useState } from "react";
import { addResampled, removeResampled, type PreparedChange, type VariableSummary } from "../../../api";
import { DATASET } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import { ErrorBanner } from "../../../ui/ErrorBanner";
import { Field } from "../../../ui/Field";

export const STEPS: { id: string; label: string; seconds: number }[] = [
  { id: "15s", label: "15 seconds", seconds: 15 },
  { id: "1min", label: "1 minute", seconds: 60 },
  { id: "15min", label: "15 minutes", seconds: 900 },
  { id: "1h", label: "1 hour", seconds: 3600 },
  { id: "1d", label: "1 day", seconds: 86400 },
];
const METHODS = ["mean", "median", "sum", "min", "max", "last"];
const METHOD_LABEL: Record<string, string> = { mean: "mean", median: "median", sum: "sum", min: "minimum", max: "maximum", last: "last value", drop: "leave out" };

/** A sensible method from the name: energies and counts add up, states keep their last value, the rest averages. */
export function guessMethod(name: string): string {
  if (/ener|energy|kwh|wh$|count|volume|_sum$/i.test(name)) return "sum";
  if (/set|state|mode|on_off|status/i.test(name)) return "last";
  return "mean";
}

export function AggregateData({
  variables,
  files,
  made,
  resolution,
  onDone,
  onOpen,
}: {
  variables: VariableSummary[];
  files: string[]; // every data file of the data center
  made: { name: string; source: string; step: string; start?: string; end?: string }[]; // the aggregated ones and the kept periods (recipe)
  resolution: number | null; // seconds between rows of the shown file
  onDone: (opened?: string, removed?: string) => void;
  onOpen: (file: string) => void;
}) {
  const delivered = files.filter((f) => !made.some((m) => m.name === f));
  const [source, setSource] = useState(delivered[0] ?? "");
  const coarser = STEPS.filter((s) => !resolution || s.seconds > resolution);
  const [step, setStep] = useState(coarser[Math.min(1, coarser.length - 1)]?.id ?? "1d");
  const [def, setDef] = useState("mean");
  const [methods, setMethods] = useState<Record<string, string>>(() => Object.fromEntries(variables.map((v) => [v.name, guessMethod(v.name)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PreparedChange | null>(null);
  const name = `${source}__${step}`;
  const raw = variables.filter((v) => !v.prepared); // prepared variables are made again on the new file

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const change = await addResampled(DATASET, { source, step, default: def, methods: Object.fromEntries(raw.map((v) => [v.name, methods[v.name] ?? def])) });
      setDone(change);
      onDone(name);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (n: string) => {
    setError(null);
    try {
      setDone(await removeResampled(DATASET, n));
      onDone(undefined, n);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="dash-prep">
      <div className="dash-prep__row">
        {delivered.length > 1 && (
          <Field label="From data file">
            <select className="field field--sm" value={source} onChange={(e) => setSource(e.target.value)}>
              {delivered.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="One row every">
          <select className="field field--sm" value={step} onChange={(e) => setStep(e.target.value)}>
            {STEPS.map((s) => (
              <option key={s.id} value={s.id} disabled={!coarser.includes(s)}>
                {s.label}
                {coarser.includes(s) ? "" : " (not coarser than the data)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Set every variable to">
          <select
            className="field field--sm"
            value={def}
            onChange={(e) => {
              setDef(e.target.value);
              setMethods(Object.fromEntries(raw.map((v) => [v.name, e.target.value])));
            }}
          >
            {[...METHODS, "drop"].map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="dash-agg__grid" role="group" aria-label="Method of each variable">
        {raw.map((v) => (
          <label key={v.name} className="dash-agg__item">
            <span className="mono">{v.name}</span>
            <select className="field field--sm" value={methods[v.name] ?? def} onChange={(e) => setMethods({ ...methods, [v.name]: e.target.value })} aria-label={`Method of ${v.name}`}>
              {[...METHODS, "drop"].map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <p className="muted dash__note">Energies and counts add up (sum), states keep their last value, the rest is averaged; change any of them. The new file is saved in your data folder's silver; the delivered file is not changed.</p>
      <div className="dash-prep__actions">
        <button type="button" className="btn btn--pill btn--primary" disabled={busy || !source || !coarser.length} onClick={create}>
          {busy ? "Aggregating…" : `Create ${name}`}
        </button>
      </div>
      <ErrorBanner error={error} />
      {done && (
        <p className="dash-prep__done" role="status">
          {done.did[0].toUpperCase() + done.did.slice(1)}. Saved in your data folder: {done.files.join(", ")}.
        </p>
      )}
      {made.length > 0 && (
        <div className="dash-prep__list">
          <h3 className="caps">Aggregated data files ({made.length})</h3>
          <ul>
            {made.map((m) => (
              <li key={m.name}>
                <span className="mono">{m.name}</span>
                <span className="muted">
                  = {m.source}, {m.step === "window" ? `from ${m.start} to ${m.end}` : `one row every ${STEPS.find((s) => s.id === m.step)?.label ?? m.step}`}
                </span>
                <button type="button" className="btn btn--pill btn--ghost" onClick={() => onOpen(m.name)}>
                  Open
                </button>
                <button type="button" className="btn btn--pill btn--ghost" onClick={() => remove(m.name)} aria-label={`Remove ${m.name}`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
