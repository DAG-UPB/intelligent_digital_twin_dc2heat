/**
 * Heat Matching's inputs, pure: the district's demand from whichever source runs (HeatDistributionPage picks it) and the
 * network's supply temperature per step. No React, no fetching: the page passes what it loaded.
 */
import { DESIGN_OUTDOOR, HEATING_LIMIT, supplySeries } from "../../lib/networkTemps";
import { withWeather } from "../../lib/weatherFit";

/** What the demand can come from, first match wins (a source not running is undefined or null). */
export interface DemandSources {
  fmMode: string | null; // the pretrained forecaster runs (its own weather: the shift is in it)
  fmKw: number[] | null | undefined;
  extDemand: number[] | null | undefined; // another dataset's measured demand
  distRunKw: number[] | null | undefined; // the district's own trained model
  profiled: number[] | null | undefined; // its profile, on the shifted weather
  measured: number[] | null | undefined; // its measured demand (or the Site map's sinks)
  districtOut: number[] | undefined; // the weather the district's measured demand was measured on
  baseOut: number[]; // the shared weather before the shift
  dTs: number[]; // the what-if's shift per step
  shifted: boolean; // some step shifted
  demScale: number; // the what-if: the demand times this
}

/**
 * The district's demand per step: the forecaster's, else another dataset's (following the shifted weather by its fitted
 * slope), else the district's trained model's, its profile's, or its measurement (shifted the same way); then scaled.
 */
export function resolveDemand(s: DemandSources): number[] | null | undefined {
  const d = s.fmMode
    ? s.fmKw
    : s.extDemand
      ? s.shifted
        ? withWeather(s.extDemand, s.baseOut, s.dTs)
        : s.extDemand
      : (s.distRunKw ?? s.profiled ?? (s.measured && s.districtOut && s.shifted ? withWeather(s.measured, s.districtOut, s.dTs) : s.measured));
  return d && s.demScale !== 1 ? d.map((x) => x * s.demScale) : d;
}

/**
 * The network's supply: `base` °C fixed, or on the heating curve from `base` in winter to `summer` (at
 * DESIGN_OUTDOOR and HEATING_LIMIT) over the outdoor temperature, for `n` steps; undefined while there is no base.
 */
export function supplyOf(base: number | undefined, curve: boolean, summer: number | undefined, outTemp: number[], n: number): number | number[] | undefined {
  if (base === undefined) return undefined;
  return curve && summer !== undefined ? supplySeries(outTemp, n, base, { winter: base, summer, tDesign: DESIGN_OUTDOOR, tLimit: HEATING_LIMIT }) : base;
}
