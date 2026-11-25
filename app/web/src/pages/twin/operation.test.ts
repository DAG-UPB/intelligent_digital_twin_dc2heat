import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, matchHeat } from "../../lib/matching";
import type { ScenarioRun } from "./operation.worker";
import { BACKUP_EUR_KWH, breakdown, COOLING, FEES_EUR_KWH, CHARGE_DT, chargeCop, coolingPerKwh, dailyMedian, defaultRc, rejectorWater, tankTau, wetBulb, type Rejection, hpLimit, hpMax, marketPrice, marketSeries, operate, operationJob, summaryOf, syntheticPrice, tankStep, tankTemp, type OpPlant, type OpSeries, type TankRc } from "./operation";
import { CO2 } from "../../lib/partKpis";
import { DEFAULT_PARAMS } from "../district/networkCost";

const plant: OpPlant = { hpKw: 100, tauH: 0, tankKwh: 200, lossPctH: 0, backupPrice: 0.12, backupCo2: 0.22 };
// two days: plenty of source heat, a flat demand, cheap nights and dear evenings
const n = 48;
const hour = (i: number) => i % 24;
const series = (o: Partial<OpSeries> = {}): OpSeries => ({
  src: Array(n).fill(1000),
  cop: Array(n).fill(4),
  demand: Array(n).fill(50),
  price: Array.from({ length: n }, (_, i) => (hour(i) < 6 ? 0.1 : hour(i) >= 17 && hour(i) < 21 ? 0.5 : 0.25)),
  co2: Array(n).fill(0.4),
  ...o,
});

describe("heat pump operation", () => {
  it("heat-led covers a demand it can make, and keeps the energy balance", () => {
    const r = operate("heat", series(), plant);
    expect(r.totals.coveredPct).toBeCloseTo(100);
    for (let i = 0; i < n; i++) expect(r.hp[i] + r.fromTank[i] + r.backup[i]).toBeGreaterThanOrEqual(50 - 1e-9);
    expect(r.backup.every((b) => b < 1e-9)).toBe(true);
  });

  it("the look-ahead costs no more than heat-led, and less when prices differ and there is a tank", () => {
    const s = series();
    const heat = operate("heat", s, plant).totals;
    const mpc = operate("mpc", s, plant).totals;
    const price = operate("price", s, plant).totals;
    expect(mpc.coveredPct).toBeCloseTo(100);
    expect(mpc.costEur).toBeLessThan(heat.costEur);
    expect(price.costEur).toBeLessThanOrEqual(heat.costEur + 1e-9);
  });

  it("the months add up to the run's totals, each step in its own month", () => {
    const s = series({ src: Array(n).fill(0) });
    const r = operate("heat", s, { ...plant, tankKwh: 0 });
    const jan31 = Date.UTC(2024, 0, 31) / 1000; // the first day in January, the second in February
    const { months } = breakdown(r, s, plant, Array.from({ length: n }, (_, i) => jan31 + i * 3600));
    expect(months[0].backupMwh).toBeCloseTo((50 * 24) / 1000);
    expect(months[1].backupMwh).toBeCloseTo((50 * 24) / 1000);
    expect(months.reduce((a, m) => a + m.costEur, 0)).toBeCloseTo(r.totals.costEur);
  });

  it("without a source the backup covers it, at its price", () => {
    const r = operate("mpc", series({ src: Array(n).fill(0) }), { ...plant, tankKwh: 0 });
    expect(r.totals.backupMwh).toBeCloseTo((50 * n) / 1000);
    expect(r.totals.costEur).toBeCloseTo(50 * n * 0.12);
  });

  it("the heat pump's lag: from a cold start it gives the first hour's mean of 1 − e^(−t/τ), as Heat Matching (audit P3)", () => {
    const r = operate("heat", series({ demand: Array(n).fill(100) }), { ...plant, tankKwh: 0, tauH: 1 });
    // the mean over the hour, 1 − τ/Δt · (1 − e^(−Δt/τ)) = e^(−1) at τ = Δt; the end-of-step value 1 − e^(−1) it gave before credited too much
    expect(r.hp[0]).toBeCloseTo(100 * Math.exp(-1));
    expect(r.backup[0]).toBeGreaterThan(0);
    expect(r.totals.starts).toBe(1);
    // the same plant through matchHeat (fixed COP 4, all the source usable, no tank): the same heat every hour
    const m = matchHeat(Array(n).fill(1000), Array(n).fill(0), Array(n).fill(100), 70, { ...DEFAULT_OPTIONS, physics: false, eta: 1, fixedCop: 4, recovery: "heatpump", hpCapacity: 100, tankKwh: 0, hpTauH: 1 });
    for (let i = 0; i < 6; i++) expect(r.hp[i]).toBeCloseTo(m.hp[i], 9);
  });

  it("a source hot enough feeds in directly, as on Heat Matching: no heat pump, no electricity (audit P2)", () => {
    // 1,000 kW at 60 °C, supply 50 °C, demand 800 kW, a 500 kW heat pump: Heat Matching's direct HEX covers it all
    const N = 24;
    const s = series({ src: Array(N).fill(1000), demand: Array(N).fill(800), price: Array(N).fill(0.2), co2: Array(N).fill(0.4), cop: Array(N).fill(8) });
    const p = { ...plant, hpKw: 500, tankKwh: 0 };
    const m = matchHeat(Array(N).fill(1000), Array(N).fill(60), Array(N).fill(800), 50, { ...DEFAULT_OPTIONS, hexEff: 1, hpCapacity: 500, tankKwh: 0 });
    expect(m.totals.coveragePct).toBeCloseTo(100);
    expect(m.viaHp.some((v) => v)).toBe(false);
    const direct = m.viaHp.map((v) => !v);
    for (const st of ["heat", "price", "mpc"] as const) {
      const r = operate(st, { ...s, direct }, p);
      expect(r.totals.coveredPct).toBeCloseTo(100); // without `direct`: 62.5 %, through the 500 kW heat pump
      expect(r.totals.elecMwh).toBe(0);
      expect(r.totals.runHours).toBe(0);
      expect(r.direct[0]).toBeCloseTo(800);
    }
    expect(operate("heat", s, p).totals.coveredPct).toBeCloseTo(62.5); // no direct steps: the heat pump's limit
    // a surplus charges the tank for free; after a direct step the heat pump starts cold
    const mixed = { ...s, src: Array(N).fill(1000), demand: Array(N).fill(800), direct: Array.from({ length: N }, (_, i) => i < 2) };
    const t = operate("heat", mixed, { ...plant, hpKw: 500, tankKwh: 300, tauH: 1 });
    expect(t.level[0]).toBeCloseTo(200); // 1,000 − 800 into the tank, no electricity
    expect(t.elec[0]).toBe(0);
    expect(t.hp[2]).toBeCloseTo(500 * Math.exp(-1)); // a cold start: the first hour's mean
    expect(hpMax(mixed, p, 0)).toBe(1000);
  });

  it("the MPC is never dearer than heat-led: where its plan (blind to τ) loses, it runs heat-led (audit P7)", () => {
    // a slow heat pump (τ 6 h): the plan turns it down for cheap hours and it cannot come back up in time
    const N = 24 * 20;
    const t = Array.from({ length: N }, (_, i) => Date.UTC(2024, 3, 1) / 1000 + i * 3600);
    const s: OpSeries = {
      src: Array(N).fill(3500),
      cop: Array(N).fill(3.5),
      demand: t.map((_, i) => 3000 + 1500 * Math.cos((2 * Math.PI * ((i % 24) - 7)) / 24)),
      ...syntheticPrice(t, 1, 0.14),
    };
    const p: OpPlant = { hpKw: 5000, tauH: 6, tankKwh: 8000, lossPctH: 0.1, backupPrice: 0.11, backupCo2: 0.22 };
    const heat = operate("heat", s, p).totals;
    const mpc = operate("mpc", s, p).totals;
    expect(mpc.heatLed).toBe(true); // its plan alone cost 0.8 % more than heat-led
    expect(mpc.costEur).toBeCloseTo(heat.costEur, 6);
    // a fast one: its own plan, cheaper
    const fast = operate("mpc", s, { ...p, tauH: 0.5 }).totals;
    expect(fast.heatLed).toBeUndefined();
    expect(fast.costEur).toBeLessThan(operate("heat", s, { ...p, tauH: 0.5 }).totals.costEur);
  });

  it("the tank starts empty, as Heat Matching's: no strategy gets free heat (audit P3)", () => {
    const r = operate("heat", series({ src: Array(n).fill(0) }), plant); // 200 kWh tank, no source
    expect(r.fromTank[0]).toBe(0); // half full before: 50 kW of free heat in the first two hours
    expect(r.totals.backupMwh).toBeCloseTo((50 * n) / 1000);
    expect(operate("heat", series({ src: Array(n).fill(0) }), { ...plant, startKwh: 100 }).fromTank[0]).toBeCloseTo(50);
  });

  it("the daily median and the synthetic price", () => {
    expect(dailyMedian([3, 1, 2, 10, 30, 20], 3)).toEqual([2, 2, 2, 20, 20, 20]);
    const t0 = Date.UTC(2024, 0, 1) / 1000;
    const { price, co2 } = syntheticPrice(Array.from({ length: 24 }, (_, i) => t0 + i * 3600));
    expect(price.every((p) => p > 0.1 && p < 0.5)).toBe(true);
    expect(Math.max(...price.slice(17, 20))).toBeGreaterThan(Math.min(...price.slice(0, 5))); // the evening peak is dearer than the night
    expect(co2.every((c) => c > 0)).toBe(true);
  });

  describe("the tank with a temperature (RC)", () => {
    // 200 kWh between 40 and 60 °C: 10 kWh per K; it starts half full, at 50 °C
    const rc: TankRc = { tMin: 40, tMax: 60, tAmb: 20, tauH: 10, chargeKw: 1000, dischargeKw: 1000 };
    const rcPlant: OpPlant = { ...plant, rc, startKwh: 100 };
    const idle = series({ src: Array(n).fill(0), demand: Array(n).fill(0) });

    it("cools towards the room with its time constant, its loss larger when it is hotter", () => {
      const r = operate("heat", idle, rcPlant);
      const t1 = 20 + (50 - 20) * Math.exp(-1 / 10);
      expect(r.level[0]).toBeCloseTo(10 * (t1 - 40));
      expect(tankTemp(rc, 200, r.level[0])).toBeCloseTo(t1);
      const full = tankStep(idle, rcPlant, 0, 1, 200).kept;
      expect(200 - full).toBeGreaterThan(100 - r.level[0]); // full (60 °C) loses more than half full (50 °C)
      expect(r.level[n - 1]).toBe(0); // and is empty once at its empty temperature
    });

    it("serves the network only above its supply temperature", () => {
      const s = series({ src: Array(n).fill(0), demand: Array(n).fill(20) });
      const below = operate("heat", { ...s, supply: Array(n).fill(55) }, { ...rcPlant, rc: { ...rc, tauH: 1e9 } });
      expect(below.fromTank[0]).toBeCloseTo(0); // 50 °C in the tank, 55 °C wanted
      expect(below.backup[0]).toBeCloseTo(20);
      const above = operate("heat", { ...s, supply: Array(n).fill(45) }, { ...rcPlant, rc: { ...rc, tauH: 1e9 } });
      expect(above.fromTank[0]).toBeCloseTo(20);
      expect(above.fromTank.reduce((a, b) => a + b, 0)).toBeCloseTo(50); // only the 5 K above 45 °C: 50 kWh
    });

    it("charges and discharges at most its kW", () => {
      const s = series({ demand: Array.from({ length: n }, (_, i) => (i === n - 1 ? 50 : 0)) }); // a demand at the end to charge for (1b-9)
      const r = operate("heat", s, { ...rcPlant, rc: { ...rc, tauH: 1e9, chargeKw: 30 } });
      expect(r.level[0] - 100).toBeCloseTo(30);
      const d = operate("heat", series({ src: Array(n).fill(0) }), { ...rcPlant, rc: { ...rc, tauH: 1e9, dischargeKw: 15 } });
      expect(d.fromTank[0]).toBeCloseTo(15);
      expect(d.backup[0]).toBeCloseTo(35);
    });

    it("the MPC keeps every step's balance with it, and costs no more than heat-led", () => {
      const s = { ...series(), supply: Array(n).fill(45) };
      const heat = operate("heat", s, rcPlant).totals;
      const mpc = operate("mpc", s, rcPlant);
      for (let i = 0; i < n; i++) expect(mpc.hp[i] - Math.max(0, mpc.hp[i] - 50) + mpc.fromTank[i] + mpc.backup[i]).toBeCloseTo(50);
      expect(mpc.totals.costEur).toBeLessThanOrEqual(heat.costEur + 1e-6);
    });

    it("heat into the tank costs more electricity: the heat pump lifts above the tank's temperature", () => {
      // 30 °C source, 45 °C supply: the demand at COP 4, the tank (50 °C after a loss-free hour) at 55 °C
      const s = { ...series({ demand: Array(n).fill(20) }), supply: Array(n).fill(45), tSrc: Array(n).fill(30) };
      const p: OpPlant = { ...rcPlant, rc: { ...rc, tauH: 1e9, chargeKw: 30 } };
      const r = operate("heat", s, p);
      const copC = 4 * (((55 + 273.15) / 25) / ((45 + 273.15) / 15));
      expect(chargeCop(s, p, 0, 50)).toBeCloseTo(copC);
      expect(r.elec[0]).toBeCloseTo(20 / 4 + 30 / copC);
      expect(r.elec[0]).toBeGreaterThan(50 / 4);
      // a hotter tank lifts higher still; at or below the supply it is charged CHARGE_DT above the supply
      expect(chargeCop(s, p, 0, 58)).toBeLessThan(copC);
      expect(chargeCop(s, p, 0, 40)).toBeCloseTo(4 * (((45 + CHARGE_DT + 273.15) / (15 + CHARGE_DT)) / ((45 + 273.15) / 15)));
      // the bucket, or no source temperature: the step's COP, as before
      expect(chargeCop(s, plant, 0, 50)).toBe(4);
      expect(chargeCop({ ...s, tSrc: undefined }, p, 0, 50)).toBe(4);
      expect(operate("heat", { ...s, tSrc: undefined }, p).elec[0]).toBeCloseTo(50 / 4);
    });

    it("a scarce source: heat into the tank at the lower COP takes less of it, so more heat is made, the source used up", () => {
      const s = { ...series({ src: Array(n).fill(20), demand: Array(n).fill(10) }), supply: Array(n).fill(45), tSrc: Array(n).fill(30) };
      const p: OpPlant = { ...rcPlant, rc: { ...rc, tauH: 1e9 } };
      const r = operate("heat", s, p);
      const copC = chargeCop(s, p, 0, 50);
      expect(r.hp[0]).toBeCloseTo(hpLimit(s, p, 0, 10, copC));
      expect(r.hp[0]).toBeGreaterThan(hpMax(s, p, 0)); // 26.7 kW at the step's COP
      expect(r.hp[0] - r.elec[0]).toBeCloseTo(20); // heat − electricity = the source's heat
      expect(hpLimit(s, p, 0, 10, 4)).toBeCloseTo(hpMax(s, p, 0)); // at one COP: as before
      expect(hpLimit(s, p, 0, 100, copC)).toBeCloseTo(hpMax(s, p, 0)); // all to the demand: as before
      const m = operate("mpc", s, p);
      for (let i = 0; i < n; i++) expect(m.hp[i] - m.elec[i]).toBeLessThanOrEqual(20 + 1e-6);
    });

    it("the MPC sees the dearer charging: it charges less than without it", () => {
      const s = { ...series(), supply: Array(n).fill(45) };
      const p: OpPlant = { ...rcPlant, rc: { ...rc, tauH: 1e9 } }; // a tank that keeps its heat: worth charging at night
      const cheap = operate("mpc", s, p);
      const dear = operate("mpc", { ...s, tSrc: Array(n).fill(40) }, p); // 5 K below the supply: charging lifts 3× as far
      const charged = (r: typeof cheap) => r.hp.reduce((a, h) => a + Math.max(0, h - 50), 0);
      expect(charged(cheap)).toBeGreaterThan(0);
      expect(charged(dear)).toBeLessThan(charged(cheap));
      expect(dear.totals.costEur).toBeGreaterThan(cheap.totals.costEur);
    });

    it("a tank's time constant from its size: a 43 m³ tank at U 0.3 W/m²K keeps its heat for weeks, not 48 h (audit P4)", () => {
      const kwh = 43 * 1.163 * 40; // 43 m³ between 50 and 90 °C
      const tau = tankTau(kwh, 50, 90);
      expect(tau).toBeGreaterThan(2000);
      expect(tau).toBeLessThan(2600);
      // half full (70 °C in a 20 °C room): the share of its content it loses in an hour
      const rcOf = (tauH: number): OpPlant => ({ ...plant, tankKwh: kwh, rc: { tMin: 50, tMax: 90, tAmb: 20, tauH, chargeKw: 1e9, dischargeKw: 1e9 } });
      const lossPct = (tauH: number) => 100 * (1 - tankStep({}, rcOf(tauH), 0, 1, kwh / 2).kept / (kwh / 2));
      expect(lossPct(48)).toBeGreaterThan(5); // the old default: 5.2 % an hour, empty within a day
      expect(lossPct(tau)).toBeLessThan(0.15);
      expect(tankTau(4 * kwh, 50, 90)).toBeGreaterThan(tau); // a bigger tank cools slower
    });

    it("a starting tank from the network's supply", () => {
      // τ from the size (tankTau): it was a fixed 48 h, 6 % lost an hour (audit P4)
      expect(defaultRc(4000, [70, 80, 65])).toEqual({ tMin: 65, tMax: 95, tAmb: 20, tauH: tankTau(4000, 65, 95), chargeKw: 1000, dischargeKw: 1000 });
      expect(defaultRc(4000, [70, 80, 65]).tauH).toBeGreaterThan(3000);
      expect(defaultRc(400, 50)).toMatchObject({ tMin: 50, tMax: 70 });
    });
  });

  it("a year of hours plans in reasonable time", () => {
    const N = 8760;
    const s: OpSeries = {
      src: Array(N).fill(500),
      cop: Array(N).fill(4),
      demand: Array(N).fill(300),
      price: Array.from({ length: N }, (_, i) => 0.2 + 0.1 * Math.sin(i / 4)),
      co2: Array(N).fill(0.4),
    };
    const t = performance.now();
    operate("mpc", s, { ...plant, hpKw: 600, tankKwh: 2000 });
    expect(performance.now() - t).toBeLessThan(8000);
  }, 10_000); // its own limit, not vitest's 5 s (about 4.5 s here)
});

// 1b-9: the tank was charged after the period's last demand (as lib/matching.ts was before 8a0316d): heat nobody draws,
// paid for in electricity and only lost
describe("no tank charged that nobody draws from again (as Heat Matching)", () => {
  const strategies = ["heat", "price", "mpc"] as const;
  it("with no demand at all: no electricity, the tank stays empty, in every strategy", () => {
    for (const st of strategies) {
      const r = operate(st, series({ demand: Array(n).fill(0) }), { ...plant, lossPctH: 1 });
      expect(r.totals.elecMwh).toBe(0);
      expect(Math.max(...r.level)).toBe(0);
    }
  });
  it("demand on the first day only: nothing charged from its last step on", () => {
    const demand = Array.from({ length: n }, (_, i) => (i < 24 ? 50 : 0));
    for (const st of strategies) {
      const r = operate(st, series({ demand }), { ...plant, lossPctH: 1 });
      for (let i = 23; i < n; i++) {
        expect(r.hp[i]).toBeCloseTo(i === 23 ? Math.max(0, 50 - r.fromTank[i]) : 0, 9); // the last demand, no more
        expect(r.level[i]).toBeLessThanOrEqual((i === 23 ? r.level[22] : r.level[i - 1]) + 1e-9); // only its loss and draws
      }
    }
    // Heat Matching's rule: the same plant through matchHeat charges nothing after its last demand either
    const m = matchHeat(Array(n).fill(1000), Array(n).fill(0), demand, 70, { ...DEFAULT_OPTIONS, physics: false, eta: 1, fixedCop: 4, recovery: "heatpump", hpCapacity: 100, tankKwh: 200, tankLossPct: 1, hpTauH: 0 });
    expect(m.hpElec.slice(24).every((x) => x === 0)).toBe(true);
    expect(operate("heat", series({ demand }), { ...plant, lossPctH: 1 }).elec.slice(24).every((x) => x === 0)).toBe(true);
  });
});

describe("the page's best case (summaryOf)", () => {
  // two scenarios: as set above (spread 1) and wider swings (spread 2), each with its own heat-led
  const totals = (costEur: number) => ({ costEur, co2T: costEur / 1000, elecMwh: 0, hpMwh: 0, backupMwh: 10, coolMwh: 0, coolEur: 0, coolT: 0, coveredPct: 100, runHours: 0, starts: 0 });
  const run = (id: number, heat: number, price: number, mpc: number) => ({
    id,
    price: [],
    demandMwh: 100,
    runs: Object.fromEntries(([["heat", heat], ["price", price], ["mpc", mpc]] as const).map(([k, c]) => [k, { totals: totals(c), years: [], months: [], hp: [], level: [] }])),
  }) as unknown as ScenarioRun;
  const scenarios = [{ id: 1, name: "As set above" }, { id: 2, name: "Storage of 8 h" }];

  it("compares the best run with heat-led in its own scenario, not the first one's (audit P8)", () => {
    const sum = summaryOf([run(1, 353_904, 352_000, 350_000), run(2, 362_465, 355_000, 340_000)], scenarios, "cost", false)!;
    expect(sum.best).toMatchObject({ scenario: "Storage of 8 h", strategy: "MPC (look-ahead)", costEur: 340_000 });
    expect(sum.base).toMatchObject({ scenario: "Storage of 8 h", costEur: 362_465 }); // before: 353,904, the first scenario's heat-led
    expect(sum.best.plantMwh).toBe(90);
  });

  it("a what-if on the demand or the heat is no plant to pick; nothing left: null", () => {
    const sum = summaryOf([run(1, 100, 99, 98), run(2, 50, 40, 30)], [scenarios[0], { id: 2, name: "Demand ×2", demandX: 2 }], "cost", false)!;
    expect(sum.best.scenario).toBe("As set above");
    expect(summaryOf([run(2, 50, 40, 30)], [{ id: 2, name: "Demand ×2", demandX: 2 }], "cost", false)).toBeNull();
  });

  it("another price spread is a market, not a plant: left out (before, the best case came from doubled price swings)", () => {
    const wider = [scenarios[0], { id: 2, name: "Wider price swings", spread: 2 }];
    expect(summaryOf([run(1, 100, 99, 98), run(2, 120, 90, 80)], wider, "cost", false)!.best.scenario).toBe("As set above");
    // the page at spread 2: a scenario set to 2 is at its prices, "as set above" too (its spread empty)
    expect(summaryOf([run(1, 100, 99, 98), run(2, 120, 90, 80)], wider, "cost", false, 2)!.best.scenario).toBe("Wider price swings");
    expect(summaryOf([run(1, 100, 99, 98), run(2, 120, 90, 80)], [scenarios[0], { id: 2, name: "Spread 1 typed", spread: 1 }], "cost", false)!.best.scenario).toBe("Spread 1 typed");
  });
});

describe("the data center's avoided cooling (the standalone model's cooling concepts)", () => {
  it("the wet bulb after Stull (2011): 20 °C at 50 % is 13.7 °C; no humidity: 5 K below", () => {
    expect(wetBulb(20, 50)).toBeCloseTo(13.7, 1);
    expect(wetBulb(20)).toBe(15);
  });

  it("free in the cold, partly free when mild, the chiller on warm days", () => {
    expect(coolingPerKwh(-5, 80)).toBe(0); // the tower water below the chilled water's 6.67 °C
    // wet bulb 4.67 °C: the tower at 9.67 °C free-cools (12 − 9.67)/(12 − 6.67) = 44 %; the chiller at its 25 °C condenser
    const cop25 = (COOLING.eta * (COOLING.tEvap + 273.15)) / (25 - COOLING.tEvap);
    expect(cop25).toBeCloseTo(6.87, 2);
    expect(coolingPerKwh(9.67)).toBeCloseTo((1 - (12 - 9.67) / (12 - 6.67)) / cop25, 4);
    // warm: no free cooling, the condenser above its minimum, the COP lower
    const warm = coolingPerKwh(30, 40);
    expect(warm).toBeGreaterThan(1 / cop25);
    expect(warm).toBeLessThan(0.25);
  });

  it("the rejectors: the dry cooler on the air, the adiabatic one sprays when hot, the hybrid dry when cool and wet when warm", () => {
    const wb = wetBulb(30, 40);
    const as = (rejection: Rejection) => ({ ...COOLING, rejection });
    expect(rejectorWater(30, wb, as("wet"))).toBeCloseTo(wb + 5, 9);
    expect(rejectorWater(30, wb, as("dry"))).toBe(38);
    expect(rejectorWater(30, wb, as("adiabatic"))).toBeCloseTo(30 - 0.7 * (30 - wb) + 8, 9); // above 25 °C: spraying
    expect(rejectorWater(20, wetBulb(20, 40), as("adiabatic"))).toBe(28); // below: dry
    expect(rejectorWater(10, 5, as("hybrid"))).toBe(rejectorWater(10, 5, as("dry")));
    expect(rejectorWater(30, wb, as("hybrid"))).toBe(rejectorWater(30, wb, as("wet")));
    // on a warm day the dry cooler costs the most, the wet tower the least; the dry cooler free-cools only in frost
    const per = (r: Rejection, t: number, rh: number) => coolingPerKwh(t, rh, as(r));
    expect(per("dry", 30, 40)).toBeGreaterThan(per("adiabatic", 30, 40));
    expect(per("adiabatic", 30, 40)).toBeGreaterThan(per("wet", 30, 40));
    expect(per("dry", 2, 80)).toBeGreaterThan(0); // 10 °C water: hardly free
    expect(per("dry", -5, 80)).toBe(0); // 3 °C water: fully free
  });

  it("a warm liquid cooling loop (return 45 °C, supply 35 °C) free-cools most of the year and needs far less", () => {
    const loop = { ...COOLING, rejection: "dry" as Rejection, tRet: 45, tEvap: 35 };
    expect(coolingPerKwh(20, 50, loop)).toBe(0); // 28 °C water below the loop's supply
    const hot = coolingPerKwh(30, 40, loop); // 38 °C water: 70 % free, a small lift for the rest (COP at its cap)
    expect(hot).toBeCloseTo(0.3 / COOLING.copMax, 6);
    expect(hot).toBeLessThan(coolingPerKwh(30, 40, { ...COOLING, rejection: "dry" }) / 3);
  });

  it("counted, it takes the heat taken from the source times the factor off the cost; heat-led runs as before", () => {
    const k = Array.from({ length: n }, (_, i) => (hour(i) >= 12 && hour(i) < 18 ? 0.2 : 0));
    const plain = operate("heat", series(), plant);
    const r = operate("heat", series({ cool: k }), plant);
    expect(r.hp).toEqual(plain.hp);
    const s = series();
    let kwh = 0,
      eur = 0;
    for (let i = 0; i < n; i++) {
      const c = Math.max(0, r.hp[i] - r.elec[i]) * k[i];
      kwh += c;
      eur += s.price[i] * c;
    }
    expect(r.totals.coolMwh).toBeCloseTo(kwh / 1000, 9);
    expect(r.totals.coolEur).toBeCloseTo(eur, 9);
    expect(r.totals.costEur).toBeCloseTo(plain.totals.costEur - eur, 9);
    expect(r.totals.co2T).toBeCloseTo(plain.totals.co2T - (0.4 * kwh) / 1000, 9);
    expect(plain.totals.coolMwh).toBe(0);
  });

  it("the MPC charges the tank where the data center's cooling is dearest, at a flat price", () => {
    const flat = series({ price: Array(n).fill(0.25) });
    const k = Array.from({ length: n }, (_, i) => (hour(i) >= 12 && hour(i) < 18 ? 0.2 : 0));
    const s = { ...flat, cool: k };
    const heat = operate("heat", s, plant).totals;
    const mpc = operate("mpc", s, plant).totals;
    expect(mpc.coveredPct).toBeCloseTo(100);
    expect(mpc.coolMwh).toBeGreaterThan(heat.coolMwh);
    expect(mpc.costEur).toBeLessThan(heat.costEur);
  });
});

describe("the market's price and CO₂ (SMARD)", () => {
  const h = 1704067200; // 1 January 2024, 0:00 UTC
  const hours = { times: [h, h + 3600], price_eur_mwh: [100, null], co2_g_kwh: [400, 300] };

  it("each step takes its hour's value, €/kWh and kg/kWh; null where the files have none", () => {
    const m = marketSeries([h, h + 1800, h + 3600, h + 7200], hours);
    expect(m.spot).toEqual([0.1, 0.1, null, null]);
    expect(m.co2).toEqual([0.4, 0.4, 0.3, null]);
  });

  it("the spot plus the fees, its swings around its mean times the spread; a step without a value from the synthetic year", () => {
    const times = [h, h + 3600, h + 7200];
    const m = { spot: [0.05, 0.15, null], co2: [0.4, 0.3, null] };
    const one = marketPrice(times, m, 1, 0.14);
    expect(one.price[0]).toBeCloseTo(0.19, 9);
    expect(one.price[1]).toBeCloseTo(0.29, 9);
    expect(one.price[2]).toBeCloseTo(syntheticPrice(times, 1, 0.14).price[2], 9);
    expect(one.co2.slice(0, 2)).toEqual([0.4, 0.3]);
    expect(one.missing).toEqual({ price: 1, co2: 1 });
    const two = marketPrice(times, m, 2, 0.14); // mean 0.10: 0.05 → 0.00, 0.15 → 0.20
    expect(two.price[0]).toBeCloseTo(0.14, 9);
    expect(two.price[1]).toBeCloseTo(0.34, 9);
  });
});

describe("the worker's job (operationJob)", () => {
  const input = {
    times: [0, 3600],
    q: [10, 20],
    cop: [4, 4],
    demand: [5, 5],
    supply: [70, 70],
    tSrc: [20, 20],
    stepHours: 0.25,
    horizonH: 24,
    objective: "cost" as const,
    fees: 0.14,
    market: null,
    cool: null,
    plant: { ...plant, rc: { tMin: 40, tMax: 80, tAmb: 15, tauH: 2000, chargeKw: 50, dischargeKw: 40 } },
    spread: 1.5,
    scenarios: [
      { id: 1, name: "As set above", hpKw: null, tankKwh: null, spread: null },
      { id: 2, name: "Bigger tank", hpKw: 300, tankKwh: 800, spread: 2, demandX: 2, supplyX: null },
    ],
  };

  it("fills a scenario's empty fields from the plant and the prices as set", () => {
    const j = operationJob(7, input);
    expect(j).toMatchObject({ seq: 7, src: input.q, dt: 0.25, horizon: 96, direct: null, market: null, cool: null });
    expect(j.scenarios[0]).toEqual({ id: 1, plant: input.plant, spread: 1.5, demandX: 1, supplyX: 1 });
    expect(j.scenarios[1]).toMatchObject({ id: 2, spread: 2, demandX: 2, supplyX: 1, plant: { hpKw: 300, tankKwh: 800 } });
  });

  it("an RC tank's kW grow with a scenario's tank; the look-ahead is at least one step", () => {
    const j = operationJob(1, { ...input, horizonH: 0.1, stepHours: 1 });
    expect(j.horizon).toBe(1);
    expect(j.scenarios[1].plant.rc).toMatchObject({ chargeKw: 200, dischargeKw: 160 }); // 800 of 200 kWh: × 4
    expect(j.scenarios[0].plant.rc).toBe(input.plant.rc); // the same tank: the same object
    expect(operationJob(1, { ...input, plant: { ...input.plant, tankKwh: 0 } }).scenarios[1].plant.rc).toMatchObject({ chargeKw: 50 }); // no tank to grow from
  });
});

describe("the price defaults follow the heat network's (networkCost.ts)", () => {
  it("fees: its electricity less the synthetic year's mean spot; backup: its peak boiler's gas and CO₂", () => {
    const t0 = Date.UTC(2024, 0, 1) / 1000;
    const spot = syntheticPrice(Array.from({ length: 8784 }, (_, i) => t0 + i * 3600), 1, 0).price;
    const mean = spot.reduce((a, b) => a + b) / spot.length;
    const p = DEFAULT_PARAMS;
    expect(mean + FEES_EUR_KWH).toBeCloseTo(p.elecPrice / 1000, 2);
    expect(BACKUP_EUR_KWH).toBeCloseTo((p.gasPrice + CO2.gas * p.co2Price) / (p.boilerEffPct / 100) / 1000, 3);
  });
});
