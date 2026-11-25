/**
 * The Heat distribution card's view of the plan, pure: which heat sinks the plan leaves out and why (they are hidden
 * on the map while the network is shown), the water's speed and a building's heat as the map's steps (CSS animates
 * them: the steps keep a running animation from jumping at every hour), the time presets and an hour's label.
 */
import { cetOffsetHours } from "../../lib/clock";
import { MONTHS } from "../datacenter/dashboard/seriesPeriod";
import type { HeatNetwork, NetworkBuilding } from "./network";
import type { NetworkHours } from "./networkCost";
import { HOURS, YEAR_TIMES } from "./quickAnalysis";

/** Why a heat sink is not supplied. */
export type Why = "far" | "street" | "reach" | "demand" | "density" | "share" | "peak";

/** Each heat sink the plan does not supply and why: not reached (too far from a street, or its street not joined to the
 * network's), no heat demand (or left out of the district), on a branch below the minimum heat density (`loose`: the
 * same plan without that rule supplies it), else beyond what the data center's heat covers at the target share (or,
 * with `fullPeak`, beyond the heat pump at the design peak).
 * ponytail: the density/share split re-plans without the density rule (a branch both rules cut counts as density). */
export function notSupplied(sinkIds: string[], buildings: NetworkBuilding[], net: HeatNetwork, loose: HeatNetwork | null, fullPeak: boolean): Map<string, Why> {
  const chosen = new Set(net.chosen);
  const unreached = new Map(net.unreached.map((u) => [u.id, u.reason]));
  const wanted = new Set(buildings.filter((b) => b.annualMwh > 0).map((b) => b.id));
  const looseChosen = new Set(loose?.chosen ?? []);
  const out = new Map<string, Why>();
  for (const id of sinkIds) {
    if (chosen.has(id)) continue;
    const r = unreached.get(id);
    out.set(
      id,
      r != null
        ? /from the nearest street/.test(r)
          ? "far"
          : /from the station/.test(r)
            ? "reach"
            : "street"
        : !wanted.has(id)
          ? "demand"
          : looseChosen.has(id)
            ? "density"
            : fullPeak
              ? "peak"
              : "share",
    );
  }
  return out;
}

/** The water's speed (m/s) as the map's flow steps: 0 still (no water moving), then faster up to 6 (≥ 1.2 m/s). */
export const FLOW_STEPS = [0.002, 0.1, 0.25, 0.5, 0.8, 1.2];
export const flowStep = (v: number) => FLOW_STEPS.filter((s) => v >= s).length;

/** A building's heat now against `topKw` (a large building's peak hour) in six steps, on a square-root scale (the
 * small buildings show too): 0 none, 1..5 by fifths, 5 from topKw up. */
export const heatStep = (kw: number, topKw: number) => (topKw <= 0 || kw <= 0.01 * topKw ? 0 : Math.min(5, 1 + Math.floor(5 * Math.sqrt(kw / topKw))));

const wrap = (h: number) => ((h % HOURS) + HOURS) % HOURS;
/** Hour h of the typical year (UTC, as YEAR_TIMES) counted on Frankfurt's clock from 1 January 00:00 there: the
 * demand's profiles follow that clock (lib/clock.ts), so the view's days and hours do too. */
const localHour = (h: number) => wrap(h + cetOffsetHours(YEAR_TIMES[wrap(h)]));
/** Hour h of the typical year as day of the year (0..364) and hour of the day (0..23), on Frankfurt's clock. */
export const dayOf = (h: number) => Math.floor(localHour(h) / 24);
export const hourOf = (h: number) => localHour(h) % 24;
/** The hour of the typical year at `hour` o'clock in Frankfurt on day `day` (wrapped round the year): the inverse of
 * dayOf/hourOf. On the clock changes: the 02:00 that spring skips is 03:00 (the next hour there is, so a play steps on),
 * the 02:00 autumn repeats the first of the two (summer time). */
export const atHour = (day: number, hour: number) => {
  const local = wrap(day * 24 + hour);
  const summer = wrap(local - 2);
  return localHour(summer) === local ? summer : wrap(local - 1);
};

/** "15 Jan" for day d of the typical year. */
export function dayLabel(d: number): string {
  const t = new Date(YEAR_TIMES[wrap(d * 24)] * 1000); // the day's own date (its hours counted as UTC)
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
}
/** "15 Jan, 18:00" for hour h of the typical year, Frankfurt's clock. */
export const hourLabel = (h: number) => `${dayLabel(dayOf(h))}, ${String(hourOf(h)).padStart(2, "0")}:00`;
/** The month (0 = January) of day d. */
export const monthOf = (d: number) => new Date(YEAR_TIMES[wrap(d * 24)] * 1000).getUTCMonth();
/** The 15th of month m as a day of the typical year. */
export const midMonth = (m: number) => Math.floor((Date.UTC(2025, m, 15) / 1000 - YEAR_TIMES[0]) / 86400);

/** The hours the card's presets jump to: the coldest day's evening, the warmest day's noon. */
export function presetsOf(x: NetworkHours) {
  return { winterEvening: x.winter.first + 18, summerNoon: x.summer.first + 12 };
}
