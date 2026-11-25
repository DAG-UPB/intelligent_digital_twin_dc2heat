/** Trained models (train, list, load, simulate, evaluate) and the physics equations they can use. */
import { getJson, postJson, putJson, query, scoped, type StructureScope } from "./http";

export interface ModelInput {
  parent: string;
  lag: number;
  coef: number;
  std?: number; // spread of the input; |coef| x std ranks equation terms
}

export interface VariableFit {
  intercept: number;
  inputs: ModelInput[];
  sigma: number;
  r2_train: number | null;
  r2_test: number | null;
  nmae_test?: number | null;
  scale?: number;
  equation?: string; // physics: right-hand side, coefficients by name
  params?: Record<string, number>;
  min: number;
  max: number;
  mean: number;
}

export type ModelKind = "linear" | "xgboost" | "physics" | "symbolic" | "tabpfn";

export interface TrainedModel {
  name: string;
  file: string;
  graph_file: string;
  order: string[];
  drivers: string[];
  requested_drivers?: string[]; // what was ticked; `drivers` is only those the graph uses
  structure?: "graph" | "all";
  max_lag_setting?: number;
  variables_used?: string[];
  kind?: ModelKind;
  variables: Record<string, VariableFit>;
  max_lag: number;
  split_index: number;
  split_time: string | null;
  rows: number;
}

export interface TrainRequest {
  name?: string;
  file?: string;
  graph_file?: string;
  drivers?: string[];
  split_fraction?: number;
  structure?: "graph" | "all";
  max_lag?: number;
  variables?: string[];
  model?: ModelKind;
  equations?: Record<string, string>;
}

export interface Intervention {
  variable: string;
  kind: "set" | "shift" | "scale";
  value: number;
  start?: number;
  end?: number | null;
}

export interface Band {
  p05: number[];
  p50: number[];
  p95: number[];
}

interface SimulateRequest {
  start: number;
  steps: number;
  columns?: string[];
  interventions?: Intervention[];
  n_draws?: number;
  baseline?: boolean;
  drivers?: Record<string, number[]>; // driver series put in from the start on (other weather, another demand)
}

export interface SimulateResponse {
  start: number;
  steps: number;
  time: string[];
  actual: Record<string, number[]>;
  // number[] for a single deterministic run, Band when n_draws > 1
  scenario: Record<string, number[] | Band>;
  baseline?: Record<string, number[] | Band>;
}

export interface EvaluateResponse {
  models: Record<
    string,
    {
      free_r2: Record<string, number | null>;
      free_nmae: Record<string, number | null>;
      // free run too (older servers lack them): MAE in the variable's unit, WAPE = Σ|e| / Σ|y|, MASE vs. the value a day earlier
      free_mae?: Record<string, number | null>;
      free_wape?: Record<string, number | null>;
      free_mase?: Record<string, number | null>;
      r2_test: Record<string, number | null>;
      nmae_test: Record<string, number | null>;
      structure: string;
      kind: string;
    }
  >;
  events: {
    lever: string;
    start: number;
    from: number;
    to: number;
    steps: number;
    time: string[];
    actual: Record<string, number[]>;
    pred: Record<string, Record<string, number[]>>;
    rmse: Record<string, Record<string, number>>;
    nmae: Record<string, Record<string, number | null>>;
  }[];
}

export type EquationCheck = { ok: true; uses: string[]; coefficients: string[] } | { ok: false; error: string };

/** Names of the models saved for a dataset. */
export const listModels = async (datasetId: string, scope?: StructureScope): Promise<string[]> =>
  (await getJson<{ models: string[] }>(`/api/datasets/${datasetId}/models${query(scoped(scope))}`, "Failed to list models")).models;

export const getModel = (datasetId: string, name: string, scope?: StructureScope) =>
  getJson<TrainedModel>(`/api/datasets/${datasetId}/models/${name}${query(scoped(scope))}`, "Model not found");

/** What a training request would fit and roughly how long it takes (backend core/twin/estimate.py); nothing is trained. */
export interface TrainEstimate {
  models: number;
  inputs: number;
  rows: number;
  train_rows: number;
  seconds: number;
  low: number;
  high: number;
  variables: { variable: string; inputs: number }[];
}

export const estimateTraining = (datasetId: string, body: TrainRequest, scope?: StructureScope) =>
  postJson<TrainEstimate>(`/api/datasets/${datasetId}/models/estimate${query(scoped(scope))}`, body, "Estimate failed");

export const trainModel = (datasetId: string, body: TrainRequest, scope?: StructureScope) =>
  postJson<TrainedModel>(`/api/datasets/${datasetId}/models/train${query(scoped(scope))}`, body, "Training failed");

// a simulation asked again while it runs (a page's parts, an input that changed back) shares the one request
const running = new Map<string, Promise<SimulateResponse>>();

export const simulateModel = (datasetId: string, name: string, body: SimulateRequest, scope?: StructureScope) => {
  const url = `/api/datasets/${datasetId}/models/${name}/simulate${query(scoped(scope))}`;
  const key = `${url}\n${JSON.stringify(body)}`;
  const run = running.get(key) ?? postJson<SimulateResponse>(url, body, "Simulation failed").finally(() => running.delete(key));
  running.set(key, run);
  return run;
};

/** Compare trained models on the test data: free run, and after each setpoint change; `store`: also saved beside the
 * models (fetchStoredEvaluation). */
export const evaluateModels = (datasetId: string, body: { names: string[]; levers?: string[]; horizon?: number; store?: boolean }, scope?: StructureScope) =>
  postJson<EvaluateResponse>(`/api/datasets/${datasetId}/models/evaluate${query(scoped(scope))}`, body, "Evaluation failed");

/** An evaluation stored beside the models, with what it scored (its content hashes are checked by the server). */
export type StoredEvaluation = EvaluateResponse & { names: string[]; levers: string[]; horizon: number };

/** The last evaluation stored, or null: none stored, or a model it scored changed since. */
export const fetchStoredEvaluation = (datasetId: string, scope?: StructureScope) =>
  getJson<StoredEvaluation | null>(`/api/datasets/${datasetId}/models/evaluation${query(scoped(scope))}`, "Failed to load the stored evaluation");

/** Physics equations (gray box): you write the form, the data fits the coefficients. */
export const getEquations = async (datasetId: string, scope?: StructureScope): Promise<Record<string, string>> =>
  (await getJson<{ equations: Record<string, string> }>(`/api/datasets/${datasetId}/equations${query(scoped(scope))}`, "Failed to load equations")).equations;

export const saveEquations = async (datasetId: string, equations: Record<string, string>, scope?: StructureScope): Promise<void> => {
  await putJson(`/api/datasets/${datasetId}/equations${query(scoped(scope))}`, equations, "Failed to save equations");
};

export const checkEquation = (datasetId: string, target: string, expr: string) =>
  postJson<EquationCheck>(`/api/datasets/${datasetId}/equations/check`, { target, expr }, "Check failed");

/** Roll models over one period the same way (day-ahead or free), with and without interventions (core/rolling.py). */
export interface CompareRequest {
  column: string;
  models: string[]; // trained models' names, and/or "chronos-2"
  mode: "day_ahead" | "free";
  start?: number;
  steps?: number;
  interventions?: Intervention[];
}
export interface CompareRun {
  model: string;
  base?: number[];
  intervened?: number[];
  scores?: { mae_pct: number | null; energy_mwh: number; corr: number | null };
  change_pct?: number | null;
  note?: string;
  error?: string;
}
export interface CompareResponse {
  column: string;
  mode: CompareRequest["mode"];
  start: number;
  steps: number;
  time: string[];
  measured: (number | null)[];
  measured_mwh: number;
  runs: CompareRun[];
}
export const compareModels = (datasetId: string, body: CompareRequest, scope?: StructureScope) =>
  postJson<CompareResponse>(`/api/datasets/${datasetId}/models/compare${query(scoped(scope))}`, body, "Comparison failed");
