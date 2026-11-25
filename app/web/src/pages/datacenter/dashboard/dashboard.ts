/** Pure helpers of the Dashboard: number formatting, table sorting, correlation colours and variable ordering. */
import { HOURS_PER_YEAR } from "../../../lib/constants";
import { fmt, fmtUpTo, LOCALE } from "../../../lib/format";
import type { VariableSummary } from "../../../api";

const SIG4 = new Intl.NumberFormat(LOCALE, { maximumSignificantDigits: 4 });
const WHOLE = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumSignificantDigits: 4 });

/**
 * A table number, short: 4 significant digits below 1000 ("0.01235", "25.72"), whole numbers up to 10 million
 * ("1.005", "17.472"), then compact ("12,35 Mio."). No "K" suffix: next to temperatures it reads as kelvin.
 */
export function compact(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "–";
  const a = Math.abs(x);
  return (a >= 1e7 ? COMPACT : a >= 1000 ? WHOLE : SIG4).format(x);
}

/** A duration in hours as the largest fitting unit ("2,0 years", "36 days", "5,5 h", "15 min"). */
export function duration(hours: number): string {
  if (hours >= 360 * 24) return `${fmt(hours / HOURS_PER_YEAR, 1)} years`;
  if (hours >= 48) return `${Math.round(hours / 24)} days`;
  if (hours >= 1) return `${fmtUpTo(hours, 1)} h`;
  return `${fmtUpTo(hours * 60, 1)} min`;
}

/** A step length in seconds ("1 h", "5 min", "60 s", "2,5 min"). */
export function resolution(seconds: number | null): string {
  if (seconds == null) return "–";
  if (seconds >= 3600) return `${fmtUpTo(seconds / 3600, 2)} h`;
  if (seconds >= 60) return `${fmtUpTo(seconds / 60, 2)} min`;
  return `${fmtUpTo(seconds, 2)} s`;
}

export type SortKey = "name" | "count" | "missing" | "mean" | "std" | "min" | "p25" | "median" | "p75" | "max";

/** The variables sorted by one column; empty values (null) always last. `dir` 1 ascending, -1 descending. */
export function sortVariables(vars: VariableSummary[], key: SortKey, dir: 1 | -1): VariableSummary[] {
  return [...vars].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    return dir * (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number));
  });
}

/**
 * Fill of a correlation cell on the diverging scale: -1 blue, 0 neutral grey, +1 red (CSS tokens, so it follows the
 * theme). null (a constant column: no correlation) is the empty surface.
 */
export function corrFill(r: number | null): string {
  if (r == null) return "var(--surface-2)";
  const pole = r < 0 ? "var(--corr-neg)" : "var(--corr-pos)";
  return `color-mix(in oklab, ${pole} ${Math.round(Math.min(1, Math.abs(r)) * 100)}%, var(--corr-mid))`;
}

/** Text on a correlation cell: light ink on the strong colours, the normal text colour elsewhere. */
export const corrInk = (r: number | null) => (r != null && Math.abs(r) >= 0.6 ? "var(--corr-ink-strong)" : "var(--foreground)");

/**
 * Indices of the variables so that strongly correlated ones sit next to each other: start at the variable with the
 * largest total |r|, then always step to the nearest one left (distance 1 - |r|; no correlation counts as 1).
 * ponytail: greedy nearest neighbour, not a full hierarchical clustering; good enough to make blocks visible.
 */
export function similarityOrder(matrix: (number | null)[][]): number[] {
  const n = matrix.length;
  const d = (i: number, j: number) => 1 - Math.abs(matrix[i][j] ?? 0);
  const total = (i: number) => matrix[i].reduce((s: number, r, j) => s + (i === j ? 0 : Math.abs(r ?? 0)), 0);
  const left = new Set(Array.from({ length: n }, (_, i) => i));
  const order: number[] = [];
  let at = n ? [...left].reduce((best, i) => (total(i) > total(best) ? i : best), 0) : -1;
  while (at >= 0) {
    order.push(at);
    left.delete(at);
    const from = at;
    at = [...left].reduce((best, i) => (best < 0 || d(from, i) < d(from, best) ? i : best), -1);
  }
  return order;
}

/** The variables the time-series chart starts with: the first `n` that vary (a constant column says nothing). */
export const defaultShown = (vars: VariableSummary[], n = 4) => vars.filter((v) => v.count > 1 && (v.std ?? 0) > 0).slice(0, n).map((v) => v.name);

/** ISO timestamps (no zone) as unix seconds for uPlot, read as local time so the axis shows them as written. */
export const unixSeconds = (iso: string[]) => iso.map((t) => new Date(t).getTime() / 1000);
