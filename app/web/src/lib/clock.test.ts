/** Frankfurt's clock: the summer time switch, the local date and hour. */
import { expect, test } from "vitest";
import { cetOffsetHours, localDate } from "./clock";

const at = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m, d, h) / 1000;

test("CET in winter, CEST from the last Sunday of March to the last of October at 01:00 UTC", () => {
  expect(cetOffsetHours(at(2024, 2, 31, 0))).toBe(1);
  expect(cetOffsetHours(at(2024, 2, 31, 1))).toBe(2);
  expect(cetOffsetHours(at(2024, 9, 27, 0))).toBe(2);
  expect(cetOffsetHours(at(2024, 9, 27, 1))).toBe(1);
});

test("the local date and hour", () => {
  const d = localDate(at(2024, 0, 14, 23)); // Sunday 23:00 UTC is Monday 00:00 in Frankfurt
  expect([d.getUTCDate(), d.getUTCHours(), d.getUTCDay()]).toEqual([15, 0, 1]);
  expect(localDate(at(2024, 6, 15, 5)).getUTCHours()).toBe(7);
});
