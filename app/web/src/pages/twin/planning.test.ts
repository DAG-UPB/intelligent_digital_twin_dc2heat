/** Operation: variant -> matching options, a run's key figures, the best variant and its operation. */
import { expect, test } from "vitest";
import { DEFAULT_OPTIONS, matchHeat } from "../../lib/matching";
import { bestOf, DEFAULT_VARIANTS, kpiOf, operationOf, optionsOf, usableOf, type Variant } from "./planning";

const v = (o: Partial<Variant>): Variant => ({ id: 0, name: "x", hex: true, hp: true, hpMw: 1, tankKwh: 0, ...o });

test("optionsOf: the parts pick the recovery path, MW become kW", () => {
  expect(optionsOf(v({})).recovery).toBe("auto");
  expect(optionsOf(v({ hp: false })).recovery).toBe("direct");
  expect(optionsOf(v({ hex: false })).recovery).toBe("heatpump");
  expect(optionsOf(v({ hex: false, hp: false })).recovery).toBe("none");
  expect(optionsOf(v({ hpMw: 2, tankKwh: 500 }))).toMatchObject({ hpCapacity: 2000, tankKwh: 500 });
  expect(new Set(DEFAULT_VARIANTS.map((x) => x.id)).size).toBe(DEFAULT_VARIANTS.length);
  // Heat Matching's heat is already the HEX's output (usable 1): HEX only delivers all of it, not 90 % a second time
  const hexOnly = v({ hp: false });
  const r = matchHeat([1000, 1000], [80, 80], [2000, 2000], 70, optionsOf(hexOnly, 1), 1);
  expect(r.totals.deliveredMwh).toBeCloseTo(2, 9);
  expect(optionsOf(hexOnly)).toMatchObject({ hexEff: 0.9, eta: 0.8 }); // no setup: the defaults
});

test("usableOf: Define here on a dataset's own heat source passes all of it, as Heat Matching does (audit P1)", () => {
  // the dataset's heat_source columns are already what the extraction HEX passes: not 90 % of it a second time
  const hexOnly = v({ hp: false });
  const run = (usable: number) => matchHeat([1000, 1000], [80, 80], [2000, 2000], 70, optionsOf(hexOnly, usable), 1);
  expect(run(usableOf(undefined, true)).totals.deliveredMwh).toBeCloseTo(2, 9); // was 1.8 (hexEff 0.9)
  expect(usableOf(undefined, false)).toBe(0.9); // a mapped column (raw waste heat): the HEX's default
  expect(usableOf(0.75, true)).toBe(0.75); // as Heat Matching ran it
});

test("on Heat Matching the options run with its options and COP: an option of its sizes gives its row (audit P10)", () => {
  const q = [400, 400, 400, 400, 400, 400];
  const t = [20, 20, 20, 20, 20, 20];
  const demand = [900, 100, 100, 900, 0, 900];
  const hmOpts = { ...DEFAULT_OPTIONS, carnotEff: 0.6, tankLossPct: 2, hpTauH: 0, hexEff: 1, hpCapacity: 800, tankKwh: 300 };
  const cop = t.map(() => 3.1); // its heat pump's model
  const hm = matchHeat(q, t, demand, 70, hmOpts, 1, undefined, { hpCop: cop });
  const same = matchHeat(q, t, demand, 70, optionsOf(v({ hpMw: 0.8, tankKwh: 300 }), 1, hmOpts), 1, undefined, { hpCop: cop });
  expect(same.totals).toEqual(hm.totals);
  expect(optionsOf(v({}), 1, hmOpts)).toMatchObject({ carnotEff: 0.6, tankLossPct: 2, hpTauH: 0 }); // before: the defaults' 0.5, 0.1, 0.5
});

test("a bigger heat pump covers more, and is the best; operation follows from the same run", () => {
  // 30 °C source below the 70 °C supply: only the heat pump can deliver
  const q = [100, 100, 100, 100];
  const t = [30, 30, 30, 30];
  const demand = [300, 300, 0, 300];
  const run = (x: Variant) => matchHeat(q, t, demand, 70, { ...optionsOf(x), hpTauH: 0 }, 1); // no start-up lag: full load at once
  const small = v({ hpMw: 0.1 });
  const big = v({ hpMw: 1, tankKwh: 100 });
  const rows = [small, big].map((x) => kpiOf(run(x), q, 1));
  expect(rows[1].coveragePct).toBeGreaterThan(rows[0].coveragePct);
  expect(rows[0].unusedMwh).toBeGreaterThan(0);
  expect(bestOf(rows)).toBe(1);
  expect(bestOf([])).toBe(-1);

  const op = operationOf(run(small), small, 1);
  expect(op.hpHours).toBe(3); // no demand and no tank in step 3: the heat pump stands still
  expect(op.hpLoadPct).toBeCloseTo(100);
  expect(op.directHours).toBe(0);
  expect(op.tankFullHours).toBeNull();
  expect(op.peakUnmetKw).toBeCloseTo(200);
  expect(operationOf(run(big), big, 1).tankFullHours).toBeGreaterThan(0);
});
