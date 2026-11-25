/**
 * The heat pump's size on the Site map, pure, one rule for the quick analysis (quickAnalysis.ts) and the heat network
 * (network.ts): a ceiling from the source (stationCapacity: what the data center's heat allows at its COP) and a choice
 * from the demand under it (heatPumpKw: a share of the peak hour, raised until it gives a share of the year's heat).
 * Not the economic optimum: that is a sweep of the size by the cost of heat (Operation's design options).
 */
import { carnotCop, DEFAULT_OPTIONS } from "../../lib/matching";

/** The heat pump's default size, a share of the network's peak hour: on the typical year 50 % of the peak hour gives
 * ~86 % of the heat, the 85 % DEA's waste-heat heat pump covers with peak units (bivalent designs: 25-75 % of the peak). */
export const HP_SHARE = 0.5;
/** BEW: a new network needs at least this share of its heat from renewable sources or waste heat. */
export const DC_SHARE = 0.75;

/** The heat-pump heat the data center's waste heat allows at the sinks' supply temperature (its heat used, the Data
 * center card's: no exchanger share off it again; Heat Matching's COP), and the COP; a source hot enough goes straight
 * through the exchanger. */
export function stationCapacity(sourceKw: number, sourceC: number, supplyC: number) {
  const o = DEFAULT_OPTIONS;
  const usable = Math.max(0, sourceKw);
  const direct = sourceC >= supplyC + o.approach;
  const cop = carnotCop(sourceC, supplyC, o.carnotEff);
  return { kw: direct ? usable : (usable * cop) / (cop - 1), cop, direct };
}

/** The heat pump for a year of demand (kW per hour) plus a constant loss (kW): `hpShare` of the demand's peak hour,
 * raised until it gives `minShare` of the year's heat (demand and loss), never above `capacityKw` (stationCapacity). */
export function heatPumpKw(year: ArrayLike<number>, lossKw: number, capacityKw: number, hpShare = HP_SHARE, minShare = DC_SHARE): number {
  let peak = 0;
  let made = 0;
  for (let h = 0; h < year.length; h++) {
    if (year[h] > peak) peak = year[h];
    made += year[h] + lossKw;
  }
  const coveredBy = (kw: number) => {
    let c = 0;
    for (let h = 0; h < year.length; h++) c += Math.min(year[h] + lossKw, kw);
    return c;
  };
  const kw = Math.min(capacityKw, hpShare * peak);
  if (coveredBy(kw) >= minShare * made) return kw;
  let [lo, hi] = [kw, capacityKw];
  for (let i = 0; i < 40; i++) [lo, hi] = coveredBy((lo + hi) / 2) >= minShare * made ? [lo, (lo + hi) / 2] : [(lo + hi) / 2, hi];
  return hi;
}
