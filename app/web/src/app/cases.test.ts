import { beforeEach, expect, test, vi } from "vitest";
import { caseOn, caseShort, EXAMPLE_CASES, pickCase, pickedCase, removeCase, reopened, saveCase, savedCases, type Case } from "./cases";

beforeEach(() => {
  const m = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });
});

const now: Case = { name: "", dc: "sim_recovery_air", heat: "sim_recovery_air", district: "sim_recovery_air", dcModel: "xgb", districtModel: "xgb" };

test("the case on: the same datasets, and the same models where it names them", () => {
  expect(caseOn(EXAMPLE_CASES, now)?.name).toBe("Case 1 · Recovery, trained models");
  expect(caseOn(EXAMPLE_CASES, { ...now, dcModel: "phys", districtModel: "phys" })?.name).toBe("Case 2 · Recovery, physical models");
  expect(caseOn(EXAMPLE_CASES, { ...now, dcModel: "linear" })).toBeUndefined();
  expect(caseOn(EXAMPLE_CASES, { ...now, dc: "sim_box_air", heat: "sim_box_air", district: "sim_box_air", dcModel: "x" })?.name).toBe("Case 4 · Box, air cooled");
  expect(caseShort("Case 1 · Recovery, trained models")).toBe("Case 1");
});

test("your own cases: kept in this browser, one per name", () => {
  saveCase({ ...now, name: "Mine" });
  saveCase({ ...now, name: "Mine", dcModel: "phys" });
  expect(savedCases()).toEqual([{ ...now, name: "Mine", dcModel: "phys" }]);
  removeCase("Mine");
  expect(savedCases()).toEqual([]);
});

test("the case picked last stays on while its datasets do, though a model did not save", () => {
  pickCase("Case 2 · Recovery, physical models");
  expect(caseOn(EXAMPLE_CASES, { ...now, dcModel: null }, pickedCase())?.name).toBe("Case 2 · Recovery, physical models");
  expect(caseOn(EXAMPLE_CASES, { ...now, district: "sim_district_heat" }, pickedCase())?.name).toBe("Case 3 · Recovery, measured district");
});

test("a new tab after an earlier visit opens blank; a first visit and a reload keep what is stored", () => {
  const tab = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (k: string) => tab.get(k) ?? null, setItem: (k: string, v: string) => void tab.set(k, v) });
  expect(reopened()).toBe(false); // the first visit
  expect(reopened()).toBe(false); // a reload
  tab.clear(); // a new tab, or the browser started again
  expect(reopened()).toBe(true);
  expect(reopened()).toBe(false);
});
