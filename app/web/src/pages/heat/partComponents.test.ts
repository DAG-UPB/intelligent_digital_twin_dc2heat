/** The parts' contract with components: which can be used, the inputs sent, the series read back, the saved choice. */
import { expect, test } from "vitest";
import type { Component } from "../../api";
import { activeComponents, asPartComponents, partInputs, toPartSeries, usableFor } from "./partComponents";

const comp = (kind: Component["kind"], nodes: string[], inputs: string[]): Component => ({
  id: kind,
  name: kind,
  kind,
  inputs: inputs.map((name) => ({ name, unit: "", default: 0 })),
  nodes: nodes.map((name) => ({ name, unit: "", equation: "", init: 0 })),
  outputs: [],
  params: [],
  notes: "",
  source: "",
  preset: false,
});

test("a part uses components of its kind that have the nodes it reads", () => {
  const hp = comp("heat_pump", ["COP", "Q_max"], ["T_source"]);
  const list = [hp, comp("heat_pump", ["COP"], []), comp("storage", ["COP", "Q_max"], [])];
  expect(usableFor("hp", list)).toEqual([hp]);
  expect(usableFor("tank", list)).toEqual([]);
});

test("only the inputs the component has are sent", () => {
  const x = { tSource: [30, 31], qSource: [100, 90], supply: 70, ret: 40 };
  expect(partInputs("hp", comp("heat_pump", [], ["T_source", "load"]), x)).toEqual({ T_source: [30, 31] });
  expect(partInputs("hex", comp("heat_exchanger", [], ["T_hot_in", "Q_hot", "T_cold_in"]), x)).toEqual({ T_hot_in: [30, 31], Q_hot: [100, 90], T_cold_in: 40 });
  expect(partInputs("tank", comp("storage", [], ["T_supply", "T_return"]), x)).toEqual({ T_supply: 70, T_return: 40 });
});

test("the run becomes the matching's series", () => {
  expect(toPartSeries("hp", { COP: [3], Q_max: [100], lift: [40] })).toEqual({ hpCop: [3], hpCap: [100] });
  expect(toPartSeries("tank", { E_max: [500], loss_pct: [0.1] })).toEqual({ tankKwh: [500], tankLossPct: [0.1] });
});

test("the saved choice: unknown keys and non-strings are dropped, an old site.json has none", () => {
  expect(asPartComponents({ hp: "hp_2mw", tank: 3, foo: "x", hex: "" })).toEqual({ hp: "hp_2mw" });
  expect(asPartComponents(undefined)).toEqual({});
});

test("a picked component runs only for a part from physics, and only while it is usable", () => {
  const hp = { ...comp("heat_pump", ["COP", "Q_max"], []), id: "hp1" };
  const tank = { ...comp("storage", ["E_max", "loss_pct"], []), id: "t1" };
  const list = [hp, tank];
  expect(activeComponents({ hp: "hp1", tank: "t1" }, list, ["hp", "tank"])).toEqual({ hp, tank });
  expect(activeComponents({ hp: "hp1", tank: "t1" }, list, ["tank"])).toEqual({ tank }); // the heat pump runs from data or is off
  expect(activeComponents({ hp: "gone", hex: "hp1" }, list, ["hex", "hp", "tank"])).toEqual({}); // deleted; of the wrong kind; none picked
});
