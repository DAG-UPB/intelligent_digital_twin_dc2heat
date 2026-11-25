/** The mini map's graph logic: parents from a trained model, everything downstream of a variable, the layout. */
import { expect, test } from "vitest";
import type { TrainedModel } from "../../../api";
import { circleLayout, downstreamOf, fileMap, modelMap, parentsOf } from "./causalGraph";

const fit = (parents: string[]) => ({ inputs: parents.map((parent) => ({ parent, lag: -1, coef: 1 })) });
const model = {
  variables: { In_Temp: fit(["In_Temp", "Cool_Set"]), ITE_Ener: fit(["IT_Load", "In_Temp"]), HEX_Hall_Q: fit(["ITE_Ener"]) },
} as unknown as TrainedModel;
const parents = parentsOf(model);

test("self-lags are not parents", () => {
  expect(parents.In_Temp).toEqual(["Cool_Set"]);
});

test("downstream is transitive, also from a driver (which has no parents entry)", () => {
  expect([...downstreamOf(parents, "Cool_Set")].sort()).toEqual(["HEX_Hall_Q", "ITE_Ener", "In_Temp"]);
});

test("downstream follows the link direction", () => {
  const d = downstreamOf(parents, "IT_Load");
  expect(d.has("HEX_Hall_Q")).toBe(true);
  expect(d.has("In_Temp")).toBe(false);
});

test("a leaf has nothing downstream", () => {
  expect(downstreamOf(parents, "HEX_Hall_Q").size).toBe(0);
});

test("a cycle terminates and leaves out the start", () => {
  expect([...downstreamOf({ A: ["B"], B: ["A"] }, "A")]).toEqual(["B"]);
});

test("the first node is at the top centre", () => {
  const pos = circleLayout(["a", "b", "c", "d"], 260, 200);
  expect(pos.a.x).toBeCloseTo(130);
  expect(pos.a.y).toBeCloseTo(20);
  expect(pos.b.x).toBeGreaterThan(130); // clockwise: the second one is on the right
  expect(circleLayout(["a", "b", "c", "d"], 260, 200, 90).b.x).toBeCloseTo(170); // room for the names beside
});

test("a graph file's map: parents without own past or lags, parent-only and link-less nodes kept, hidden ones dropped", () => {
  const targets = {
    A: [
      { parent: "A", lag: -1 },
      { parent: "B", lag: -1 },
      { parent: "B", lag: -2 },
    ],
    Lonely: [],
    Q: [{ parent: "A", lag: 0 }],
  };
  const m = fileMap(targets, new Set(["Q"]));
  expect(m.parents.A).toEqual(["B"]);
  expect(m.nodes.sort()).toEqual(["A", "B", "Lonely"]);
});

test("a model's map: drivers and predicted variables, minus the hidden ones", () => {
  const m = modelMap({ ...model, drivers: ["Cool_Set", "IT_Load"], order: ["In_Temp", "ITE_Ener", "HEX_Hall_Q"] } as TrainedModel, new Set(["HEX_Hall_Q"]));
  expect(m.nodes).toEqual(["Cool_Set", "IT_Load", "In_Temp", "ITE_Ener"]);
});
