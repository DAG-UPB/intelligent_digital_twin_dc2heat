/** Site map bubble encoding: radius by power, colour by temperature. */
import { describe, expect, test } from "vitest";
import { bubbleColor, R_MAX, R_MIN, radiusScale } from "./bubbles";

describe("radiusScale", () => {
  test("linear between the smallest and biggest power", () => {
    const r = radiusScale([100, 40, 500]);
    expect(r(40)).toBe(R_MIN);
    expect(r(500)).toBe(R_MAX);
    expect(r(270)).toBeCloseTo((R_MIN + R_MAX) / 2);
  });

  test("all powers equal: the middle size", () => {
    expect(radiusScale([100, 100])(100)).toBe(14.5);
  });
});

describe("bubbleColor", () => {
  test("clamps the temperature to 10..90 °C", () => {
    expect(bubbleColor("sink", -20)).toEqual(bubbleColor("sink", 10));
    expect(bubbleColor("source", 200)).toEqual(bubbleColor("source", 90));
    expect(bubbleColor("source", 90).fill).toBe("rgb(255,0,0)");
    expect(bubbleColor("sink", 10).fill).toBe("rgb(150,190,255)");
  });

  test("red family for the source, blue for sinks", () => {
    expect(bubbleColor("source", 50).stroke).toBe("#7f1d1d");
    expect(bubbleColor("sink", 50).stroke).toBe("#1e3a8a");
  });
});
