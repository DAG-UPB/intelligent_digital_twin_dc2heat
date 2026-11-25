import { expect, test } from "vitest";
import {
  profileKw,
  dailyTemperatures,
  generate,
  monthsFor,
  perMonth,
  periodOf,
  rateUnit,
  slpH,
  stepsBetween,
  totalOf,
  FLAT,
  type Driver,
  type ProfileSpec,
  averageDay,
  withAverageDay,
} from "./profile";
import { DEFAULT_DISTRICT } from "./demand";
import { PROFILE_PRESETS, sinkPresets } from "./profilePresets";

const sigmoidOf = (id: string) => PROFILE_PRESETS.find((p) => p.id === id)!.spec.parts[0].driver as Extract<Driver, { kind: "slp" }>;
const at = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m, d, h) / 1000;

test("the BDEW coefficients give the guideline's own check values h(8 °C)", () => {
  expect(slpH(sigmoidOf("bdew-hef03"), 8)).toBeCloseTo(1.00752, 5);
  expect(slpH(sigmoidOf("bdew-hmf03"), 8)).toBeCloseTo(1.03652, 5);
  expect(slpH(sigmoidOf("bdew-gko03"), 8)).toBeCloseTo(1.06303, 5);
  expect(slpH(sigmoidOf("bdew-gha03"), 8)).toBeCloseTo(0.97853, 5);
  expect(slpH(sigmoidOf("bdew-hef03"), -10)).toBeGreaterThan(slpH(sigmoidOf("bdew-hef03"), 15)); // colder: more
});

test("the allocation temperature is the geometric series of the day and the three before it", () => {
  const times = [0, 1, 2, 3].map((d) => at(2023, 0, 2 + d, 12));
  const { mean, allocation } = dailyTemperatures(times, [10, 0, 0, 0]);
  expect(mean).toEqual([10, 0, 0, 0]);
  expect(allocation[0]).toBe(10); // nothing before: the day itself
  expect(allocation[3]).toBeCloseTo((0 + 0.5 * 0 + 0.25 * 0 + 0.125 * 10) / 1.875);
});

test("periods: a day, a week from Monday, a month, a year", () => {
  const t = at(2023, 4, 17, 13); // Wednesday 17 May 2023
  expect(periodOf("day", t)).toEqual({ from: at(2023, 4, 17), to: at(2023, 4, 18) });
  expect(periodOf("week", t)).toEqual({ from: at(2023, 4, 15), to: at(2023, 4, 22) });
  expect(periodOf("month", t)).toEqual({ from: at(2023, 4, 1), to: at(2023, 5, 1) });
  expect(periodOf("year", t)).toEqual({ from: at(2023, 0, 1), to: at(2024, 0, 1) });
  expect(stepsBetween(0, 7200, 0.5)).toEqual([0, 1800, 3600, 5400]);
});

const cold = (times: number[]) => times.map((t) => 10 - 12 * Math.cos((2 * Math.PI * (t / 86400 - 15)) / 365)); // -2 to 22 °C daily means

test("the total over its period is met exactly, whatever span is shown", () => {
  for (const p of PROFILE_PRESETS) {
    const year = generate(p.spec, at(2023, 0, 1), at(2024, 0, 1), 1, cold);
    expect(year.matched, p.id).toBe(true);
    const sum = year.kw.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(totalOf(p.spec), 3);
    expect(year.periodKwh).toBeCloseTo(totalOf(p.spec), 3);
    // a week is a window onto the same year: its values are the year's
    const week = generate(p.spec, at(2023, 1, 6), at(2023, 1, 13), 1, cold);
    const i = year.times.indexOf(week.times[0]);
    expect(week.kw).toEqual(year.kw.slice(i, i + week.kw.length));
  }
});

test("shapes count: the weekday factors, the hour shape, the weather, the parts' shares", () => {
  const spec: ProfileSpec = {
    units: 2,
    total: 700,
    unit: "kWh",
    perUnit: true,
    per: "week",
    parts: [{ label: "x", share: 1, hour: FLAT.hour, weekday: [1, 1, 1, 1, 1, 2, 0], month: FLAT.month, driver: { kind: "none" } }],
  };
  const g = generate(spec, at(2023, 4, 15), at(2023, 4, 22), 24, cold); // Monday..Sunday, daily steps
  expect(g.kw.map((k) => k * 24)).toEqual([175, 175, 175, 175, 175, 350, 0].map((x) => (x * 1400) / 1225)); // 1400 kWh by the factors
  // heating below 15 °C: none on a warm day, and the total cannot be met within that day
  const warm = generate({ ...spec, per: "day", parts: [{ ...spec.parts[0], driver: { kind: "below", limit: 15 } }] }, at(2023, 6, 1), at(2023, 6, 2), 1, () =>
    Array(24).fill(25),
  );
  expect(warm.matched).toBe(false);
  expect(warm.kw.every((k) => k === 0)).toBe(true);
  // two parts: each its share
  const two = generate({ ...spec, parts: [spec.parts[0], { ...spec.parts[0], share: 3 }] }, at(2023, 4, 15), at(2023, 4, 22), 1, cold);
  expect(two.parts.map((p) => p.reduce((a, b) => a + b, 0))).toEqual([expect.closeTo(350, 6), expect.closeTo(1050, 6)]);
});

test("one total for everything or per unit; any unit; the weather can raise a value on warm days too", () => {
  const base: ProfileSpec = {
    total: 1000,
    unit: "MWh",
    per: "year",
    perUnit: false,
    units: 50,
    parts: [{ label: "x", share: 1, ...FLAT, driver: { kind: "none" } }],
  };
  expect(totalOf(base)).toBe(1000); // the units do not count
  expect(totalOf({ ...base, perUnit: true })).toBe(50000);
  expect([rateUnit("kWh"), rateUnit("MWh"), rateUnit("m³")]).toEqual(["kW", "MW", "m³/h"]);
  const year = (driver: Driver) => {
    const g = generate({ ...base, parts: [{ ...base.parts[0], driver }] }, at(2023, 0, 1), at(2024, 0, 1), 24, cold);
    return perMonth(g.times, g.kw, 24);
  };
  const above = year({ kind: "above", limit: 10 }); // cooling: summer only
  expect(above[6]).toBeGreaterThan(above[0]);
  expect(above.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 6); // the total holds
  const less = year({ kind: "linear", ref: 5, slope: -0.05 }); // less on warm days, more on cold ones
  expect(less[0]).toBeGreaterThan(less[6]);
  const flat = year({ kind: "none" });
  expect(flat[0] / 31).toBeCloseTo(flat[6] / 31, 6); // no weather: the same per day in January as in July
});

test("a month drawn on its result: its factor follows, a month without energy keeps its own", () => {
  expect(monthsFor([1, 1, 2], [100, 0, 50], [200, 30, 50])).toEqual([2, 1, 2]); // doubled; nothing to scale; unchanged
});

test("the average day to draw: its height is the part's total, drawing it changes the shape and the total, the other parts keep theirs", () => {
  const s: ProfileSpec = {
    total: 3650,
    unit: "kWh",
    per: "year",
    perUnit: false,
    units: 1,
    parts: [
      { label: "a", share: 0.5, ...FLAT, driver: { kind: "none" } },
      { label: "b", share: 0.5, ...FLAT, driver: { kind: "none" } },
    ],
  };
  const day = averageDay(s, 0);
  expect(day[0]).toBeCloseTo(1825 / 365.25 / 24, 9); // kW on an average day
  const twice = withAverageDay(
    s,
    0,
    day.map((v) => 2 * v),
  ); // the whole curve moved up: twice the energy
  expect(totalOf(twice)).toBeCloseTo(1825 * 3, 6);
  expect(twice.parts[1].share * totalOf(twice)).toBeCloseTo(1825, 6); // b keeps its 1,825 kWh
  const peaked = withAverageDay(
    s,
    0,
    day.map((v, h) => (h === 8 ? 3 * v : v)),
  ); // one point raised: a peak at 8 h
  expect(peaked.parts[0].hour[8] / peaked.parts[0].hour[0]).toBeCloseTo(3);
  expect(averageDay({ ...peaked, perUnit: true, units: 2, total: totalOf(peaked) / 2 }, 0)[8]).toBeCloseTo(averageDay(peaked, 0)[8]); // per unit: the same curve
});

test("the heat sinks of Heat demand as presets: all included together, each by its energy, then each alone", () => {
  const sink = (id: string, houses: number, kwhPerHouse: number, included = true) => ({
    id,
    name: id,
    area: true,
    settings: { ...DEFAULT_DISTRICT, houses, kwhPerHouse, included },
  });
  const ps = sinkPresets([sink("a", 10, 10000), sink("b", 1, 50000), sink("c", 5, 1000, false)]);
  expect(ps.map((p) => p.id)).toEqual(["heat-demand", "heat-demand:a", "heat-demand:b", "heat-demand:c"]);
  const all = ps[0].spec;
  expect(totalOf(all)).toBe(150); // MWh: c is not included
  const year = generate(all, at(2023, 0, 1), at(2024, 0, 1), 1, cold);
  const parts = year.parts.map((p) => p.reduce((x, y) => x + y, 0));
  expect(parts[0] + parts[1]).toBeCloseTo(100, 6); // a: 10 x 10,000 kWh
  expect(parts[2] + parts[3]).toBeCloseTo(50, 6);
  expect(parts[1] / (parts[0] + parts[1])).toBeCloseTo(DEFAULT_DISTRICT.dhwShare, 6); // its hot-water share
  expect(totalOf(ps[2].spec)).toBe(50);
  expect(ps.every((p) => p.spec.unit === "MWh")).toBe(true);
});

test("a profile over given steps in kW: the steps' own weather, a MWh total in MW", () => {
  const flat = PROFILE_PRESETS.find((p) => p.id === "constant")!.spec; // 8760 kWh a year, the same every hour
  const t0 = Date.UTC(2024, 2, 4) / 1000;
  const times = Array.from({ length: 48 }, (_, i) => t0 + i * 3600);
  const typical = (ts: number[]) => ts.map(() => 10);
  expect(
    profileKw(
      flat,
      times,
      times.map(() => 5),
      1,
      typical,
    ).every((x) => Math.abs(x - 8760 / 8784) < 1e-9),
  ).toBe(true); // 2024: 8784 h
  expect(profileKw({ ...flat, unit: "MWh" }, times, [], 1, typical)[0]).toBeCloseTo((1000 * 8760) / 8784);
  // a heating part follows the steps' temperatures: colder steps get more
  const heating = { ...flat, parts: [{ ...flat.parts[0], driver: { kind: "below" as const, limit: 15 } }] };
  const kw = profileKw(
    heating,
    times,
    times.map((_, i) => (i < 24 ? 0 : 10)),
    1,
    typical,
  );
  expect(kw[0]).toBeGreaterThan(kw[30]);
  expect(profileKw(flat, [], [], 1, typical)).toEqual([]);
  // a gap in the steps shifts nothing: each step gets its own time's value (and its own temperature)
  const gappy = [...times.slice(0, 10), ...times.slice(22)];
  const cold = (ts: number[]) => ts.map((t) => (t >= times[30] ? 0 : 10));
  const whole = profileKw(heating, times, cold(times), 1, typical);
  const cut = profileKw(heating, gappy, cold(gappy), 1, typical);
  expect(cut).toHaveLength(gappy.length);
  gappy.forEach((t, i) => expect(cut[i]).toBeCloseTo(whole[times.indexOf(t)], 9));
});

test("a month total over a long run is the average month: a year from 1 July holds 12 months, winter more than summer", () => {
  // before, the month around the first step (July) held the total and set the scale for the whole year: no heating at all
  const heating = { kind: "below" as const, limit: 15 };
  const part = (label: string, share: number, driver: Driver) => ({ label, share, ...FLAT, driver });
  const spec: ProfileSpec = { total: 1000, unit: "kWh", per: "month", perUnit: false, units: 1, parts: [part("Heating", 0.8, heating), part("Hot water", 0.2, { kind: "none" })] };
  const t0 = at(2023, 6, 1);
  const times = Array.from({ length: 8760 }, (_, i) => t0 + i * 3600);
  const typical = (ts: number[]) => ts.map((t) => 10.5 - 9.5 * Math.cos((2 * Math.PI * (t / 86400 - 15)) / 365.25));
  const kw = profileKw(spec, times, typical(times), 1, typical);
  const sum = kw.reduce((a, b) => a + b, 0);
  expect(Math.abs(sum - 12 * 1000) / 12000).toBeLessThan(0.01);
  const months = perMonth(times, kw, 1);
  expect(months[0]).toBeGreaterThan(3 * months[6]); // January vs July
  // per unit: the units still multiply
  expect(profileKw({ ...spec, perUnit: true, units: 3 }, times, typical(times), 1, typical)[4000]).toBeCloseTo(3 * kw[4000], 9);
});

test("the hour shape is Frankfurt's clock: a 7 am peak at 06:00 UTC in winter, 05:00 UTC in summer time", () => {
  // before, the hours were read as UTC, so the peak sat at 07:00 UTC (8 or 9 am in Frankfurt)
  const hour = Array.from({ length: 24 }, (_, h) => (h === 7 ? 10 : 1));
  const spec: ProfileSpec = { units: 1, total: 100, unit: "kWh", perUnit: false, per: "day", parts: [{ label: "x", share: 1, hour, weekday: FLAT.weekday, month: FLAT.month, driver: { kind: "none" } }] };
  const peakUtc = (from: number) => {
    const g = generate(spec, from, from + 86400, 1, cold);
    return new Date(g.times[g.kw.indexOf(Math.max(...g.kw))] * 1000).getUTCHours();
  };
  expect(peakUtc(at(2024, 0, 15))).toBe(6);
  expect(peakUtc(at(2024, 6, 15))).toBe(5);
});
