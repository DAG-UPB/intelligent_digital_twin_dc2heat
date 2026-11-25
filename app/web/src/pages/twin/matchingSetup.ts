/**
 * What Heat Matching last ran, for Operation to run on the same plant: the data center's heat at its extraction point
 * (from the model picked there), the district's demand as it makes it, the network's supply, the heat pump's COP and
 * its sizes, with what each comes from in words. Kept in this browser (localStorage `heat-matching`), one setup: the
 * last one Heat Matching computed. Values rounded to keep it small (a year of hours is a few hundred kB).
 */
import { carnotCop, type MatchOptions, type MatchResult, type PartSeries } from "../../lib/matching";
import { perMonth } from "../../lib/profile";
import type { DiagramProps } from "../heat/HeatFlowDiagram";

export interface MatchingSetup {
  dataset: string; // the data center's
  saved: number; // unix ms
  at: string; // the extraction point
  dcFrom: string; // in words: the data center's model
  demandFrom: string; // in words: where the district's demand comes from
  parts: { hex: boolean; hp: boolean; tank: boolean };
  hpKw: number;
  tankKwh: number;
  stepHours: number;
  times: number[];
  q: number[]; // kW
  usable?: number; // the share of q the extraction HEX recovers, what the heat pump's source gets (older setups: none)
  t: number[]; // °C at the extraction point
  demand: number[]; // kW
  supply: number | number[]; // °C
  cop: number[];
  opts?: MatchOptions; // the options its run had (Carnot share, tank loss, lag, approach), for the design options; older setups: none
  direct?: boolean[]; // the steps its direct HEX fed the network (no heat pump); older setups: none
  tOut?: number[]; // °C outdoors, as it ran (setups saved before 2026-11-17 have none)
  hum?: number[]; // relative humidity of the data (% or 0–1), where the data has it
  diagram?: DiagramProps; // Heat Matching's flow diagram as it drew it (its window), drawn small on Operation
  // its year as it showed it (the Site map's Quick analysis shows these As in Heat Matching): MWh, %, kW, MWh per month
  // its sums over the period it ran on, `hours` long (older setups: none, taken as a year)
  result?: { demandMwh: number; deliveredMwh: number; coveragePct: number; hpElecMwh: number; peakKw: number; hours?: number; months: { demand: number[]; recovered: number[] } };
}

/** One Heat Matching run, as the page has it: its first `n` steps are the period it ran on. */
export interface MatchingRun {
  dataset: string;
  saved: number; // unix ms
  at: string; // the extraction point
  dcFrom: string;
  demandFrom: string;
  parts: { hex?: boolean; hp?: boolean; tank?: boolean };
  opts: MatchOptions; // the options matchHeat ran with
  partSeries: PartSeries; // the parts' plant models per step ({} for the built-in formulas)
  stepHours: number;
  n: number;
  times: number[]; // unix s, the district's
  q: number[]; // kW, the heat offered
  tSrc: number[]; // °C at the extraction point
  demand: number[]; // kW
  supply: number | number[]; // °C
  res: MatchResult;
  outTemp: number[]; // °C, the weather it ran on ([] when none)
  humidity?: number[];
  diagram: DiagramProps | null;
}

/** The setup Operation runs on, from one Heat Matching run (pure; saveSetup keeps it). */
export function buildSetup(r: MatchingRun): MatchingSetup {
  const { n, opts, partSeries, parts, res, stepHours } = r;
  const tSrc = r.tSrc.slice(0, n);
  const supAt = (i: number) => (typeof r.supply === "number" ? r.supply : r.supply[i]);
  const peak = (v: number[]) => v.reduce((x, y) => Math.max(x, y), 0);
  const times = r.times.slice(0, n);
  const demand = r.demand.slice(0, n);
  return {
    dataset: r.dataset,
    saved: r.saved,
    at: r.at,
    dcFrom: r.dcFrom,
    demandFrom: r.demandFrom,
    parts: { hex: !!parts.hex, hp: !!parts.hp, tank: !!parts.tank },
    usable: opts.physics ? opts.hexEff : opts.eta, // as matchHeat gives the heat pump
    hpKw: parts.hp ? (partSeries.hpCap ? peak(partSeries.hpCap) : opts.hpCapacity) : 0,
    tankKwh: parts.tank ? (partSeries.tankKwh ? peak(partSeries.tankKwh) : opts.tankKwh) : 0,
    stepHours,
    times,
    q: r.q,
    t: tSrc,
    demand,
    supply: typeof r.supply === "number" ? r.supply : r.supply.slice(0, n),
    cop: partSeries.hpCop?.slice(0, n) ?? tSrc.map((x, i) => (opts.physics ? carnotCop(x, supAt(i), opts.carnotEff) : opts.fixedCop)),
    opts,
    // the steps its direct HEX ran (the source hot enough): Operation feeds them in directly too
    direct: parts.hex ? res.viaHp.map((v) => !v) : undefined,
    // the weather as it ran (the what-if shift in it): Operation's avoided data center cooling runs on it
    tOut: r.outTemp.length >= n ? r.outTemp.slice(0, n) : undefined,
    hum: r.humidity && r.humidity.length >= n ? r.humidity.slice(0, n) : undefined,
    diagram: r.diagram ?? undefined,
    result: {
      demandMwh: res.totals.demandMwh,
      deliveredMwh: res.totals.deliveredMwh,
      coveragePct: res.totals.coveragePct,
      hpElecMwh: res.totals.hpElecMwh,
      peakKw: demand.reduce((x, y) => Math.max(x, y), 0),
      hours: n * stepHours,
      months: {
        demand: perMonth(times, demand, stepHours).map((x) => x / 1000),
        recovered: perMonth(times, res.direct.map((d, i) => d + res.hp[i] + res.fromTank[i]), stepHours).map((x) => x / 1000),
      },
    },
  };
}

const KEY = "heat-matching";
const r1 = (v: number[]) => v.map((x) => Math.round(x * 10) / 10);

export function saveSetup(s: MatchingSetup) {
  const small = {
    ...s,
    hpKw: Math.round(s.hpKw),
    tankKwh: Math.round(s.tankKwh),
    q: r1(s.q),
    t: r1(s.t),
    demand: r1(s.demand),
    supply: Array.isArray(s.supply) ? r1(s.supply) : s.supply,
    cop: s.cop.map((x) => Math.round(x * 100) / 100),
    tOut: s.tOut && r1(s.tOut),
    hum: s.hum?.map((x) => Math.round(x * 1000) / 1000),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(small));
  } catch {
    // storage full or blocked: Operation then defines its own plant
  }
}

/** The last setup Heat Matching ran for this data center, or null. */
export function readSetup(dataset: string): MatchingSetup | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as MatchingSetup | null;
    return s && s.dataset === dataset && Array.isArray(s.q) && s.q.length ? s : null;
  } catch {
    return null;
  }
}
