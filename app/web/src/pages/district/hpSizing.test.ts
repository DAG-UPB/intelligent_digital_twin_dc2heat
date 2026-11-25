import { expect, test } from "vitest";
import { heatPumpKw, stationCapacity } from "./hpSizing";

test("stationCapacity: the data center's heat used (no exchanger share off it again), lifted by a Carnot COP; a hot source goes direct", () => {
  const c = stationCapacity(3270, 30, 70);
  expect(c.cop).toBeCloseTo((0.5 * 343.15) / 40, 6);
  expect(c.kw).toBeCloseTo((3270 * c.cop) / (c.cop - 1), 6); // the card's heat is the heat used: all of it to the heat pump
  expect(stationCapacity(1000, 80, 70)).toMatchObject({ kw: 1000, direct: true });
});

test("heatPumpKw: half the peak hour where that gives 75 % of the year, else raised until it does, never above the capacity", () => {
  const flat = new Array<number>(100).fill(10);
  expect(heatPumpKw(flat, 0, 1000)).toBeCloseTo(7.5, 6); // half the peak gives 50 % of a flat year: raised to 75 %
  const peaky = [...new Array<number>(99).fill(1), 90];
  expect(heatPumpKw(peaky, 0, 1000)).toBe(45); // half the peak hour covers 144 of 189
  expect(heatPumpKw(flat, 0, 5)).toBe(5); // the data center allows no more
  expect(heatPumpKw(flat, 2, 1000)).toBeCloseTo(9, 6); // the pipes' loss is heat to make too: 75 % of 12
  expect(heatPumpKw([], 0, 1000)).toBe(0);
});
