/**
 * Pure geometry of the fit dialog (FitDialog.tsx): the measured / predicted pairs, an even downsample, histograms,
 * padded axis ranges, nice ticks; and the units a dataset config names for its variables.
 */
import type { DatasetConfig } from "../../../dataset";

// mirror backend/core/limits.py: TabPFN's free run covers its first 720 steps; simulate takes at most 20000 steps
export const TABPFN_FREE_STEPS = 720;
export const SIMULATE_MAX_STEPS = 20000;

/** The rows where the measured and the predicted value are both finite (a gap, null or NaN is skipped). */
export function finitePairs(measured: (number | null)[], predicted: (number | null)[]) {
  const out = { measured: [] as number[], predicted: [] as number[] };
  for (let i = 0; i < Math.min(measured.length, predicted.length); i++) {
    const y = measured[i];
    const p = predicted[i];
    if (y != null && p != null && Number.isFinite(y) && Number.isFinite(p)) {
      out.measured.push(y);
      out.predicted.push(p);
    }
  }
  return out;
}

/** At most `max` indices of 0..n−1, spread evenly over all of them (the first and the last included). */
export function evenly(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  if (max <= 1) return max === 1 ? [0] : [];
  return Array.from({ length: max }, (_, k) => Math.round((k * (n - 1)) / (max - 1)));
}

/** [lo, hi] of the values with `pad` of their span added on each side; one value (or none) gets ±1 around it (or 0). */
export function paddedRange(values: number[], pad = 0.05): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of values) {
    // a loop, not Math.min(...values): a year of 5-minute rows overflows the call stack
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  if (!Number.isFinite(lo)) return [-1, 1];
  if (hi === lo) return [lo - 1, hi + 1];
  const d = (hi - lo) * pad;
  return [lo - d, hi + d];
}

/** About `count` ticks at 1, 2 or 5 × 10^k inside [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  // a hair over hi: 3 × 0.1 is 0.30000000000000004, still the tick at 0.3; || 0: no "-0" tick
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) ticks.push(k * step || 0);
  return ticks;
}

/** How many values fall in each of `bins` equal bins over [lo, hi] (hi itself in the last bin; values outside are left out). */
export function histogram(values: number[], lo: number, hi: number, bins = 30): number[] {
  const counts = new Array<number>(bins).fill(0);
  const w = (hi - lo) / bins;
  if (!(w > 0)) return counts;
  for (const x of values) {
    if (x < lo || x > hi) continue;
    counts[Math.min(bins - 1, Math.floor((x - lo) / w))]++;
  }
  return counts;
}

/**
 * Units of the variables the dataset config knows: its heat points (q in kW, temperatures in °C, m in kg/s, as
 * dataset.ts HeatPoint) and the KPI power columns in their `power_unit`. Any other variable: no unit (unknown).
 */
export function unitsOf(config: DatasetConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of Object.values(config.heat_source ?? {})) {
    out[p.q] = "kW";
    for (const t of [p.t, p.t_in, p.t_out, p.t_return]) if (t) out[t] = "°C";
    if (p.m) out[p.m] = "kg/s";
  }
  const kpi = (config.kpi ?? {}) as { it_power?: string | null; cooling_power?: string | null; heat_demand?: string | null; power_unit?: string | null };
  if (kpi.power_unit) for (const c of [kpi.it_power, kpi.cooling_power, kpi.heat_demand]) if (c) out[c] = kpi.power_unit;
  return out;
}
