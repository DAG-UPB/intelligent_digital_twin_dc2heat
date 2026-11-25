/**
 * Scenarios, level 2: a Monte Carlo rollout (50 noise draws) of the 'linear' model over the test period, with
 * set/shift/scale interventions in date windows; baseline vs scenario as p05-p95 bands, and their means.
 */
import { useEffect, useMemo, useState } from "react";
import { fetchDatasets, simulateModel, type Band, type SimulateResponse, type StructureScope, type TrainedModel } from "../../../../api";
import { DATASET } from "../../../../dataset";
import { errorMessage } from "../../../../lib/errors";
import { durationLabel } from "../../../../lib/period";
import { derivable } from "../../../../lib/sourceMap";
import { MODEL_NAME } from "../../../../lib/modelCatalog";
import { Card } from "../../../../ui/Card";
import { ErrorBanner } from "../../../../ui/ErrorBanner";
import { Field } from "../../../../ui/Field";
import type { Picked } from "../../shared/focus";
import type { HexView } from "../../shared/useHexView";
import { RunKpis, useRunKpis } from "../RunKpis";
import { BandChart } from "./BandChart";
import { defaultColumns, horizonsFor, interventionsOf, isYear, mean, wholeSteps, type Row } from "./horizons";
import { InterventionRows } from "./InterventionRows";

const DRAWS = 50;
const STRUCTURE_OF: Record<StructureScope, string> = { dc: "#/dc/pid", heat: "#/heat/structure", district: "#/district/structure" };

/**
 * `model`: the app data center's 'linear' model, undefined while loading, null when none is trained. `view`: the
 * selected HEX; interventions and plots show its variables, plus its calculated Q (computed by simulate).
 */
export default function TestPeriodPage({
  picked,
  model,
  view,
  scope,
}: {
  picked: Picked | null;
  model: TrainedModel | null | undefined;
  view: HexView | null;
  scope?: StructureScope; // whose structure's model: the data center's by default
}) {
  const [steps, setSteps] = useState(0); // 0 = the whole test period
  const [stepSec, setStepSec] = useState(3600);
  const [columns, setColumns] = useState<string[] | null>(null); // null until the default is chosen
  const [rows, setRows] = useState<Row[]>([]);
  const [res, setRes] = useState<SimulateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDatasets().then((r) => setStepSec(r.datasets.find((d) => d.id === DATASET)?.resolution_seconds || 3600), () => {});
  }, []);

  const kpi = useRunKpis(DATASET, model, view?.config?.derived, scope);
  const variables = useMemo(() => (model ? [...model.drivers, ...model.order].filter((v) => !view?.hidden.has(v)) : []), [model, view]);
  // the selected HEX's Q, calculated from the predicted T_in, T_out and m
  const calculated = useMemo(() => (model && view ? derivable(view.config?.derived, [...model.drivers, ...model.order]).filter((c) => view.calculated.includes(c)) : []), [model, view]);
  const plottable = useMemo(() => [...variables, ...calculated], [variables, calculated]);

  // plot the heat variables first, then what the model predicts (once: a re-trained model keeps the choice)
  useEffect(() => {
    if (!model || !view || columns) return;
    setColumns(defaultColumns(view.config?.heat ?? [], plottable));
  }, [model, view, columns, plottable]);

  // a node clicked on the causal mini map becomes an intervention row (once per variable)
  useEffect(() => {
    if (picked)
      setRows((rs) =>
        picked.off
          ? rs.filter((r) => r.variable !== picked.v) // released: its row goes
          : rs.some((r) => r.variable === picked.v)
            ? rs
            : [...rs, { variable: picked.v, kind: "shift", value: "1", from: "", to: "" }],
      );
  }, [picked]);

  const plotted = columns ?? [];

  if (model === null)
    return (
      <div className="test-period__missing">
        No trained model for {DATASET} yet. Train one under Modelling on <a href={STRUCTURE_OF[scope ?? "dc"]}>Structure and Modelling</a> first.
      </div>
    );
  if (!model) return null;

  const whole = wholeSteps(model);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const interventions = interventionsOf(rows, model.split_time, stepSec);
      setRes(await simulateModel(DATASET, MODEL_NAME, { start: model.split_index, steps: steps || whole, columns: [...new Set([...plotted, ...kpi.columns])], interventions, n_draws: DRAWS, baseline: interventions.length > 0 }, scope));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page test-period">
      <div>
        <h1 className="page__title">Scenarios · Level 2: Long period simulation{isYear(whole, stepSec) ? " · a year" : ""}</h1>
        <p className="page__lead">
          Starts {model.split_time?.slice(0, 16).replace("T", " ")}, right after the training data, and rolls the model forward step by step (every{" "}
          {durationLabel(stepSec)}) with {DRAWS} noise draws over the test period ({durationLabel(whole * stepSec)}). Inputs ({model.drivers.join(", ") || "none"}) follow
          the real data unless you change them.
        </p>
      </div>

      <ErrorBanner error={error} />

      <Card className="test-period__controls">
        <div className="test-period__row">
          <Field label="Horizon">
            <select className="field" value={steps} onChange={(e) => setSteps(Number(e.target.value))}>
              {horizonsFor(stepSec, whole).map((h) => (
                <option key={h.steps} value={h.steps}>
                  {h.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="field-label" role="group" aria-label="Plot">
            <span className="caps">Plot</span>
            <div className="chips">
              {plottable.map((v) => (
                <label key={v} className="test-period__check" title={calculated.includes(v) ? "Calculated from the predicted m, T_in and T_out: Q = ṁ·cₚ·(T_in − T_out)" : undefined}>
                  <input type="checkbox" checked={plotted.includes(v)} onChange={() => setColumns(plotted.includes(v) ? plotted.filter((c) => c !== v) : [...plotted, v])} />
                  {v}
                  {calculated.includes(v) && <span className="muted"> (calculated)</span>}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="caps">Interventions</div>
        <InterventionRows rows={rows} variables={variables} withTime={stepSec < 3600} onChange={setRows} />
        <div className="step__row">
          <button type="button" className="btn" onClick={() => setRows([...rows, { variable: model.drivers[0] ?? variables[0], kind: "shift", value: "1", from: "", to: "" }])}>
            + Add intervention
          </button>
          <button type="button" className="btn btn--primary test-period__run" onClick={run} disabled={busy || plotted.length === 0}>
            {busy ? "Simulating…" : "Run"}
          </button>
        </div>
      </Card>

      <RunKpis setup={kpi} res={res} withLabel="Twin, your interventions" />
      {res && plotted.filter((c) => c in res.scenario).map((c) => <Result key={c} res={res} column={c} />)}
    </div>
  );
}

/** A plotted variable's card: the means of actual, baseline and scenario, and the band chart. */
function Result({ res, column }: { res: SimulateResponse; column: string }) {
  const sc = mean((res.scenario[column] as Band).p50);
  const bl = res.baseline ? mean((res.baseline[column] as Band).p50) : null;
  return (
    <section className="card" aria-label={column}>
      <div className="result__head">
        <b>{column}</b>
        <span className="muted">
          mean: actual {mean(res.actual[column]).toPrecision(4)} · {bl !== null && <>baseline {bl.toPrecision(4)} · </>}
          scenario {sc.toPrecision(4)}
          {bl !== null && <> · change {(sc - bl >= 0 ? "+" : "") + (sc - bl).toPrecision(3)}</>}
        </span>
      </div>
      <BandChart res={res} column={column} />
    </section>
  );
}
