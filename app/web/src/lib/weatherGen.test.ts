import { describe, expect, it } from "vitest";
import { generateWeather, parseWeatherCsv } from "./weatherGen";

describe("weatherGen", () => {
  const jan15 = Date.UTC(2023, 0, 15) / 1000;
  const jul15 = Date.UTC(2023, 6, 15) / 1000;
  it("is coldest in January and warmest in July, at 03:00 and 15:00", () => {
    const [winter3, winter15, summer15] = generateWeather([jan15 + 3 * 3600, jan15 + 15 * 3600, jul15 + 15 * 3600], 10, 9, 4);
    expect(winter3).toBeCloseTo(10 - 9 - 4, 0);
    expect(winter15).toBeCloseTo(10 - 9 + 4, 0);
    expect(summer15).toBeCloseTo(10 + 9 + 4, 0);
  });
  it("reads the last number of each line, skips the header, repeats a short file", () => {
    expect(parseWeatherCsv("time;T\n2023-01-01 00:00;1,5\n2023-01-01 01:00;2\n", 5)).toEqual([1.5, 2, 1.5, 2, 1.5]);
    expect(parseWeatherCsv("no numbers here", 3)).toBeNull();
  });
});
