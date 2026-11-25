/**
 * The period the time series show (Explore › Time series): all the data, one year, or one month of a year, read in
 * local time as the charts' axis shows the timestamps. Pure: the page loads the columns, these pick and thin them.
 */

import type { SummaryKpi } from "../../../api";
import type { WhatIfKpi } from "./whatIf";

/** null year: all the data; null month: the whole year. month 0 = January. */
export interface SeriesPeriod {
  year: number | null;
  month: number | null;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MAX_SHOWN = 1500; // points per chart: a year of hourly data becomes 6-hour means, a month stays every row
export const FINE_ROWS = 200_000; // up to this many rows the columns are loaded in full; above, the summary's bin means

/** Every year from the first timestamp to the last (ISO, no zone). */
export function yearsOf(start: string | null, end: string | null): number[] {
  const a = start ? new Date(start).getFullYear() : NaN;
  const b = end ? new Date(end).getFullYear() : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

/** The months of a year that have data, from the series' timestamps (unix seconds). */
export function monthsWithData(times: number[], year: number): Set<number> {
  const out = new Set<number>();
  for (const t of times) {
    const d = new Date(t * 1000);
    if (d.getFullYear() === year) out.add(d.getMonth());
  }
  return out;
}

/** [from, to) in unix seconds; all the data: unbounded. */
export function rangeOf(p: SeriesPeriod): [number, number] {
  if (p.year == null) return [-Infinity, Infinity];
  const from = p.month == null ? new Date(p.year, 0, 1) : new Date(p.year, p.month, 1);
  const to = p.month == null ? new Date(p.year + 1, 0, 1) : new Date(p.year, p.month + 1, 1);
  return [from.getTime() / 1000, to.getTime() / 1000];
}

/** The points within the period, thinned to at most `max` means of consecutive points (gaps skipped in a mean). */
export function inPeriod(times: number[], values: (number | null)[], p: SeriesPeriod, max = MAX_SHOWN) {
  const [from, to] = rangeOf(p);
  let i0 = 0;
  while (i0 < times.length && times[i0] < from) i0++;
  let i1 = i0;
  while (i1 < times.length && times[i1] < to) i1++;
  const n = i1 - i0;
  const per = Math.max(1, Math.ceil(n / max));
  const xs: number[] = [];
  const ys: (number | null)[] = [];
  for (let i = i0; i < i1; i += per) {
    let sum = 0;
    let k = 0;
    for (let j = i; j < Math.min(i + per, i1); j++) {
      const v = values[j];
      if (v != null && Number.isFinite(v)) {
        sum += v;
        k++;
      }
    }
    xs.push(times[i]);
    ys.push(k ? sum / k : null);
  }
  return { xs, ys, rows: n, per, raw: values.slice(i0, i1) };
}

/** How many values (gaps left out) fall in each of `bins` equal bins from lo to hi; values beyond them are left out. */
export function countsIn(values: (number | null)[], lo: number, hi: number, bins: number): number[] {
  const out = new Array<number>(bins).fill(0);
  const w = (hi - lo) / bins;
  if (w > 0) for (const v of values) if (v != null && v >= lo && v <= hi) out[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
  return out;
}

/** How the period is said: "2023", "Mar 2023", "All years (2023–2024)". */
export const periodLabel = (p: SeriesPeriod, years: number[]) =>
  p.year == null
    ? `All years${years.length > 1 ? ` (${years[0]}–${years[years.length - 1]})` : ""}`
    : p.month == null
      ? String(p.year)
      : `${MONTHS[p.month]} ${p.year}`;

/** Each column's rows within the period, unthinned (for the KPIs of the period). */
export const periodRows = (times: number[], columns: Record<string, (number | null)[]>, p: SeriesPeriod) =>
  Object.fromEntries(Object.entries(columns).map(([c, v]) => [c, inPeriod(times, v, p, Infinity).raw]));

/** The share of the demand the reused heat covers step by step (heat beyond a step's demand covers nothing), over the
 * rows where both have a value (as backend core/summary.kpis). */
export function coverageOf(rows: Record<string, (number | null)[]>, heat: string[], demand: string): number | null {
  const d = rows[demand];
  if (!d || !heat.every((c) => rows[c])) return null;
  let reused = 0;
  let need = 0;
  for (let i = 0; i < d.length; i++) {
    const hs = heat.map((c) => rows[c][i]).filter((v): v is number => v != null && Number.isFinite(v));
    const di = d[i];
    if (!hs.length || di == null || !Number.isFinite(di)) continue;
    reused += Math.min(hs.reduce((a, b) => a + b, 0), di);
    need += di;
  }
  return need > 0 ? reused / need : null;
}

const SAME: Record<string, string> = { "IT energy, total": "IT energy", "Heat reused, total": "Heat reused" }; // summary label: whatIf kpisOf's

/** The data center's KPI tiles (the summary's, over the whole file) with the values of the period (whatIf kpisOf over its
 * rows) and the coverage in the heat note; a tile the period has no value for: null. */
export function periodKpis(tiles: SummaryKpi[], computed: WhatIfKpi[], coverage: number | null): SummaryKpi[] {
  return tiles.map((k) => {
    const c = computed.find((x) => x.label === (SAME[k.label] ?? k.label));
    const note = k.note.replace(/ · \d+ % of (.+) covered$/, (_, d) => (coverage == null ? "" : ` · ${Math.round(coverage * 100)} % of ${d} covered`));
    return { ...k, value: c ? c.value : null, note };
  });
}
