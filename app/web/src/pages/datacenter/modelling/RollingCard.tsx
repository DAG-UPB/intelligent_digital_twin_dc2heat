/**
 * Rolling comparison, under the models (Structure and Modelling): pick a variable and models (the saved ones, and
 * Chronos-2, the pretrained forecaster), roll them over the data's last year the same way, day-ahead (each day from the
 * measurement before it) or free (the year on their own predictions; Chronos-2's from the weather), with an
 * intervention or without. A table compares them with the measurement, and how much the intervention moves each;
 * the charts show the year's daily means. Runs on request (backend core/rolling.py): Chronos-2 takes about a minute.
 */
import { useMemo, useState } from "react";
import { useKept } from "../../../lib/kept";
import { compareModels, type CompareResponse, type Intervention, type StructureScope, type TrainedModel } from "../../../api";
import { errorMessage } from "../../../lib/errors";
import { fmt } from "../../../lib/format";
import { STRUCTURES } from "../../../lib/modelCatalog";
import { Card } from "../../../ui/Card";
import { ErrorBanner } from "../../../ui/ErrorBanner";
import { Field } from "../../../ui/Field";
import LineChart, { type Line } from "../../../ui/LineChart";
import { NumberField } from "../../../ui/NumberField";
import { Segmented } from "../../../ui/Segmented";

const FOUNDATION = "chronos-2";
const MEASURED = "#64748b";
const labelOf = (m: string) => (m === FOUNDATION ? "Chronos-2 (pretrained)" : (STRUCTURES.find((d) => d.name === m)?.label ?? m));
const colorOf = (m: string) => (m === FOUNDATION ? "#0ea5e9" : (STRUCTURES.find((d) => d.name === m)?.color ?? "#94a3b8"));

/**
 * Daily means of hourly (or finer) values at ISO times: [day starts in unix seconds, means]. The days come from the
 * time axis, not from the values, so every line of one response has the same days; a day without a value is NaN.
 */
export function dailyMeans(time: string[], values: (number | null)[]): [number[], number[]] {
  const days = new Map<number, [number, number]>();
  time.forEach((t, i) => {
    const d = Math.floor(Date.parse(`${t}Z`) / 86_400_000) * 86_400;
    const [s, n] = days.get(d) ?? [0, 0];
    const v = values[i];
    days.set(d, v == null || !Number.isFinite(v) ? [s, n] : [s + v, n + 1]);
  });
  const xs = [...days.keys()].sort((a, b) => a - b);
  return [xs, xs.map((d) => (days.get(d)![1] ? days.get(d)![0] / days.get(d)![1] : NaN))];
}

export function RollingCard({ dataset, scope, models }: { dataset: string; scope?: StructureScope; models: Record<string, TrainedModel> }) {
  const saved = Object.keys(models);
  const columns = useMemo(() => [...new Set(Object.values(models).flatMap((m) => m.order))], [models]);
  const inputs = useMemo(() => [...new Set(Object.values(models).flatMap((m) => [...m.drivers, ...m.order]))], [models]);
  const [column, setColumn] = useKept(`${scope}-rolling-column|${dataset}`, "");
  const col = columns.includes(column) ? column : (columns.find((c) => /demand/i.test(c)) ?? columns[0] ?? "");
  const [chosen, setChosen] = useKept<string[] | null>(`${scope}-rolling-chosen|${dataset}`, null);
  const picked = chosen ?? saved; // Chronos-2 only when ticked (a minute, and not the twin's own model)
  const [mode, setMode] = useKept<"day_ahead" | "free">(`${scope}-rolling-mode|${dataset}`, "free");
  const [ivVar, setIvVar] = useKept(`${scope}-rolling-ivVar|${dataset}`, "Out_Temp");
  const [ivKind, setIvKind] = useKept<Intervention["kind"]>(`${scope}-rolling-ivKind|${dataset}`, "shift");
  const [ivValue, setIvValue] = useKept(`${scope}-rolling-ivValue|${dataset}`, 3);
  const [res, setRes] = useKept<CompareResponse | null>(`${scope}-rolling-res|${dataset}`, null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setBusy(true);
    setError(null);
    const interventions: Intervention[] = ivVar ? [{ variable: ivVar, kind: ivKind, value: ivValue }] : [];
    compareModels(dataset, { column: col, models: picked, mode, interventions }, scope)
      .then(setRes)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  const charts = useMemo(() => {
    if (!res) return null;
    const [xs, measured] = dailyMeans(res.time, res.measured);
    const ok = res.runs.filter((r) => r.base);
    const base: Line[] = [{ label: "Measured", values: measured, color: MEASURED }, ...ok.map((r) => ({ label: labelOf(r.model), values: dailyMeans(res.time, r.base!)[1], color: colorOf(r.model) }))];
    const moved: Line[] = ok.filter((r) => r.intervened).map((r) => ({ label: `${labelOf(r.model)} · intervened`, values: dailyMeans(res.time, r.intervened!)[1], color: colorOf(r.model) }));
    return { xs, base, moved };
  }, [res]);
  const ivText = ivVar ? `${ivVar} ${ivKind === "shift" ? `${ivValue >= 0 ? "+" : ""}${ivValue}` : ivKind === "scale" ? `× ${ivValue}` : `= ${ivValue}`}` : "";

  return (
    <Card title="Rolling comparison">
      <p className="rolling-note">
        The models rolled over the data&apos;s last year the same way, against the measurement. <b>Day-ahead</b>: each day from the measured history before it,
        as an operator forecasts. <b>Free run</b>: the whole year on the model&apos;s own predictions (Chronos-2: each day from the measured year before, up to
        the same date, with the year&apos;s weather). The <b>intervention</b> runs each again with it, to see whether the model follows it; Chronos-2 sees only
        the outdoor temperature and the calendar. Chronos-2 takes about a minute.
      </p>
      <div className="rolling-controls">
        <Field label="Variable">
          <select className="field field--sm" value={col} onChange={(e) => setColumn(e.target.value)} aria-label="Variable to roll">
            {columns.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Segmented<"day_ahead" | "free">
          label="Rolling"
          value={mode}
          onChange={setMode}
          options={[
            { id: "day_ahead", label: "Day-ahead" },
            { id: "free", label: "Free run" },
          ]}
        />
        <Field label="Intervention">
          <span className="rolling-iv">
            <select className="field field--sm" value={ivVar} onChange={(e) => setIvVar(e.target.value)} aria-label="Intervention variable">
              <option value="">None</option>
              {inputs.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select className="field field--sm" value={ivKind} onChange={(e) => setIvKind(e.target.value as Intervention["kind"])} aria-label="Intervention kind" disabled={!ivVar}>
              <option value="shift">shift</option>
              <option value="scale">scale</option>
              <option value="set">set</option>
            </select>
          </span>
        </Field>
        {ivVar && <NumberField label="By" step={ivKind === "scale" ? 0.1 : 1} value={ivValue} onChange={setIvValue} />}
      </div>
      <fieldset className="rolling-models">
        <legend className="caps">Compared</legend>
        {[...saved, FOUNDATION].map((m) => (
          <label key={m}>
            <input
              type="checkbox"
              checked={picked.includes(m)}
              onChange={(e) => setChosen(e.target.checked ? [...picked, m] : picked.filter((x) => x !== m))}
            />{" "}
            {labelOf(m)}
          </label>
        ))}
        <button type="button" className="btn btn--primary btn--sm" onClick={run} disabled={busy || !col || picked.length === 0}>
          {busy ? "Rolling…" : "Roll and compare"}
        </button>
      </fieldset>
      <ErrorBanner error={error} />
      {busy && (
        <p role="status" className="rolling-note">
          <span className="train-spinner" aria-hidden="true" /> Rolling {picked.length} model{picked.length === 1 ? "" : "s"} over the year
          {ivVar ? ", twice (with the intervention)" : ""}…
        </p>
      )}
      {res && (
        <>
          <table className="rolling-table" aria-label="Rolling comparison">
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col" title="Mean absolute error per step, in % of the measured mean">
                  Error per step
                </th>
                <th scope="col">Year (MWh) · measured {fmt(res.measured_mwh)}</th>
                <th scope="col">Correlation</th>
                {res.runs.some((r) => r.intervened) && <th scope="col">With {ivText}</th>}
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {res.runs.map((r) => (
                <tr key={r.model}>
                  <th scope="row">{labelOf(r.model)}</th>
                  {r.scores ? (
                    <>
                      <td>{r.scores.mae_pct == null ? "–" : `${fmt(r.scores.mae_pct)} %`}</td>
                      <td>{fmt(r.scores.energy_mwh)}</td>
                      <td>{r.scores.corr == null ? "–" : fmt(r.scores.corr, 3)}</td>
                      {res.runs.some((x) => x.intervened) && <td>{r.change_pct == null ? "–" : `${r.change_pct >= 0 ? "+" : "−"}${fmt(Math.abs(r.change_pct))} %`}</td>}
                    </>
                  ) : (
                    <td colSpan={4}>{r.error}</td>
                  )}
                  <td className="rolling-note">{r.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {charts && (
            <>
              <h3 className="rolling-h3">{res.column} · daily means · {res.mode === "day_ahead" ? "day-ahead" : "free run"}</h3>
              <LineChart xs={charts.xs} lines={charts.base} height={260} />
              {charts.moved.length > 0 && (
                <>
                  <h3 className="rolling-h3">With {ivText}</h3>
                  <LineChart xs={charts.xs} lines={[charts.base[0], ...charts.moved]} height={260} />
                </>
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}
