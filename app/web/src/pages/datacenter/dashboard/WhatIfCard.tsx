/**
 * Visualization and Scenarios › Scenarios, of any part: move a lever (shifted by an amount) and the part's KPIs
 * follow, its twin (the trained 'linear' model of its structure, `scope`) run over the test period. Three columns
 * compare like for like: measured, the twin without a change, the twin with your levers; the change is the twin's with
 * against its without, so the model's own error does not count as an effect. Nothing runs until a lever is moved.
 * The data center's levers are its setpoints and actuators (dataset.json); another part's are what its twin takes
 * from the data (the outdoor temperature too: a colder winter). `onResult` hands the rows to the page's KPI tiles.
 * Which variables are levers is the page's (`chosen`, the step-through's what-if takes the same), picked in the panel
 * on the left (`side`) or on its causal graph (`focus`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchDatasets, fetchTimeSeriesData, simulateModel, type DatasetInfo, type DatasetSummary, type SimulateResponse, type StructureScope } from "../../../api";
import { configOf, DATASET } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import { fmt } from "../../../lib/format";
import { MODEL_NAME } from "../../../lib/modelCatalog";
import { Card } from "../../../ui/Card";
import { ErrorBanner } from "../../../ui/ErrorBanner";
import { Slider } from "../../../ui/Slider";
import { leversOf } from "../modelling/inputs";
import type { Picked } from "../shared/focus";
import { wholeSteps } from "../scenarios/simulation/horizons";
import { actualWith, twinSplit } from "../scenarios/kpiRun";
import { useScenarioModel } from "../scenarios/useScenarioModel";
import { changeOf, compareKpis, runSeries, type ScenarioKpi, type WhatIfKpi } from "./whatIf";

export type { ScenarioKpi } from "./whatIf";

/** A KPI's value with its unit, as the table and the page's tiles show it. */
export const valueOf = (v: number | null, unit: string | null) => (v == null ? "–" : `${fmt(v, Math.abs(v) < 10 ? 3 : 1)}${unit ? ` ${unit}` : ""}`);

/** Whether the change is good (green), bad (red) or too small to say (shown as 0.0 %). */
export function toneOf(k: ScenarioKpi): "good" | "bad" | null {
  const c = changeOf(k.with, k.without);
  if (c == null || Math.abs(c) < 5e-4) return null;
  return (k.better === "lower" ? c < 0 : c > 0) ? "good" : "bad";
}

/** The change, twin with against without, for a KPI tile's line: " · change +1,2 %" (nothing when there is none). */
export function changeSaid(k: ScenarioKpi) {
  const c = changeOf(k.with, k.without);
  return c == null ? "" : ` · change ${c > 0 ? "+" : ""}${fmt(100 * c, 1)} %`;
}

/** A slider step of about 1/100 of the lever's range, rounded to 1, 2 or 5 times a power of ten. */
function niceStep(span: number) {
  const raw = span / 100 || 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
}

export function WhatIfCard({
  summary,
  title,
  columns,
  kpis,
  scope = "dc",
  structure = "#/dc/pid",
  onResult,
  chosen,
  onChosen,
  side,
  focus,
}: {
  summary: DatasetSummary;
  title: string;
  columns: string[]; // what the KPIs read: the twin runs these
  kpis: (series: Record<string, (number | null)[]>, stepHours: number) => WhatIfKpi[];
  scope?: StructureScope;
  structure?: string; // where the part's models are trained
  onResult?: (rows: ScenarioKpi[] | null) => void;
  chosen: string[] | null; // the levers picked; null: not yet, the first ones
  onChosen: (levers: string[]) => void;
  side?: HTMLElement | null; // the panel on the left, under the causal graph: the list goes there
  focus?: Picked | null; // the variable clicked on the causal graph: a lever; clicked again, released
}) {
  const [dataset, setDataset] = useState<DatasetInfo | null>(null);
  const [model] = useScenarioModel(DATASET, scope);
  const [shift, setShift] = useState<Record<string, number>>({});
  const [res, setRes] = useState<SimulateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchDatasets()
      .then((r) => setDataset(r.datasets.find((d) => d.id === DATASET) ?? null))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  // the levers: the user's pick among what the twin takes (actuators and setpoints marked), at first the dataset's own
  // levers (the data center's setpoints or actuators, dataset.json) or, for another part, what its twin takes
  const marked = useMemo(() => new Set([...configOf(dataset ?? undefined).actuators, ...configOf(dataset ?? undefined).levers]), [dataset]);
  const choices = useMemo(() => [...new Set([...(model?.drivers ?? []), ...(model?.order ?? [])])].filter((v) => !dataset || dataset.columns.includes(v)), [model, dataset]);
  const first = useMemo(() => (scope === "dc" ? leversOf(dataset) : (model?.drivers ?? [])), [scope, dataset, model]);
  const levers = useMemo(() => (chosen ?? first).filter((v) => !choices.length || choices.includes(v)), [chosen, first, choices]);
  const setLevers = (next: string[]) => {
    onChosen(next);
    setShift((s) => Object.fromEntries(Object.entries(s).filter(([k]) => next.includes(k)))); // a lever taken off: its shift goes
  };
  const toggle = (v: string) => setLevers(levers.includes(v) ? levers.filter((x) => x !== v) : [...levers, v]);
  // once the twin and the dataset are known, the page's list starts with the first levers
  useEffect(() => {
    if (chosen === null && model && dataset) onChosen(levers);
  }, [chosen, model, dataset, levers, onChosen]);
  useEffect(() => {
    if (focus && choices.includes(focus.v)) setLevers(focus.off ? levers.filter((x) => x !== focus.v) : levers.includes(focus.v) ? levers : [...levers, focus.v]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new click on the graph only
  }, [focus]);
  const ranges = useMemo(
    () =>
      Object.fromEntries(
        levers.map((v) => {
          const s = summary.variables.find((x) => x.name === v);
          // as far either way as the data spreads (the twin extrapolates beyond what it was trained on: less sure there)
          const half = s && s.min != null && s.max != null ? Math.max(s.max - s.min, 1e-9) : 10;
          return [v, { half, step: niceStep(2 * half) }];
        }),
      ),
    [levers, summary.variables],
  );
  const moved = Object.entries(shift).filter(([, d]) => d !== 0);

  // the twin is asked only for the KPI columns it makes (simulate refuses the others: "Not in the model"); the rest
  // are read from the data once and count the same in all three runs, so their change is 0
  const derived = configOf(dataset ?? undefined).derived;
  const split = useMemo(() => (model ? twinSplit(columns, model, derived) : null), [model, columns, derived]);
  const twinCols = split?.twin.join(",") ?? "";
  const missing = split?.measured.join(",") ?? "";
  const [measured, setMeasured] = useState<Record<string, (number | null)[]>>({});
  useEffect(() => {
    setMeasured({});
    if (!model || !missing) return;
    let live = true;
    fetchTimeSeriesData(DATASET, model.file, missing.split(",")).then(
      (r) => live && setMeasured(r.columns),
      () => {}, // those columns stay out of the KPIs
    );
    return () => {
      live = false;
    };
  }, [model, missing]);

  // a moment after the last lever moved: run the twin with the levers and without them (nothing before a lever moves)
  const seq = useRef(0);
  const key = JSON.stringify(moved);
  useEffect(() => {
    if (!model || !moved.length) return setRes(null);
    const n = ++seq.current;
    const timer = setTimeout(() => {
      setBusy(true);
      setError(null);
      simulateModel(
        DATASET,
        MODEL_NAME,
        {
          start: model.split_index,
          steps: wholeSteps(model),
          columns: twinCols ? twinCols.split(",") : [],
          interventions: moved.map(([variable, value]) => ({ variable, kind: "shift", value })),
          n_draws: 1,
          baseline: true,
        },
        scope,
      )
        .then((r) => n === seq.current && setRes(r))
        .catch((e) => n === seq.current && setError(errorMessage(e)))
        .finally(() => n === seq.current && setBusy(false));
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the moved levers
  }, [key, model, twinCols, scope]);

  const stepHours = (summary.resolution_seconds ?? 3600) / 3600;
  const table = useMemo<ScenarioKpi[] | null>(() => {
    if (!res) return null;
    const actual = actualWith(res, measured);
    const run = (src?: SimulateResponse["scenario"]) => kpis(runSeries(columns, actual, src), stepHours);
    return compareKpis(kpis(runSeries(columns, actual), stepHours), run(res.baseline), run(res.scenario));
  }, [res, measured, columns, kpis, stepHours]);
  const shown = moved.length ? table : null;
  useEffect(() => onResult?.(shown), [shown, onResult]);

  const pick = (
    <div className="dash-filters">
      <span className="caps">Intervention variables</span>
      <div className="chips" role="group" aria-label="Intervention variables">
        {choices.map((v) => (
          <button
            key={v}
            type="button"
            className={levers.includes(v) ? "chip chip--on" : "chip"}
            aria-pressed={levers.includes(v)}
            title={marked.has(v) ? `${v}: an actuator or setpoint` : v}
            onClick={() => toggle(v)}
          >
            {marked.has(v) && <span className="whatif__actuator" aria-label="actuator" />}
            {v}
          </button>
        ))}
      </div>
      <p className="muted dash-filters__hint">
        <span className="whatif__actuator" aria-hidden /> an actuator or setpoint. A slider each for the KPIs; the step-through's what-if takes them too.
      </p>
    </div>
  );

  return (
    <Card title={`${title} · scenario: move a lever, the KPIs follow`}>
      <ErrorBanner error={error} />
      {model === null ? (
        <p className="dash__note">
          Scenarios need a model of the system, and this one has none yet. Model it on <a href={structure}>Structure and Modelling</a>: under Modelling, Train.
        </p>
      ) : !levers.length && !choices.length ? (
        <p className="muted dash__note">
          {scope === "dc" ? "This data center has no levers (setpoints or actuators) marked in dataset.json." : "Its twin takes nothing from the data to move."}
        </p>
      ) : (
        <div className="whatif">
          <div className="whatif__levers" role="group" aria-label="Levers">
            {choices.length > 0 && (side ? createPortal(pick, side) : pick)}
            {!levers.length && <p className="muted whatif__note">Pick an intervention variable{side ? " in the panel on the left" : ""}.</p>}
            {levers.map((v) => (
              <Slider
                key={v}
                label={`${v}, shifted by`}
                value={shift[v] ?? 0}
                show={`${(shift[v] ?? 0) > 0 ? "+" : ""}${fmt(shift[v] ?? 0, 2)}`}
                min={-ranges[v].half}
                max={ranges[v].half}
                step={ranges[v].step}
                onChange={(x) => setShift((s) => ({ ...s, [v]: x }))}
              />
            ))}
          </div>
          <div className="whatif__foot">
            <button type="button" className="btn btn--sm" disabled={!moved.length} onClick={() => setShift({})}>
              Reset
            </button>
            {/* the result is in the KPI tiles on top: the twin with your levers, measured and without beside it */}
            <p className="muted whatif__note" aria-busy={busy}>
              {busy ? "Running the twin…" : !moved.length ? "Move a lever to see how the KPIs change." : "The KPIs on top: the twin with your levers."}{" "}
              Over the test period{model ? ` (${wholeSteps(model)} steps)` : ""}, with the trained model.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * The KPIs measured, by the twin without a change and with it, and the change (green: better, red: worse), the
 * change being the twin's with against its without. `heads`: the run columns' names; two: a run without a change.
 */
export function KpiTable({ rows, heads, label }: { rows: ScenarioKpi[]; heads: [string, string, string?]; label: string }) {
  const withChange = heads.length > 2;
  return (
    <table className="whatif__table" aria-label={label}>
      <thead>
        <tr>
          <th scope="col">KPI</th>
          {heads.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
          {withChange && <th scope="col">Change</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((k) => {
          const c = changeOf(k.with, k.without);
          const tone = toneOf(k);
          return (
            <tr key={k.label}>
              <th scope="row">{k.label}</th>
              <td>{valueOf(k.value, k.unit)}</td>
              <td>{valueOf(k.without, k.unit)}</td>
              {withChange && <td>{valueOf(k.with, k.unit)}</td>}
              {withChange && (
                <td style={{ color: tone ? (tone === "good" ? "var(--ok)" : "var(--danger)") : undefined }}>
                  {c == null ? "–" : `${c > 0 ? "+" : ""}${fmt(100 * c, 1)} %`}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
