import { expect, test } from "vitest";
import { fmt, fmtDate, fmtDateTime, fmtTime, fmtUpTo } from "./format";

test("fixed decimals with thousands separators, German: points between the thousands, a decimal comma", () => {
  expect(fmt(12345.678)).toBe("12.346");
  expect(fmt(12345.678, 1)).toBe("12.345,7");
  expect(fmt(2, 2)).toBe("2,00");
  expect(fmt(-0.5, 1)).toBe("-0,5");
});

test("a value that rounds to zero has no sign", () => {
  expect(fmt(-1e-12)).toBe("0");
  expect(fmt(-0.04, 1)).toBe("0,0");
  expect(fmt(-0.05, 1)).toBe("-0,1");
});

test("not a finite number: a dash", () => {
  expect(fmt(NaN)).toBe("–");
  expect(fmt(Infinity, 2)).toBe("–");
});

test("a date and time, German on Frankfurt's clock, not the browser's US format (audit P9)", () => {
  expect(fmtDateTime(Date.UTC(2026, 10, 24, 13, 35))).toBe("24.11.2026, 14:35"); // was "11/24/2026, 2:35:11 PM"
  expect(fmtDateTime(Date.UTC(2026, 6, 1, 6, 5))).toBe("01.07.2026, 08:05"); // summer time
});

test("at most d decimals, trailing zeros dropped; a day and a time on Frankfurt's clock", () => {
  expect(fmtUpTo(5.5, 1)).toBe("5,5");
  expect(fmtUpTo(5.04, 1)).toBe("5");
  expect(fmtUpTo(1234.567, 2)).toBe("1.234,57");
  expect(fmtUpTo(-0.001, 2)).toBe("0");
  expect(fmtUpTo(NaN, 1)).toBe("–");
  expect(fmtDate(Date.UTC(2026, 1, 1, 23, 30))).toBe("02.02.2026"); // after midnight in Frankfurt
  expect(fmtTime(Date.UTC(2026, 10, 24, 13, 35))).toBe("14:35");
});
