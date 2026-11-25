import { describe, expect, it } from "vitest";
import { withWeather } from "../../lib/weatherFit";
import { resolveDemand, supplyOf, type DemandSources } from "./matchingInputs";

const out = [-5, 0, 5, 10, 15, 20];
const own = [60, 50, 40, 30, 20, 10]; // falls as it warms
const none: DemandSources = {
  fmMode: null,
  fmKw: undefined,
  extDemand: undefined,
  distRunKw: undefined,
  profiled: undefined,
  measured: undefined,
  districtOut: out,
  baseOut: out,
  dTs: [0, 0, 0, 0, 0, 0],
  shifted: false,
  demScale: 1,
};

describe("the district's demand (resolveDemand)", () => {
  it("takes the first source that runs: forecaster, another dataset, trained model, profile, measured", () => {
    const all = { ...none, fmKw: [1], extDemand: [2], distRunKw: [3], profiled: [4], measured: [5] };
    expect(resolveDemand({ ...all, fmMode: "rolling" })).toEqual([1]);
    expect(resolveDemand(all)).toEqual([2]);
    expect(resolveDemand({ ...all, extDemand: null })).toEqual([3]);
    expect(resolveDemand({ ...all, extDemand: null, distRunKw: null })).toEqual([4]);
    expect(resolveDemand({ ...all, extDemand: null, distRunKw: null, profiled: null })).toEqual([5]);
    expect(resolveDemand(none)).toBeUndefined();
    expect(resolveDemand({ ...none, fmMode: "weather", fmKw: null, measured: [5] })).toBeNull(); // the forecaster picked, not ready: nothing
  });

  it("measured demand follows a shifted weather by its fitted slope; the forecaster and a profile do not", () => {
    const dTs = [2, 2, 2, 2, 2, 2];
    const warmer = resolveDemand({ ...none, measured: own, dTs, shifted: true })!;
    expect(warmer).toEqual(withWeather(own, out, dTs));
    expect(warmer[0]).toBeLessThan(own[0]);
    expect(resolveDemand({ ...none, extDemand: own, dTs, shifted: true })).toEqual(withWeather(own, out, dTs));
    expect(resolveDemand({ ...none, fmMode: "rolling", fmKw: own, dTs, shifted: true })).toBe(own);
    expect(resolveDemand({ ...none, profiled: own, measured: [1], dTs, shifted: true })).toBe(own);
  });

  it("scales by the what-if, and returns the source itself when unscaled", () => {
    expect(resolveDemand({ ...none, measured: own })).toBe(own);
    expect(resolveDemand({ ...none, measured: own, demScale: 0.5 })).toEqual([30, 25, 20, 15, 10, 5]);
  });
});

describe("the network's supply (supplyOf)", () => {
  it("fixed, on the heating curve, or none without a base", () => {
    expect(supplyOf(undefined, true, 55, out, 6)).toBeUndefined();
    expect(supplyOf(70, false, 55, out, 6)).toBe(70);
    expect(supplyOf(70, true, undefined, out, 6)).toBe(70); // no summer value: fixed
    const s = supplyOf(70, true, 55, [-12, 1.5, 15, 30, Number.NaN], 5) as number[];
    expect(s).toEqual([70, 62.5, 55, 55, 70]); // design day and below: winter; the heating limit and above: summer; no weather: fixed
  });
});
