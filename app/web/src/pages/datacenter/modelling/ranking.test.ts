/** Best model per structure and overall: free run first, then one step, then nothing. */
import { expect, test } from "vitest";
import type { EvaluateResponse, TrainedModel } from "../../../api";
import { STRUCTURES } from "../../../lib/modelCatalog";
import { bestOf, candidatesOf, meanNmae, rankVariables } from "./ranking";

const def = (name: string) => STRUCTURES.find((s) => s.name === name)!;
const model = (vars: Record<string, number | null>): TrainedModel =>
  ({
    variables: Object.fromEntries(Object.entries(vars).map(([v, n]) => [v, { nmae_test: n, inputs: [] }])),
  }) as unknown as TrainedModel;
const scores = (free: Record<string, number | null>, one: Record<string, number | null> = {}) => ({ free_nmae: free, nmae_test: one, free_r2: {}, r2_test: {}, structure: "", kind: "" });

const models = { linear: model({ y: 0.3, z: 0.2 }), xgb: model({ y: 0.4 }), linear_all: model({ y: 0.5 }) };
const shown = ["linear", "xgb", "linear_all"].map(def);
const evalRes = {
  models: { linear: scores({ y: 0.2 }), xgb: scores({ y: 0.1 }), linear_all: scores({ y: 0.05 }) },
  events: [{ nmae: { xgb: { y: 0.3 } } }, { nmae: { xgb: { y: 0.1 } } }, { nmae: {} }],
} as unknown as EvaluateResponse;

test("bestOf picks the lowest free run of that structure", () => {
  const b = bestOf(shown, models, evalRes, "graph", "y")!;
  expect(b.def.name).toBe("xgb");
  expect(b.free).toBe(0.1);
  expect(b.after).toBeCloseTo(0.2);
});

test("bestOf carries the free run's MAE, WAPE, R² and MASE, null when the server has none", () => {
  const withFit = {
    ...evalRes,
    models: { ...evalRes.models, xgb: { ...scores({ y: 0.1 }), free_mae: { y: 1.5 }, free_wape: { y: 0.08 }, free_r2: { y: 0.9 }, free_mase: { y: 0.6 } } },
  } as EvaluateResponse;
  const b = bestOf(shown, models, withFit, "graph", "y")!;
  expect([b.mae, b.wape, b.r2, b.mase]).toEqual([1.5, 0.08, 0.9, 0.6]);
  const old = bestOf(shown, models, evalRes, "graph", "y")!; // an older server: no free_mae / free_wape / free_mase
  expect([old.mae, old.wape, old.r2, old.mase]).toEqual([null, null, null, null]);
  expect(bestOf(shown, models, null, "graph", "y")!.r2).toBeNull();
});

test("bestOf falls back to the one-step score, then to Infinity, and skips models without the variable", () => {
  expect(bestOf(shown, models, null, "graph", "y")!.def.name).toBe("linear"); // one step 0.3 < 0.4
  expect(bestOf(shown, models, null, "graph", "z")!.one).toBe(0.2);
  expect(bestOf(shown, { linear: model({ y: null }) }, null, "graph", "y")!.def.name).toBe("linear");
  expect(bestOf(shown, models, evalRes, "all", "z")).toBeNull();
});

test("candidatesOf lists every model of the variable, both structures, the best first", () => {
  expect(candidatesOf(shown, models, evalRes, "y").map((c) => [c.def.name, c.free])).toEqual([
    ["linear_all", 0.05],
    ["xgb", 0.1],
    ["linear", 0.2],
  ]);
  expect(candidatesOf(shown, models, null, "y").map((c) => c.def.name)).toEqual(["linear", "xgb", "linear_all"]); // one step
  expect(candidatesOf(shown, models, evalRes, "z").map((c) => c.def.name)).toEqual(["linear"]);
  expect(candidatesOf(shown, models, evalRes, "nope")).toEqual([]);
});

test("rankVariables compares the structures' bests", () => {
  const r = rankVariables(shown, models, evalRes, ["y", "z"]);
  expect(r.y.best.graph!.def.name).toBe("xgb");
  expect(r.y.best.all!.def.name).toBe("linear_all");
  expect(r.y.winner!.def.name).toBe("linear_all");
  expect(r.z.best.all).toBeNull();
  expect(r.z.winner!.def.name).toBe("linear");
});

test("meanNmae averages only the events that scored the model", () => {
  expect(meanNmae(evalRes.events, "xgb", "y")).toBeCloseTo(0.2);
  expect(meanNmae(evalRes.events, "linear", "y")).toBeNull();
});

test("a model whose free run failed ranks after those with a free run, its one-step error not against their free runs", () => {
  const failed = { ...evalRes, models: { ...evalRes.models, linear: scores({ y: null }, { y: 0.01 }) } } as unknown as EvaluateResponse;
  expect(candidatesOf(shown, models, failed, "y").map((c) => c.def.name)).toEqual(["linear_all", "xgb", "linear"]);
  expect(bestOf(shown, models, failed, "graph", "y")!.def.name).toBe("xgb");
});
