/**
 * A closer look at one model's fit of one variable over its test period (the free run, as Evaluate scores it):
 * predicted vs measured with each one's distribution on the margins, the residuals vs predicted with theirs, and the
 * two series over time (zoomable). The free run comes from the simulate route, which also returns the measured rows.
 */
import { useEffect, useMemo, useState } from "react";
import { simulateModel, type EvaluateResponse, type StructureScope, type TrainedModel } from "../../../api";
import { errorMessage } from "../../../lib/errors";
import { fmt } from "../../../lib/format";
import { STRUCTURES } from "../../../lib/modelCatalog";
import { Dialog } from "../../../ui/Dialog";
import { ErrorBanner } from "../../../ui/ErrorBanner";
import { Field } from "../../../ui/Field";
import LineChart from "../../../ui/LineChart";
import { compact } from "../dashboard/dashboard";
import { SIMULATE_MAX_STEPS, TABPFN_FREE_STEPS, evenly, finitePairs, histogram, niceTicks, paddedRange } from "./fitPlot";
import { pct } from "./format";
import "./fit.css";

const MEASURED = "#8391a7"; // chart line (canvas: no CSS vars), as SetpointEventCard's actual
const MAX_DOTS = 3000; // more dots only add ink: the histograms on the margins count every row
const BINS = 30;

// the plot's box in SVG units: left axis, bottom axis, the margin histograms' band and the gap before it
const W = 460;
const H = 400;
const L = 56;
const B = 40;
const M = 52;
const G = 6;

/** A number or "–" (fmt's two decimals). */
const num = (x: number | null | undefined, d = 2) => (x == null ? "–" : fmt(x, d));

/** A scatter of (x, y) with optional histograms on the top (of x) and right (of y) margins, the y = x diagonal or a zero line. */
function MarginPlot({
  label,
  xs,
  ys,
  xRange,
  yRange,
  xLabel,
  yLabel,
  top,
  right,
  diagonal = false,
  zero = false,
}: {
  label: string;
  xs: number[];
  ys: number[];
  xRange: [number, number];
  yRange: [number, number];
  xLabel: string;
  yLabel: string;
  top?: number[];
  right: number[];
  diagonal?: boolean;
  zero?: boolean;
}) {
  const [x0, x1, y0, y1] = [L, W - M - G, top ? M + G : 10, H - B];
  const sx = (x: number) => x0 + ((x - xRange[0]) / (xRange[1] - xRange[0])) * (x1 - x0);
  const sy = (y: number) => y1 - ((y - yRange[0]) / (yRange[1] - yRange[0])) * (y1 - y0);
  const topMax = Math.max(1, ...(top ?? []));
  const rightMax = Math.max(1, ...right);
  const xTicks = niceTicks(xRange[0], xRange[1]);
  const yTicks = niceTicks(yRange[0], yRange[1]);
  return (
    <svg className="fit-plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {xTicks.map((t) => (
        <line key={`x${t}`} className="fit-plot__grid" x1={sx(t)} x2={sx(t)} y1={y0} y2={y1} />
      ))}
      {yTicks.map((t) => (
        <line key={`y${t}`} className="fit-plot__grid" x1={x0} x2={x1} y1={sy(t)} y2={sy(t)} />
      ))}
      <rect className="fit-plot__frame" x={x0} y={y0} width={x1 - x0} height={y1 - y0} />
      {diagonal && <line className="fit-plot__ref" x1={x0} y1={y1} x2={x1} y2={y0} />}
      {zero && yRange[0] < 0 && yRange[1] > 0 && <line className="fit-plot__ref" x1={x0} x2={x1} y1={sy(0)} y2={sy(0)} />}
      <g className="fit-plot__dots">
        {xs.map((x, i) => (
          <circle key={i} cx={sx(x)} cy={sy(ys[i])} r={2} />
        ))}
      </g>
      {top && (
        <g className="fit-plot__bars">
          {top.map((c, i) => {
            const w = (x1 - x0) / top.length;
            const h = (c / topMax) * (M - 4);
            return <rect key={i} x={x0 + i * w} y={M - h} width={Math.max(0.5, w - 1)} height={h} />;
          })}
        </g>
      )}
      <g className="fit-plot__bars">
        {right.map((c, i) => {
          const h = (y1 - y0) / right.length;
          return <rect key={i} x={x1 + G} y={y1 - (i + 1) * h} width={(c / rightMax) * (W - 4 - x1 - G)} height={Math.max(0.5, h - 1)} />;
        })}
      </g>
      {xTicks.map((t) => (
        <text key={`xl${t}`} className="fit-plot__tick" x={sx(t)} y={y1 + 14} textAnchor="middle">
          {compact(t)}
        </text>
      ))}
      {yTicks.map((t) => (
        <text key={`yl${t}`} className="fit-plot__tick" x={x0 - 6} y={sy(t)} dy="0.32em" textAnchor="end">
          {compact(t)}
        </text>
      ))}
      <text className="fit-plot__label" x={(x0 + x1) / 2} y={H - 6} textAnchor="middle">
        {xLabel}
      </text>
      <text className="fit-plot__label" transform={`translate(14 ${(y0 + y1) / 2}) rotate(-90)`} textAnchor="middle">
        {yLabel}
      </text>
    </svg>
  );
}

interface Run {
  key: string;
  time: string[];
  measured: (number | null)[];
  predicted: (number | null)[];
}

/** The dialog: one variable, one of the models that predict it (switchable), its free run over the test period. */
export function FitDialog({
  dataset,
  scope,
  models,
  evalRes,
  variable,
  initial,
  unit,
  onClose,
}: {
  dataset: string;
  scope?: StructureScope;
  models: Record<string, TrainedModel>;
  evalRes: EvaluateResponse | null;
  variable: string;
  initial: string; // the model shown first (the best one)
  unit?: string;
  onClose: () => void;
}) {
  const choices = STRUCTURES.filter((d) => models[d.name]?.variables[variable]);
  const [name, setName] = useState(initial);
  const model = models[name];
  const def = STRUCTURES.find((d) => d.name === name);
  const label = def?.label ?? name;
  const predicts = !!model?.variables[variable];
  const key = `${dataset}|${scope}|${name}|${variable}`;
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);

  useEffect(() => {
    if (!model?.variables[variable]) return;
    let live = true;
    // the free run as Evaluate scores it: from the split (after the first lags) to the end of the data, TabPFN its first part
    const start = Math.max(model.split_index, model.max_lag);
    // the route cuts at the end of the data, so ask for the most: the plots then cover what Evaluate scored, even if the file grew
    const steps = model.kind === "tabpfn" ? TABPFN_FREE_STEPS : SIMULATE_MAX_STEPS;
    simulateModel(dataset, name, { start, steps, columns: [variable] }, scope)
      .then((r) => {
        const p = r.scenario[variable];
        if (!live) return;
        setRun({ key, time: r.time, measured: r.actual[variable] ?? [], predicted: Array.isArray(p) ? p : p.p50 });
        // an earlier failure of the same model must not stay above its plots
        setError((x) => (x?.key === key ? null : x));
      })
      .catch((e) => live && setError({ key, text: errorMessage(e) }));
    return () => {
      live = false;
    };
  }, [dataset, scope, name, variable, model, key]);

  const shown = run?.key === key ? run : null;
  const plots = useMemo(() => {
    if (!shown) return null;
    const { measured, predicted } = finitePairs(shown.measured, shown.predicted);
    if (!measured.length) return null;
    const residual = measured.map((y, i) => y - predicted[i]);
    const both = paddedRange([...measured, ...predicted]);
    const pRange = paddedRange(predicted);
    const rRange = paddedRange([...residual, 0]);
    const pick = evenly(measured.length, MAX_DOTS);
    return {
      rows: measured.length,
      dots: { m: pick.map((i) => measured[i]), p: pick.map((i) => predicted[i]), r: pick.map((i) => residual[i]) },
      both,
      pRange,
      rRange,
      top: histogram(measured, both[0], both[1], BINS),
      right: histogram(predicted, both[0], both[1], BINS),
      rightRes: histogram(residual, rRange[0], rRange[1], BINS),
    };
  }, [shown]);
  const chart = useMemo(
    () =>
      shown && {
        xs: shown.time.map((t) => new Date(t).getTime() / 1000),
        // uPlot draws a null as a gap
        lines: [
          { label: "Measured", values: shown.measured as number[], color: MEASURED },
          { label, values: shown.predicted as number[], color: def?.color ?? MEASURED },
        ],
      },
    [shown, label, def],
  );

  const e = evalRes?.models[name];
  const fit = model?.variables[variable];
  const mae = e?.free_mae?.[variable];
  const metrics: [string, string, string][] = [
    ["MAE", mae == null ? "–" : `${compact(mae)}${unit ? ` ${unit}` : ""}`, "Mean absolute error of the free run, in the variable's unit"],
    ["WAPE", pct(e?.free_wape?.[variable]), "Σ|measured − predicted| ÷ Σ|measured| over the free run"],
    ["R²", num(e?.free_r2[variable]), "Share of the variance the free run explains: 1 perfect, 0 no better than the mean, below 0 worse"],
    ["MASE", num(e?.free_mase?.[variable]), "MAE of the free run ÷ MAE of repeating the value one day earlier (training rows): below 1 beats it"],
    ["nMAE", pct(e?.free_nmae[variable]), "MAE of the free run ÷ the mean absolute value of the variable (training rows)"],
    ["One step nMAE", pct(e?.nmae_test[variable] ?? fit?.nmae_test), "The next step from the real history, test rows"],
    ["One step R²", num(e?.r2_test[variable] ?? fit?.r2_test), "The next step from the real history, test rows"],
  ];
  const withUnit = (s: string) => (unit ? `${s} (${unit})` : s);
  // the simulate route takes at most SIMULATE_MAX_STEPS; Evaluate scores the whole test period
  const testSteps = model ? model.rows - Math.max(model.split_index, model.max_lag) : 0;
  const capped = model?.kind !== "tabpfn" && testSteps > SIMULATE_MAX_STEPS;

  return (
    <Dialog label={`Fit of ${variable} · ${label}`} onClose={onClose} className="fit-dialog">
      <div className="fit-head">
        <h2 className="mono">{variable}</h2>
        <Field label="Model">
          <select className="field" value={name} onChange={(ev) => setName(ev.target.value)}>
            {choices.map((d) => (
              <option key={d.name} value={d.name}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <dl className="fit-metrics">
        {metrics.map(([k, v, hint]) => (
          <div key={k} title={hint}>
            <dt className="caps">{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="muted fit-note">
        The free run over the test period{model?.split_time ? ` from ${model.split_time.slice(0, 10)}` : ""}: the model on its own predictions, only the inputs
        from data are real{model?.kind === "tabpfn" ? ` (TabPFN: its first ${TABPFN_FREE_STEPS} steps)` : ""}.
        {capped ? ` Plotted: the first ${fmt(SIMULATE_MAX_STEPS)} of ${fmt(testSteps)} steps; the scores above cover all of them.` : ""}
        {plots ? ` ${fmt(plots.rows)} rows with both values.` : ""}
      </p>
      {!predicts && (
        <p className="muted">
          {label} has no prediction of {variable}.
        </p>
      )}
      <ErrorBanner error={error?.key === key ? error.text : null} />
      {predicts && !shown && error?.key !== key && (
        <p role="status" className="muted">
          Running the free run of {label}…
        </p>
      )}
      {shown && !plots && <p className="muted">No row of the test period has both a measured and a predicted value.</p>}
      {plots && (
        <div className="fit-plots">
          <figure>
            <figcaption className="caps">Predicted vs measured</figcaption>
            <MarginPlot
              label={`Predicted vs measured ${variable}, ${fmt(plots.rows)} rows: on the diagonal is right. Measured's distribution on the top margin, predicted's on the right.`}
              xs={plots.dots.m}
              ys={plots.dots.p}
              xRange={plots.both}
              yRange={plots.both}
              xLabel={withUnit(`Measured ${variable}`)}
              yLabel={withUnit(`Predicted ${variable}`)}
              top={plots.top}
              right={plots.right}
              diagonal
            />
          </figure>
          <figure>
            <figcaption className="caps">Residuals vs predicted</figcaption>
            <MarginPlot
              label={`Residual (measured − predicted) of ${variable} vs predicted, ${fmt(plots.rows)} rows: around zero is right. The residuals' distribution on the right margin.`}
              xs={plots.dots.p}
              ys={plots.dots.r}
              xRange={plots.pRange}
              yRange={plots.rRange}
              xLabel={withUnit(`Predicted ${variable}`)}
              yLabel={withUnit("Measured − predicted")}
              right={plots.rightRes}
              zero
            />
          </figure>
        </div>
      )}
      {chart && plots && (
        <figure>
          <figcaption className="caps">Over time (drag to zoom, double-click to zoom out)</figcaption>
          <LineChart xs={chart.xs} lines={chart.lines} height={260} unit={unit ?? ""} />
        </figure>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
