import { expect, test } from "vitest";
import type { HeatPoint, Site } from "../../api";
import { DEFAULT_DISTRICT } from "../../lib/demand";
import { co2SavedT } from "../../lib/partKpis";
import { heatPumpKw, stationCapacity } from "./hpSizing";
import { ceilingKw, flatDc, fromMatching, HOURS, quickAnalysis, quickOptions, sinkKw, toTypicalYear, yearSupply } from "./quickAnalysis";

const sink = (id: string, demand: HeatPoint["demand"]): HeatPoint => ({
  id,
  name: id,
  lat: 0,
  lon: 0,
  temp_c: 70,
  power_kw: 0,
  outline: null,
  area: false,
  demand,
});
const site = (sinks: HeatPoint[], extra: Partial<Site> = {}): Site => ({ building: null, source: null, sinks, ...extra });

test("a sink's year holds its annual demand", () => {
  const kw = sinkKw({ ...DEFAULT_DISTRICT, houses: 1, kwhPerHouse: 120_000, dhwShare: 0.25 });
  expect(kw).toHaveLength(HOURS);
  expect(kw.reduce((a, b) => a + b, 0) / 1000).toBeCloseTo(120, 3);
  expect(kw[0]).toBeGreaterThan(kw[24 * 190]); // January above July: heating
});

test("quick analysis: recovered, covered, CO₂ and electricity add up; no sink, no analysis", () => {
  const s = site([sink("a", { houses: 1, kwhPerHouse: 200_000 }), sink("b", { houses: 1, kwhPerHouse: 100_000, included: false })]);
  expect(quickAnalysis(site([]), flatDc(40, 35))).toBeNull();
  const t0 = performance.now();
  const q = quickAnalysis(s, flatDc(40, 35))!;
  expect(performance.now() - t0).toBeLessThan(500); // the first run builds the shapes; later ones are faster still
  expect(q.demandMwh).toBeCloseTo(200, 3); // the excluded sink does not count
  expect(q.wasteMwh).toBeCloseTo(40 * 8.76, 6);
  expect(q.recoveredMwh).toBeGreaterThan(0);
  expect(q.recoveredMwh).toBeLessThanOrEqual(q.demandMwh + 1e-9);
  expect(q.coveredPct).toBeCloseTo((100 * q.recoveredMwh) / q.demandMwh, 6);
  expect(q.hpElecMwh).toBeGreaterThan(0); // 35 °C into a 70 °C network: only the heat pump
  expect(q.co2T).toBeCloseTo(co2SavedT(q.recoveredMwh, q.hpElecMwh), 9);
  expect(q.dcElecMwh).toBeNull();
  expect(q.months.demand.reduce((a, b) => a + b, 0)).toBeCloseTo(q.demandMwh, 6);
  expect(q.months.recovered.reduce((a, b) => a + b, 0)).toBeCloseTo(q.recoveredMwh, 1); // the tank's last content stays in it
  const t1 = performance.now();
  quickAnalysis(s, flatDc(80, 35));
  expect(performance.now() - t1).toBeLessThan(100);
});

test("a hot enough source runs the direct heat exchanger: no electricity; the parts switched off recover nothing", () => {
  const s = site([sink("a", { houses: 1, kwhPerHouse: 200_000, supplyTemp: 60 })]);
  const q = quickAnalysis(s, flatDc(500, 75))!;
  expect(q.hpElecMwh).toBe(0);
  expect(q.coveredPct).toBeGreaterThan(99);
  expect(quickAnalysis({ ...s, heat_parts: { hex: false, hp: false, tank: false } }, flatDc(500, 75))!.recoveredMwh).toBe(0);
});

test("the data center's heat is the heat used: a hot source short of the demand gives all of it, not 90 % (the exchanger once)", () => {
  const s = site([sink("a", { houses: 1, kwhPerHouse: 200_000_000, supplyTemp: 60 })]); // 200 GWh a year: more than 500 kW every hour
  const q = quickAnalysis(s, flatDc(500, 75))!;
  expect(q.recoveredMwh).toBeCloseTo((500 * HOURS) / 1000, 6);
});

test("a period becomes a typical year: hours by their date, the rest the mean day", () => {
  const t0 = Date.UTC(2023, 5, 1) / 1000;
  const times = Array.from({ length: 48 * 12 }, (_, i) => t0 + i * 300); // two days at 5 min
  const v = times.map((t) => (new Date(t * 1000).getUTCHours() < 12 ? 10 : 30));
  const y = toTypicalYear(times, v);
  expect(y.kw).toHaveLength(HOURS);
  expect(y.share).toBeCloseTo(48 / HOURS, 9);
  expect(y.kw[0]).toBe(10); // 1 January 00 h: from the mean day
  expect(y.kw[13]).toBe(30);
  expect(y.kw.reduce((a, b) => a + b, 0) / HOURS).toBeCloseTo(20, 9);
});

// K1: the heat pump was 1.3 × the data center's heat whatever the COP (right only at COP 4.3)
test("the heat pump's ceiling is what the data center's heat allows at its COP; the sinks' demand picks the size under it", () => {
  const huge = new Array<number>(HOURS).fill(1e6); // a demand far above the data center: the ceiling decides
  const at19 = quickOptions(site([]), flatDc(3202.2, 19), huge, 70); // Case 1: COP 0.5 · 343.15 / 51 = 3.364
  expect(at19.hpCapacity).toBeCloseTo((3202.2 * 3.3642) / 2.3642, 0); // 4,557 kW (was 4,163)
  const at5 = quickOptions(site([]), flatDc(3202.2, 5), huge, 70); // COP 0.5 · 343.15 / 65 = 2.64
  expect(at5.hpCapacity).toBeCloseTo((3202.2 * 2.6396) / 1.6396, 0); // 5,155 kW
  // a data center whose heat and temperature move: the largest hour of q · COP/(COP − 1)
  const dc = flatDc(1000, 30);
  dc.q[10] = 2000;
  dc.t[10] = 20;
  expect(quickOptions(site([]), dc, huge, 70).hpCapacity).toBeCloseTo(stationCapacity(2000, 20, 70).kw, 6);
  // a small demand gives a small heat pump: half its peak hour, raised until it gives 75 % of the year (the network's rule)
  const small = sinkKw({ ...DEFAULT_DISTRICT, houses: 1, kwhPerHouse: 120_000 });
  const peak = Math.max(...small);
  const o = quickOptions(site([]), flatDc(4000, 30), small, 70);
  expect(o.hpCapacity).toBeCloseTo(heatPumpKw(small, 0, stationCapacity(4000, 30, 70).kw), 9);
  expect(o.hpCapacity).toBeLessThan(peak);
  expect(o.hpCapacity).toBeGreaterThanOrEqual(0.5 * peak - 1e-9);
  // never above the ceiling, whatever the demand
  for (const k of [0.1, 1, 10, 1000]) {
    const d = small.map((x) => x * k);
    expect(quickOptions(site([]), flatDc(40, 35), d, 70).hpCapacity).toBeLessThanOrEqual(stationCapacity(40, 35, 70).kw + 1e-9);
  }
});

test("Case 1's shape: the quick analysis covers more with the heat pump the COP allows than with 1.3 × the heat", () => {
  const s = site([sink("a", { houses: 1, kwhPerHouse: 30_000_000 })]);
  const q = quickAnalysis(s, flatDc(3202.2, 19))!;
  const old = quickAnalysis(s, flatDc(3202.2, 19), { hpCapacity: 1.3 * 3202.2 })!;
  expect(q.recoveredMwh).toBeGreaterThan(old.recoveredMwh);
});

test("a second source covers what the data center leaves: hot enough, directly; both add up", () => {
  const s = site([sink("a", { houses: 1, kwhPerHouse: 800_000, supplyTemp: 70 })]);
  const alone = quickAnalysis(s, flatDc(20, 35))!;
  expect(alone.extra).toBeNull();
  const both = quickAnalysis(s, flatDc(20, 35), undefined, flatDc(500, 95))!; // a 95 °C waste heat source, 500 kW
  expect(both.extra!.dcCoveredPct).toBeCloseTo(alone.coveredPct, 9); // the data center first, as alone
  expect(both.extra!.hpElecMwh).toBe(0); // 95 °C into a 70 °C network: through the heat exchanger
  expect(both.recoveredMwh).toBeCloseTo(alone.recoveredMwh + both.extra!.recoveredMwh, 6);
  expect(both.coveredPct).toBeGreaterThan(99);
  expect(both.hpElecMwh).toBeCloseTo(alone.hpElecMwh, 9);
  expect(both.co2T).toBeGreaterThan(alone.co2T);
  expect(both.months.recovered.reduce((a, b) => a + b, 0)).toBeCloseTo(both.recoveredMwh, 1);
  // a cold one needs its own heat pump
  const cold = quickAnalysis(s, flatDc(20, 35), undefined, flatDc(100, 30))!;
  expect(cold.extra!.hpElecMwh).toBeGreaterThan(0);
});

// K2: the tank held an hour of the heat pump, at least 500 kWh, kept full all year: its standing loss swamped a small demand
test("the tank holds an hour of the smaller of the heat pump and the sinks' peak: a small demand is not swamped by its loss", () => {
  const one = site([sink("a", { houses: 1, kwhPerHouse: 12_000 })]); // one clicked building, 12 MWh a year
  const small = sinkKw({ ...DEFAULT_DISTRICT, houses: 1, kwhPerHouse: 12_000 });
  const o = quickOptions(one, flatDc(26, 35), small, 70);
  expect(o.tankKwh).toBeCloseTo(Math.min(o.hpCapacity, Math.max(...small)), 9); // was 500 kWh
  const q = quickAnalysis(one, flatDc(26, 35))!; // a new site's 40 kW data center
  const noTank = quickAnalysis({ ...one, heat_parts: { hex: true, hp: true, tank: false } }, flatDc(26, 35))!;
  expect(q.hpElecMwh).toBeLessThan(1.3 * noTank.hpElecMwh); // was 4.3 MWh (7.0 before K1) against 2.4 without the tank
  expect(q.co2T).toBeGreaterThan(0.9 * noTank.co2T); // was 0.8 t (0.0 before K1) against 1.7
  const five = quickAnalysis(site([sink("a", { houses: 5, kwhPerHouse: 12_000 })]), flatDc(5000, 19))!; // 60 MWh a year on 5 MW
  expect(five.hpElecMwh).toBeLessThan(0.5 * five.recoveredMwh); // was 71.6 MWh for 60 delivered
  expect(five.co2T).toBeGreaterThan(0); // was −13.8 t
  const none = quickAnalysis(site([sink("a", { houses: 1, kwhPerHouse: 0 })]), flatDc(5000, 19));
  expect(none?.hpElecMwh ?? 0).toBe(0); // no demand: no tank kept warm (was 10.3 MWh)
});

// K15: "As in Heat Matching" showed Heat Matching's totals per year beside its months unscaled, and the map run's
// waste heat and network temperatures
test("As in Heat Matching: every figure from Heat Matching's one run, per year", () => {
  const s = site([sink("a", { houses: 1, kwhPerHouse: 200_000, supplyTemp: 60 })]);
  const map = quickAnalysis(s, flatDc(40, 35))!;
  // Heat Matching ran half a year (4,380 h) of a 100 kW data center into an 80 °C network
  const setup = {
    q: new Array<number>(4380).fill(100),
    stepHours: 1,
    supply: new Array<number>(4380).fill(70).fill(80, 0, 100),
    result: { demandMwh: 500, deliveredMwh: 300, coveragePct: 60, hpElecMwh: 80, peakKw: 250, hours: 4380, months: { demand: [500, ...new Array<number>(11).fill(0)], recovered: [300, ...new Array<number>(11).fill(0)] } },
  };
  const r = fromMatching(map, setup)!;
  expect(r).toMatchObject({ demandMwh: 1000, recoveredMwh: 600, coveredPct: 60, hpElecMwh: 160, peakKw: 250 });
  expect(r.co2T).toBeCloseTo(co2SavedT(600, 160), 9);
  expect(r.months.recovered.reduce((a, b) => a + b, 0)).toBeCloseTo(r.recoveredMwh, 9); // was 300 beside 600
  expect(r.months.demand.reduce((a, b) => a + b, 0)).toBeCloseTo(r.demandMwh, 9);
  expect(r.wasteMwh).toBeCloseTo(876, 9); // Heat Matching's data center, a year of it (was the map run's)
  expect(r.supply).toBe(80); // its network (was the map's sinks' 60 °C)
  expect(r.ret).toBeNull(); // it keeps no return
  expect(fromMatching(map, { ...setup, result: undefined })).toBeNull();
});

// A10: Konzeption held the supply at the hottest sink's all year (one COP, 3.36 on Case 1); Heat Matching's heating curve
// (lib/networkTemps.ts) lowers it on mild days, where the heat pump needs less electricity
test("the network's supply follows the heating curve over the typical year: a seasonal COP above the design one, a ceiling at the coldest hour", () => {
  const sup = yearSupply(70, 40);
  expect(sup).toHaveLength(HOURS);
  expect(Math.max(...sup)).toBeLessThanOrEqual(70);
  expect(Math.min(...sup)).toBe(55); // summer: 15 K under the design supply
  expect(sup[0]).toBeGreaterThan(sup[24 * 190]); // January above July
  // the ceiling: the largest hour of q × COP/(COP − 1), where the supply is highest (the coldest hour)
  const top = Math.max(...sup);
  expect(ceilingKw(flatDc(3202.2, 19), sup)).toBeCloseTo(stationCapacity(3202.2, 19, top).kw, 6);
  expect(ceilingKw(flatDc(3202.2, 19), sup)).toBeLessThan(stationCapacity(3202.2, 19, 70).kw);
  // Case 1's shape: the year's heat per electricity is above the design COP of 3.36
  const q = quickAnalysis(site([sink("a", { houses: 1, kwhPerHouse: 30_000_000, supplyTemp: 70, returnTemp: 40 })]), flatDc(3202.2, 19))!;
  expect(q.recoveredMwh / q.hpElecMwh).toBeGreaterThan(3.5); // was 3.35
  expect(q.supply).toBe(70); // the design supply, as shown
});
