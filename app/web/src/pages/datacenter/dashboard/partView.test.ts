import { expect, test } from "vitest";
import type { DatasetSummary } from "../../../api";
import type { DatasetConfig } from "../../../dataset";
import { graphVariables, onlyVariables, partKpis, partVariables, shownKpis, statsOf } from "./partView";

const config: DatasetConfig = {
  actuators: [],
  heat: [],
  levers: [],
  heat_source: { hall: { q: "Q_h", t: "T_h", m: "m_h" }, cond: { q: "Q_c", t: "T_c" } },
  kpi: { heat_demand: "Demand" },
};
const columns = ["IT", "Q_h", "T_h", "m_h", "Q_c", "T_c", "Demand", "Out_Temp", "x"];

test("each part shows its own variables: the data center all, the heat distribution its HEX points, the district its demand and weather", () => {
  expect(partVariables("dc", config, columns, [])).toBeNull();
  expect(partVariables("heat", config, columns, ["x", "not_data"])).toEqual(["Q_h", "T_h", "m_h", "Q_c", "T_c", "x"]); // and its graph's, with data
  expect(partVariables("district", config, columns, [])).toEqual(["Demand", "Out_Temp"]);
  expect(graphVariables({ a: [{ parent: "b", lag: -1 }], c: [] })).toEqual(["a", "b", "c"]);
});

test("the summary cut to a part's variables keeps the correlations between them only", () => {
  const s = {
    variables: [{ name: "a" }, { name: "b" }, { name: "c" }],
    correlation: {
      names: ["a", "b", "c"],
      matrix: [
        [1, 0.5, 0.1],
        [0.5, 1, 0.2],
        [0.1, 0.2, 1],
      ],
    },
    series: { time: ["t"], columns: { a: [1], b: [2], c: [3] } },
    missing_map: {},
    profile: null,
    duration: {},
    daily: {},
    acf: {},
    monthly: {},
    recommendations: [{ variables: ["c"] }, { variables: ["a", "x"] }],
  } as unknown as DatasetSummary;
  const cut = onlyVariables(s, ["a", "c"]);
  expect(cut.variables.map((v) => v.name)).toEqual(["a", "c"]);
  expect(cut.correlation).toEqual({
    names: ["a", "c"],
    matrix: [
      [1, 0.1],
      [0.1, 1],
    ],
  });
  expect(Object.keys(cut.series.columns)).toEqual(["a", "c"]);
  expect(cut.recommendations).toHaveLength(2);
  expect(onlyVariables(s, null)).toBe(s);
});

test("the parts' KPIs come out the same from the data's statistics and from a run's series", () => {
  const run = { Q_h: [10, 20, null], T_h: [30, 32, 34], Q_c: [5, 5, 5], T_c: [40, 40, 40], Demand: [100, 300, 200] };
  const stats = statsOf(run);
  expect(stats.Q_h).toEqual({ mean: 15, max: 20, count: 2 }); // the gap left out
  const heat = partKpis("heat", config, stats, 1);
  expect(heat.map((k) => [k.label, k.value, k.note])).toEqual([
    ["Heat recovered", 0.03, "Σ Q_h × Δt (at the hall; cond: another design)"], // 15·2 kWh: the options are not added up
    ["Electricity consumption", null, "needs P_el_hp"],
    ["Mean source temperature", 32, "mean of T_h"],
    ["Mean sink temperature", null, "needs T_dh_supply"],
    ["COP", null, "needs Q_hp, P_el_hp"],
  ]);
  // the three without their variables in the data are not tiles (audit P12: three empty tiles on Case 1)
  expect(shownKpis(heat).map((k) => k.label)).toEqual(["Heat recovered", "Mean source temperature"]);
  expect(heat.filter((k) => k.lacking).map((k) => k.label)).toEqual(["Electricity consumption", "Mean sink temperature", "COP"]);
  // the heat pump's and the district side's variables, as the Structure page's KPI variables (lib/partKpis)
  const hp = partKpis("heat", config, statsOf({ ...run, Q_hp: [40, 40, 40], P_el_hp: [10, 10, 10], T_dh_supply: [70, 72, 74] }), 1);
  expect(hp.map((k) => [k.label, k.value, k.note]).slice(1)).toEqual([
    ["Electricity consumption", 0.03, "Σ P_el_hp × Δt"],
    ["Mean source temperature", 32, "mean of T_h"],
    ["Mean sink temperature", 72, "mean of T_dh_supply"],
    ["COP", 4, "Σ Q_hp / Σ P_el_hp"],
  ]);
  expect(shownKpis(hp)).toHaveLength(5);
  const district = partKpis("district", config, stats, 0.5);
  expect(district.map((k) => [k.label, k.value])).toEqual([
    ["Heat demand", 0.3],
    ["Peak demand", 300],
    ["Mean demand", 200],
  ]);
  expect(partKpis("dc", config, stats, 1)).toEqual([]); // the data center's come from the backend
});
