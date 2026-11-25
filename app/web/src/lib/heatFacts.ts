/**
 * The delivered heat and the CO₂ saved in everyday terms: households supplied, people, showers, cars, trees. Rough
 * figures for a feel of the size, each constant with where it comes from; not for planning.
 */

/** A household's heat a year (MWh: heating and hot water): ~70 m² × 130 kWh/(m²·a), an estimate (the costs dialog's
 * "Heat of one apartment", networkCost.ts aptMwh). */
export const HOUSEHOLD_MWH = 9;
/** People per household in Germany (Destatis, Mikrozensus 2023: ~2.0). */
export const PEOPLE_PER_HOUSEHOLD = 2;
/** One 5-minute shower (kWh of heat): ~40 L warmed from 10 to 38 °C, 40 × 4.18 × 28 / 3600 ≈ 1.3, with the losses of
 * storage and pipes ~1.5 (an estimate). */
export const SHOWER_KWH = 1.5;
/** A German car's CO₂ a year (t): ~12,500 km at ~150 g/km (an estimate on KBA mileage and UBA emission figures). */
export const CAR_T = 1.9;
/** CO₂ a grown tree takes up a year (kg): ~20, the middle of the usual estimates (about 10 to 30 kg; a rough one). */
export const TREE_KG = 20;

export interface HeatFacts {
  households: number;
  people: number;
  showers: number; // a year (the period's scaled to 365 days)
  showersPerDay: number;
  showersPerHouseholdDay: number;
  cars: number;
  trees: number;
}

/** The delivered heat (MWh over `days`) and the CO₂ saved (t) in everyday terms; households per year of heat. */
export function heatFacts(deliveredMwh: number, co2T: number, days = 365): HeatFacts {
  const years = days / 365;
  const households = years > 0 ? deliveredMwh / HOUSEHOLD_MWH / years : 0;
  const inPeriod = (deliveredMwh * 1000) / SHOWER_KWH;
  const showers = years > 0 ? inPeriod / years : 0; // a year, as the households, cars and trees
  const showersPerDay = days > 0 ? inPeriod / days : 0;
  const saved = Number.isFinite(co2T) && co2T > 0 ? co2T : 0; // more grid CO₂ than gas avoided: no cars, no trees (as trees.ts treesFor)
  return {
    households,
    people: households * PEOPLE_PER_HOUSEHOLD,
    showers,
    showersPerDay,
    showersPerHouseholdDay: households > 0 ? showersPerDay / households : 0,
    cars: years > 0 ? saved / CAR_T / years : 0,
    trees: years > 0 ? (saved * 1000) / TREE_KG / years : 0,
  };
}
