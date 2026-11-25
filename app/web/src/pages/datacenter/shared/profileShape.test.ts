/** set_profile_shape: picking the open generator and checking the drawn values. */
import { expect, test } from "vitest";
import { pickByName, shapeValues } from "./profileShape";

test("a generator by its exact name or a unique part of it; the only one without a name", () => {
  const names = ["Q_houses · profile", "Q_offices · profile"];
  expect(pickByName(names, "q_offices")).toBe("Q_offices · profile");
  expect(pickByName(["Q_houses · profile"], undefined)).toBe("Q_houses · profile");
  expect(() => pickByName(names, undefined)).toThrow(/Several/);
  expect(() => pickByName(names, "profile")).toThrow(/several/);
});

test("drawn values: the right count, numbers of 0 or more", () => {
  expect(shapeValues([1, 2, 3, 4, 5, 6, 7], [7], "weekday")).toHaveLength(7);
  expect(() => shapeValues([1, 2], [7], "weekday")).toThrow(/7 numbers/);
  expect(() => shapeValues(Array(24).fill(-1), [24, 48], "day")).toThrow(/24 or 48/);
});
