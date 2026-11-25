/** Pure helpers of the top bar: dataset grouping and short labels in the picker, project file name. */
import { expect, test } from "vitest";
import type { DataVersions } from "../api";
import { pickerGroups, shortName, versionLabel } from "./DataCenterPicker";

const ds = (id: string, kind = "simulation") => ({ id, name: id, kind });

test("menu: the user's versions newest first, then the examples; per folder Simulations, Testbed, Real, then its examples; unknown kinds left out", () => {
  const state: DataVersions = {
    current: "version_1",
    versions: ["version_1", "version_2"],
    linked: true,
    root: "/x",
    folders: {
      version_1: [ds("real1", "real"), ds("sim"), ds("bed", "testbed"), ds("odd", "other"), { ...ds("sim_1"), example: true }],
      version_2: [ds("real2", "real")],
      local: [ds("sim_1")],
    },
  };
  expect(pickerGroups(state).map((g) => [g.label, g.folder, g.items.map((d) => d.id)])).toEqual([
    ["Version 2 · Real data centers", "version_2", ["real2"]],
    ["Version 1 · Simulations", "version_1", ["sim"]],
    ["Version 1 · Testbed", "version_1", ["bed"]],
    ["Version 1 · Real data centers", "version_1", ["real1"]],
    ["Examples", "version_1", ["sim_1"]],
    ["Examples · Simulations", "local", ["sim_1"]],
  ]);
});

test.each([
  ["Simulation 1 · with heat exchangers", "Sim 1 · HEX"],
  ["Simulation 2", "Sim 2"],
  ["Lab testbed · experiment 1", "Lab · exp 1"],
  ["Plant A (water-cooled) · rack 2", "Plant A · rack 2"],
  ["Plant B (air-cooled) · 5 min", "Plant B · 5 min"],
  ["Pilot (lab experiment 1)", "Pilot"],
  ["sim_3", "sim_3"],
  ["Testbed", "Testbed"], // nothing would be left: keep the name
  ["(draft)", "(draft)"],
])("short picker label of %s is %s", (name, short) => {
  expect(shortName(name)).toBe(short);
});

test("data version labels", () => {
  expect(versionLabel("local")).toBe("Examples");
  expect(versionLabel("version_12")).toBe("Version 12");
});
