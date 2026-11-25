/** Dataset defaults of the training settings. */
import { expect, test } from "vitest";
import type { DatasetInfo } from "../../../api";
import { defaultInputs, leversOf, modelColumns, splitDate, toggle } from "./inputs";

test("defaultInputs: suggested, actuators and weather columns, deduplicated, only existing columns", () => {
  const cols = ["In_Temp", "Out_Temp", "hour", "temperature_2m", "Cool_Set", "ITE_Ener"];
  expect(defaultInputs(cols, ["ITE_Ener", "Gone"], ["Cool_Set", "ITE_Ener"])).toEqual(["ITE_Ener", "Cool_Set", "Out_Temp", "hour", "temperature_2m"]);
});

test("leversOf: levers, else actuators, only columns of the data", () => {
  const ds = (config: object) => ({ columns: ["a", "b"], config }) as unknown as DatasetInfo;
  expect(leversOf(ds({ levers: ["b", "x"], actuators: ["a"] }))).toEqual(["b"]);
  expect(leversOf(ds({ actuators: ["a"] }))).toEqual(["a"]);
  expect(leversOf(null)).toEqual([]);
});

test("splitDate interpolates the time range", () => {
  expect(splitDate({ start: "2024-01-01T00:00:00Z", end: "2024-01-11T00:00:00Z" }, 0.5)).toBe("2024-01-06");
});

test("toggle adds or removes", () => {
  expect(toggle(["a"], "b")).toEqual(["a", "b"]);
  expect(toggle(["a", "b"], "a")).toEqual(["b"]);
});

test("modelColumns: every column but the calculated ones", () => {
  const derived = { Q: { m: "m", t_in: "a", t_out: "b", cp: 4.18 } };
  expect(modelColumns({ columns: ["a", "b", "m", "Q"], config: { derived } } as unknown as DatasetInfo)).toEqual(["a", "b", "m"]);
  expect(modelColumns(null)).toEqual([]);
});
