/** What-if logic: re-train request from the saved model, revealed overlays, and their alignment on the time axis. */
import { expect, test } from "vitest";
import type { SimulateResponse, TrainedModel } from "../../../../api";
import { alignPrediction, overlaysOf, retrainRequest, splitOf, whatIfResultOf } from "./whatIf";

const saved = {
  name: "linear",
  file: "df_a",
  graph_file: "causal_graph_pcmci.json",
  drivers: ["Cool_Set"],
  requested_drivers: ["Cool_Set", "Out_Temp"],
  structure: "graph",
  max_lag_setting: 12,
  variables_used: ["Cool_Set", "Out_Temp", "In_Temp"],
  kind: "linear",
  order: ["In_Temp"],
  split_index: 13977,
  rows: 17472,
} as unknown as TrainedModel;

test("re-prepare re-sends the saved training settings with the new split", () => {
  expect(retrainRequest(saved, "df_other", 0.6)).toEqual({
    name: "linear",
    file: "df_a",
    split_fraction: 0.6,
    graph_file: "causal_graph_pcmci.json",
    drivers: ["Cool_Set", "Out_Temp"],
    structure: "graph",
    max_lag: 12,
    variables: ["Cool_Set", "Out_Temp", "In_Temp"],
    model: "linear",
  });
});

test("without a saved model only the name, the file and the split are sent", () => {
  expect(JSON.parse(JSON.stringify(retrainRequest(null, "df_b", 0.5)))).toEqual({ name: "linear", file: "df_b", split_fraction: 0.5 });
});

test("the split shown is the saved one, which re-trains to the same split index", () => {
  expect(splitOf(saved)).toBe(0.8);
  expect(Math.floor(saved.rows * splitOf(saved))).toBe(saved.split_index);
  expect(splitOf(null)).toBe(0.5);
});

const res = {
  time: ["2023-01-01T00:00:00", "2023-01-01T01:00:00", "2023-01-01T02:00:00"],
  steps: 3,
  scenario: { In_Temp: [20, 21, 22], Cool_Set: [18, 18, 18], Out_Temp: [5, 5, 5] },
} as unknown as SimulateResponse;

test("overlays show the first k steps of the predictions and of intervened model drivers only", () => {
  const r = whatIfResultOf(res, saved, ["Cool_Set", "Hour"]);
  expect(Object.keys(r.future_known)).toEqual(["Cool_Set"]);
  const o = overlaysOf(r, 2);
  expect(Object.keys(o).sort()).toEqual(["Cool_Set", "In_Temp"]);
  expect(o.In_Temp.values).toEqual([20, 21]);
  expect(o.In_Temp.timestamps).toEqual(res.time.slice(0, 2).map((t) => new Date(t).getTime() / 1000));
});

test("a prediction lands on matching timestamps with gaps elsewhere", () => {
  expect(alignPrediction([10, 20, 30, 40], { timestamps: [20, 30], values: [1.5, 2.5] })).toEqual([null, 1.5, 2.5, null]);
});
