/** districtProfile and totalDemand: energy totals, weather and daily-curve behaviour, sub-hourly steps. */
import { describe, expect, test } from "vitest";
import { localDate } from "./clock";
import { alignToTimes, annualMwh, combineDemand, DEFAULT_DISTRICT, demandEntries, districtProfile, drawDay, heatingCurve, hotWaterCurve, referenceHdd, siteLocation, syntheticOutdoor, totalDemand, typicalDayKw, WHOLE } from "./demand";
import type { Site } from "../api";

const t0 = Date.UTC(2023, 0, 2) / 1000; // a Monday
const times = Array.from({ length: 8760 }, (_, i) => t0 + i * 3600);
const s = DEFAULT_DISTRICT;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const want = s.houses * s.kwhPerHouse;
// seasonal weather: -2 °C in winter .. 22 °C in summer, plus a daily swing
const seasonal = times.map((_, i) => 10 - 12 * Math.cos((2 * Math.PI * i) / 8760) + 3 * Math.sin((2 * Math.PI * i) / 24));

describe("districtProfile", () => {
  test("a year sums to houses x kWh per house", () => {
    expect(Math.abs(sum(districtProfile(s, times, seasonal)) - want) / want).toBeLessThan(0.001);
  });

  test("a year with missing hours: the hours there get their share, not the whole year's total", () => {
    const kept = times.map((_, i) => i).filter((i) => i % 10 !== 0); // every 10th hour missing
    const kw = districtProfile(s, kept.map((i) => times[i]), kept.map((i) => seasonal[i]), 1);
    // ~90 % of the year (the missing hours are weighed on the typical weather, not this one's): before, ~100 % of it
    expect(Math.abs(sum(kw) - 0.9 * want) / want).toBeLessThan(0.02);
  });

  test("no space heating above the heating limit (hot water only)", () => {
    const warm = districtProfile(s, times, times.map(() => s.heatingLimit + 5));
    expect(Math.abs(sum(warm) - want * s.dhwShare) / want).toBeLessThan(0.001);
  });

  test("a cold day needs more than a mild one", () => {
    const day = (xs: number[], d: number) => sum(xs.slice(d * 24, d * 24 + 24));
    const mixed = districtProfile(s, times, times.map((_, i) => (Math.floor(i / 24) % 14 === 0 ? -5 : 10)));
    expect(day(mixed, 14)).toBeGreaterThan(day(mixed, 21));
  });

  test("a drawn curve reshapes the day but keeps the annual total", () => {
    const flat = Array.from({ length: 24 }, (_, h) => (h === 3 ? 5 : 1)); // a big 3 am peak
    const drawn = districtProfile({ ...s, heatingDay: flat, hotWaterDay: flat }, times, seasonal);
    expect(Math.abs(sum(drawn) - want) / want).toBeLessThan(0.001);
    const at = (xs: number[], h: number) => sum(xs.filter((_, i) => localDate(times[i]).getUTCHours() === h)); // 3 am in Frankfurt
    expect(at(drawn, 3) / at(districtProfile(s, times, seasonal), 3)).toBeGreaterThan(2);
  });

  test("5-minute steps sum to what hourly steps give and follow the hourly profile", () => {
    const step = 300;
    const t5 = Array.from({ length: (14 * 86400) / step }, (_, i) => t0 + i * step);
    const out5 = t5.map((t) => 2 + 3 * Math.sin((2 * Math.PI * (t - t0)) / 86400));
    const kw5 = districtProfile(s, t5, out5); // step taken from the timestamps
    const th = times.slice(0, 336);
    const kwh = districtProfile(s, th, th.map((t) => 2 + 3 * Math.sin((2 * Math.PI * (t - t0)) / 86400)));
    expect(Math.abs((sum(kw5) * step) / 3600 - sum(kwh)) / sum(kwh)).toBeLessThan(0.002);
    // daily energy (after the first day, where the 24 h mean warms up)
    for (let d = 1; d < 14; d++) {
      const e5 = (sum(kw5.slice(d * 288, d * 288 + 288)) * step) / 3600;
      const eh = sum(kwh.slice(d * 24, d * 24 + 24));
      expect(Math.abs(e5 - eh) / eh).toBeLessThan(0.02);
    }
  });

  test("a period shorter than a year holds its part of the annual demand by its weather (the rest: the typical year)", () => {
    const y0 = Date.UTC(2023, 0, 1) / 1000;
    const year = Array.from({ length: 8760 }, (_, i) => y0 + i * 3600);
    const full = districtProfile(s, year, syntheticOutdoor(year));
    expect(Math.abs(sum(full) - want) / want).toBeLessThan(1e-9); // a full year: the annual total, as before
    const slice = (from: number, to: number) => {
      const i = year.findIndex((t) => t >= from);
      const j = year.findIndex((t) => t >= to);
      const ts = year.slice(i, j);
      return { got: sum(districtProfile(s, ts, syntheticOutdoor(ts))), want: sum(full.slice(i, j)), hours: j - i };
    };
    const winter = slice(y0, Date.UTC(2023, 2, 1) / 1000); // Jan-Feb
    expect(Math.abs(winter.got - winter.want) / winter.want).toBeLessThan(0.03);
    const summer = slice(Date.UTC(2023, 6, 1) / 1000, Date.UTC(2023, 8, 1) / 1000); // Jul-Aug
    expect(Math.abs(summer.got - summer.want) / summer.want).toBeLessThan(0.03);
    // before, both got annual x hours / 8760: now winter has far more per hour, summer about its hot water only
    expect(winter.got / winter.hours).toBeGreaterThan((3 * summer.got) / summer.hours);
    expect(summer.got).toBeLessThan((1.2 * want * s.dhwShare * summer.hours) / 8760);
  });

  test("the first day follows a whole day's mean temperature, not the few hours since the start (audit P5)", () => {
    // the same weather every day (a daily swing round 0 °C): every weekday the same profile, the first one too
    const days = times.slice(0, 72); // Monday to Wednesday
    const kw = districtProfile(s, days, days.map((t) => 6 * Math.cos((2 * Math.PI * (t - t0)) / 86400)));
    for (let h = 0; h < 24; h++) expect(kw[h]).toBeCloseTo(kw[h + 24], 6); // before: the first night's hours from the night alone, ~+14 %
  });

  test("no timestamps, no demand", () => {
    expect(districtProfile(s, [], [])).toEqual([]);
  });
});

describe("totalDemand", () => {
  test("sums the included sinks and meets the hottest included supply", () => {
    const one = { ...s, houses: 10 };
    const tot = totalDemand(
      [
        { id: "a", name: "a", area: false, settings: one },
        { id: "b", name: "b", area: true, settings: { ...one, supplyTemp: 85 } },
        { id: "c", name: "c", area: false, settings: { ...one, supplyTemp: 95, included: false } },
      ],
      times,
      seasonal,
    );
    expect(Math.abs(sum(tot.kw) - 2 * 10 * s.kwhPerHouse)).toBeLessThan(1);
    expect(tot.settings.supplyTemp).toBe(85);
  });
});

describe("combineDemand", () => {
  test("uses the given profiles; nothing included: zeros and no hottest", () => {
    const e = (id: string, included: boolean) => ({ id, name: id, area: false, settings: { ...s, included } });
    const profiles: Record<string, number[]> = { a: [1, 2], b: [10, 20] };
    expect(combineDemand([e("a", true), e("b", true)], (x) => profiles[x.id], 2).kw).toEqual([11, 22]);
    expect(combineDemand([e("a", false)], (x) => profiles[x.id], 2)).toEqual({ kw: [0, 0], hottest: null });
  });

  test("annualMwh is houses x kWh per house", () => {
    expect(annualMwh(s)).toBe((s.houses * s.kwhPerHouse) / 1000);
  });
});

describe("daily curves and weather", () => {
  test("a drawn curve is interpolated and wraps at midnight", () => {
    const day = Array.from({ length: 24 }, (_, h) => h);
    expect(hotWaterCurve(23.5, false, day)).toBeCloseTo(11.5); // halfway from 23 back to 0
    expect(heatingCurve(2.5, { ...s, heatingDay: day })).toBeCloseTo(2.5);
  });

  test("the weekend morning peak is 2 h later", () => {
    const morning = (weekend: boolean) => [...Array(12).keys()].reduce((best, h) => (heatingCurve(h, s, weekend) > heatingCurve(best, s, weekend) ? h : best), 0);
    expect(morning(true) - morning(false)).toBe(2);
  });

  test("synthetic Frankfurt year: cold January, warm July", () => {
    const at = (m: number, d: number) => syntheticOutdoor([Date.UTC(2023, m, d, 15) / 1000])[0];
    expect(at(0, 15)).toBeCloseTo(1 + 4, 0);
    expect(at(6, 15)).toBeGreaterThan(20);
  });
});

describe("demandEntries", () => {
  const site: Site = { building: null, source: null, sinks: [] };

  test("no sinks on the map: one whole-district entry", () => {
    const [e, ...rest] = demandEntries({ ...site, district: { houses: 50 } });
    expect(rest).toHaveLength(0);
    expect(e.id).toBe(WHOLE);
    expect(e.settings.houses).toBe(50);
  });

  test("a building is one house unless its own settings say otherwise; an area keeps the district's", () => {
    const sink = { id: "b1", name: "B1", lat: 0, lon: 0, temp_c: 70, power_kw: 0 };
    const [b, a, own] = demandEntries({
      ...site,
      district: { houses: 50 },
      sinks: [sink, { ...sink, id: "a1", area: true }, { ...sink, id: "b2", demand: { houses: 3 } }],
    });
    expect([b.settings.houses, a.settings.houses, own.settings.houses]).toEqual([1, 50, 3]);
    expect(a.area).toBe(true);
  });
});

describe("typical day in kW (48 points) and the annual demand", () => {
  const close = (a: number[], b: number[], tol = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(tol)));

  test("an old 24-point drawing loads as before (hourly points, linear between)", () => {
    const old = Array.from({ length: 24 }, (_, h) => 1 + (h % 5));
    const s24 = { ...s, heatingDay: old, hotWaterDay: old };
    expect(heatingCurve(7, s24)).toBe(old[7]);
    expect(heatingCurve(7.5, s24)).toBeCloseTo((old[7] + old[8]) / 2);
    expect(hotWaterCurve(23.5, false, old)).toBeCloseTo((old[23] + old[0]) / 2);
    // as 48 half-hourly points it is the same curve, so the same profile
    const as48 = Array.from({ length: 48 }, (_, i) => heatingCurve(i / 2, s24));
    const a = districtProfile(s24, times.slice(0, 336), seasonal.slice(0, 336));
    const b = districtProfile({ ...s, heatingDay: as48, hotWaterDay: as48 }, times.slice(0, 336), seasonal.slice(0, 336));
    close(a, b);
  });

  test("drawing the curves that are shown changes nothing", () => {
    const kw = typicalDayKw(s);
    expect(kw.heating).toHaveLength(48);
    const p = drawDay(s, "heatingDay", kw.heating);
    // 48 points smooth the parametric curve's night-setback steps: within 0.5 %
    expect(Math.abs(p.kwhPerHouse! - s.kwhPerHouse) / s.kwhPerHouse).toBeLessThan(0.005);
    expect(p.dhwShare).toBeCloseTo(s.dhwShare, 3);
    const q = drawDay(s, "hotWaterDay", kw.hotWater);
    expect(Math.abs(q.kwhPerHouse! - s.kwhPerHouse) / s.kwhPerHouse).toBeLessThan(0.005);
    // a drawn curve drawn again is exact
    const drawn = { ...s, ...p };
    expect(drawDay(drawn, "heatingDay", typicalDayKw(drawn).heating).kwhPerHouse).toBe(p.kwhPerHouse);
  });

  test("the height is the annual demand: doubling the heating curve doubles the space heating", () => {
    const kw = typicalDayKw(s);
    const p = drawDay(s, "heatingDay", kw.heating.map((v) => 2 * v));
    const annual = s.houses * s.kwhPerHouse;
    const want = annual * (1 - s.dhwShare) * 2 + annual * s.dhwShare;
    expect(Math.abs(p.kwhPerHouse! * s.houses - want) / want).toBeLessThan(0.002);
    expect(p.dhwShare).toBeCloseTo((annual * s.dhwShare) / want, 3);
    // and the drawn kW is what is shown back, the hot water unchanged
    const next = { ...s, ...p };
    close(typicalDayKw(next).heating, p.heatingDay!, 1e-1);
    close(typicalDayKw(next).hotWater, kw.hotWater, 1e-1);
  });

  test("editing the demand per house moves the curves", () => {
    const k1 = typicalDayKw(s).hotWater;
    const k2 = typicalDayKw({ ...s, kwhPerHouse: 2 * s.kwhPerHouse }).hotWater;
    close(k2, k1.map((v) => 2 * v));
  });

  test("hot water: the day's kWh x 365 is its annual share", () => {
    const kw = typicalDayKw(s).hotWater;
    const day = (kw.reduce((a, b) => a + b, 0) * 24) / 48;
    const weekendAware = s.houses * s.kwhPerHouse * s.dhwShare;
    expect(Math.abs(day * 365 - weekendAware) / weekendAware).toBeLessThan(0.05); // weekends shift the morning, nearly the same energy
  });

  test("a flat zero heating curve leaves hot water only", () => {
    const p = drawDay(s, "heatingDay", new Array(48).fill(0));
    expect(p.dhwShare).toBe(1);
    expect(typicalDayKw({ ...s, ...p }).heating.every((v) => v === 0)).toBe(true);
  });

  test("reference heating degree-days grow with the heating limit", () => {
    expect(referenceHdd(15)).toBeGreaterThan(1500);
    expect(referenceHdd(18)).toBeGreaterThan(referenceHdd(15));
  });
});

describe("Open-Meteo alignment and the site location", () => {
  test("hourly values are interpolated to 5-second steps and held at the ends", () => {
    const src = [0, 3600, 7200];
    const vals = [0, 10, 4];
    const t5 = [-5, 0, 5, 1800, 3600, 5400, 7200, 7205];
    alignToTimes(src, vals, t5).forEach((v, i) => expect(v).toBeCloseTo([0, 0, 1 / 72, 5, 10, 7, 4, 4][i], 9));
    expect(alignToTimes([], [], [1, 2]).every(Number.isNaN)).toBe(true);
  });

  test("the source bubble, else the building outline's centre, else nothing", () => {
    const b = { name: "B", osm_id: null, outline: [[50, 8], [50.2, 8.2]] as [number, number][] };
    expect(siteLocation({ building: b, source: null, sinks: [] })).toEqual({ lat: 50.1, lon: 8.1 });
    expect(siteLocation({ building: b, source: { id: "s", name: "s", lat: 1, lon: 2, temp_c: 0, power_kw: 0 }, sinks: [] })).toEqual({ lat: 1, lon: 2 });
    expect(siteLocation({ building: null, source: null, sinks: [] })).toBeNull();
  });
});
