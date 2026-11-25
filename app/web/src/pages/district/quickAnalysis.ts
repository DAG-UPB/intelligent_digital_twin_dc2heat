/**
 * The Site map's quick analysis: one typical year, hourly, of the data center's waste heat against the heat sinks'
 * demand, through Heat Matching's built-in formulas (lib/matching.ts matchHeat with its default options, the parts
 * switched on as on Heat Matching, the heat pump sized as the heat network's (hpSizing.ts: at most what the data center's
 * heat allows, under it by the sinks' demand)): the heat recovered, the demand covered, the CO₂ saved against gas (lib/partKpis.ts)
 * and the electricity needed. Each sink's demand is its own profile (lib/profilePresets.ts sinkParts, as its tooltip),
 * on the typical Frankfurt year's weather. With a second source (a waste heat source of the Plattform für Abwärme,
 * pfa.ts sourceYear) the data center goes first and that source covers what it leaves, hour by hour, through the same
 * formulas (direct when hot enough, else its own heat pump, as large as its heat allows, no tank of its own). Pure.
 */
import type { Site } from "../../api";
import { annualMwh, combineDemand, demandEntries, syntheticOutdoor, type DistrictSettings } from "../../lib/demand";
import { DEFAULT_OPTIONS, matchHeat, type MatchOptions } from "../../lib/matching";
import { defaultCurve, DESIGN_OUTDOOR, supplySeries } from "../../lib/networkTemps";
import { HOURS_PER_YEAR } from "../../lib/constants";
import { co2SavedT } from "../../lib/partKpis";
import { generate, perMonth, weightsOf, type ProfilePart } from "../../lib/profile";
import { sinkParts } from "../../lib/profilePresets";
import { asPartsOn, recoveryOf } from "../heat/parts";
import type { MatchingSetup } from "../twin/matchingSetup";
import { heatPumpKw, stationCapacity } from "./hpSizing";

const Y0 = Date.UTC(2025, 0, 1) / 1000; // the typical year (as the sinks' tooltips, sinkProfile.ts)
export const HOURS = HOURS_PER_YEAR;
export const YEAR_TIMES = Array.from({ length: HOURS }, (_, i) => Y0 + i * 3600);

/** The data center's waste heat over the typical year: kW and °C per hour, and its own electricity (kW) when known. */
export interface QuickDc {
  q: number[];
  t: number[];
  elecKw?: number[];
}

/** The data center of the map: its waste heat held flat all year. */
export const flatDc = (kw: number, tC: number): QuickDc => ({ q: new Array<number>(HOURS).fill(Math.max(0, kw)), t: new Array<number>(HOURS).fill(tC) });

/**
 * Values over any period (unix seconds, any step) as an hourly typical year: each hour of the year the mean of the
 * steps that fall in it (whatever their year; 29 February dropped), an hour without data its hour of day's mean.
 * `share`: the part of the year's hours that had data.
 */
export function toTypicalYear(times: number[], values: number[]): { kw: number[]; share: number } {
  const sum = new Array<number>(HOURS).fill(0);
  const cnt = new Array<number>(HOURS).fill(0);
  times.forEach((t, i) => {
    const v = values[i];
    if (!Number.isFinite(v)) return;
    const d = new Date(t * 1000);
    if (d.getUTCMonth() === 1 && d.getUTCDate() === 29) return;
    const h = (Date.UTC(2025, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()) / 1000 - Y0) / 3600;
    sum[h] += v;
    cnt[h]++;
  });
  const daySum = new Array<number>(24).fill(0);
  const dayCnt = new Array<number>(24).fill(0);
  let filled = 0;
  for (let h = 0; h < HOURS; h++)
    if (cnt[h]) {
      daySum[h % 24] += sum[h] / cnt[h];
      dayCnt[h % 24]++;
      filled++;
    }
  const kw = sum.map((s, h) => (cnt[h] ? s / cnt[h] : dayCnt[h % 24] ? daySum[h % 24] / dayCnt[h % 24] : 0));
  return { kw, share: filled / HOURS };
}

// kW over the typical year of 1 MWh a year shaped by one profile part: the sinks share few shapes (every Wärmeatlas
// building has the same heating and hot-water curves, only their split differs), so a new sink costs a sum, not a run
const shapes = new Map<string, number[]>();
function shapeOf(p: ProfilePart): number[] {
  const one = { ...p, label: "", share: 1 };
  const key = JSON.stringify(one);
  let kw = shapes.get(key);
  if (!kw) {
    if (shapes.size > 200) shapes.clear(); // ponytail: a crude bound; an LRU if many custom-drawn sinks show up
    const g = generate({ total: 1, unit: "MWh", per: "year", perUnit: false, units: 1, parts: [one] }, Y0, Y0 + HOURS * 3600, 1, syntheticOutdoor);
    kw = g.kw.map((x) => x * 1000); // MW -> kW
    shapes.set(key, kw);
  }
  return kw;
}

/** One sink's demand over the typical year, kW: its annual demand split by its profile's parts (as generate does). */
export function sinkKw(s: DistrictSettings): number[] {
  const parts = sinkParts(s);
  const shareSum = parts.reduce((a, p) => a + Math.max(0, p.share), 0) || 1;
  const out = new Array<number>(HOURS).fill(0);
  for (const p of parts) {
    const k = (annualMwh(s) * Math.max(0, p.share)) / shareSum;
    if (!k) continue;
    const shape = shapeOf(p);
    for (let i = 0; i < HOURS; i++) out[i] += k * shape[i];
  }
  return out;
}

// kW per MWh a year one profile part gives in the largest hour of a design day: the typical year's coldest day with
// the outdoor at DESIGN_OUTDOOR (−12 °C in Frankfurt, DIN EN 12831) all day and the three days before (BDEW's allocation
// temperature reads them), its weights scaled as on the typical year (lib/profile.ts weightsOf, as generate scales)
const designs = new Map<string, number>();
function designOf(p: ProfilePart): number {
  const one = { ...p, label: "", share: 1 };
  const key = JSON.stringify(one);
  let kw = designs.get(key);
  if (kw === undefined) {
    if (designs.size > 200) designs.clear(); // as shapes
    const year = weightsOf(one, YEAR_TIMES, yearOutdoor()).reduce((a, b) => a + b, 0);
    const out = yearOutdoor();
    let coldest = 0; // the day of the typical year with the lowest mean
    for (let d = 1, low = Infinity; d < 365; d++) {
      const mean = out.slice(d * 24, d * 24 + 24).reduce((a, b) => a + b, 0) / 24;
      if (mean < low) [low, coldest] = [mean, d];
    }
    const times = Array.from({ length: 96 }, (_, i) => YEAR_TIMES[coldest * 24] + (i - 72) * 3600);
    const w = weightsOf(one, times, times.map(() => DESIGN_OUTDOOR));
    kw = year > 0 ? (1000 * Math.max(...w.slice(72))) / year : 0;
    designs.set(key, kw);
  }
  return kw;
}

/** One sink's design peak, kW: its largest hour on a design day at DESIGN_OUTDOOR (designOf), at least its typical
 * year's largest hour (sinkKw). What the network's pipes, pumps and peak boiler are sized on (network.ts buildingsOf). */
export function designKw(s: DistrictSettings): number {
  const parts = sinkParts(s);
  const shareSum = parts.reduce((a, p) => a + Math.max(0, p.share), 0) || 1;
  const design = parts.reduce((a, p) => a + ((annualMwh(s) * Math.max(0, p.share)) / shareSum) * designOf(p), 0);
  return Math.max(design, sinkKw(s).reduce((a, b) => Math.max(a, b), 0));
}

/** The extraction exchanger passing all of the heat it is given: the heat given is already the heat used (the Data
 * center card's "heat used", a recovery HEX's output), not the heat ahead of it. */
export const RECOVERED = { hexEff: 1, eta: 1 } as const;

let outdoor: number[] | null = null;
/** The typical year's outdoor temperature, hourly: the weather the sinks' profiles are drawn on. */
export const yearOutdoor = () => (outdoor ??= syntheticOutdoor(YEAR_TIMES));

/** The network's supply over the typical year (°C per hour) for sinks that need `supplyC`/`returnC`: on Heat
 * Matching's heating curve at its defaults (lib/networkTemps.ts defaultCurve: the design supply at −12 °C outside and
 * below, sliding to 15 K less, at least 10 K above the return, at 15 °C and above). The site has no setting for it. */
export const yearSupply = (supplyC: number, returnC: number) => supplySeries(yearOutdoor(), HOURS, supplyC, defaultCurve(supplyC, returnC));

/** The heat pump's ceiling: the largest hour of what the source's heat allows at its COP (stationCapacity; with the
 * supply per hour it falls where the COP is lowest), `hexEff` of the heat reaching it. */
export function ceilingKw(dc: QuickDc, supplyC: number | number[], hexEff = 1): number {
  let top = 0;
  for (let i = 0; i < dc.q.length; i++) top = Math.max(top, stationCapacity(dc.q[i] * hexEff, dc.t[i], typeof supplyC === "number" ? supplyC : supplyC[i]).kw);
  return top;
}

/** Heat Matching's default options with the parts switched on there (site.json heat_parts), the heat pump sized as the
 * heat network's on the same page (hpSizing.ts): at most what the data center's heat allows at its COP (ceilingKw),
 * under it a share of the sinks' peak hour, raised until it gives a share of the year's heat; the tank holds an hour of
 * the smaller of it and the sinks' peak. The data center's heat is the heat used (RECOVERED): the exchanger's share is
 * not taken off it a second time, * unless `hexEff` says it is the heat ahead of the exchanger. */
export function quickOptions(site: Site, dc: QuickDc, demandKw: number[], supplyC: number | number[], hexEff: number = RECOVERED.hexEff): MatchOptions {
  const on = asPartsOn(site.heat_parts);
  const hpCapacity = heatPumpKw(demandKw, 0, ceilingKw(dc, supplyC, hexEff));
  // the tank: an hour of the smaller of the heat pump and the sinks' peak (it is kept full, so its standing loss grows
  // with its size: sized to the data center it swamped a small demand)
  const tankKwh = on.tank ? Math.min(hpCapacity, demandKw.reduce((a, b) => Math.max(a, b), 0)) : 0;
  return { ...DEFAULT_OPTIONS, ...RECOVERED, hexEff, recovery: recoveryOf(on), hpCapacity, tankKwh };
}

export interface Quick {
  demandMwh: number; // the sinks' demand over the year
  peakKw: number;
  recoveredMwh: number; // the heat delivered to them (heat exchanger + heat pump + tank)
  coveredPct: number;
  co2T: number; // saved against gas, minus the heat pump's grid electricity
  hpElecMwh: number;
  dcElecMwh: number | null; // the data center's own, when known
  wasteMwh: number; // the waste heat offered
  supply: number; // °C the network needs at its design (the hottest included sink); the year runs on the heating curve under it (yearSupply)
  ret: number | null; // null: not known (Heat Matching's stored year keeps only its supply)
  months: { demand: number[]; recovered: number[] }; // MWh per month, January first (both sources)
  extra: { recoveredMwh: number; hpElecMwh: number; wasteMwh: number; dcCoveredPct: number } | null; // the second source's part; dcCoveredPct: the data center alone
}

/** The quick analysis of the site's included heat sinks against `dc`; null without an included sink. `over` replaces
 * single options of quickOptions (its hexEff also sizes the heat pump). */
export function quickAnalysis(site: Site, dc: QuickDc, over: Partial<MatchOptions> = {}, extra?: QuickDc | null): Quick | null {
  const entries = site.sinks.length ? demandEntries(site) : []; // no sink: nothing selected (not the whole district)
  const { kw, hottest } = combineDemand(entries, (e) => sinkKw(e.settings), HOURS);
  if (!hottest) return null;
  const supply = yearSupply(hottest.supplyTemp, hottest.returnTemp); // hour by hour, on the heating curve
  const opts = { ...quickOptions(site, dc, kw, supply, over.hexEff), ...over };
  const r = matchHeat(dc.q, dc.t, kw, supply, opts, 1);
  const recovered = r.direct.map((d, i) => d + r.hp[i] + r.fromTank[i]);
  const T = r.totals;
  const mwh = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / 1000;
  // the second source on what the data center leaves: the same formulas, its own heat pump, no tank
  let more: Quick["extra"] = null;
  if (extra) {
    const left = kw.map((k, i) => Math.max(0, k - recovered[i]));
    // a reported waste heat potential is the heat ahead of an exchanger: its share comes off (Heat Matching's default)
    const { hexEff, eta } = DEFAULT_OPTIONS;
    const o2: MatchOptions = { ...opts, hexEff, eta, hpCapacity: ceilingKw(extra, supply, hexEff), tankKwh: 0 };
    const r2 = matchHeat(extra.q, extra.t, left, supply, o2, 1);
    r2.direct.forEach((d, i) => (recovered[i] += d + r2.hp[i] + r2.fromTank[i]));
    more = { recoveredMwh: r2.totals.deliveredMwh, hpElecMwh: r2.totals.hpElecMwh, wasteMwh: mwh(extra.q), dcCoveredPct: T.coveragePct };
  }
  const delivered = T.deliveredMwh + (more?.recoveredMwh ?? 0);
  const hpElec = T.hpElecMwh + (more?.hpElecMwh ?? 0);
  return {
    demandMwh: T.demandMwh,
    peakKw: kw.reduce((a, b) => Math.max(a, b), 0),
    recoveredMwh: delivered,
    coveredPct: T.demandMwh > 0 ? (100 * delivered) / T.demandMwh : 0,
    co2T: co2SavedT(delivered, hpElec),
    hpElecMwh: hpElec,
    dcElecMwh: dc.elecKw ? mwh(dc.elecKw) : null,
    wasteMwh: mwh(dc.q),
    supply: hottest.supplyTemp,
    ret: hottest.returnTemp,
    months: { demand: perMonth(YEAR_TIMES, kw, 1).map((x) => x / 1000), recovered: perMonth(YEAR_TIMES, recovered, 1).map((x) => x / 1000) },
    extra: more,
  };
}

/** Heat Matching's stored year (twin/matchingSetup.ts) as the quick analysis shows it "As in Heat Matching": every
 * figure from that one run (its models, period, heat pump and storage), its sums scaled from its period to a year, the
 * months too; the waste heat offered is its data center's, the supply its network's highest. `run` (the map's run on
 * the same data center) gives only the data center's own electricity. null: Heat Matching has not stored a year. */
export function fromMatching(run: Quick, s: Pick<MatchingSetup, "q" | "stepHours" | "supply" | "result">): Quick | null {
  const y = s.result;
  if (!y) return null;
  const hours = y.hours ?? s.q.length * s.stepHours;
  const perYear = hours > 0 ? HOURS / hours : 1;
  const [delivered, elec] = [y.deliveredMwh * perYear, y.hpElecMwh * perYear];
  return {
    demandMwh: y.demandMwh * perYear,
    peakKw: y.peakKw,
    recoveredMwh: delivered,
    coveredPct: y.coveragePct,
    co2T: co2SavedT(delivered, elec),
    hpElecMwh: elec,
    dcElecMwh: run.dcElecMwh,
    wasteMwh: (s.q.reduce((a, b) => a + Math.max(0, b), 0) * s.stepHours * perYear) / 1000,
    supply: typeof s.supply === "number" ? s.supply : s.supply.reduce((a, b) => Math.max(a, b), -Infinity),
    ret: null,
    months: { demand: y.months.demand.map((x) => x * perYear), recovered: y.months.recovered.map((x) => x * perYear) },
    extra: null,
  };
}
