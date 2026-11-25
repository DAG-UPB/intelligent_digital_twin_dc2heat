/**
 * Operating the heat pump and its storage: when the heat pump runs and the tank charges, under three strategies, over
 * the same data (the data center's heat and its temperature, the district's demand) and the same plant:
 *
 *   heat-led   the heat pump follows the demand, a surplus charges the tank (Heat Matching's matchHeat does the same)
 *   price      a rule: charge the tank in the day's cheap hours (price at or below the day's median), else let it serve first
 *   mpc        model predictive control: every step it plans the next `horizon` steps by dynamic programming over the
 *              tank's level (cost of electricity and of backup heat, minus the heat left in the tank valued at λ),
 *              applies only the first step, and the plant decides what really happens (plant in the loop)
 *
 * The plant: the heat pump's output limited by its capacity and by the source (Q ≤ Q_src · COP / (COP − 1)), rising
 * towards a higher set point with its time constant τ (1 − e^(−Δt/τ) per step: start-up, the condenser water warming
 * up; a step gives its mean, as Heat Matching's); the tank's level with its standing loss, empty at the start; what
 * neither covers is backup heat (a boiler or bought district heat).
 * The tank is either an energy bucket (kWh, a flat loss in % per hour) or, with `rc`, a store with a temperature
 * (a 1-node RC model, from the old idz app's thermalStorageControl.ts): its heat capacity C = capacity / (full − empty
 * temperature), its loss towards the room with the time constant τ (T → T_amb + (T − T_amb)·e^(−Δt/τ)), charge and
 * discharge limited in kW, and it serves the network only above the network's supply temperature of the step. Heat
 * the heat pump puts into the RC tank is delivered above the tank's temperature, at a lower COP (`chargeCop`).
 * The objective is cost (€) or CO₂ (kg), each from per-step prices or factors.
 * Following an earlier MPC prototype (receding horizon, terminal value instead of a hard end level, plant in the loop), with
 * a grid DP instead of an LP solver, so it runs in the page with no dependency. Pure: no React, no fetching.
 */
import { carnotRaw } from "../../lib/matching";
import { CO2 } from "../../lib/partKpis";
import type { OperationJob, ScenarioRun } from "./operation.worker";

export type Strategy = "heat" | "price" | "mpc";
export const STRATEGIES: { id: Strategy; label: string; about: string }[] = [
  { id: "heat", label: "Heat-led", about: "The heat pump follows the demand; a surplus charges the tank." },
  { id: "price", label: "Price rule", about: "Charge the tank in the day's cheap hours, else let it serve first." },
  { id: "mpc", label: "MPC (look-ahead)", about: "Plans the next hours by optimisation, applies the first, plans again." },
];

export interface OpSeries {
  src: number[]; // kW heat the data center offers
  cop: number[]; // the heat pump's COP per step (Carnot formula or its plant model)
  demand: number[]; // kW
  price: number[]; // €/kWh electricity
  co2: number[]; // kg/kWh grid electricity
  supply?: number[]; // °C the network's supply per step: the RC tank serves only above it (none: from its empty temperature)
  tSrc?: number[]; // °C the heat pump's source per step: charging the RC tank above the supply then costs COP (none: it does not)
  // kWh of electricity the data center's cooling spends per kWh of heat it rejects, per step (coolingPerKwh): the heat
  // the heat pump takes it need not cool, credited at the step's price or CO₂ (none: not counted)
  cool?: number[];
  // steps where the source is hot enough to feed the network directly (Heat Matching's direct HEX, its path that step):
  // its heat serves the demand and the tank with no heat pump and no electricity, at most the source's (none: never)
  direct?: boolean[];
}

/**
 * The data center's cooling concepts of a standalone data center model (only its cooling, not its load profile): the heat goes to a heat rejector that free-cools what it can, and a Carnot chiller lifts the rest, with
 * that model's parameters. Chilled water 6.67 °C supply, 12 °C return; the chiller
 * at 0.45 of Carnot, its condenser 5 K above the rejector's water and at least 25 °C (head-pressure control), at most
 * COP 10. The rejectors (`REJECTIONS`): a wet cooling tower (5 K above the wet bulb, the model's baseline), a dry
 * cooler (8 K above the air), an adiabatic one (dry, above 25 °C spraying: the air cooled 70 % of the way to the wet
 * bulb) and a hybrid (dry below 15 °C, wet above). Fans and pumps (under 0.1 % of the load there) are left out.
 */
export type Rejection = "wet" | "dry" | "adiabatic" | "hybrid";
export const REJECTIONS: { id: Rejection; label: string }[] = [
  { id: "wet", label: "Wet cooling tower" },
  { id: "dry", label: "Dry cooler" },
  { id: "adiabatic", label: "Adiabatic cooler" },
  { id: "hybrid", label: "Hybrid cooler" },
];
export interface Cooling {
  rejection: Rejection;
  tEvap: number; // °C chilled water supply
  tRet: number; // °C chilled water return
  approach: number; // K wet tower water above the wet bulb
  dryApproach: number; // K dry cooler water above the air
  adiabaticFrom: number; // °C outdoors from which the adiabatic cooler sprays
  adiabaticEff: number; // how far spraying cools the air towards the wet bulb
  hybridWetFrom: number; // °C outdoors from which the hybrid runs wet
  dtCw: number; // K condenser water warming
  tCondMin: number; // °C the condenser at least
  eta: number; // the chiller's share of Carnot
  copMax: number;
}
export const COOLING: Cooling = {
  rejection: "wet",
  tEvap: 6.67,
  tRet: 12,
  approach: 5,
  dryApproach: 8,
  adiabaticFrom: 25,
  adiabaticEff: 0.7,
  hybridWetFrom: 15,
  dtCw: 5,
  tCondMin: 25,
  eta: 0.45,
  copMax: 10,
};

/** The heat rejector's water, °C, at an outdoor °C and wet bulb (`_rejector_state`; the wet tower's frost limit of 4 °C changes nothing here: it free-cools fully below 6.67 °C). */
export function rejectorWater(tOut: number, wb: number, c: Cooling = COOLING): number {
  const r = c.rejection === "hybrid" ? (tOut < c.hybridWetFrom ? "dry" : "wet") : c.rejection;
  if (r === "wet") return wb + c.approach;
  const air = r === "adiabatic" && tOut > c.adiabaticFrom ? tOut - c.adiabaticEff * (tOut - wb) : tOut;
  return air + c.dryApproach;
}

/** The wet-bulb temperature, °C, after Stull (2011) from the air's °C and relative humidity in %; no humidity: 5 K below. */
export function wetBulb(t: number, rh?: number | null): number {
  if (rh == null || !Number.isFinite(rh)) return t - 5;
  const h = Math.min(99, Math.max(5, rh));
  return (
    t * Math.atan(0.151977 * Math.sqrt(h + 8.313659)) +
    Math.atan(t + h) -
    Math.atan(h - 1.676331) +
    0.00391838 * h ** 1.5 * Math.atan(0.023101 * h) -
    4.686035
  );
}

/**
 * kWh of electricity the data center's cooling spends per kWh of heat it rejects, at an outdoor °C and humidity (%):
 * the share its rejector cannot free-cool, 1 − clip((T_ret − T_water)/(T_ret − T_evap)), over the chiller's COP between
 * the chilled water and the condenser (Cooling). Heat the heat pump takes ahead of the cooling (from the
 * hall's return, `hp_airside` there) is that much electricity the data center does not spend.
 */
export function coolingPerKwh(tOut: number, rh?: number | null, c: Cooling = COOLING): number {
  const wb = wetBulb(tOut, rh);
  const water = rejectorWater(tOut, wb, c);
  const free = Math.min(1, Math.max(0, (c.tRet - water) / (c.tRet - c.tEvap)));
  const tCond = Math.max(water + c.dtCw, c.tCondMin);
  if (tCond <= c.tEvap) return 0;
  const cop = Math.min(c.copMax, (c.eta * (c.tEvap + 273.15)) / (tCond - c.tEvap));
  return (1 - free) / cop;
}

/** The tank with a temperature (1-node RC model): `OpPlant.tankKwh` is its capacity between `tMin` and `tMax`. */
export interface TankRc {
  tMin: number; // °C empty
  tMax: number; // °C full
  tAmb: number; // °C around the tank (its loss goes there)
  tauH: number; // h, its time constant C/UA: the larger, the slower it cools
  chargeKw: number; // kW at most into it
  dischargeKw: number; // kW at most out of it
}

export interface OpPlant {
  hpKw: number; // thermal capacity
  tauH: number; // h, time constant of its output (0: at once)
  tankKwh: number;
  lossPctH: number; // % of the content per hour (the bucket; the RC tank's loss follows its temperature)
  backupPrice: number; // €/kWh heat from the backup
  backupCo2: number; // kg/kWh heat from the backup
  rc?: TankRc | null; // the tank with a temperature; none: an energy bucket
  startKwh?: number; // kWh in the tank at the start; none: empty, as Heat Matching's (no strategy gets free heat)
}

/** W/m²K through a buffer tank's insulation (about 10 cm of mineral wool): its time constant follows from it. */
const TANK_U = 0.3;

/**
 * A tank's time constant C/UA, h, from its size: water for its kWh between `tMin` and `tMax` (1.163 kWh per m³ and K),
 * a standing cylinder twice as high as wide, TANK_U through all of its surface. A 43 m³ tank: about 2,300 h; it grows
 * with the size (the volume against the surface).
 */
export function tankTau(tankKwh: number, tMin: number, tMax: number): number {
  const C = Math.max(0, tankKwh) / Math.max(1, tMax - tMin); // kWh/K
  const r = (C / 1.163 / (4 * Math.PI)) ** (1 / 3); // m: V = π r² · 4r
  const ua = (TANK_U * 10 * Math.PI * r * r) / 1000; // kW/K: two ends 2πr² and the side 8πr²
  return ua > 0 ? Math.round(C / ua) : 1;
}

/**
 * A starting RC tank (as the idz app's defaultStorageParams): empty at the network's lowest supply, full 20 K above its
 * highest (at most 95 °C, water), in a room at 20 °C, its time constant from its size (tankTau; the idz app's fixed
 * 48 h lost 6 % an hour, about 50 times too much), charged or emptied in 4 h at full power.
 */
export function defaultRc(tankKwh: number, supply: number | number[]): TankRc {
  const s = typeof supply === "number" ? [supply] : supply.length ? supply : [70];
  let lo = Infinity,
    hi = -Infinity;
  for (const v of s) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const tMin = Math.round(Math.max(30, lo));
  const kw = Math.round(Math.max(0, tankKwh) / 4);
  const tMax = Math.min(95, Math.round(Math.max(hi, tMin) + 20));
  return { tMin, tMax, tAmb: 20, tauH: tankTau(tankKwh, tMin, tMax), chargeKw: kw, dischargeKw: kw };
}

/** The RC tank's temperature at a level (kWh above empty). */
export const tankTemp = (rc: TankRc, tankKwh: number, level: number) =>
  tankKwh > 0 ? rc.tMin + (level / tankKwh) * Math.max(1e-6, rc.tMax - rc.tMin) : rc.tMin;

/**
 * The tank over step i before it is charged or emptied: what is left after its loss (kWh), and in kW what it can take
 * and what it can give the network. The bucket: a flat loss, all of it usable. The RC tank: it cools towards the room
 * with τ, takes and gives at most its kW, and gives only the heat above the step's supply temperature.
 */
export function tankStep(s: Pick<OpSeries, "supply">, p: OpPlant, i: number, dt: number, level: number) {
  const cap = Math.max(0, p.tankKwh);
  const rc = p.rc;
  if (!rc || cap <= 0) {
    const kept = Math.min(cap, level * (1 - Math.min(1, p.lossPctH / 100)) ** dt);
    return { kept, room: (cap - kept) / dt, give: kept / dt, temp: null };
  }
  const C = cap / Math.max(1e-6, rc.tMax - rc.tMin); // kWh per K
  const t = rc.tAmb + (tankTemp(rc, cap, level) - rc.tAmb) * Math.exp(-dt / Math.max(1e-6, rc.tauH));
  const kept = Math.min(cap, Math.max(0, C * (t - rc.tMin)));
  const need = Math.max(rc.tMin, s.supply?.[i] ?? rc.tMin); // too cold for the network: that heat stays in
  const usable = Math.max(0, kept - C * (need - rc.tMin));
  return {
    kept,
    room: Math.max(0, Math.min(rc.chargeKw, (cap - kept) / dt)),
    give: Math.max(0, Math.min(rc.dischargeKw, usable / dt)),
    temp: Math.max(rc.tMin, t) as number | null, // °C after the loss (the RC tank only)
  };
}

/** K the heat pump delivers above what it heats: the tank's temperature (or the supply), to get the heat in. */
export const CHARGE_DT = 5;

/** The Carnot COP's temperature part, T_hot[K] / lift (at least 5 K): lib/matching.ts's kernel, unclamped. */
const carnot = (tHot: number, tSrc: number) => carnotRaw(tSrc, tHot);

/**
 * The heat pump's COP for the heat it puts into the RC tank at step i: it delivers CHARGE_DT above the tank's
 * temperature `tankT`, and at least CHARGE_DT above the supply, so it lifts higher and its COP falls. The step's COP
 * (the Carnot formula or a plant model, at the supply) scaled by the Carnot COPs at the two temperatures (its
 * efficiency cancels). The bucket, or no source temperature: the step's COP.
 */
export function chargeCop(s: Pick<OpSeries, "cop" | "supply" | "tSrc">, p: OpPlant, i: number, tankT: number | null): number {
  const cop = Math.max(1.1, s.cop[i]);
  const tSrc = s.tSrc?.[i];
  if (!p.rc || tankT === null || tSrc === undefined) return cop;
  const sup = s.supply?.[i] ?? p.rc.tMin;
  const tCharge = Math.max(sup, tankT) + CHARGE_DT;
  return Math.max(1.1, (cop * carnot(tCharge, tSrc)) / carnot(sup, tSrc));
}

export type Objective = "cost" | "co2";

export interface OpResult {
  hp: number[]; // kW heat from the heat pump (to the demand and into the tank)
  direct: number[]; // kW heat the source fed in directly (OpSeries.direct; to the demand and into the tank)
  elec: number[]; // kW its electricity
  fromTank: number[];
  backup: number[]; // kW heat the backup gives
  level: number[]; // kWh in the tank at the end of the step
  // costEur and co2T: net of the data center's avoided cooling where it is counted (OpSeries.cool), coolMwh its electricity
  totals: {
    costEur: number;
    co2T: number;
    elecMwh: number;
    hpMwh: number;
    backupMwh: number;
    coolMwh: number;
    coolEur: number;
    coolT: number;
    coveredPct: number;
    runHours: number;
    starts: number;
    heatLed?: boolean; // the MPC ran heat-led: its plan cost more over the period (operate)
  };
}

/** kW of the data center's cooling electricity a step avoids: the heat taken from the source (heat − electricity; direct heat all of it). */
const avoided = (s: Pick<OpSeries, "cool">, i: number, hp: number, elec: number) => (s.cool ? Math.max(0, hp - elec) * Math.max(0, s.cool[i] ?? 0) : 0);

const LEVELS = 21; // the tank's levels on the MPC's grid (5 % steps), its value interpolated between them
const CONTROLS = 10; // the heat pump's set points the MPC weighs: off to full in 10 % steps (and just the demand)

/** What the heat pump can make at step i: its capacity, or the source's heat lifted (source · COP / (COP − 1)); a
 * direct step (OpSeries.direct): the source's heat. */
export const hpMax = (s: Pick<OpSeries, "src" | "cop" | "direct">, p: Pick<OpPlant, "hpKw">, i: number) => {
  if (s.direct?.[i]) return Math.max(0, s.src[i]);
  const cop = Math.max(1.1, s.cop[i]);
  return Math.max(0, Math.min(p.hpKw, (Math.max(0, s.src[i]) * cop) / (cop - 1)));
};

/**
 * What the heat pump can make at step i when the demand `d` is made at the step's COP and the rest goes into the tank
 * at `copC` (chargeCop): a kWh of heat takes 1 − 1/COP from the source, so at the lower COP into the tank the same
 * source gives more heat (more of it from electricity). At most its capacity. copC = COP: hpMax. A direct step: the
 * source's heat.
 */
export function hpLimit(s: Pick<OpSeries, "src" | "cop" | "direct">, p: Pick<OpPlant, "hpKw">, i: number, d: number, copC: number): number {
  const src = Math.max(0, s.src[i]);
  if (s.direct?.[i]) return src;
  const a = 1 - 1 / Math.max(1.1, s.cop[i]);
  const b = 1 - 1 / Math.max(1.1, copC);
  const made = src <= d * a ? src / a : d + (src - d * a) / b;
  return Math.max(0, Math.min(p.hpKw, made));
}

/**
 * One step of the plant: the heat pump asked for `want` kW (at most its lagged limit), the tank and the backup cover the
 * rest. Rising from `prev` (its output at the step's start) it gives the step's mean of the first-order rise, as
 * matchHeat (lib/matching.ts) does, and `end` is its output at the step's end, the next step's start. A direct step
 * (OpSeries.direct): the source's heat as it comes, whatever was asked (it is free), the heat pump off. `store` false: the
 * tank takes nothing (from the period's last step with a demand on, as matchHeat: that heat would never be drawn).
 */
function step(s: OpSeries, p: OpPlant, i: number, dt: number, level: number, prev: number, want: number, store = true) {
  const lagF = p.tauH > 0 ? 1 - Math.exp(-dt / p.tauH) : 1;
  const meanF = p.tauH > 0 ? 1 - (p.tauH / dt) * lagF : 1;
  const direct = !!s.direct?.[i];
  const d = Math.max(0, s.demand[i]);
  const tank = tankStep(s, p, i, dt, level);
  const copC = chargeCop(s, p, i, tank.temp);
  const max = hpLimit(s, p, i, d, copC);
  const rising = !direct && max > prev;
  const ceiling = rising ? prev + (max - prev) * meanF : max;
  let l = tank.kept;
  const hp = Math.max(0, Math.min(direct ? Infinity : want, ceiling, d + (store ? tank.room : 0))); // what is neither used nor stored is not made
  const toDemand = Math.min(hp, d);
  const charge = hp - toDemand;
  const fromTank = Math.min(d - toDemand, tank.give);
  l += (charge - fromTank) * dt;
  const backup = d - toDemand - fromTank;
  const elec = direct ? 0 : toDemand / Math.max(1.1, s.cop[i]) + (charge > 0 ? charge / copC : 0);
  // still rising at full output: it ends the step higher; held back by the demand or the tank: it runs at that
  const end = direct ? 0 : rising && hp >= ceiling - 1e-9 ? prev + (max - prev) * lagF : hp;
  return { hp: direct ? 0 : hp, direct: direct ? hp : 0, elec, fromTank, backup, level: Math.min(p.tankKwh, Math.max(0, l)), end };
}

/** The heat pump's set point at step i under a rule-based strategy. */
function ruleWant(strategy: "heat" | "price", s: OpSeries, p: OpPlant, i: number, level: number, dt: number, cheap: boolean) {
  const d = Math.max(0, s.demand[i]);
  if (strategy === "heat" || cheap) return Infinity; // as much as it can: the demand, then the tank
  // expensive: the tank serves first, as much as it can give after its standing loss (as step() draws it; before, the
  // bucket's level before the loss: the step's loss was bought as backup)
  return Math.max(0, d - tankStep(s, p, i, dt, level).give);
}

/** The day's median price of each step (the rule's threshold), days by `stepsPerDay`. */
export function dailyMedian(price: number[], stepsPerDay: number): number[] {
  const out: number[] = [];
  for (let a = 0; a < price.length; a += stepsPerDay) {
    const day = price.slice(a, a + stepsPerDay);
    const sorted = [...day].sort((x, y) => x - y);
    const m = sorted[Math.floor((sorted.length - 1) / 2)];
    for (let k = 0; k < day.length; k++) out.push(m);
  }
  return out;
}

/**
 * The MPC's plan from step i: the heat pump's set point of the first step, by backward dynamic programming over the
 * tank's level on a grid of LEVELS, over `h` steps. Cost per step: the objective's weight of its electricity and of the
 * backup heat; the end level is worth λ per kWh (what that heat would cost to make later), so the plan neither empties
 * the tank for nothing nor fills it at any price. The lag is left to the plant (it is applied when the step runs).
 */
function mpcWant(s: OpSeries, p: OpPlant, i: number, h: number, dt: number, level: number, obj: Objective): number {
  const n = Math.min(h, s.demand.length - i);
  if (p.tankKwh <= 0 || n <= 0) return Infinity;
  const cell = p.tankKwh / (LEVELS - 1);
  const elecW = (j: number) => (obj === "cost" ? s.price[j] : s.co2[j]);
  const backW = obj === "cost" ? p.backupPrice : p.backupCo2;
  const coolK = (j: number) => (s.cool ? Math.max(0, s.cool[j] ?? 0) : 0);
  // λ: the median electricity weight over the horizon per kWh of heat (÷ COP; less the data center's cooling it avoids
  // on the 1 − 1/COP it takes from the source, where that is counted), at most the backup's
  const ws: number[] = [];
  let copSum = 0,
    kSum = 0;
  let hpSteps = 0;
  for (let j = i; j < i + n; j++) {
    ws.push(elecW(j));
    kSum += coolK(j);
    if (s.direct?.[j]) continue; // the direct steps' heat costs nothing
    copSum += Math.max(1.1, s.cop[j]);
    hpSteps++;
  }
  ws.sort((a, b) => a - b);
  const copM = hpSteps ? copSum / hpSteps : Infinity;
  const lambda = Math.min(backW, ws[Math.floor(ws.length / 2)] * (1 / copM - (kSum / n) * (1 - 1 / copM)));
  // V between the grid's levels: linear (the level after a step is anywhere, not only on the grid)
  const at = (V: Float64Array, l: number) => {
    const x = Math.min(LEVELS - 1, Math.max(0, l / cell));
    const k = Math.min(LEVELS - 2, Math.floor(x));
    return V[k] + (V[k + 1] - V[k]) * (x - k);
  };
  // the best of the heat pump's set points (CONTROLS steps from off to full, and just the demand) from level l: the
  // tank takes what is left over (up to full, at most its kW), gives what is missing (what it can give), the backup the rest
  const out = { hp: 0 };
  // the electricity of `made` kW, the heat into the tank at its own COP (chargeCop); k: the data center's cooling
  // electricity per kWh it need not reject (the heat taken from the source, made − el), credited at the same weight
  const best = (V: Float64Array, tank: ReturnType<typeof tankStep>, max: number, d: number, cop: number, copC: number, w: number, k: number) => {
    const { kept, room, give } = tank;
    let m = Infinity;
    for (let c = 0; c <= CONTROLS + 1; c++) {
      const u = c <= CONTROLS ? (max * c) / CONTROLS : Math.min(max, d);
      let made = u,
        l2: number,
        back = 0,
        el = u / cop;
      if (u >= d) {
        const charge = Math.min(u - d, room);
        made = d + charge;
        el = d / cop + charge / copC;
        l2 = kept + charge * dt;
      } else {
        const fromTank = Math.min(d - u, give);
        back = d - u - fromTank;
        l2 = kept - fromTank * dt;
      }
      const cost = (w * (el - k * Math.max(0, made - el)) + backW * back) * dt + at(V, l2);
      if (cost < m) {
        m = cost;
        out.hp = made;
      }
    }
    return m;
  };
  // backward: V[k] = the best cost from level k·cell at step j to the end (plain loops: it runs every step of a year)
  let V = new Float64Array(LEVELS);
  const W = new Float64Array(LEVELS);
  for (let k = 0; k < LEVELS; k++) V[k] = -lambda * k * cell;
  // a direct step's heat takes no electricity: an infinite COP
  const copOf = (j: number) => (s.direct?.[j] ? Infinity : Math.max(1.1, s.cop[j]));
  const copCOf = (j: number, tank: ReturnType<typeof tankStep>) => (s.direct?.[j] ? Infinity : chargeCop(s, p, j, tank.temp));
  for (let j = i + n - 1; j > i; j--) {
    const d = Math.max(0, s.demand[j]),
      cop = copOf(j),
      w = elecW(j);
    for (let k = 0; k < LEVELS; k++) {
      const tank = tankStep(s, p, j, dt, k * cell);
      const copC = copCOf(j, tank);
      W[k] = best(V, tank, hpLimit(s, p, j, d, copC), d, cop, copC, w, coolK(j));
    }
    V = Float64Array.from(W);
  }
  // the first step from the true level
  const tank = tankStep(s, p, i, dt, level);
  const d0 = Math.max(0, s.demand[i]);
  const copC0 = copCOf(i, tank);
  best(V, tank, hpLimit(s, p, i, d0, copC0), d0, copOf(i), copC0, elecW(i), coolK(i));
  return out.hp;
}

/**
 * Run one strategy over the series. `horizon` steps of look-ahead for the MPC. Its plan ignores the heat pump's time
 * constant τ: with a slow heat pump (or a short look-ahead) it turns the heat pump down and cannot get it back up in
 * time, and costs more than heat-led. Then it runs heat-led (`totals.heatLed`): never worse than following the demand.
 */
export function operate(strategy: Strategy, s: OpSeries, p: OpPlant, dt = 1, obj: Objective = "cost", horizon = 24): OpResult {
  if (strategy !== "mpc") return run(strategy, s, p, dt, obj, horizon);
  const mpc = run("mpc", s, p, dt, obj, horizon);
  const heat = run("heat", s, p, dt, obj, horizon);
  const val = (r: OpResult) => (obj === "cost" ? r.totals.costEur : r.totals.co2T);
  return val(mpc) <= val(heat) + 1e-9 ? mpc : { ...heat, totals: { ...heat.totals, heatLed: true } };
}

function run(strategy: Strategy, s: OpSeries, p: OpPlant, dt: number, obj: Objective, horizon: number): OpResult {
  const n = Math.min(s.src.length, s.cop.length, s.demand.length, s.price.length, s.co2.length);
  const r: OpResult = {
    hp: [],
    direct: [],
    elec: [],
    fromTank: [],
    backup: [],
    level: [],
    totals: { costEur: 0, co2T: 0, elecMwh: 0, hpMwh: 0, backupMwh: 0, coolMwh: 0, coolEur: 0, coolT: 0, coveredPct: 0, runHours: 0, starts: 0 },
  };
  let coolE = 0,
    coolEur = 0,
    coolKg = 0;
  const median = strategy === "price" ? dailyMedian(s.price.slice(0, n), Math.max(1, Math.round(24 / dt))) : [];
  let level = Math.min(p.tankKwh, Math.max(0, p.startKwh ?? 0)); // empty at the start, as Heat Matching's tank
  let lastDraw = -1; // the last step with a demand: what is charged from it on is never drawn (as matchHeat)
  for (let i = n - 1; i >= 0 && lastDraw < 0; i--) if (s.demand[i] > 0) lastDraw = i;
  let prev = 0;
  let cost = 0,
    co2 = 0,
    elec = 0,
    hpE = 0,
    back = 0,
    dem = 0,
    runs = 0,
    starts = 0;
  for (let i = 0; i < n; i++) {
    const want =
      strategy === "mpc" ? mpcWant(s, p, i, horizon, dt, level, obj) : ruleWant(strategy, s, p, i, level, dt, strategy === "price" && s.price[i] <= median[i]);
    const o = step(s, p, i, dt, level, prev, want, i < lastDraw);
    if (o.hp > 1e-6 && prev <= 1e-6) starts++;
    if (o.hp > 1e-6) runs += dt;
    prev = o.end;
    level = o.level;
    r.hp.push(o.hp);
    r.direct.push(o.direct);
    r.elec.push(o.elec);
    r.fromTank.push(o.fromTank);
    r.backup.push(o.backup);
    r.level.push(o.level);
    const c = avoided(s, i, o.hp + o.direct, o.elec);
    cost += (s.price[i] * (o.elec - c) + p.backupPrice * o.backup) * dt;
    co2 += (s.co2[i] * (o.elec - c) + p.backupCo2 * o.backup) * dt;
    coolE += c * dt;
    coolEur += s.price[i] * c * dt;
    coolKg += s.co2[i] * c * dt;
    elec += o.elec * dt;
    hpE += o.hp * dt;
    back += o.backup * dt;
    dem += Math.max(0, s.demand[i]) * dt;
  }
  r.totals = {
    costEur: cost,
    co2T: co2 / 1000,
    elecMwh: elec / 1000,
    hpMwh: hpE / 1000,
    backupMwh: back / 1000,
    coolMwh: coolE / 1000,
    coolEur,
    coolT: coolKg / 1000,
    coveredPct: dem ? (100 * (dem - back)) / dem : 0,
    runHours: runs,
    starts,
  };
  return r;
}

/**
 * The page's price defaults, in step with the heat network's economics (district/networkCost.ts DEFAULT_PARAMS, its
 * sources; operation.test.ts checks it): its electricity, 179 €/MWh for industry (BDEW), is the synthetic year's mean
 * spot (0.080 €/kWh) plus these fees and levies; its peak boiler's heat, gas 60 €/MWh and CO₂ 60 €/t burnt at 95 %,
 * costs 0.076 €/kWh. Before, 0.14 and 0.11: electricity about a third dearer than the network's, the backup half again.
 */
export const FEES_EUR_KWH = 0.1;
export const BACKUP_EUR_KWH = 0.076;

/**
 * A synthetic day-ahead electricity price, €/kWh (a stand-in: no market data in the app), shaped like the German
 * day-ahead market of the last years: a seasonal level (dearer in winter), a morning and a stronger evening peak (both
 * higher in winter), a midday dip from solar that is deepest in late spring and early summer (then the spot goes
 * negative on sunny hours, more so at weekends), a little noise (seeded); `spread` scales the swings around the level,
 * `fixed` adds the grid fees and levies. The grid's CO₂ follows the same drivers (solar at noon is clean, the
 * evening peak is gas). Both by unix seconds.
 */
export function syntheticPrice(times: number[], spread = 1, fixed = FEES_EUR_KWH): { price: number[]; co2: number[] } {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  const price: number[] = [];
  const co2: number[] = [];
  for (const t of times) {
    const d = new Date(t * 1000);
    const h = d.getUTCHours() + 1; // CET, near enough
    const doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000;
    const winter = Math.cos((2 * Math.PI * (doy - 15)) / 365); // 1 in January, -1 in July
    const sun = 0.5 + 0.5 * Math.cos((2 * Math.PI * (doy - 140)) / 365); // the solar surplus: 1 in late May, 0 in November
    const g = (c: number, w: number) => Math.exp(-(((h - c) / w) ** 2));
    const solar = sun * g(13, 2.8);
    const peaks = (0.6 * g(8, 1.5) + g(19, 2)) * (0.8 + 0.4 * Math.max(0, winter));
    const weekend = d.getUTCDay() % 6 === 0 ? -0.015 - 0.04 * solar : 0;
    const spot = 0.085 + 0.025 * winter + spread * (0.075 * peaks - 0.14 * solar + weekend + 0.015 * rnd());
    price.push(fixed + Math.max(-0.08, spot));
    co2.push(Math.max(0.08, CO2.grid + 0.08 * winter + 0.1 * peaks - 0.22 * solar));
  }
  return { price, co2 };
}

/** The market's day-ahead spot (€/kWh, without fees) and the grid's CO₂ (kg/kWh) per step, null where the market files
 * have none (OperationJob.market). */
export interface MarketSeries {
  spot: (number | null)[];
  co2: (number | null)[];
}

/** The page's steps from the market's hours (GET /api/market/hourly): each step takes the value of its hour. */
export function marketSeries(times: number[], m: { times: number[]; price_eur_mwh: (number | null)[]; co2_g_kwh: (number | null)[] }): MarketSeries {
  const at = new Map(m.times.map((t, i) => [t, i]));
  const of = (t: number) => at.get(t - (((t % 3600) + 3600) % 3600));
  return {
    spot: times.map((t) => {
      const i = of(t);
      const v = i == null ? null : m.price_eur_mwh[i];
      return v == null ? null : v / 1000;
    }),
    co2: times.map((t) => {
      const i = of(t);
      const v = i == null ? null : m.co2_g_kwh[i];
      return v == null ? null : v / 1000;
    }),
  };
}

/**
 * The electricity price and the grid's CO₂ from the market (SMARD): the day-ahead spot, its swings around its mean over
 * the period times `spread` (1: as it was), plus `fixed` (grid fees and levies); the CO₂ of the generation mix as it
 * was. A step without a market value takes the synthetic year's (syntheticPrice); `missing` counts them.
 */
export function marketPrice(times: number[], m: MarketSeries, spread = 1, fixed = FEES_EUR_KWH): { price: number[]; co2: number[]; missing: { price: number; co2: number } } {
  const synth = m.spot.some((v) => v == null) || m.co2.some((v) => v == null) ? syntheticPrice(times, spread, fixed) : null;
  const known = m.spot.filter((v): v is number => v != null);
  const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  const price = times.map((_, i) => {
    const v = m.spot[i];
    return v == null ? synth!.price[i] : fixed + mean + spread * (v - mean);
  });
  const co2 = times.map((_, i) => m.co2[i] ?? synth!.co2[i]);
  return { price, co2, missing: { price: m.spot.filter((v) => v == null).length, co2: m.co2.filter((v) => v == null).length } };
}

/**
 * Cost and CO₂ of a run per calendar year and per month of the year (January first, every year's January together;
 * with its backup heat; net of the data center's avoided cooling where it is counted), from its steps.
 */
export function breakdown(r: OpResult, s: OpSeries, p: OpPlant, times: number[], dt = 1) {
  const years = new Map<number, { costEur: number; co2T: number; elecMwh: number; backupMwh: number; coolMwh: number; hours: number }>();
  const months = Array.from({ length: 12 }, () => ({ costEur: 0, co2T: 0, backupMwh: 0 }));
  for (let i = 0; i < r.hp.length && i < times.length; i++) {
    const d = new Date(times[i] * 1000);
    const c = avoided(s, i, r.hp[i] + r.direct[i], r.elec[i]);
    const cost = (s.price[i] * (r.elec[i] - c) + p.backupPrice * r.backup[i]) * dt;
    const co2 = ((s.co2[i] * (r.elec[i] - c) + p.backupCo2 * r.backup[i]) * dt) / 1000;
    const y = years.get(d.getUTCFullYear()) ?? { costEur: 0, co2T: 0, elecMwh: 0, backupMwh: 0, coolMwh: 0, hours: 0 };
    y.costEur += cost;
    y.co2T += co2;
    y.elecMwh += (r.elec[i] * dt) / 1000;
    y.backupMwh += (r.backup[i] * dt) / 1000;
    y.coolMwh += (c * dt) / 1000;
    y.hours += dt;
    years.set(d.getUTCFullYear(), y);
    const mo = months[d.getUTCMonth()];
    mo.costEur += cost;
    mo.co2T += co2;
    mo.backupMwh += (r.backup[i] * dt) / 1000;
  }
  return { years, months };
}

/** The page's key figures (OpSummary): the best run of every scenario and strategy against heat-led in the same scenario. */
export interface OpSummary {
  objective: Objective;
  cooling: boolean; // the data center's avoided cooling counted (cost and CO₂ net of it)
  best: { scenario: string; strategy: string; costEur: number; co2T: number; plantMwh: number; backupMwh: number; coolMwh: number };
  base: { scenario: string; costEur: number; co2T: number; plantMwh: number; backupMwh: number; coolMwh: number };
}

/**
 * The cheapest (or cleanest) run of the scenarios at the page's prices and without a what-if on the demand or the heat
 * (another price spread is a market to expect, not a plant to pick: its saving is no saving at today's prices), against
 * heat-led in the same scenario: the same prices and plant, so the difference is the strategy's. The plant's heat
 * delivered is the demand less the backup (every run meets the same demand).
 */
export function summaryOf(
  out: ScenarioRun[],
  scenarios: { id: number; name: string; spread?: number | null; demandX?: number | null; supplyX?: number | null }[],
  objective: Objective,
  cooling: boolean,
  spread = 1, // the page's price spread: a scenario with its own (spread set and other) is left out
): OpSummary | null {
  const fig = (t: OpResult["totals"], demandMwh: number) => ({ costEur: t.costEur, co2T: t.co2T, plantMwh: demandMwh - t.backupMwh, backupMwh: t.backupMwh, coolMwh: t.coolMwh });
  const pick = (t: OpResult["totals"]) => (objective === "cost" ? t.costEur : t.co2T);
  const same = (id: number) => !scenarios.some((s) => s.id === id && ((s.demandX ?? 1) !== 1 || (s.supplyX ?? 1) !== 1 || (s.spread ?? spread) !== spread));
  const all = out.filter((r) => same(r.id)).flatMap((r) => STRATEGIES.map((st) => ({ r, st, t: r.runs[st.id].totals })));
  if (!all.length) return null;
  const top = all.reduce((x, y) => (pick(y.t) < pick(x.t) ? y : x));
  const name = scenarios.find((s) => s.id === top.r.id)?.name ?? "";
  return {
    objective,
    cooling,
    best: { scenario: name, strategy: top.st.label, ...fig(top.t, top.r.demandMwh) },
    base: { scenario: name, ...fig(top.r.runs.heat.totals, top.r.demandMwh) },
  };
}

/** A scenario of the page: the plant and the prices as set above, with some of them changed (null: as above). */
export interface OpScenario {
  id: number;
  name: string;
  hpKw: number | null;
  tankKwh: number | null;
  spread: number | null;
  demandX?: number | null; // what if: the district's demand times this (null: as it is)
  supplyX?: number | null; // what if: the data center's heat times this
}

/** What the page sends the worker (operation.worker.ts), from its data, its settings and its scenarios. */
export interface JobInput {
  times: number[];
  q: number[]; // kW the data center offers
  cop: number[];
  demand: number[];
  supply: number[]; // °C per step
  tSrc: number[];
  stepHours: number;
  horizonH: number; // the MPC's look-ahead, h
  objective: Objective;
  fees: number;
  market: MarketSeries | null; // none: the synthetic year
  cool: number[] | null; // none: the avoided cooling not counted
  direct?: boolean[] | null;
  plant: OpPlant;
  spread: number;
  scenarios: OpScenario[];
}

/**
 * The worker's job: every scenario's plant (its fields empty: the plant as set) and prices. A scenario with another
 * tank size grows the RC tank's kW with it (it still fills in the same hours); the look-ahead in steps, at least one.
 */
export function operationJob(seq: number, j: JobInput): OperationJob {
  const { plant } = j;
  return {
    seq,
    times: j.times,
    src: j.q,
    cop: j.cop,
    demand: j.demand,
    supply: j.supply,
    tSrc: j.tSrc,
    dt: j.stepHours,
    horizon: Math.max(1, Math.round(j.horizonH / j.stepHours)),
    objective: j.objective,
    fees: j.fees,
    market: j.market,
    cool: j.cool,
    direct: j.direct ?? null,
    scenarios: j.scenarios.map((s) => {
      const tankKwh = s.tankKwh ?? plant.tankKwh;
      const f = plant.tankKwh > 0 ? tankKwh / plant.tankKwh : 1;
      const rc = plant.rc && f !== 1 ? { ...plant.rc, chargeKw: plant.rc.chargeKw * f, dischargeKw: plant.rc.dischargeKw * f } : plant.rc;
      return { id: s.id, plant: { ...plant, hpKw: s.hpKw ?? plant.hpKw, tankKwh, rc }, spread: s.spread ?? j.spread, demandX: s.demandX ?? 1, supplyX: s.supplyX ?? 1 };
    }),
  };
}
