/** matchHeat invariants (energy balance, tank and heat-pump limits, physics vs simple mode) and physicsSource. */
import { describe, expect, test } from "vitest";
import { COP_MAX, DEFAULT_OPTIONS, DEFAULT_SOURCE_PHYSICS as P, carnotCop, carnotRaw, matchHeat, physicsSource, type MatchOptions } from "./matching";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));

// a day-night year: source 20..60 kW at 15..45 °C, demand 0..120 kW
const N = 24 * 60;
const q = Array.from({ length: N }, (_, i) => 40 + 20 * Math.sin(i / 7));
const t = Array.from({ length: N }, (_, i) => 30 + 15 * Math.sin(i / 11));
const demand = Array.from({ length: N }, (_, i) => Math.max(0, 60 + 60 * Math.sin((2 * Math.PI * i) / 24)));
const SUPPLY = 35;

const cases: [string, Partial<MatchOptions>][] = [
  ["auto physics", {}],
  ["direct physics", { recovery: "direct" }],
  ["heatpump physics", { recovery: "heatpump" }],
  ["heatpump simple", { recovery: "heatpump", physics: false }],
  ["direct simple, no tank", { recovery: "direct", physics: false, tankKwh: 0 }],
  ["small tank, big loss", { tankKwh: 30, tankLossPct: 20 }],
  ["none", { recovery: "none" }],
];

describe.each(cases)("matchHeat %s", (_, o) => {
  const opt = { ...DEFAULT_OPTIONS, ...o };
  const r = matchHeat(q, t, demand, SUPPLY, opt);
  const steps = Array.from({ length: N }, (_, i) => i);

  test("delivered + unmet = demand at every step", () => {
    for (const i of steps) expect(close(r.direct[i] + r.hp[i] + r.fromTank[i] + r.unmet[i], demand[i]), `step ${i}`).toBe(true);
  });
  test("no negative unmet or surplus", () => {
    for (const i of steps) expect(Math.min(r.unmet[i], r.surplus[i]), `step ${i}`).toBeGreaterThanOrEqual(-1e-9);
  });
  test("tank stays within 0..capacity", () => {
    for (const i of steps) {
      expect(r.tankLevel[i]).toBeGreaterThanOrEqual(-1e-9);
      expect(r.tankLevel[i]).toBeLessThanOrEqual(opt.tankKwh + 1e-9);
    }
  });
  test("source heat used ≤ available, heat pump within capacity", () => {
    for (const i of steps) {
      expect(r.drawn[i]).toBeLessThanOrEqual(q[i] + 1e-9);
      if (r.viaHp[i]) expect(r.hp[i] + r.charge[i]).toBeLessThanOrEqual(opt.hpCapacity + 1e-9);
    }
  });
});

describe("matchHeat physics vs simple", () => {
  test("physics on: no direct heat from a source colder than supply + approach", () => {
    const direct = matchHeat(q, t, demand, SUPPLY, { ...DEFAULT_OPTIONS, recovery: "direct" });
    t.forEach((tt, i) => {
      if (tt < SUPPLY + DEFAULT_OPTIONS.approach) expect([direct.direct[i], direct.charge[i]]).toEqual([0, 0]);
    });
    const cold = matchHeat(q, t.map(() => 10), demand, SUPPLY, { ...DEFAULT_OPTIONS, recovery: "direct" });
    expect(cold.totals.deliveredMwh).toBe(0);
  });

  test("physics off: fixed COP, temperatures ignored", () => {
    const simple = { ...DEFAULT_OPTIONS, recovery: "heatpump" as const, physics: false };
    const a = matchHeat(q, t, demand, SUPPLY, simple);
    const b = matchHeat(q, t.map(() => -50), demand, SUPPLY, simple);
    expect(a).toEqual(b);
    expect(a.cop.every((c) => c === simple.fixedCop)).toBe(true);
    expect(close(a.totals.spf, simple.fixedCop)).toBe(true);
  });

  test("15-min steps of the same kW give the hourly energies", () => {
    const rep4 = (xs: number[]) => xs.flatMap((x) => [x, x, x, x]);
    const o = { ...DEFAULT_OPTIONS, tankLossPct: 0, hpTauH: 0 }; // a lag depends on the step length
    const h = matchHeat(q, t, demand, SUPPLY, o).totals;
    const m = matchHeat(rep4(q), rep4(t), rep4(demand), SUPPLY, o, 0.25).totals;
    for (const k of ["demandMwh", "deliveredMwh", "hpElecMwh", "unmetMwh", "surplusMwh", "hours"] as const)
      expect(Math.abs(h[k] - m[k]), k).toBeLessThan(1e-6 * Math.max(1, h[k]));
    const r = matchHeat(rep4(q), rep4(t), rep4(demand), SUPPLY, { ...o, tankKwh: 30 }, 0.25);
    expect(Math.max(...r.tankLevel)).toBeLessThanOrEqual(30 + 1e-9);
  });
});

describe("matchHeat: the heat pump's time lag", () => {
  test("from a cold start its output rises as 1 − e^(−t/τ) towards what it could give; a step gives its mean", () => {
    const o = { ...DEFAULT_OPTIONS, recovery: "heatpump" as const, tankKwh: 0, hpCapacity: 100, hpTauH: 1 };
    const r = matchHeat([1000, 1000, 1000], [30, 30, 30], [100, 100, 100], 70, o);
    // the mean of 100 (1 − e^(−t)) over [0, 1] and over [1, 2]
    expect(r.hp[0]).toBeCloseTo(100 * Math.exp(-1), 9);
    expect(r.hp[1]).toBeCloseTo(100 * (1 - Math.exp(-1) + Math.exp(-2)), 9);
    expect(r.hp[2]).toBeGreaterThan(r.hp[1]);
    expect(matchHeat([1000], [30], [100], 70, { ...o, hpTauH: 0 }).hp[0]).toBeCloseTo(100); // no lag: at once
  });

  test("the same plant gives the same heat on hourly and on 5-min steps (a daily start, τ = 0.5 h)", () => {
    const o = { ...DEFAULT_OPTIONS, recovery: "heatpump" as const, tankKwh: 0, hpCapacity: 1000, hpTauH: 0.5 };
    const day = Array.from({ length: 24 * 7 }, (_, h) => (h % 24 >= 6 && h % 24 < 22 ? 1000 : 0)); // on 06–22 h
    const rep = (xs: number[], k: number) => xs.flatMap((x) => Array<number>(k).fill(x));
    const kw = (dt: number, k: number) => matchHeat(rep(day.map(() => 5000), k), rep(day.map(() => 30), k), rep(day, k), 70, o, dt).totals.deliveredMwh;
    // hourly against 5 min: within 0.1 % (the end of the step instead of its mean: about 2 % more on hourly data)
    expect(Math.abs(kw(1, 1) - kw(1 / 12, 12)) / kw(1 / 12, 12)).toBeLessThan(0.001);
  });
});

describe("matchHeat paths switched off and the HEX from data", () => {
  test("none: nothing delivered, nothing drawn, the tank stays empty", () => {
    const r = matchHeat(q, t, demand, SUPPLY, { ...DEFAULT_OPTIONS, recovery: "none" });
    expect(r.totals.deliveredMwh).toBe(0);
    expect(r.totals.hpElecMwh).toBe(0);
    expect(Math.max(...r.tankLevel, ...r.drawn)).toBe(0);
  });

  test("HEX data: the direct path passes the HEX heat (at most the source) when its inlet is hot enough", () => {
    const o = { ...DEFAULT_OPTIONS, recovery: "direct" as const, tankKwh: 0 };
    const hot = { q: q.map((x) => x / 2), t: q.map(() => SUPPLY + o.approach) };
    const r = matchHeat(q, t.map(() => 0), demand, SUPPLY, o, 1, hot); // the source temperature no longer decides
    r.direct.forEach((d, i) => expect(close(d, Math.min(hot.q[i], demand[i])), `step ${i}`).toBe(true));
    const big = matchHeat(q, t, demand, SUPPLY, o, 1, { q: q.map((x) => 10 * x), t: hot.t });
    big.direct.forEach((d, i) => expect(d).toBeLessThanOrEqual(q[i] + 1e-9));
    const cold = matchHeat(q, t, demand, SUPPLY, o, 1, { q, t: q.map(() => SUPPLY) });
    expect(cold.totals.deliveredMwh).toBe(0);
  });
});

describe("physicsSource", () => {
  const drv = { ite: [10, 20, 30], hvac: [1, 2, 3], inT: [24, 25, 26], outT: [-30, 20, 50] };

  test("hall: Q = η · ITE one step before, T = In_Temp + ΔT − approach", () => {
    const hall = physicsSource("hall", drv, P);
    hall.q.forEach((v, i) => expect(close(v, P.eta * drv.ite[Math.max(0, i - 1)])).toBe(true));
    expect(close(hall.t[2], 25 + P.rackDt - P.approach)).toBe(true);
  });

  test("condenser: Q = η · (ITE + HVAC), T from the outdoor air, clipped", () => {
    const cond = physicsSource("condenser", drv, P);
    expect(close(cond.q[1], P.eta * 11)).toBe(true);
    expect(close(cond.t[0], P.tMin - P.approach) && close(cond.t[1], P.tMin - P.approach)).toBe(true);
    expect(close(cond.t[2], 20 + P.towerApproach - P.approach)).toBe(true);
    expect(close(physicsSource("condenser", { ...drv, outT: [50, 50, 50] }, P).t[1], P.tMax - P.approach)).toBe(true);
  });

  test("liquid cooling: the cold plates' share on facility water following the outdoor air up to W45, the rest at the condenser", () => {
    const liquid = physicsSource("liquid", drv, P, true); // outdoor -30, 20, 50 °C
    expect(close(liquid.q[2], P.eta * P.liquidShare * 20)).toBe(true);
    expect(close(liquid.t[0], P.tFacility + P.liquidDt - P.approach)).toBe(true); // cold: the lowest supply
    const warm = physicsSource("liquid", { ...drv, outT: [43, 43, 43] }, P).t[1];
    expect(close(warm, 43 + P.facilityApproach + P.liquidDt - P.approach)).toBe(true); // warm: it rises
    expect(close(physicsSource("condenser", drv, P, true).q[1], P.eta * ((1 - P.liquidShare) * 10 + 1))).toBe(true);
    expect(close(physicsSource("liquid", { ...drv, outT: [50, 50, 50] }, P).t[1], 45 + P.liquidDt - P.approach)).toBe(true);
  });
});

describe("carnotCop", () => {
  test("η_C · T_supply[K] / lift at a known point", () => {
    expect(carnotCop(35, 70, 0.5)).toBeCloseTo((0.5 * 343.15) / 35);
  });
  test("lift floor of 5 K, clamped to 1.1..8", () => {
    expect(carnotCop(80, 70, 0.1)).toBeCloseTo((0.1 * 343.15) / 5);
    expect(carnotCop(80, 70, 0.5)).toBe(8);
    expect(carnotCop(-100, 70, 0.1)).toBe(1.1);
  });
});

describe("matchHeat with components' per-step series", () => {
  const o = DEFAULT_OPTIONS;
  const same = {
    hpCop: t.map((x) => carnotCop(x, SUPPLY, o.carnotEff)),
    hpCap: t.map(() => o.hpCapacity),
    hexQ: q.map((x) => x * o.hexEff),
    hexTOut: t.map((x) => x - o.approach),
    tankKwh: t.map(() => o.tankKwh),
    tankLossPct: t.map(() => o.tankLossPct),
  };

  test("series equal to the built-in formulas give the same result", () => {
    expect(matchHeat(q, t, demand, SUPPLY, o, 1, undefined, same)).toEqual(matchHeat(q, t, demand, SUPPLY, o));
  });

  test("a heat pump with no capacity delivers nothing; its COP is kept within the bounds", () => {
    const r = matchHeat(q, t, demand, SUPPLY, { ...o, recovery: "heatpump" }, 1, undefined, { hpCop: t.map(() => 20), hpCap: t.map(() => 0) });
    expect(r.totals.deliveredMwh).toBe(0);
    expect(Math.max(...r.cop)).toBe(COP_MAX);
  });

  test("a shrinking tank capacity spills what no longer fits", () => {
    const tankKwh = t.map((_, i) => (i < N / 2 ? 500 : 10));
    const r = matchHeat(q, t, demand, SUPPLY, o, 1, undefined, { tankKwh });
    for (let i = N / 2; i < N; i++) expect(r.tankLevel[i]).toBeLessThanOrEqual(10 + 1e-9);
  });
});

test("the tank's default standing loss: 0.1 %/h, 2.4 % a day (it was 0.5 %/h, 11 % a day), Operation's too (audit P3)", () => {
  // one hour charges 100 kWh into the tank, then it stands a day with nothing drawn and nothing made (a demand after it)
  const n = 26;
  const o = { ...DEFAULT_OPTIONS, physics: false, eta: 1, recovery: "direct" as const, tankKwh: 100 };
  const r = matchHeat([100, ...Array(n - 1).fill(0)], Array(n).fill(80), [...Array(n - 1).fill(0), 10], 70, o);
  expect(r.tankLevel[0]).toBeCloseTo(100, 9);
  expect(r.tankLevel[24] / r.tankLevel[0]).toBeCloseTo(0.999 ** 24, 9); // 97.6 % kept; 0.995 ** 24 = 88.7 % before
});

test("a tank nobody draws from again is not charged: no heat pump electricity, no data-center heat for its loss (audit P3)", () => {
  const n = 48;
  const o = { ...DEFAULT_OPTIONS, recovery: "heatpump" as const, hpCapacity: 100, tankKwh: 500, hpTauH: 0 };
  // no demand at all: before, it charged 100 kW an hour into the tank and then topped up its loss, every hour
  const idle = matchHeat(Array(n).fill(100), Array(n).fill(30), Array(n).fill(0), 70, o);
  expect(idle.totals.hpElecMwh).toBe(0);
  expect(idle.totals.dcUsedPct).toBe(0);
  expect(Math.max(...idle.tankLevel)).toBe(0);
  // demand in the first day only: the tank charges and serves that day, nothing goes in after its last draw
  const day = matchHeat(Array(n).fill(100), Array(n).fill(30), Array.from({ length: n }, (_, i) => (i < 24 && i % 2 ? 150 : 0)), 70, o);
  expect(Math.max(...day.fromTank.slice(0, 24))).toBeGreaterThan(0);
  expect(day.charge.slice(23).every((c) => c === 0)).toBe(true);
  expect(day.hpElec.slice(24).every((e) => e === 0)).toBe(true);
});

test("hours fully met count only hours with a demand, out of the hours with a demand (audit P11)", () => {
  const o = { ...DEFAULT_OPTIONS, physics: false, eta: 1, recovery: "direct" as const, tankKwh: 0 };
  const r = matchHeat([100, 100, 100, 100], [80, 80, 80, 80], [0, 0, 50, 150], 70, o);
  expect(r.totals.hoursCovered).toBe(1); // before: 3, the two hours with no demand counted as met
  expect(r.totals.demandHours).toBe(2);
  expect(r.totals.hours).toBe(4);
});

test("the Carnot kernel: eff × T_hot[K] / lift, the lift at least 5 K, unclamped; carnotCop clamps it", () => {
  expect(carnotRaw(20, 70)).toBe(343.15 / 50);
  expect(carnotRaw(68, 70, 0.5)).toBe((0.5 * 343.15) / 5); // a 2 K lift counts as 5 K
  expect(carnotCop(20, 70, 0.5)).toBe(carnotRaw(20, 70, 0.5));
  expect(carnotCop(68, 70, 1)).toBe(COP_MAX); // 68.6 unclamped
});
