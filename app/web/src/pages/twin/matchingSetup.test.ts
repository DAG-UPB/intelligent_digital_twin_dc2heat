/** The page-to-page contract: what Heat Matching keeps for Operation and the Quick analysis (localStorage
 * `heat-matching`), built from one run, saved rounded, read back for its data center only, old setups included. */
import { afterEach, expect, test, vi } from "vitest";
import { DEFAULT_OPTIONS, carnotCop, matchHeat } from "../../lib/matching";
import { buildSetup, readSetup, saveSetup, type MatchingRun } from "./matchingSetup";

const m = new Map<string, string>();
afterEach(() => {
  m.clear();
  vi.unstubAllGlobals();
});
const stub = () => vi.stubGlobal("localStorage", { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });

const H = 3600;
const times = [0, 1, 2, 3, 4].map((i) => Date.UTC(2025, 0, 1) / 1000 + i * H); // January
const opts = { ...DEFAULT_OPTIONS, hpCapacity: 300, tankKwh: 500 };
const run = (over: Partial<MatchingRun> = {}): MatchingRun => {
  const q = [400, 400, 400, 400];
  const tSrc = [30, 30, 30, 30, 99]; // one step more than the run: cut to n
  const demand = [200, 250, 300, 350, 999];
  const res = matchHeat(q, tSrc.slice(0, 4), demand.slice(0, 4), 70, opts, 1);
  return {
    dataset: "sim_x",
    saved: 1,
    at: "hall",
    dcFrom: "Calculation",
    demandFrom: "profile",
    parts: { hex: true, hp: true, tank: true },
    opts,
    partSeries: {},
    stepHours: 1,
    n: 4,
    times,
    q,
    tSrc,
    demand,
    supply: 70,
    res,
    outTemp: [1, 2, 3],
    diagram: null,
    ...over,
  };
};

test("built from one run: the first n steps, the Carnot COP, the sizes of the parts switched on, its year", () => {
  const s = buildSetup(run());
  expect(s.times).toEqual(times.slice(0, 4));
  expect(s.t).toEqual([30, 30, 30, 30]);
  expect(s.demand).toEqual([200, 250, 300, 350]);
  expect(s.cop).toEqual([30, 30, 30, 30].map((x) => carnotCop(x, 70, opts.carnotEff)));
  expect([s.hpKw, s.tankKwh, s.usable]).toEqual([300, 500, opts.hexEff]);
  expect(s.direct).toEqual([false, false, false, false]); // 30 °C cannot feed 70 °C directly
  expect(s.tOut).toBeUndefined(); // a weather shorter than the run is not kept
  expect(s.result!.peakKw).toBe(350);
  expect(s.result!.hours).toBe(4);
  expect(s.result!.months.demand[0]).toBeCloseTo(1.1, 9); // MWh in January
  expect(s.result!.deliveredMwh).toBeCloseTo(s.result!.months.recovered[0], 9);
});

test("parts switched off: no heat pump, no tank, no direct steps; a plant model's COP and size win", () => {
  const off = buildSetup(run({ parts: { hex: false, hp: false, tank: false } }));
  expect([off.hpKw, off.tankKwh, off.direct]).toEqual([0, 0, undefined]);
  const model = buildSetup(run({ partSeries: { hpCop: [3, 3, 3, 3, 3], hpCap: [100, 250, 200, 0] } }));
  expect([model.cop, model.hpKw]).toEqual([[3, 3, 3, 3], 250]);
});

test("a plant model's COP is clamped as matchHeat runs it (before: a COP of 12 went to Operation as it was)", () => {
  expect(buildSetup(run({ partSeries: { hpCop: [12, 0.5, 3, 3] } })).cop).toEqual([8, 1.1, 3, 3]);
});

test("saved rounded, read back only for its data center; an old setup without direct, opts or result still reads", () => {
  stub();
  saveSetup({ ...buildSetup(run()), q: [400.04, 1, 2, 3] });
  const back = readSetup("sim_x")!;
  expect(back.q[0]).toBe(400);
  expect(back.cop[0]).toBe(Math.round(carnotCop(30, 70, opts.carnotEff) * 100) / 100);
  expect(readSetup("another")).toBeNull();
  // as Heat Matching saved it before 2026-11-17: no direct, opts, tOut, hum, diagram or result
  m.set(
    "heat-matching",
    JSON.stringify({
      dataset: "old",
      saved: 1,
      at: "hall",
      dcFrom: "",
      demandFrom: "",
      parts: { hex: true, hp: true, tank: true },
      hpKw: 5,
      tankKwh: 0,
      stepHours: 1,
      times,
      q: [1, 2],
      t: [30, 30],
      demand: [1, 1],
      supply: 70,
      cop: [3, 3],
    }),
  );
  const old = readSetup("old")!;
  expect(old.q).toEqual([1, 2]);
  expect([old.direct, old.opts, old.result]).toEqual([undefined, undefined, undefined]);
  m.set("heat-matching", "{broken");
  expect(readSetup("old")).toBeNull();
});
