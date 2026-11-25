/**
 * Operation (Intelligent Digital Twin): design options of the heat distribution, each run through the same heat
 * matching (lib/matching.ts) over the same period, and what that run says about how the option operates.
 * Pure: no React, no fetching; the page loads the data like Heat distribution does.
 */
import { DEFAULT_OPTIONS, type MatchOptions, type MatchResult } from "../../lib/matching";
import { mwh } from "../../lib/period";
import { recoveryOf } from "../heat/parts";

/** One design option: which parts exist and how big they are. */
export interface Variant {
  id: number; // stable React key while names are edited
  name: string;
  hex: boolean; // direct heat exchanger
  hp: boolean; // heat pump
  hpMw: number; // heat pump thermal capacity
  tankKwh: number; // 0 = no storage
}

/** A spread from no heat pump to a large one with storage, so the first view already shows a trade-off. */
export const DEFAULT_VARIANTS: Variant[] = [
  { id: 1, name: "HEX only", hex: true, hp: false, hpMw: 0, tankKwh: 0 },
  { id: 2, name: "HP 1 MW", hex: true, hp: true, hpMw: 1, tankKwh: 500 },
  { id: 3, name: "HP 2 MW + storage", hex: true, hp: true, hpMw: 2, tankKwh: 2000 },
  { id: 4, name: "HP 5 MW + storage", hex: true, hp: true, hpMw: 5, tankKwh: 2000 },
];

/** The matching's options for a variant: `base` (the options Heat Matching ran with: its Carnot share, tank loss, lag,
 * approach; else Heat distribution's defaults) with the variant's parts and sizes. `usable`: the share of q the
 * extraction HEX passes as Heat Matching ran it (1 when q is already the recovered heat), so the HEX is not counted a
 * second time; else the base's. */
export const optionsOf = (v: Variant, usable?: number, base: MatchOptions = DEFAULT_OPTIONS): MatchOptions => ({
  ...base,
  ...(usable !== undefined && { hexEff: usable, eta: usable }),
  recovery: recoveryOf({ hex: v.hex, hp: v.hp, tank: v.tankKwh > 0 }),
  hpCapacity: v.hpMw * 1000,
  tankKwh: Math.max(0, v.tankKwh),
});

/** The share of the data center's heat q the heat pump's source gets: as Heat Matching ran it (`setup`); else 1 where q
 * is already what the extraction HEX passes (a heat source of the dataset's own, `recovered`: Heat Matching's rule), so
 * the HEX is not counted a second time; else the defaults'. */
export const usableOf = (setup: number | undefined, recovered: boolean) =>
  setup ?? (recovered ? 1 : DEFAULT_OPTIONS.physics ? DEFAULT_OPTIONS.hexEff : DEFAULT_OPTIONS.eta);

/** The comparison's key figures of one run. */
export interface KpiRow {
  deliveredMwh: number;
  coveragePct: number;
  hpElecMwh: number;
  spf: number; // heat pump heat / electricity over the period: the energy-weighted mean COP; 0 without heat pump
  unusedMwh: number; // data-center heat available but not drawn
}

/** Key figures of a run; `q` is the data center's heat (kW) the run was given. */
export function kpiOf(r: MatchResult, q: number[], stepHours: number): KpiRow {
  const avail = mwh(
    q.slice(0, r.drawn.length).map((x) => Math.max(0, x)),
    stepHours,
  );
  const T = r.totals;
  return {
    deliveredMwh: T.deliveredMwh,
    coveragePct: T.coveragePct,
    hpElecMwh: T.hpElecMwh,
    spf: T.spf,
    unusedMwh: Math.max(0, avail - mwh(r.drawn, stepHours)),
  };
}

/** The best row: the highest coverage, and on a tie the one needing less heat pump electricity; -1 when empty. */
export function bestOf(rows: KpiRow[]): number {
  let best = -1;
  rows.forEach((k, i) => {
    const b = rows[best];
    if (!b || k.coveragePct > b.coveragePct + 1e-9 || (Math.abs(k.coveragePct - b.coveragePct) <= 1e-9 && k.hpElecMwh < b.hpElecMwh)) best = i;
  });
  return best;
}

/** How a variant runs over the period. */
export interface Operation {
  hours: number;
  hpHours: number; // hours the heat pump produced heat
  hpLoadPct: number | null; // mean output / capacity while running; null without capacity or running hours
  directHours: number; // hours the direct HEX delivered
  tankFullHours: number | null; // null without storage
  tankEmptyHours: number | null;
  peakUnmetKw: number;
}

/** Operation of a variant from its run (no second computation: the run's per-step series). */
export function operationOf(r: MatchResult, v: Variant, stepHours: number): Operation {
  const cap = optionsOf(v);
  let hp = 0,
    load = 0,
    direct = 0,
    full = 0,
    empty = 0,
    peak = 0;
  for (let i = 0; i < r.unmet.length; i++) {
    const out = r.viaHp[i] ? r.hp[i] + r.charge[i] : 0; // the heat pump's output, also what it put into the tank
    if (out > 1e-9) {
      hp++;
      load += cap.hpCapacity > 0 ? out / cap.hpCapacity : 0;
    }
    if (r.direct[i] > 1e-9) direct++;
    // a small tolerance: the level is a float sum of charges and losses
    if (r.tankLevel[i] >= cap.tankKwh * (1 - 1e-6)) full++;
    if (r.tankLevel[i] <= cap.tankKwh * 1e-6) empty++;
    peak = Math.max(peak, r.unmet[i]);
  }
  const tank = cap.tankKwh > 0;
  return {
    hours: r.unmet.length * stepHours,
    hpHours: hp * stepHours,
    hpLoadPct: hp && cap.hpCapacity > 0 ? (100 * load) / hp : null,
    directHours: direct * stepHours,
    tankFullHours: tank ? full * stepHours : null,
    tankEmptyHours: tank ? empty * stepHours : null,
    peakUnmetKw: peak,
  };
}
