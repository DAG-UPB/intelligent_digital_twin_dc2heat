import { expect, test } from "vitest";
import { dailyMeans } from "./RollingCard";

test("daily means of hourly values, gaps left out", () => {
  const time = ["2024-01-01T00:00:00", "2024-01-01T12:00:00", "2024-01-02T00:00:00", "2024-01-02T01:00:00"];
  const [xs, ys] = dailyMeans(time, [1, 3, null, 10]);
  expect(xs).toEqual([Date.UTC(2024, 0, 1) / 1000, Date.UTC(2024, 0, 2) / 1000]);
  expect(ys).toEqual([2, 10]);
});

test("a day without values stays on the time axis as NaN, so later days keep their place", () => {
  const time = ["2024-01-01T00:00:00", "2024-01-02T00:00:00", "2024-01-03T00:00:00"];
  const [xs, ys] = dailyMeans(time, [1, null, 3]);
  expect(xs).toEqual([1, 2, 3].map((d) => Date.UTC(2024, 0, d) / 1000));
  expect(ys).toEqual([1, NaN, 3]);
});
