import { describe, expect, it } from "vitest";
import type uPlot from "uplot";
import { europeanTime } from "./LineChart";

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
