/**
 * The modelling results of one variable, and of every variable of one approach, where they are looked for: what
 * Evaluate scored on the free run over the test period (MAE in the variable's unit, WAPE, R², MASE, nMAE), each model
 * with Inspect, its fit up close (FitDialog). PickedResults: every saved model of the variable picked (on the drawing,
 * the causal map or in the columns), the best marked, or why it has none. ApproachResults: under a column's settings,
 * the best model of that approach for each of its variables; a click on a name picks it.
 */
import { useMemo, useState } from "react";
import type { DatasetInfo, EvaluateResponse, StructureScope, TrainedModel } from "../../../api";
import { configOf } from "../../../dataset";
import { fmt } from "../../../lib/format";
import type { Kind, ModelDef } from "../../../lib/modelCatalog";
import { compact } from "../dashboard/dashboard";
import type { Approach } from "./approaches";
import { FitDialog } from "./FitDialog";
import { unitsOf } from "./fitPlot";
import { nmaeColor, pct } from "./format";
import { candidatesOf, type Candidate } from "./ranking";
import { FIT_COLS, KindTag } from "./ResultsCard";

/** What every results table here reads: the saved models, their evaluation, and Evaluate. */
export interface ResultsData {
  dataset: DatasetInfo;
  scope: StructureScope;
  shown: ModelDef[]; // the saved models, in the catalogue's order
  models: Record<string, TrainedModel>;
  evalRes: EvaluateResponse | null;
  evaluating: number;
  checking: boolean; // the stored evaluation still looked for: not "not evaluated" yet
  onEvaluate: () => void;
}

const NMAE_HINT = "Normalized MAE of the free run: MAE ÷ the mean absolute value of the variable (training rows), lower is better";

/** The free-run scores of one model of `v`, in FIT_COLS' order, then nMAE. */
function Scores({ c, unit }: { c: Candidate; unit?: string }) {
  return (
    <>
      <td>{c.mae == null ? "–" : `${compact(c.mae)}${unit ? ` ${unit}` : ""}`}</td>
      <td>{pct(c.wape)}</td>
      <td>{c.r2 == null ? "–" : fmt(c.r2, 3)}</td>
      <td>{c.mase == null ? "–" : fmt(c.mase, 2)}</td>
      <td style={{ color: nmaeColor(c.free) }}>{pct(c.free)}</td>
    </>
  );
}

/** The table's score headers, each with what it tells. */
const ScoreHeads = () => (
  <>
    {FIT_COLS.map(([k, hint]) => (
      <th key={k} scope="col" title={hint}>
        {k}
      </th>
    ))}
    <th scope="col" title={NMAE_HINT}>
      nMAE
    </th>
  </>
);

/** Inspect: one model's fit of `v` in a dialog. */
function Inspect({ r, v, c, unit }: { r: ResultsData; v: string; c: Candidate; unit?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn--xs fit-inspect"
        aria-label={`Inspect ${v} · ${c.def.label}`}
        title="Predicted vs measured, the residuals and the series over the test period"
        onClick={() => setOpen(true)}
      >
        Inspect
      </button>
      {open && (
        <FitDialog
          dataset={r.dataset.id}
          scope={r.scope}
          models={r.models}
          evalRes={r.evalRes}
          variable={v}
          initial={c.def.name}
          unit={unit}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Not evaluated yet: say so, with Evaluate (or that it is running). */
function NotEvaluated({ r }: { r: ResultsData }) {
  if (r.evalRes || !r.shown.length || r.checking) return null;
  return r.evaluating ? (
    <p role="status" className="muted train-results-note">
      <span className="train-spinner" aria-hidden="true" /> Evaluating on the test period…
    </p>
  ) : (
    <p className="muted train-results-note">
      Not evaluated yet: the free-run scores come from Evaluate.
      <button type="button" className="btn btn--primary btn--xs" onClick={r.onEvaluate}>
        Evaluate
      </button>
    </p>
  );
}

const useUnits = (dataset: DatasetInfo) => useMemo(() => unitsOf(configOf(dataset)), [dataset]);

/** The results of the variable picked: every saved model of it, the best first and marked, or why it has none. */
export function PickedResults({
  r,
  variable: v,
  approach,
  input,
  modelled,
}: {
  r: ResultsData;
  variable: string;
  approach: Approach | null | undefined; // null: calculated
  input: boolean; // taken from the data (no causes in the graph)
  modelled: string[]; // the data columns a model may predict (the calculated ones are not)
}) {
  const units = useUnits(r.dataset);
  const cands = useMemo(() => candidatesOf(r.shown, r.models, r.evalRes, v), [r.shown, r.models, r.evalRes, v]);
  const still = cands.length ? " The saved models below still predict it." : "";
  const note = !r.dataset.columns.includes(v)
    ? "No data: in the graph, but not a column of the data, so no model can learn it."
    : !modelled.includes(v)
      ? "Calculated from other variables (the HEX heat Q = ṁ·cₚ·ΔT), never a model of its own: it follows the models of its parts."
      : input && !cands.length
        ? "An input taken from the data (the graph gives it no causes): the models read it, they do not predict it."
        : approach === "off"
          ? `Not modelled: left out of the training.${still}`
          : approach === "profile"
            ? `Made by a profile (under Measurement or profile).${still}`
            : !cands.length
              ? "No saved model predicts it yet: tick the models under Data-driven and Train."
              : null;
  const evaluated = !!r.evalRes;
  const split = r.shown.map((d) => r.models[d.name]?.split_time).find(Boolean);
  return (
    <section className="card" aria-label={`Results of ${v}`}>
      <div className="train-picked__head">
        <span className="caps">
          Results · <span className="mono">{v}</span>
        </span>
        {cands.length > 0 && (
          <span className="muted train-picked__about">
            free run over the test period{split ? ` from ${split.slice(0, 10)}` : ""}, the best first (hover a header for its meaning)
          </span>
        )}
      </div>
      {note && <p className="muted train-results-note">{note}</p>}
      {cands.length > 0 && (
        <div className="fit-table-scroll">
          <table className="train-table">
            <thead>
              <tr>
                <th scope="col">Model</th>
                <ScoreHeads />
                <th />
              </tr>
            </thead>
            <tbody>
              {cands.map((c, i) => {
                const best = evaluated && i === 0 && c.free != null;
                return (
                  <tr key={c.def.name} className={best ? "train-picked__best" : undefined}>
                    <th scope="row">
                      <KindTag kind={c.def.kind} /> {c.def.label}
                      {best && <span className="train-picked__mark">best</span>}
                    </th>
                    <Scores c={c} unit={units[v]} />
                    <td>
                      <Inspect r={r} v={v} c={c} unit={units[v]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {cands.length > 0 && <NotEvaluated r={r} />}
    </section>
  );
}

/** Under a column's settings: each of its variables with the best of that approach's models (`kinds`) and its scores. */
export function ApproachResults({
  r,
  column,
  title,
  variables,
  kinds,
  onPick,
}: {
  r: ResultsData;
  column: string; // the column's name, for its label
  title: string;
  variables: string[];
  kinds: Kind[];
  onPick: (v: string) => void;
}) {
  const units = useUnits(r.dataset);
  const defs = useMemo(() => r.shown.filter((d) => kinds.includes(d.kind)), [r.shown, kinds]);
  const rows = useMemo(() => variables.map((v) => ({ v, c: candidatesOf(defs, r.models, r.evalRes, v)[0] ?? null })), [defs, r.models, r.evalRes, variables]);
  // no saved model of this approach: a row per variable would only say so again and again
  if (!variables.length || !defs.length) return null;
  return (
    <section className="train-approach-results" aria-label={`Results of the ${column} column`}>
      <div className="caps train-card__title">{title}</div>
      <div className="fit-table-scroll">
        <table className="train-table">
          <thead>
            <tr>
              <th scope="col">Variable</th>
              <th scope="col" className="train-table__group">
                Best model
              </th>
              <ScoreHeads />
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ v, c }) => (
              <tr key={v}>
                <th scope="row">
                  <button
                    type="button"
                    className="train-approach-results__name"
                    title="Pick it: its results, on the causal graph and the drawing"
                    onClick={() => onPick(v)}
                  >
                    {v}
                  </button>
                </th>
                {c ? (
                  <>
                    <td className="train-table__group">
                      <KindTag kind={c.def.kind} /> {c.def.label}
                    </td>
                    <Scores c={c} unit={units[v]} />
                    <td>
                      <Inspect r={r} v={v} c={c} unit={units[v]} />
                    </td>
                  </>
                ) : (
                  <td className="train-table__group train-table__none" colSpan={FIT_COLS.length + 3}>
                    no saved model of this approach predicts it
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <NotEvaluated r={r} />
    </section>
  );
}
