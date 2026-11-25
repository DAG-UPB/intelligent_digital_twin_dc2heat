/** The training-time estimate shown before Train: the definitions summed, and the time in words. Pure: estimate.test.ts. */
import type { TrainEstimate } from "../../../api";
import { fmt } from "../../../lib/format";
import type { ModelDef } from "../../../lib/modelCatalog";

export interface TrainingEstimate {
  models: number; // variable models over all definitions
  seconds: number;
  low: number;
  high: number;
  parts: { label: string; models: number; seconds: number }[];
  problems: string[]; // definitions that would fail (e.g. TabPFN with too many inputs)
}

export function sumEstimates(each: { def: ModelDef; e: TrainEstimate | null; error: string | null }[]): TrainingEstimate {
  const ok = each.filter((x) => x.e);
  const add = (k: "models" | "seconds" | "low" | "high") => ok.reduce((t, x) => t + x.e![k], 0);
  return {
    models: add("models"),
    seconds: add("seconds"),
    low: add("low"),
    high: add("high"),
    parts: ok.map((x) => ({ label: x.def.label, models: x.e!.models, seconds: x.e!.seconds })).sort((a, b) => b.seconds - a.seconds),
    problems: each.filter((x) => x.error).map((x) => `${x.def.label}: ${x.error}`),
  };
}

/** "under a second", "40 s", "3 min", "1,5 h". */
export function duration(seconds: number): string {
  if (seconds < 1) return "under a second";
  if (seconds < 59.5) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${fmt(seconds / 3600, 1)} h`;
}

/** The line under the Train button. */
export function estimateText(e: TrainingEstimate): string {
  const range = duration(e.low) === duration(e.high) ? "" : ` (${duration(e.low)} – ${duration(e.high)})`;
  return `${e.models} variable model${e.models === 1 ? "" : "s"} · about ${duration(e.seconds)}${range}`;
}
