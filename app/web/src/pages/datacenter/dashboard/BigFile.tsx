/**
 * A data file too big to load here (a delivered CSV of gigabytes): its variables are known from its header, and the
 * user decides what to make of it, read in chunks and never whole. Aggregate it to a coarser step (each variable's
 * mean, median, sum, ...; core/resample.py resample_chunks) or keep one period (a day, a week; core/csv_data.py
 * window), with all or some variables. Either is a new data file in silver, opened when it is made.
 */
import { useState } from "react";
import { addResampled, addWindow } from "../../../api";
import { DATASET } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import { Field } from "../../../ui/Field";
import { STEPS } from "./AggregateData";

const METHODS = [
  ["mean", "mean"],
  ["median", "median"],
  ["sum", "sum"],
  ["min", "minimum"],
  ["max", "maximum"],
  ["last", "last value"],
] as const;

interface Props {
  file: string;
  why: string; // the backend's message: how big it is, and the limit
  variables: string[];
  start: string; // the file's time span (ISO), for the default period
  end: string;
  resolution: number | null; // seconds between rows
  onMade: (file: string) => void;
}

/** "2024-01-01T00:00:00" -> the value of a datetime-local input (minutes). */
const local = (iso: string) => iso.slice(0, 16);
/** A day after a zone-less time, zone-less (read as UTC both ways, so no time zone shifts it). */
export const dayAfter = (iso: string) => (iso ? new Date(new Date(`${iso.slice(0, 19)}Z`).getTime() + 86_400_000).toISOString().slice(0, 16) : "");

export function BigFile({ file, why, variables, start, end, resolution, onMade }: Props) {
  const [keep, setKeep] = useState<Set<string>>(() => new Set(variables));
  const [step, setStep] = useState(STEPS.find((s) => s.id === "1h" && (resolution ?? 0) < s.seconds)?.id ?? "1d");
  const [method, setMethod] = useState("mean");
  const [from, setFrom] = useState(local(start));
  const [to, setTo] = useState(dayAfter(start));
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const kept = variables.filter((v) => keep.has(v));

  const run = async (what: string, make: () => Promise<{ did: string }>, name: string) => {
    setBusy(what);
    setStatus(null);
    try {
      const r = await make();
      setStatus(r.did);
      onMade(name);
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const aggregate = () =>
    run(
      "aggregate",
      () => addResampled(DATASET, { source: file, step, default: method, methods: Object.fromEntries(variables.filter((v) => !keep.has(v)).map((v) => [v, "drop"])) }),
      `${file}__${step}`,
    );
  const period = () => {
    const name = `${file}__${from.slice(0, 10).replaceAll("-", "")}-${to.slice(0, 10).replaceAll("-", "")}`;
    return run("period", () => addWindow(DATASET, { source: file, start: from, end: to, columns: kept.length === variables.length ? [] : kept }), name);
  };

  return (
    <div className="dash-big">
      <p>
        <b>{file}</b> is too big to load here: {why.replace(/^[^:]*: /, "")} Its {variables.length} variables are known from its first rows. Choose what to
        make of it; the file is read in chunks, never whole, and the result is a new data file in your data folder's silver.
      </p>
      <div className="dash-big__pair">
        <section aria-label="Aggregate the file">
          <h3 className="caps">Aggregate</h3>
          <p className="muted">One row per step for the whole period, each variable by the method. Reads the whole file: about 15 s per 2 GB.</p>
          <div className="dash-big__fields">
            <Field label="Step">
              <select className="field field--sm" value={step} onChange={(e) => setStep(e.target.value)}>
                {STEPS.filter((s) => (resolution ?? 0) < s.seconds).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Method">
              <select className="field field--sm" value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <button type="button" className="btn btn--primary" disabled={!!busy || kept.length === 0} onClick={aggregate}>
            {busy === "aggregate" ? "Aggregating… (reading the whole file)" : `Aggregate ${kept.length} variables`}
          </button>
        </section>
        <section aria-label="Keep one period">
          <h3 className="caps">One period</h3>
          <p className="muted">Every row from the start up to the end, as delivered: a day, a week. Reading stops at the end.</p>
          <div className="dash-big__fields">
            <Field label="From">
              <input className="field field--sm" type="datetime-local" value={from} min={local(start)} max={local(end)} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Up to">
              <input className="field field--sm" type="datetime-local" value={to} min={local(start)} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <button type="button" className="btn btn--primary" disabled={!!busy || kept.length === 0 || !(from < to)} onClick={period}>
            {busy === "period" ? "Reading the period…" : `Load this period (${kept.length} variables)`}
          </button>
        </section>
      </div>
      <fieldset className="dash-big__vars">
        <legend>
          Variables kept ({kept.length} of {variables.length}) ·{" "}
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setKeep(new Set(variables))}>
            all
          </button>{" "}
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setKeep(new Set())}>
            none
          </button>
        </legend>
        {variables.map((v) => (
          <label key={v}>
            <input
              type="checkbox"
              checked={keep.has(v)}
              onChange={(e) => {
                const next = new Set(keep);
                if (e.target.checked) next.add(v);
                else next.delete(v);
                setKeep(next);
              }}
            />
            {v}
          </label>
        ))}
      </fieldset>
      {status && (
        <p role="status" className="dash__note">
          {status}
        </p>
      )}
    </div>
  );
}
