import { expect, test } from "vitest";
import { DEFAULT_DISTRICT, demandEntries } from "../../lib/demand";
import { bubbleKw, daySvg, daysOf, monthsOf, monthsSvg, profileHtml, sinkFigures, sinkLine } from "./sinkProfile";
import { withSink } from "./siteEdits";

const sink = (profile?: string) => ({ id: "a", name: "A", settings: { ...DEFAULT_DISTRICT, houses: 1, kwhPerHouse: 120000, profile } });

test("a sink's months hold its annual demand, shaped by its profile", () => {
  const curves = monthsOf(sink());
  expect(curves.reduce((a, b) => a + b, 0)).toBeCloseTo(120, 6); // MWh
  expect(curves[0]).toBeGreaterThan(curves[6]); // heating: more in January than in July
  const flat = monthsOf(sink("constant"));
  expect(flat.reduce((a, b) => a + b, 0)).toBeCloseTo(120, 6);
  expect(flat[0] / flat[1]).toBeCloseTo(31 / 28, 2); // the same every day: by the days of the month
  expect(monthsSvg(flat).match(/<rect/g)).toHaveLength(12);
  expect(profileHtml(sink("constant"))).toContain("120 MWh/a");
});

test("its average day in January and July: 24 hours that hold the month's demand, the winter one higher", () => {
  const { winter, summer } = daysOf(sink());
  expect(winter).toHaveLength(24);
  expect((winter.reduce((a, b) => a + b, 0) * 31) / 1000).toBeCloseTo(monthsOf(sink())[0], 6); // kW over a day × 31 days = January's MWh
  expect(Math.max(...winter)).toBeGreaterThan(Math.max(...summer)); // heating in January, only hot water in July
  const flat = daysOf(sink("constant"));
  expect(Math.max(...flat.winter)).toBeCloseTo(Math.min(...flat.winter), 6); // the same every hour
  expect(daySvg(flat).match(/<polyline/g)).toHaveLength(2);
  expect(profileHtml(sink())).toContain("A day: up to");
});

// K6: the sink's card and tooltip showed its bubble's temp_c and power_kw ("60 °C · 100 kW"), which no calculation reads
test("a sink's figures are its demand's: a new sink is 12 MWh/a, 4.8 kW at its peak, in a 70 °C network", () => {
  const site = withSink({ building: null, source: null, sinks: [] }, 50, 8, null);
  expect(site.sinks[0]).toMatchObject({ temp_c: 60, power_kw: 100 }); // the bubble's, not what counts
  const e = demandEntries(site)[0];
  const f = sinkFigures(e.settings);
  expect(f.mwh).toBeCloseTo(12, 9);
  expect(f.peakKw).toBeCloseTo(4.8, 1); // its peak hour on the typical year (3.9 kW with a clicked home's profile)
  expect(f.supply).toBe(70);
  expect(sinkLine(e.settings)).toBe("70 °C · peak 4,8 kW");
  expect(sinkLine({ ...e.settings, kwhPerHouse: 5_000_000, supplyTemp: 95 })).toMatch(/^95 °C · peak 1\.\d{3} kW$/); // it follows the demand
});

// 1b-4: a sink's bubble was sized by its stored power_kw (100 kW for a new one) while its row says its peak
test("a sink's bubble is sized by its peak hour, as its row; the data center's by its power", () => {
  const site = withSink({ building: null, source: null, sinks: [] }, 50, 8, null);
  const e = demandEntries(site)[0];
  expect(bubbleKw(site.sinks[0], e)).toBeCloseTo(sinkFigures(e.settings).peakKw, 9); // 4.8 kW, was 100
  const big = { ...e, settings: { ...e.settings, kwhPerHouse: 5_000_000 } };
  expect(bubbleKw(site.sinks[0], big)).toBeGreaterThan(1000); // it follows the demand, not power_kw
  expect(bubbleKw({ power_kw: 5930 }, undefined)).toBe(5930); // the data center (no demand)
});
