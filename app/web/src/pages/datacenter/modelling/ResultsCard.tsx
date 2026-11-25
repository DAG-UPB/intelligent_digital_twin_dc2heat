/**
 * Results table: for each predicted variable and structure, the best model and its one-step, free-run and after-setpoint
 * nMAE; then the overall best model's free-run MAE, WAPE, R² and MASE, and Inspect, which opens its fit (FitDialog).
 * A click on a row picks its variable (its results, its equation, on the graph and the drawing).
 */
import { useMemo, useState } from "react";
import type { DatasetInfo, EvaluateResponse, StructureScope, TrainedModel } from "../../../api";
import { configOf } from "../../../dataset";
import { fmt } from "../../../lib/format";
import { durationLabel } from "../../../lib/period";
import { STRUCTS, TAG, type Kind } from "../../../lib/modelCatalog";
import { compact } from "../dashboard/dashboard";
import { FitDialog } from "./FitDialog";
import { unitsOf } from "./fitPlot";
import { nmaeColor, pct } from "./format";
import type { Candidate, VariableRanking } from "./ranking";

const WINDOWS = [6, 12, 24, 72, 168, 720, 2000];

/** Coloured badge of a model kind (LR, XGB, PHY, SR, TPF). */
export function KindTag({ kind }: { kind: Kind }) {
  return (
    <span className="train-tag" style={{ background: TAG[kind].bg, color: TAG[kind].fg }}>
      {TAG[kind].text}
    </span>
  );
}

/** The cells of one structure's column group for one variable. */
function Cells({ c, bold, hasLevers }: { c: Candidate; bold: boolean; hasLevers: boolean }) {
  return (
    <>
      <td className="train-table__group">
        <KindTag kind={c.def.kind} />
      </td>
      <td style={{ color: nmaeColor(c.one) }}>{pct(c.one)}</td>
      <td style={{ color: nmaeColor(c.free), fontWeight: bold ? 700 : 400 }}>{pct(c.free)}</td>
      {hasLevers && <td style={{ color: nmaeColor(c.after) }}>{pct(c.after)}</td>}
    </>
  );
}

// the fit columns' headers and what each tells (their tooltips)
export const FIT_COLS: [string, string][] = [
  ["MAE", "Mean absolute error of the free run, in the variable's own unit"],
  ["WAPE", "Σ|measured − predicted| ÷ Σ|measured| over the free run, in percent"],
  ["R²", "Share of the variance the free run explains: 1 perfect, 0 no better than the mean, below 0 worse"],
  ["MASE", "MAE of the free run ÷ MAE of repeating the value one day earlier (on the training rows): below 1 beats that"],
];

export function ResultsCard({
  predicted,
  ranking,
  levers,
  eventCount,
  stepSec,
  splitTime,
  drivers,
  window_,
  onWindow,
  dataset,
  scope,
  models,
  evalRes,
  picked,
  onPick,
}: {
  predicted: string[];
  ranking: Record<string, VariableRanking>;
  levers: string[];
  eventCount: number;
  stepSec: number;
  splitTime: string | null; // start of the test period (of the first shown model)
  drivers: string[]; // inputs from data (of the first shown model)
  window_: number;
  onWindow: (steps: number) => void;
  dataset: DatasetInfo | null; // for Inspect's free run, and the units its config names
  scope?: StructureScope;
  models: Record<string, TrainedModel>;
  evalRes: EvaluateResponse | null;
  picked: string | null; // its row marked
  onPick: (v: string) => void;
}) {
  const hasLevers = levers.length > 0;
  const span = hasLevers ? 4 : 3;
  const units = useMemo(() => unitsOf(configOf(dataset ?? undefined)), [dataset]);
  const [inspect, setInspect] = useState<{ v: string; name: string } | null>(null);
  return (
    <div className="card">
      <div className="caps train-card__title">Results · causal graph vs all vs all</div>
      <p className="muted train-card__text">
        Normalized MAE (nMAE) = mean absolute error ÷ mean absolute value of the variable, lower is better. Each column shows the best model for that variable
        (LR, XGBoost, Physics, Symbolic regression or TabPFN, picked by free run). One step: the next step ({durationLabel(stepSec)}) from real history. Free run:
        the whole test period from {splitTime?.slice(0, 10)} on the model's own predictions (TabPFN: only its first part, it is too slow per step for more).{" "}
        {hasLevers ? (
          <>
            After setpoints: the same free run, scored only in the window after each of the {eventCount} changes of {levers.join(", ")}, so it shows how the
            twin, running on its own, reacts to the intervention (window:{" "}
            <select className="field field--xs" value={window_} onChange={(e) => onWindow(Number(e.target.value))} aria-label="Window after a setpoint change">
              {WINDOWS.map((h) => (
                <option key={h} value={h}>
                  {h} steps · {durationLabel(h * stepSec)}
                </option>
              ))}
            </select>
            ), averaged.
          </>
        ) : (
          <>This data center names no setpoints (levers or actuators in its dataset.json), so there is no after-setpoints score.</>
        )}
      </p>
      {/* a wide table scrolls in its card, not the page */}
      <div className="fit-table-scroll">
        <table className="train-table train-table--pick">
          <thead>
            <tr>
              <th scope="col">Variable</th>
              {STRUCTS.map((st) => (
                <th key={st.id} scope="colgroup" className="train-table__group" colSpan={span}>
                  {st.label}
                </th>
              ))}
              <th scope="colgroup" className="train-table__group" colSpan={FIT_COLS.length + 1} title="The bold (overall best) model of the row, over the whole free run">
                Best · free run
              </th>
            </tr>
            <tr>
              <th />
              {STRUCTS.map((st) => [
                <th key={`${st.id}m`} scope="col" className="train-table__group">
                  Best
                </th>,
                <th key={`${st.id}1`} scope="col">
                  One step
                </th>,
                <th key={`${st.id}2`} scope="col">
                  Free run
                </th>,
                hasLevers && (
                  <th key={`${st.id}3`} scope="col">
                    After setpoints
                  </th>
                ),
              ])}
              {FIT_COLS.map(([k, hint], i) => (
                <th key={k} scope="col" title={hint} className={i === 0 ? "train-table__group" : undefined}>
                  {k}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {predicted.map((v) => {
              const { best, winner } = ranking[v];
              return (
                // the name a button (focus, Enter), the row's click handling both
                <tr key={v} className={v === picked ? "train-table__picked" : undefined} onClick={() => onPick(v)}>
                  <th scope="row">
                    <button type="button" className="train-approach-results__name" title="Pick it: its results, its equation, on the causal graph and the drawing">
                      {v}
                    </button>
                  </th>
                  {STRUCTS.map((st) => {
                    const c = best[st.id];
                    return c ? (
                      <Cells key={st.id} c={c} bold={winner?.def.structure === st.id} hasLevers={hasLevers} />
                    ) : (
                      <td key={st.id} className="train-table__group train-table__none" colSpan={span}>
                        not predicted (from data or no parents)
                      </td>
                    );
                  })}
                  <td className="train-table__group">{winner?.mae == null ? "–" : `${compact(winner.mae)}${units[v] ? ` ${units[v]}` : ""}`}</td>
                  <td>{pct(winner?.wape)}</td>
                  <td>{winner?.r2 == null ? "–" : fmt(winner.r2, 2)}</td>
                  <td>{winner?.mase == null ? "–" : fmt(winner.mase, 2)}</td>
                  <td>
                    {winner && dataset && (
                      <button
                        type="button"
                        className="btn btn--xs fit-inspect"
                        aria-label={`Inspect ${v} · ${winner.def.label}`}
                        title="Predicted vs measured, the residuals and the series over the test period"
                        onClick={() => setInspect({ v, name: winner.def.name })}
                      >
                        Inspect
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted train-card__foot">
        Bold = the structure that wins the free run for that variable; Best · free run: that model's other scores (hover a header), Inspect: its fit up close;
        a click on a row: its results and its equation.
        From data: {drivers.join(", ") || "none"}.
      </p>
      {inspect && dataset && (
        <FitDialog
          dataset={dataset.id}
          scope={scope}
          models={models}
          evalRes={evalRes}
          variable={inspect.v}
          initial={inspect.name}
          unit={units[inspect.v]}
          onClose={() => setInspect(null)}
        />
      )}
    </div>
  );
}
