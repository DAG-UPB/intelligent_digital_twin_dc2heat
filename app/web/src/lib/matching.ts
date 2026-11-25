/**
 * Heat matching: the data center's waste heat against the district's demand, step by step
 * (any step length: stepHours; kWh = kW x stepHours).
 *
 * Each step one recovery path runs:
 *   direct HEX  – the source heat goes straight into the network (needs a hot enough source)
 *   heat pump   – lifts the source heat to the supply temperature, delivered = source + electricity
 *   none        – both switched off: nothing is delivered
 * Whatever the path can deliver beyond the demand charges the tank; the tank covers later deficits. From the period's
 * last step with a demand on nothing is charged: that heat would never be drawn, only lost (and paid for in electricity).
 * With `hex` (the heat exchanger from its own data), the direct path passes the HEX's heat (at most the source's)
 * and checks the HEX's inlet temperature instead of the source's share and temperature.
 *
 * physics on:  direct only if t_src ≥ supply + approach; COP = carnotEff · T_supply[K] / max(lift, 5 K);
 *              the extraction HEX passes hexEff of the source heat.
 * physics off: share η of the source is usable, the heat pump runs at a fixed COP, no temperature checks.
 * With `parts` (per-step series of components, pages/heat/partComponents.ts) a part's built-in formula is replaced:
 *   hp    COP and thermal capacity per step;  hex  delivered heat and network-side outlet temperature per step
 *   (direct if t_out ≥ supply);  tank  capacity (kWh) and standing loss (%/h) per step.
 */
export type Recovery = "direct" | "heatpump" | "auto" | "none";

export interface MatchOptions {
  recovery: Recovery;
  physics: boolean;
  approach: number; // K, direct HEX approach (physics)
  carnotEff: number; // 0..1, share of the Carnot COP reached (physics)
  hexEff: number; // 0..1, extraction HEX efficiency (physics)
  eta: number; // 0..1, usable share of the source (simple)
  fixedCop: number; // heat pump COP (simple)
  hpCapacity: number; // kW thermal, heat pump output limit
  tankKwh: number; // 0 = no tank
  tankLossPct: number; // % of the content lost per hour
  hpTauH: number; // h, the heat pump's time constant: its output rises towards what it could give as 1 − e^(−t/τ), a step gives its mean (0: at once)
}

export const DEFAULT_OPTIONS: MatchOptions = {
  recovery: "auto",
  physics: true,
  approach: 5,
  carnotEff: 0.5,
  hexEff: 0.9,
  eta: 0.8,
  fixedCop: 3.5,
  hpCapacity: 150,
  tankKwh: 500,
  tankLossPct: 0.1, // 2.4 % a day: an insulated buffer tank (0.5 %/h, 11 % a day, was pessimistic); Operation's tank too
  hpTauH: 0.5, // compressor start and the condenser's water warming up: tens of minutes (manufacturers' start-up curves)
};

export const COP_MAX = 8;
const COP_MIN = 1.1;

/** The Carnot COP's share `eff` lifting from tSrc to tHot (°C): eff · T_hot[K] / lift, the lift at least 5 K. Not
 * clamped: each caller clamps its own way (carnotCop below, pages/twin/operation.ts chargeCop). */
export const carnotRaw = (tSrc: number, tHot: number, eff = 1) => (eff * (tHot + 273.15)) / Math.max(tHot - tSrc, 5);

/** Carnot-based heat pump COP lifting from tSrc to tSupply (°C), clamped to COP_MIN..COP_MAX. */
export const carnotCop = (tSrc: number, tSupply: number, carnotEff: number) => Math.min(COP_MAX, Math.max(COP_MIN, carnotRaw(tSrc, tSupply, carnotEff)));

/** Per-step numbers of a part from its component, instead of the built-in formula (each optional). */
export interface PartSeries {
  hpCop?: number[];
  hpCap?: number[]; // kW thermal
  hexQ?: number[]; // kW the HEX delivers
  hexTOut?: number[]; // °C network-side outlet
  tankKwh?: number[];
  tankLossPct?: number[]; // %/h
}

export interface MatchResult {
  direct: number[]; // kW from the direct HEX to the demand
  hp: number[]; // kW from the heat pump to the demand
  hpElec: number[]; // kW electricity of the heat pump (incl. heat it put into the tank)
  cop: number[]; // COP the heat pump would run at (0 when not used)
  viaHp: boolean[]; // path of the hour
  charge: number[]; // kW into the tank
  fromTank: number[]; // kW from the tank to the demand
  tankLevel: number[]; // kWh at the end of the step
  unmet: number[]; // kW of demand not covered
  surplus: number[]; // kW the active path could have delivered but nobody took
  drawn: number[]; // kW of data-center heat used
  totals: {
    demandMwh: number;
    deliveredMwh: number;
    coveragePct: number;
    dcUsedPct: number;
    hpElecMwh: number;
    spf: number;
    unmetMwh: number;
    surplusMwh: number;
    hoursCovered: number; // hours with a demand, fully met
    demandHours: number; // hours with a demand
    hours: number; // hours of the period
  };
}

export function matchHeat(
  q: number[],
  t: number[],
  demand: number[],
  supply: number | number[], // °C network supply, fixed or per step (a heating curve, lib/networkTemps.ts)
  o: MatchOptions,
  stepHours = 1,
  hex?: { q: number[]; t: number[] },
  parts: PartSeries = {},
): MatchResult {
  const dt = stepHours > 0 ? stepHours : 1;
  const n = Math.min(q.length, t.length, demand.length);
  const r: MatchResult = {
    direct: [], hp: [], hpElec: [], cop: [], viaHp: [], charge: [], fromTank: [], tankLevel: [], unmet: [], surplus: [], drawn: [],
    totals: { demandMwh: 0, deliveredMwh: 0, coveragePct: 0, dcUsedPct: 0, hpElecMwh: 0, spf: 0, unmetMwh: 0, surplusMwh: 0, hoursCovered: 0, demandHours: 0, hours: n },
  };
  let cap = Math.max(0, o.tankKwh);
  let keep = (1 - Math.min(1, Math.max(0, o.tankLossPct) / 100)) ** dt; // loss is per hour
  let level = 0;
  let hpPrev = 0; // kW the heat pump gives at the start of the step (0: it was off, a cold start)
  // first-order rise: the share of the way to its target at the step's end, and its mean over the step (what it gives;
  // the end value alone would credit hourly data with more than 15-min data for the same plant)
  const lagF = o.hpTauH > 0 ? 1 - Math.exp(-dt / o.hpTauH) : 1;
  const meanF = o.hpTauH > 0 ? 1 - (o.hpTauH / dt) * lagF : 1;
  let sAvail = 0, sDemand = 0, sDelivered = 0, sElec = 0, sHp = 0, sUnmet = 0, sSurplus = 0, sDrawn = 0, covered = 0, withDemand = 0;

  const { hpCop, hpCap, hexQ: pHexQ, hexTOut, tankKwh, tankLossPct } = parts;
  let lastDraw = -1; // the last step with a demand: what is charged from it on is never drawn
  for (let i = n - 1; i >= 0 && lastDraw < 0; i--) if (demand[i] > 0) lastDraw = i;
  for (let i = 0; i < n; i++) {
    const sup = typeof supply === "number" ? supply : (supply[i] ?? supply[supply.length - 1]);
    const avail = Math.max(0, q[i]);
    const d = Math.max(0, demand[i]);
    const usable = avail * (o.physics ? o.hexEff : o.eta);
    const hexQ = pHexQ ? Math.min(avail, Math.max(0, pHexQ[i])) : hex ? Math.min(avail, Math.max(0, hex.q[i])) : usable;
    const directOk = hexTOut ? hexTOut[i] >= sup : !o.physics || (hex ? hex.t[i] : t[i]) >= sup + o.approach;
    const useHp = o.recovery === "heatpump" || (o.recovery === "auto" && !directOk);
    const cop = !useHp ? 0 : hpCop ? Math.min(COP_MAX, Math.max(COP_MIN, hpCop[i])) : o.physics ? carnotCop(t[i], sup, o.carnotEff) : Math.max(COP_MIN, o.fixedCop);
    const hpMax = Math.max(0, hpCap ? hpCap[i] : o.hpCapacity);
    // what the active path could deliver this hour
    const potNow = useHp ? Math.min(hpMax, (usable * cop) / (cop - 1)) : directOk && o.recovery !== "none" ? hexQ : 0;
    // the heat pump's output cannot jump up: it moves from the last step's towards what it could give (first-order lag)
    const rising = useHp && potNow > hpPrev;
    const pot = rising ? hpPrev + (potNow - hpPrev) * meanF : potNow;

    if (tankKwh) {
      // the tank's own capacity and loss this step (its capacity follows the network temperatures)
      cap = Math.max(0, tankKwh[i]);
      level = Math.min(level, cap);
    }
    if (tankLossPct) keep = (1 - Math.min(1, Math.max(0, tankLossPct[i]) / 100)) ** dt;
    level *= keep;
    const use = Math.min(pot, d);
    // kW in and out of the tank; its level is kWh
    const fromTank = Math.min(d - use, level / dt);
    level -= fromTank * dt;
    const charge = i < lastDraw ? Math.min(pot - use, (cap - level) / dt) : 0;
    level += charge * dt;
    const produced = use + charge;
    const elec = useHp ? produced / cop : 0;
    const unmet = d - use - fromTank;
    const surplus = pot - produced;
    const drawn = produced - elec;
    // still rising at full output: it ends the step higher; held back by the demand or the tank: it runs at that
    hpPrev = !useHp ? 0 : rising && produced >= pot - 1e-9 ? hpPrev + (potNow - hpPrev) * lagF : produced;

    r.direct.push(useHp ? 0 : use);
    r.hp.push(useHp ? use : 0);
    r.hpElec.push(elec);
    r.cop.push(cop);
    r.viaHp.push(useHp);
    r.charge.push(charge);
    r.fromTank.push(fromTank);
    r.tankLevel.push(level);
    r.unmet.push(unmet);
    r.surplus.push(surplus);
    r.drawn.push(drawn);

    sAvail += avail; sDemand += d; sDelivered += use + fromTank; sElec += elec; sUnmet += unmet; sSurplus += surplus; sDrawn += drawn;
    if (useHp) sHp += produced;
    if (d > 0) withDemand++;
    if (d > 0 && unmet <= 1e-6 * Math.max(1, d)) covered++; // an hour with nothing to meet is not "met"
  }
  const e = dt / 1000; // sum of kW -> MWh
  r.totals = {
    demandMwh: sDemand * e,
    deliveredMwh: sDelivered * e,
    coveragePct: sDemand ? (100 * sDelivered) / sDemand : 0,
    dcUsedPct: sAvail ? (100 * sDrawn) / sAvail : 0,
    hpElecMwh: sElec * e,
    spf: sElec ? sHp / sElec : 0,
    unmetMwh: sUnmet * e,
    surplusMwh: sSurplus * e,
    hoursCovered: covered * dt,
    demandHours: withDemand * dt,
    hours: n * dt,
  };
  return r;
}

/**
 * The heat available at an extraction point from physics instead of the HEX_* series (a simple estimate with no
 * demand limit; sim_1_modified's HEX_* columns are the demand-limited recovered heat, docs simulated-heat-recovery),
 * from IT and HVAC power (kW) and the temperatures (°C), delayed by one step (one hour on hourly data, 5 s on 5 s data):
 *   hall      Q = η · ITE_Ener                 T = In_Temp + rackΔT − approach
 *   condenser Q = η · (a · ITE_Ener + HVAC)    T = clip(Out_Temp + towerApproach, tMin, tMax) − approach
 *   liquid    Q = η · f · ITE_Ener             T = clip(Out_Temp + facilityApproach, tFacility, 45) + liquidΔT − approach
 * with a = 1, or 1 − f for a liquid-cooled data center (`liquidCooled`): its cold plates take the share f on facility
 * water, whose supply follows the outdoor air up to W45, and only the air's rest reaches the chiller.
 */
export interface SourcePhysics {
  eta: number; // 0..1, share of the heat the extraction HEX recovers
  rackDt: number; // K, air temperature rise across the racks
  approach: number; // K, extraction HEX approach
  towerApproach: number; // K, condenser water above outside air
  tMin: number; // °C, condenser water clip
  tMax: number;
  liquidShare: number; // 0..1, share of the IT heat the cold plates take (liquid cooling)
  tFacility: number; // °C, lowest facility water into the racks (liquid cooling)
  facilityApproach: number; // K, the facility water above the outdoor air when it is warm
  liquidDt: number; // K, its rise across the racks
}
export const DEFAULT_SOURCE_PHYSICS: SourcePhysics = {
  eta: 0.8,
  rackDt: 12,
  approach: 3,
  towerApproach: 8,
  tMin: 15,
  tMax: 40,
  liquidShare: 0.75,
  tFacility: 40,
  facilityApproach: 0,
  liquidDt: 10,
};
/** The highest facility water supply (ASHRAE W45). */
const T_FACILITY_MAX = 45;
export interface DcDrivers { ite: number[]; hvac: number[]; inT: number[]; outT: number[] }

export function physicsSource(at: "hall" | "condenser" | "liquid", d: DcDrivers, p: SourcePhysics, liquidCooled = false): { q: number[]; t: number[] } {
  const q: number[] = [];
  const t: number[] = [];
  const air = liquidCooled ? 1 - p.liquidShare : 1; // what the chiller sees of the IT heat
  for (let i = 0; i < d.ite.length; i++) {
    const k = Math.max(0, i - 1);
    if (at === "hall") {
      q.push(p.eta * d.ite[k]);
      t.push(d.inT[k] + p.rackDt - p.approach);
    } else if (at === "liquid") {
      q.push(p.eta * p.liquidShare * d.ite[k]);
      t.push(Math.min(T_FACILITY_MAX, Math.max(p.tFacility, d.outT[k] + p.facilityApproach)) + p.liquidDt - p.approach);
    } else {
      q.push(p.eta * (air * d.ite[k] + d.hvac[k]));
      t.push(Math.min(p.tMax, Math.max(p.tMin, d.outT[k] + p.towerApproach)) - p.approach);
    }
  }
  return { q, t };
}
