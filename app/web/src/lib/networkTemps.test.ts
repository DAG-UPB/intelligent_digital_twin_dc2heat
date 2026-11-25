import { describe, expect, it } from "vitest";
import { defaultCurve, supplyAt, supplySeries } from "./networkTemps";

const c = { winter: 80, summer: 65, tDesign: -12, tLimit: 15 };

describe("heating curve", () => {
  it("is the winter supply at and below the design temperature, the summer one at and above the limit", () => {
    expect(supplyAt(-20, c)).toBe(80);
    expect(supplyAt(-12, c)).toBe(80);
    expect(supplyAt(15, c)).toBe(65);
    expect(supplyAt(30, c)).toBe(65);
  });
  it("is linear in between", () => {
    expect(supplyAt(1.5, c)).toBeCloseTo(72.5);
  });
  it("without a curve every step has the fixed supply; a missing outdoor value keeps it too", () => {
    expect(supplySeries([0, 10], 2, 70, null)).toEqual([70, 70]);
    expect(supplySeries([-12, NaN], 2, 70, c)).toEqual([80, 70]);
  });
  it("the default curve: the design supply in winter, 15 K lower in summer, at least 10 K above the return and never above the winter's", () => {
    expect(defaultCurve(70, 40)).toEqual({ winter: 70, summer: 55, tDesign: -12, tLimit: 15 });
    expect(defaultCurve(60, 40)).toMatchObject({ winter: 60, summer: 50 }); // 10 K above the return
    expect(defaultCurve(50, 45)).toMatchObject({ winter: 50, summer: 50 }); // not hotter in summer than in winter
  });
});
