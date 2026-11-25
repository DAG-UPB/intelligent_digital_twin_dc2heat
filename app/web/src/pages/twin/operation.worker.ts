/**
 * Runs Operation's heat pump strategies off the page's thread (operation.ts): each scenario's prices, the three
 * strategies over the year, and each run's totals, its years and months, and its steps for the charts. The MPC plans
 * every step of a year, a second or so for several scenarios: here the page stays responsive meanwhile.
 */
import { breakdown, marketPrice, operate, STRATEGIES, syntheticPrice, type MarketSeries, type Objective, type OpPlant, type Strategy } from "./operation";

export interface OperationJob {
  seq: number;
  times: number[];
  src: number[];
  cop: number[];
  demand: number[];
  supply: number[]; // °C the network's supply per step (the RC tank serves only above it)
  tSrc: number[]; // °C the heat pump's source per step (charging the RC tank lifts higher)
  dt: number;
  horizon: number; // steps
  objective: Objective;
  fees: number;
  market?: MarketSeries | null; // SMARD's price and CO₂ per step; none: the synthetic year
  cool?: number[] | null; // the data center's cooling electricity per kWh of heat per step (coolingPerKwh); none: not counted
  direct?: boolean[] | null; // the steps the source feeds in directly (OpSeries.direct); none: never
  scenarios: { id: number; plant: OpPlant; spread: number; demandX: number; supplyX: number }[]; // the what-ifs: demand and heat times x
}

export interface StrategyRun {
  totals: ReturnType<typeof operate>["totals"];
  years: [number, ReturnType<typeof breakdown>["years"] extends Map<number, infer V> ? V : never][];
  months: ReturnType<typeof breakdown>["months"];
  hp: number[];
  level: number[];
}
export interface ScenarioRun {
  id: number;
  price: number[];
  demandMwh: number; // the scenario's demand over the period
  runs: Record<Strategy, StrategyRun>;
}

export function runJob(j: OperationJob): ScenarioRun[] {
  return j.scenarios.map((sc) => {
    const prices = j.market ? marketPrice(j.times, j.market, sc.spread, j.fees) : syntheticPrice(j.times, sc.spread, j.fees);
    const times = (v: number[], x: number) => (x === 1 ? v : v.map((y) => y * x));
    const s = { src: times(j.src, sc.supplyX), cop: j.cop, demand: times(j.demand, sc.demandX), supply: j.supply, tSrc: j.tSrc, price: prices.price, co2: prices.co2, cool: j.cool ?? undefined, direct: j.direct ?? undefined };
    const runs = Object.fromEntries(
      STRATEGIES.map((st) => {
        const r = operate(st.id, s, sc.plant, j.dt, j.objective, j.horizon);
        const b = breakdown(r, s, sc.plant, j.times, j.dt);
        return [st.id, { totals: r.totals, years: [...b.years], months: b.months, hp: r.hp, level: r.level }];
      }),
    ) as Record<Strategy, StrategyRun>;
    return { id: sc.id, price: prices.price, demandMwh: (s.demand.reduce((a, b) => a + b, 0) * j.dt) / 1000, runs };
  });
}

self.onmessage = (e: MessageEvent<OperationJob>) => self.postMessage({ seq: e.data.seq, out: runJob(e.data) });
