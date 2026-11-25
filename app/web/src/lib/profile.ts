/**
 * Profile generator: a fixed value becomes a curve. A total over a period, of any quantity (a district's heat demand
 * in kWh, a data center's waste heat in MWh, water in m³, ...), for everything at once or per unit times the number of
 * units, is spread over time by shapes keyed on the clock and the weather, so the period holds exactly the total:
 * hour of day, day of week, month, and optionally the outdoor temperature (below a heating limit, above a cooling
 * limit, a straight line in either direction, or a BDEW gas standard load profile). A profile may have several parts
 * (space heating and hot water), each with its share of the total. Any span can be shown (a day, a week, a year): it is a window onto the same
 * profile, scaled on the period of the total that contains its start. The time stamps are UTC; the hour shape and the
 * weekday are read on Frankfurt's clock (CET/CEST, lib/clock.ts), as people live by it, while the calendar (the days of
 * the daily mean temperature, months, periods) stays UTC, so a UTC year holds its total exactly. Pure: no React, no fetching.
 *
 * BDEW standard load profiles (gas): BDEW/VKU/GEODE Leitfaden "Abwicklung von Standardlastprofilen Gas", Stand
 * 27.03.2026 (SigLinDe profile function, section 3.4; allocation temperature, section 3.5.2): a day's energy is the
 * customer value x h(T) x the weekday factor, with
 *   h(T) = A / (1 + (B / (T - T0))^C) + D + max(mH T + bH, mW T + bW),  T0 = 40 °C,
 * T the allocation temperature (T_d + 0.5 T_d-1 + 0.25 T_d-2 + 0.125 T_d-3) / 1.875 of the daily means.
 *
 * A learned driver is a model learned from measured buildings (lib/learnedModels.ts: homes from Aalborg, offices and
 * public buildings from Helsinki): it gives each step's weight itself, from the local hour of week and the smoothed
 * outdoor temperature, so a flat hour shape keeps its measured day shape.
 */

import { localDate } from "./clock";
import { DEFAULT_PLACE, learnedKw, type LearnedModelId } from "./learnedModels";

export type Per = "day" | "week" | "month" | "year";

/** How the outdoor temperature drives a part's daily energy (none: the same every day). */
export type Driver =
  | { kind: "none" }
  | { kind: "below"; limit: number } // heating degree-days: max(0, limit - daily mean), this app's space-heating rule
  | { kind: "above"; limit: number } // cooling degree-days: max(0, daily mean - limit), warm days
  | { kind: "linear"; ref: number; slope: number } // 1 + slope (daily mean - ref), never below 0: more (slope > 0) or less per degree
  | { kind: "slp"; code: string; A: number; B: number; C: number; D: number; T0: number; mH: number; bH: number; mW: number; bW: number }
  | { kind: "learned"; model: LearnedModelId; lat?: number; lon?: number }; // a model learned from measured buildings (lib/learnedModels.ts): hour by hour, its own day shape

export interface ProfilePart {
  label: string;
  share: number; // of the total; the parts' shares are normalised
  hour: number[]; // relative, over the day (24 hourly or 48 half-hourly values; only the shape counts)
  weekday: number[]; // 7 factors, Monday first
  month: number[]; // 12 factors, January first
  driver: Driver;
}

export interface ProfileSpec {
  total: number; // over the period: for everything, or per unit when perUnit
  unit: string; // what the total is in (kWh, MWh, m³, ...); the curve is that per hour (rateUnit)
  per: Per;
  perUnit: boolean; // the total is per unit, times `units`
  units: number; // how many (houses, flats, offices, ...), when perUnit
  parts: ProfilePart[];
}

/** The whole total over the period: per unit times the units, or the total itself. */
export const totalOf = (s: ProfileSpec) => (s.perUnit ? s.units * s.total : s.total);

/** What the curve is in: kWh -> kW, MWh -> MW, Wh -> W, anything else per hour. */
export const rateUnit = (unit: string) => ({ Wh: "W", kWh: "kW", MWh: "MW", GWh: "GW" })[unit] ?? `${unit}/h`;

const DAY = 86400;
const flat = (n: number) => Array.from({ length: n }, () => 1);
export const FLAT = { hour: flat(24), weekday: flat(7), month: flat(12) };

/** The BDEW SigLinDe profile function h(T). */
export function slpH(d: Extract<Driver, { kind: "slp" }>, t: number): number {
  const sigmoid = d.A / (1 + (d.B / (t - d.T0)) ** d.C) + d.D;
  return sigmoid + Math.max(d.mH * t + d.bH, d.mW * t + d.bW);
}

const dayOf = (t: number) => Math.floor(t / DAY);

/** Daily mean temperature of each step's (UTC) day, and the allocation temperature (geometric series of that day
 * and the three before it; days before the first known one are left out and the weights renormalised). */
export function dailyTemperatures(times: number[], temps: number[]): { mean: number[]; allocation: number[] } {
  const sum = new Map<number, [number, number]>();
  times.forEach((t, i) => {
    if (!Number.isFinite(temps[i])) return;
    const s = sum.get(dayOf(t)) ?? [0, 0];
    sum.set(dayOf(t), [s[0] + temps[i], s[1] + 1]);
  });
  const meanOf = (d: number) => {
    const s = sum.get(d);
    return s ? s[0] / s[1] : undefined;
  };
  const alloc = (d: number) => {
    let [v, w] = [0, 0];
    [1, 0.5, 0.25, 0.125].forEach((g, k) => {
      const m = meanOf(d - k);
      if (m !== undefined) [v, w] = [v + g * m, w + g];
    });
    return w ? v / w : NaN;
  };
  return { mean: times.map((t) => meanOf(dayOf(t)) ?? NaN), allocation: times.map((t) => alloc(dayOf(t))) };
}

/** The factor a driver gives a day (its daily mean and allocation temperature). */
function dayFactor(driver: Driver, mean: number, allocation: number): number {
  if (driver.kind === "below") return Math.max(0, driver.limit - mean);
  if (driver.kind === "above") return Math.max(0, mean - driver.limit);
  if (driver.kind === "linear") return Math.max(0, 1 + driver.slope * (mean - driver.ref));
  if (driver.kind === "slp") return Math.max(0, slpH(driver, allocation));
  return 1;
}

/** Relative weight of each step for one part: the driver's daily factor spread by the hour shape (its mean kept at
 * 1, so the day's energy follows the driver), times the weekday and month factors. A learned driver gives each
 * step's own weight instead of the day's. */
export function weightsOf(part: ProfilePart, times: number[], temps: number[]): number[] {
  const { mean, allocation } = dailyTemperatures(times, temps);
  const n = part.hour.length;
  const hourMean = part.hour.reduce((a, b) => a + b, 0) / n || 1;
  const driver = part.driver;
  // the learned model weighs each step itself (its own day shape); the rules weigh the day
  const model =
    driver.kind === "learned" ? learnedKw(driver.model, times, temps, { lat: driver.lat ?? DEFAULT_PLACE.lat, lon: driver.lon ?? DEFAULT_PLACE.lon }) : null;
  return times.map((t, i) => {
    const d = localDate(t); // Frankfurt's clock in its getUTC* fields: the hour and weekday people live by
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    const weekday = (d.getUTCDay() + 6) % 7; // Monday 0
    const h = part.hour[Math.floor((hour * n) / 24) % n] / hourMean;
    return (model ? model[i] : dayFactor(part.driver, mean[i], allocation[i])) * h * part.weekday[weekday] * part.month[new Date(t * 1000).getUTCMonth()];
  });
}

/** The period of `per` that contains `t` (UTC; a week starts on Monday): [from, to) in unix seconds. */
export function periodOf(per: Per, t: number): { from: number; to: number } {
  const d = new Date(t * 1000);
  const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
  const at = (yy: number, mm: number, dd: number) => Date.UTC(yy, mm, dd) / 1000;
  if (per === "day") return { from: at(y, m, day), to: at(y, m, day + 1) };
  if (per === "week") {
    const monday = day - ((d.getUTCDay() + 6) % 7);
    return { from: at(y, m, monday), to: at(y, m, monday + 7) };
  }
  if (per === "month") return { from: at(y, m, 1), to: at(y, m + 1, 1) };
  return { from: at(y, 0, 1), to: at(y + 1, 0, 1) };
}

/** Step start times from `from` (included) to `to` (excluded). */
export const stepsBetween = (from: number, to: number, stepHours: number) =>
  Array.from({ length: Math.max(0, Math.round((to - from) / (stepHours * 3600))) }, (_, i) => from + i * stepHours * 3600);

export interface Generated {
  times: number[];
  kw: number[]; // per step of the shown span: the total's unit per hour (rateUnit)
  parts: number[][]; // each part's
  period: { from: number; to: number }; // where the total is met
  periodKwh: number; // what the profile gives over it (= totalOf(spec), unless a part has no weight there)
  matched: boolean;
}

/**
 * The profile over [from, to), per step in the total's unit per hour, scaled so that the period of `spec.per`
 * containing `from` holds totalOf(spec), split by the parts' shares. `temperature` gives the outdoor temperature at given times.
 */
export function generate(spec: ProfileSpec, from: number, to: number, stepHours: number, temperature: (times: number[]) => number[]): Generated {
  const period = periodOf(spec.per, from);
  const lo = Math.min(period.from, from);
  const hi = Math.max(period.to, to);
  const all = stepsBetween(lo, hi, stepHours);
  const temps = temperature(all);
  const inPeriod = all.map((t) => t >= period.from && t < period.to);
  const shown = all.map((t) => t >= from && t < to);
  const shareSum = spec.parts.reduce((a, p) => a + Math.max(0, p.share), 0) || 1;
  let matched = true;
  const parts = spec.parts.map((p) => {
    const w = weightsOf(p, all, temps);
    const energy = w.reduce((a, x, i) => a + (inPeriod[i] ? x * stepHours : 0), 0); // relative kWh over the period
    const target = (totalOf(spec) * Math.max(0, p.share)) / shareSum;
    if (target > 0 && energy <= 0) matched = false; // e.g. heating on a summer day: nothing to spread it over
    const k = energy > 0 ? target / energy : 0;
    return w.map((x) => x * k);
  });
  const kwAll = all.map((_, i) => parts.reduce((a, p) => a + p[i], 0));
  const periodKwh = kwAll.reduce((a, x, i) => a + (inPeriod[i] ? x * stepHours : 0), 0);
  const pick = <T>(xs: T[]) => xs.filter((_, i) => shown[i]);
  return { times: pick(all), kw: pick(kwAll), parts: parts.map(pick), period, periodKwh, matched };
}

/**
 * Month factors that give the months the energies `wanted` where the run gave `got` (a month drawn on its result):
 * each changed month's factor is scaled by wanted / got. A month that gave nothing (heating in summer) cannot be
 * raised this way and keeps its factor.
 */
export const monthsFor = (factors: number[], got: number[], wanted: number[]) =>
  factors.map((f, i) => (wanted[i] !== got[i] && got[i] > 0 ? (f * Math.max(0, wanted[i])) / got[i] : f));

/** What each calendar month of a run holds (rate x step), January first: the seasons at a glance. */
export function perMonth(times: number[], values: number[], stepHours: number): number[] {
  const out = Array.from({ length: 12 }, () => 0);
  times.forEach((t, i) => (out[new Date(t * 1000).getUTCMonth()] += values[i] * stepHours));
  return out;
}

/** Days in a period of each kind, on average: what an average day of the total is. */
const DAYS: Record<Per, number> = { day: 1, week: 7, month: 365.25 / 12, year: 365.25 };

/** A part's share of the whole total. */
const partTotal = (s: ProfileSpec, i: number) => {
  const sum = s.parts.reduce((a, p) => a + Math.max(0, p.share), 0) || 1;
  return (totalOf(s) * Math.max(0, s.parts[i].share)) / sum;
};

/** Part i's average day over the total's period, per point of its hour shape: its rate (the unit per hour). */
export function averageDay(s: ProfileSpec, i: number): number[] {
  const hour = s.parts[i].hour;
  const mean = hour.reduce((a, b) => a + b, 0) / hour.length || 1;
  const perHour = partTotal(s, i) / DAYS[s.per] / 24;
  return hour.map((h) => (perHour * h) / mean);
}

/** The profile with part i's average day drawn as `day` (rates per point): its hour shape, and the total (and the
 * parts' shares) follow the drawn height, so the other parts keep their energy. */
export function withAverageDay(s: ProfileSpec, i: number, day: number[]): ProfileSpec {
  const drawn = (day.reduce((a, b) => a + Math.max(0, b), 0) / day.length) * 24 * DAYS[s.per]; // the part's new total
  const energies = s.parts.map((_, j) => (j === i ? drawn : partTotal(s, j)));
  const total = energies.reduce((a, b) => a + b, 0);
  const parts = s.parts.map((p, j) => ({
    ...p,
    share: total > 0 ? energies[j] / total : p.share,
    ...(j === i ? { hour: day.map((v) => Math.max(0, v)) } : {}),
  }));
  return { ...s, parts, total: s.perUnit && s.units > 0 ? total / s.units : total };
}

/** kW per unit per hour of a total's unit (a MWh total gives MW). */
export const KW_PER: Record<string, number> = { Wh: 0.001, kWh: 1, MWh: 1000, GWh: 1e6 };

/**
 * The profile in kW over given steps (`times`, unix seconds, `outTemp` their outdoor temperature): the generator's curve
 * from the first step on. A day, week or month total is the average such period (the year holds total x periods a
 * year): scaled on the one period around the first step, a run starting in summer would get no heating all year.
 * The total is met over the year around the first step, the steps' weather where it is known and `typical` (e.g. the
 * typical year) before and after them.
 */
export function profileKw(spec: ProfileSpec, times: number[], outTemp: number[], stepHours: number, typical: (times: number[]) => number[]): number[] {
  const n = times.length;
  if (!n) return [];
  const t0 = times[0];
  const dt = stepHours * 3600;
  // the curve is made on an even grid over the steps' span and each step takes its own grid point: a gap in the
  // timestamps does not shift what follows (a step's index is not its time)
  const slot = (t: number) => Math.round((t - t0) / dt);
  const at = new Map(times.map((t, i) => [slot(t), i]));
  const temperature = (ts: number[]) => {
    const fill = typical(ts);
    return ts.map((t, k) => {
      const i = at.get(slot(t));
      return i !== undefined && Number.isFinite(outTemp[i]) ? outTemp[i] : fill[k];
    });
  };
  const yearly = spec.per === "year" ? spec : { ...spec, per: "year" as const, total: (spec.total * DAYS.year) / DAYS[spec.per] }; // total (per unit) scaled: totalOf keeps units
  const g = generate(yearly, t0, times[n - 1] + dt, stepHours, temperature);
  const k = KW_PER[spec.unit] ?? 1;
  return times.map((t) => (g.kw[slot(t)] ?? 0) * k);
}
