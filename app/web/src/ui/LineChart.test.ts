import { describe, expect, it } from "vitest";
import type uPlot from "uplot";
import { europeanTime, germanTicks } from "./LineChart";

const opts = (o: Partial<uPlot.Options> = {}): uPlot.Options => ({ width: 100, height: 100, series: [{}, { label: "a" }], axes: [{}, {}], ...o });

describe("europeanTime", () => {
  it("writes dates the European way, on the browser's clock", () => {
    const o = europeanTime(opts());
    const at = new Date(2024, 0, 15, 14, 5); // 15 January 2024, 14:05 on this computer's clock
    expect(o.fmtDate!("{D}.{M}. {HH}:{mm}")(at)).toBe("15.1. 14:05");
    expect(o.tzDate).toBeUndefined(); // uPlot's default: the browser's zone
    expect(o.series[0].value).toBe("{DD}.{MM}.{YYYY} {HH}:{mm}");
    expect((o.axes![0].values as uPlot.Axis.TimeValuesConfig).some((r) => r[1] === "{D}.{M}.")).toBe(true);
    expect(o.axes).toHaveLength(2);
  });

  it("keeps a chart's own legend value and leaves charts without time alone", () => {
    expect(europeanTime(opts({ series: [{ value: "{DD}.{MM}.{YYYY}" }, {}] })).series[0].value).toBe("{DD}.{MM}.{YYYY}");
    const plain = opts({ scales: { x: { time: false } } });
    expect(europeanTime(plain)).toBe(plain);
  });
});

describe("germanTicks", () => {
  it("formats a value axis as the page's numbers, with the decimals the spacing needs (uPlot gave 12,500 and 0.2)", () => {
    expect(germanTicks(null, [10_000, 12_500, 15_000])).toEqual(["10.000", "12.500", "15.000"]);
    expect(germanTicks(null, [0, 0.2, 0.4])).toEqual(["0,0", "0,2", "0,4"]);
    expect(germanTicks(null, [0.05, 0.1])).toEqual(["0,05", "0,10"]);
  });
  it("is the y axes' default; a chart's own values win", () => {
    const own = () => ["x"];
    const o = europeanTime({ width: 1, height: 1, series: [{}, {}], axes: [{}, {}, { values: own }] });
    expect(o.axes![1].values).toBe(germanTicks);
    expect(o.axes![2].values).toBe(own);
  });
});
