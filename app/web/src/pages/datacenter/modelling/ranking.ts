/**
 * Which trained model is best for each predicted variable: per structure (causal graph, all vs all) and overall.
 * Score = free-run nMAE, else one-step nMAE, else none (Infinity); lower wins, and a free-run score always before none.
 */
import type { EvaluateResponse, TrainedModel } from "../../../api";
import { STRUCTS, type ModelDef, type Structure } from "../../../lib/modelCatalog";

/** One model's scores for one variable. */
export interface Candidate {
  def: ModelDef;
  one: number | null; // one-step nMAE on the test period
  free: number | null; // free-run nMAE on the test period
  after: number | null; // mean free-run nMAE in the windows after setpoint changes
  // the free run's other scores (null: not evaluated, or a server without them)
  mae: number | null; // in the variable's own unit
  wape: number | null; // Σ|y − ŷ| / Σ|y|
  r2: number | null;
  mase: number | null; // MAE / MAE of the value one day earlier (training rows); < 1 beats it
}

export interface VariableRanking {
  best: Record<Structure, Candidate | null>;
  winner: Candidate | null;
}

const score = (c: Candidate) => c.free ?? c.one ?? Infinity;
// a model without a free-run score (its free run failed, or none was evaluated) after every one with it: its one-step
// error is smaller by nature and would win against the others' free runs
const byScore = (a: Candidate, b: Candidate) => Number(a.free == null) - Number(b.free == null) || score(a) - score(b);
const lowest = (cs: Candidate[]) => [...cs].sort(byScore)[0] ?? null;

/** Mean nMAE of a model's prediction of `v` over the setpoint events that scored it (null when none did). */
export function meanNmae(events: EvaluateResponse["events"], name: string, v: string) {
  const xs = events.map((e) => e.nmae?.[name]?.[v]).filter((x): x is number => x != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Every one of the `shown` models that predicts `v`, with its scores, the best first (the Results of one variable). */
export function candidatesOf(shown: ModelDef[], models: Record<string, TrainedModel>, evalRes: EvaluateResponse | null, v: string): Candidate[] {
  return shown
    .filter((d) => models[d.name]?.variables[v])
    .map((def) => {
      const e = evalRes?.models[def.name];
      return {
        def,
        one: e?.nmae_test[v] ?? models[def.name].variables[v].nmae_test ?? null,
        free: e?.free_nmae[v] ?? null,
        after: meanNmae(evalRes?.events ?? [], def.name, v),
        mae: e?.free_mae?.[v] ?? null,
        wape: e?.free_wape?.[v] ?? null,
        r2: e?.free_r2[v] ?? null,
        mase: e?.free_mase?.[v] ?? null,
      };
    })
    .sort(byScore);
}

/** The best of the `shown` models of one structure that predict `v`. */
export function bestOf(shown: ModelDef[], models: Record<string, TrainedModel>, evalRes: EvaluateResponse | null, structure: Structure, v: string) {
  const ofIt = shown.filter((d) => d.structure === structure);
  return candidatesOf(ofIt, models, evalRes, v)[0] ?? null;
}

/** Best model per structure and overall, for every variable (computed once per evaluation, not per render). */
export function rankVariables(shown: ModelDef[], models: Record<string, TrainedModel>, evalRes: EvaluateResponse | null, vars: string[]) {
  const out: Record<string, VariableRanking> = {};
  for (const v of vars) {
    const best = Object.fromEntries(STRUCTS.map((st) => [st.id, bestOf(shown, models, evalRes, st.id, v)])) as Record<Structure, Candidate | null>;
    out[v] = { best, winner: lowest(Object.values(best).filter((c): c is Candidate => !!c)) };
  }
  return out;
}
