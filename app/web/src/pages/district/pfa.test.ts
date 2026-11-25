/** The Plattform für Abwärme's sources: their heat over the typical year, their temperature, colour, size, tooltip. */
import { describe, expect, test } from "vitest";
import type { HeatSource } from "../../api";
import { radiusOf, sourceHtml, sourceYear, tempColor, tempOf, TEMP_CLASSES } from "./pfa";
import { YEAR_TIMES } from "./quickAnalysis";

const source = (over: Partial<HeatSource> = {}): HeatSource => ({
  id: 1,
  company: "ACME <GmbH>",
  site: "Werk",
  street: "Hanauer Landstraße 1",
  plz: "60314",
  city: "Frankfurt am Main",
  name: "Kühlturm",
  mwh: 8760,
  max_kw: 5000,
  temp_c: 35,
  temp_range: "25 - 60 °C",
  hours_per_day: 24,
  weekend: true,
  availability: "7 Tage 24 Std",
  predictable: false,
  control: null,
  note: null,
  months_mwh: null,
  lat: 50.11,
  lon: 8.7,
  geo: "address",
  ...over,
});
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("a source's heat over the typical year", () => {
  test("without months: the year spread evenly over each month's hours", () => {
    const y = sourceYear(source());
    expect(sum(y.q) / 1000).toBeCloseTo(8760, 6);
    expect(y.q[0]).toBeCloseTo(730_000 / 744, 6); // January: 730 MWh over 744 h
    expect(y.t[0]).toBe(35);
  });

  test("its months, only on weekdays and 8 h a day from 6:00, the month's heat kept", () => {
    const months = [310, 0, ...Array(10).fill(100)];
    const y = sourceYear(source({ months_mwh: months, hours_per_day: 8, weekend: false, mwh: 1310 }));
    expect(sum(y.q) / 1000).toBeCloseTo(1310, 6);
    const jan = YEAR_TIMES.map((t, i) => [new Date(t * 1000), y.q[i]] as const).filter(([d]) => d.getUTCMonth() === 0);
    const on = jan.filter(([, q]) => q > 0);
    expect(on).toHaveLength(23 * 8); // 1 January 2025 is a Wednesday: 23 weekdays
    expect(on.every(([d]) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && d.getUTCHours() >= 6 && d.getUTCHours() < 14)).toBe(true);
    expect(y.q.slice(744, 744 + 672).every((q) => q === 0)).toBe(true); // February: none
  });

  test("the months only shape the year: months far below it (another unit) are scaled to it; without a year they count", () => {
    // as a Mainova boiler: 1,473 MWh a year, months that sum to 0.44, none in August
    const months = [0.05, 0.02, 0.02, 0.05, 0.04, 0.05, 0.04, 0, 0.05, 0.03, 0.02, 0.04];
    const y = sourceYear(source({ mwh: 1472.8, max_kw: 409, months_mwh: months }));
    expect(sum(y.q) / 1000).toBeGreaterThan(1300); // the year's amount (less only where the max kW caps a month)
    expect(y.q.slice(5088, 5088 + 744).every((q) => q === 0)).toBe(true); // August: none, as its months say
    // no year figure: the months as the header says, mean kW (the table's 100 kW in January: 74.4 MWh)
    expect(sum(sourceYear(source({ mwh: null, months_mwh: [0.1, ...Array(11).fill(0)] })).q) / 1000).toBeCloseTo(74.4, 6);
  });

  test("at most its maximum power: the month's rest is lost", () => {
    const y = sourceYear(source({ max_kw: 100, hours_per_day: 1 }));
    expect(Math.max(...y.q)).toBe(100);
    expect(sum(y.q) / 1000).toBeCloseTo(36.5, 6);
  });
});

test("the temperature from its range when no mean is given; colours and sizes", () => {
  expect(tempOf({ temp_c: null, temp_range: "25 - 60 °C" })).toBe(42.5);
  expect(tempOf({ temp_c: null, temp_range: ">=110 °C" })).toBe(110);
  expect(tempOf({ temp_c: null, temp_range: null })).toBeNull();
  expect(tempColor(20)).toBe(TEMP_CLASSES[0].color);
  expect(tempColor(95)).toBe(TEMP_CLASSES[3].color);
  expect(radiusOf(50)).toBe(5);
  expect(radiusOf(50_000)).toBeGreaterThan(radiusOf(5_000));
  expect(radiusOf(1e9)).toBe(22);
});

test("the tooltip escapes the table's texts", () => {
  const html = sourceHtml(source({ geo: "postcode" }));
  expect(html).toContain("ACME &#60;GmbH&#62;");
  expect(html).toContain("placed at its postcode only");
  expect(html).toContain("35 °C");
});
