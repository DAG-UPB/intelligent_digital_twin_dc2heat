/**
 * The zoomed window of Heat distribution (a week, a day on short data, or the whole period) and the mean
 * flows over it that the diagram draws. Pure: no React, no fetching.
 */
import type { MatchResult } from "../../lib/matching";

export type WindowKind = "week" | "day" | "period";

/** Steps a..b (b exclusive) of window `index` of `count`, each `kind` long. */
export interface Window {
  kind: WindowKind;
  index: number; // clamped to 0..count-1
  count: number;
  a: number;
  b: number;
}

const DAY = 86400;

/** Window `index` over n steps of `stepHours`: weeks on more than 14 days of data, days on more than 2, else the whole period. */
export function windowOf(n: number, stepHours: number, index: number): Window {
  const span = n * stepHours * 3600;
  const kind: WindowKind = span > 14 * DAY ? "week" : span > 2 * DAY ? "day" : "period";
  const per = kind === "period" ? Math.max(1, n) : Math.max(1, Math.round((kind === "week" ? 7 * DAY : DAY) / (stepHours * 3600)));
  const count = Math.max(1, Math.floor(n / per));
  const i = Math.max(0, Math.min(index, count - 1));
  return { kind, index: i, count, a: i * per, b: Math.min(n, i * per + per) };
}

/** The window (0..count-1) whose steps hold time t (unix s), on steps from xs[0] every `step` s, `per` steps each:
 * the year picker's click and the assistant's set_window by date. */
export function windowAt(t: number, x0: number, step: number, per: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.floor((t - x0) / step / per)));
}

/** Mean of xs[a..b) (missing values count as 0; an empty range divides by 1). */
export function meanOver(xs: number[], a: number, b: number): number {
  let s = 0;
  for (let i = a; i < b; i++) s += xs[i] ?? 0;
  return s / Math.max(1, b - a);
}

/** Mean flows (kW) of the window, from the data center through recovery and storage to the district. */
export interface Flows {
  srcQ: number; // kW available (scaled)
  srcT: number; // °C
  toHex: number; // kW of source heat into the direct HEX
  toHp: number; // kW of source heat into the heat pump
  hexOut: number; // kW direct HEX → district
  hpOut: number; // kW heat pump → district
  hexTank: number; // kW direct HEX → tank
  hpTank: number; // kW heat pump → tank
  tankOut: number; // kW tank → district
  elec: number; // kW electricity into the heat pump
  cop: number; // mean COP of the heat-pump steps
  level: number; // kWh mean tank level
  demand: number; // kW
  coverage: number; // %
}

/** The window's mean flows of a matching result for source heat q at temperature t against the demand. */
export function windowFlows(res: MatchResult, q: number[], t: number[], demand: number[], a: number, b: number): Flows {
  const h = Math.max(1, b - a);
  let hexTank = 0, hpTank = 0, hpSteps = 0, copSum = 0;
  for (let i = a; i < b; i++) {
    if (res.viaHp[i]) {
      hpTank += res.charge[i];
      if (res.hp[i] + res.charge[i] > 0) {
        hpSteps++;
        copSum += res.cop[i];
      }
    } else hexTank += res.charge[i];
  }
  const hexOut = meanOver(res.direct, a, b);
  const hpOut = meanOver(res.hp, a, b);
  const elec = meanOver(res.hpElec, a, b);
  const tankOut = meanOver(res.fromTank, a, b);
  const d = meanOver(demand, a, b);
  return {
    srcQ: meanOver(q, a, b),
    srcT: meanOver(t, a, b),
    toHex: hexOut + hexTank / h,
    toHp: Math.max(0, hpOut + hpTank / h - elec),
    hexOut,
    hpOut,
    hexTank: hexTank / h,
    hpTank: hpTank / h,
    tankOut,
    elec,
    cop: hpSteps ? copSum / hpSteps : 0,
    level: meanOver(res.tankLevel, a, b),
    demand: d,
    coverage: d ? (100 * (hexOut + hpOut + tankOut)) / d : 100,
  };
}

/** A timestamp (unix s, UTC) as "20 Aug", with the time of day on data shorter than 3 days, on the browser's clock as the
 * charts (`timeZone` another); "" when missing. */
export function dateOf(s: number | undefined, spanSec: number, timeZone?: string): string {
  if (!s) return "";
  const time: Intl.DateTimeFormatOptions = spanSec < 3 * DAY ? { hour: "2-digit", minute: "2-digit" } : {};
  return new Date(s * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", timeZone, ...time });
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The ISO week (1..53) of a timestamp (unix s, UTC): the week with its Thursday in the year, from Monday. */
export function isoWeek(s: number): number {
  const d = new Date(s * 1000);
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  return Math.floor((thursday - Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1)) / (7 * DAY * 1000)) + 1;
}

/** When a window is, from its first and last step (unix s): "week 3 · Mon–Sun", one day "Mon · week 3"; "" when missing. */
export function whenOf(first: number | undefined, last: number | undefined): string {
  if (!first || !last) return "";
  const [w0, w1] = [isoWeek(first), isoWeek(last)];
  const week = w0 === w1 ? `week ${w0}` : `week ${w0}–${w1}`;
  const [d0, d1] = [WEEKDAY[new Date(first * 1000).getUTCDay()], WEEKDAY[new Date(last * 1000).getUTCDay()]];
  return last - first < DAY ? `${d0} · ${week}` : `${week} · ${d0}–${d1}`;
}
