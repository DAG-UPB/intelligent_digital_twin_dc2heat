/**
 * Test-period simulation logic without React: horizons offered, intervention rows -> request, and dates -> steps.
 *
 * Time zones: the data's timestamps (and the model's split_time) are wall-clock times without a zone, and the
 * date / datetime-local inputs give wall-clock times too. Both are read as UTC here so that a date maps to the
 * same step in every browser (parsing split_time as local time but a bare date as UTC put interventions off by
 * the browser's UTC offset).
 */
import type { Intervention, TrainedModel } from "../../../../api";
import { MAX_STEPS, durationLabel } from "../../../../lib/period";

/** Horizons offered (seconds), as steps of the data's resolution; plus the whole test period. */
const SPANS = [3600, 6 * 3600, 86400, 7 * 86400, 30 * 86400, 91 * 86400];

/** An intervention as typed: value and dates are the raw input strings. */
export interface Row {
  variable: string;
  kind: Intervention["kind"];
  value: string;
  from: string; // yyyy-mm-dd or yyyy-mm-ddThh:mm, blank = horizon start
  to: string; // blank = horizon end
}

/** Steps in the test period at the data's own resolution, at most MAX_STEPS. */
export const wholeSteps = (m: TrainedModel): number => Math.max(1, Math.min(MAX_STEPS, m.rows - m.split_index));

/** The horizons that fit (at least 2 steps, shorter than the test period), then the whole test period (steps 0). */
export function horizonsFor(stepSec: number, whole: number): { label: string; steps: number }[] {
  return [
    ...SPANS.map((sec) => ({ label: durationLabel(sec), steps: Math.round(sec / stepSec) })).filter((h) => h.steps >= 2 && h.steps < whole),
    { label: `Whole test period · ${durationLabel(whole * stepSec)}${whole === MAX_STEPS ? " (capped)" : ""}`, steps: 0 },
  ];
}

/** A test period of about a year or more is called a "Year" simulation. */
export const isYear = (whole: number, stepSec: number) => whole * stepSec >= 360 * 86400;

/** Milliseconds of a wall-clock time ("2023-07-01", "2023-07-01T06:00", "2023-07-01 06:00:00", any zone suffix ignored). */
export function wallClockMs(s: string): number {
  const t = s.replace(" ", "T").slice(0, 19);
  return Date.parse(`${t.length === 10 ? `${t}T00:00` : t}Z`);
}

/** The step (from the split) a date input falls on; null when there is no date or no split time. */
export function toStep(date: string, splitTime: string | null, stepSec: number): number | null {
  if (!date || !splitTime) return null;
  return Math.max(0, Math.round((wallClockMs(date) - wallClockMs(splitTime)) / (stepSec * 1000)));
}

/** The rows as simulate interventions; rows with an empty or non-numeric value are left out. */
export function interventionsOf(rows: Row[], splitTime: string | null, stepSec: number): Intervention[] {
  return rows
    .filter((r) => r.variable && r.value.trim() !== "" && !isNaN(Number(r.value)))
    .map((r) => ({ variable: r.variable, kind: r.kind, value: Number(r.value), start: toStep(r.from, splitTime, stepSec) ?? 0, end: toStep(r.to, splitTime, stepSec) }));
}

/** Plotted by default: up to 3 of the plottable variables, the heat variables first. */
export const defaultColumns = (heat: string[], plottable: string[]): string[] => [...new Set([...heat.filter((c) => plottable.includes(c)), ...plottable])].slice(0, 3);

/** The mean of the finite values: a gap (null in the JSON, or NaN) is left out, not counted as 0; 0 when there are none. */
export function mean(xs: (number | null)[]) {
  const ok = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return ok.reduce((a, b) => a + b, 0) / Math.max(ok.length, 1);
}
