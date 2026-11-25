/** What-if logic without React: the re-train request, the predictions revealed so far, and their alignment on a chart's time axis. */
import type { SimulateResponse, TrainedModel, TrainRequest } from "../../../../api";
import { MODEL_NAME } from "../../../../lib/modelCatalog";

/** What the user set up: variables to intervene on, constant overrides, and how many steps to simulate. */
export interface WhatIfConfig {
  futureKnownVars: string[];
  overrides: Record<string, number>;
  steps: number;
}

/** One simulation from the playhead: predicted series and the intervened drivers, per variable. */
export interface WhatIfResult {
  time: string[];
  predictions: Record<string, number[]>;
  future_known: Record<string, number[]>;
  steps: number;
}

/** A predicted series drawn over a chart (unix seconds). */
export interface PredictionOverlay {
  timestamps: number[];
  values: number[];
}

/** The saved model's train split, rounded to the 0.01 the AI modelling slider uses (0.5 without a model). */
export const splitOf = (model: TrainedModel | null | undefined): number => (model ? Math.round((model.split_index / model.rows) * 100) / 100 : 0.5);

/**
 * The request that re-trains the 'linear' model with a new split and otherwise the settings it was trained with
 * on the AI modelling page (graph, variables, drivers, structure, max lag, kind, data file). Settings an older
 * saved model lacks are left out, so the backend uses its defaults for them.
 */
export function retrainRequest(model: TrainedModel | null | undefined, file: string | null, split: number): TrainRequest {
  return {
    name: MODEL_NAME,
    file: model?.file ?? file ?? undefined,
    split_fraction: split,
    graph_file: model?.graph_file,
    drivers: model?.requested_drivers ?? model?.drivers,
    structure: model?.structure,
    max_lag: model?.max_lag_setting,
    variables: model?.variables_used,
    model: model?.kind,
  };
}

/** The simulated series to show: every predicted variable, plus the intervened variables the model takes as inputs. */
export function whatIfResultOf(res: SimulateResponse, model: TrainedModel, futureKnownVars: string[]): WhatIfResult {
  const pick = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, res.scenario[c] as number[]]));
  return { time: res.time, predictions: pick(model.order), future_known: pick(futureKnownVars.filter((c) => model.drivers.includes(c))), steps: res.steps };
}

/** The first `step` points of every simulated series, as chart overlays. */
export function overlaysOf(r: WhatIfResult, step: number): Record<string, PredictionOverlay> {
  const timestamps = r.time.slice(0, step).map((t) => new Date(t).getTime() / 1000);
  return Object.fromEntries(Object.entries({ ...r.predictions, ...r.future_known }).map(([col, values]) => [col, { timestamps, values: values.slice(0, step) }]));
}

/** The overlay on the chart's own time axis: its value where a timestamp matches exactly, a gap (null) elsewhere. */
export function alignPrediction(timestamps: number[], overlay: PredictionOverlay): (number | null)[] {
  const at = new Map(overlay.timestamps.map((t, i) => [t, overlay.values[i]]));
  return timestamps.map((t) => at.get(t) ?? null);
}
