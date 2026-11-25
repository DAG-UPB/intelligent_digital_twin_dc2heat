import { expect, test } from "vitest";
import { DEFAULT_DISTRICT, districtProfile, type DemandEntry } from "./demand";
import { AALBORG_RESIDENTIAL, PROFILE_PRESETS, siteDemand } from "./profilePresets";
import { generate } from "./profile";

const at = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m, d, h) / 1000;
const year = Array.from({ length: 8784 }, (_, i) => at(2024, 0, 1) + i * 3600);
const temp = year.map((t) => 10 - 9 * Math.cos((2 * Math.PI * (t - at(2024, 0, 15))) / (366 * 86400)) + 3 * Math.sin((2 * Math.PI * t) / 86400));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const entry = (id: string, settings: Partial<typeof DEFAULT_DISTRICT>): DemandEntry => ({ id, name: id, area: false, settings: { ...DEFAULT_DISTRICT, ...settings } });

test("the homes' standard profile is the Aalborg model, and it holds its total over a year", () => {
  const p = PROFILE_PRESETS.find((x) => x.id === AALBORG_RESIDENTIAL)!;
  expect(PROFILE_PRESETS[0].id).toBe(AALBORG_RESIDENTIAL);
  const g = generate(p.spec, year[0], year[year.length - 1] + 3600, 1, () => temp);
  expect(sum(g.kw)).toBeCloseTo(200 * 12000, -1); // the same starting district as the app's curves: 200 houses × 12,000 kWh
  const jan = sum(g.kw.slice(0, 31 * 24));
  const jul = sum(g.kw.slice(182 * 24, 213 * 24));
  expect(jan).toBeGreaterThan(3 * jul); // heating in winter, hot water all year
  expect(jul).toBeGreaterThan((0.05 * 200 * 12000) / 12); // a summer base
});

test("Heat Matching's demand follows each sink's profile: its energy, the Aalborg model's shape, the app's curves without one", () => {
  const homes = entry("a", { houses: 1, kwhPerHouse: 30000, profile: AALBORG_RESIDENTIAL });
  const office = entry("b", { houses: 1, kwhPerHouse: 20000, profile: "bdew-gko03" });
  const curves = entry("c", { houses: 2, kwhPerHouse: 10000, profile: "residential" });
  const off = entry("d", { houses: 1, kwhPerHouse: 99999, profile: AALBORG_RESIDENTIAL, included: false });
  const { kw } = siteDemand([homes, office, curves, off], year, temp, 1);
  expect(sum(kw)).toBeCloseTo(30000 + 20000 + 20000 * (8784 / 8760), -1);
  // the app's own curves are the sink's settings, unchanged
  const own = siteDemand([curves], year, temp, 1).kw;
  expect(own).toEqual(districtProfile(curves.settings, year, temp, 1));
  // two homes of the same kind: one shape, scaled by each one's energy
  const two = siteDemand([homes, { ...homes, id: "e", settings: { ...homes.settings, kwhPerHouse: 10000 } }], year, temp, 1).kw;
  const one = siteDemand([homes], year, temp, 1).kw;
  two.forEach((v, i) => expect(v).toBeCloseTo((one[i] * 40000) / 30000, 6));
});
