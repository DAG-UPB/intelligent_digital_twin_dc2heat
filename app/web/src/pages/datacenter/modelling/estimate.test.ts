/** The estimate under Train: summed definitions, the slowest first, failures named, times in words. */
import { expect, test } from "vitest";
import type { TrainEstimate } from "../../../api";
import type { ModelDef } from "../../../lib/modelCatalog";
import { duration, estimateText, sumEstimates } from "./estimate";

const def = (label: string) => ({ label }) as unknown as ModelDef;
const est = (models: number, seconds: number) => ({ models, seconds, low: seconds / 2, high: seconds * 2 }) as TrainEstimate;

test("definitions add up, the slowest first, and failures are named", () => {
  const e = sumEstimates([
    { def: def("Linear"), e: est(10, 0.01), error: null },
    { def: def("TabPFN"), e: est(10, 120), error: null },
    { def: def("TabPFN all"), e: null, error: "too many inputs" },
  ]);
  expect(e.models).toBe(20);
  expect(e.seconds).toBeCloseTo(120.01);
  expect(e.parts.map((p) => p.label)).toEqual(["TabPFN", "Linear"]);
  expect(e.problems).toEqual(["TabPFN all: too many inputs"]);
  expect(estimateText(e)).toBe("20 variable models · about 2 min (1 min – 4 min)");
});

test("durations in words", () => {
  expect(duration(0.2)).toBe("under a second");
  expect(duration(42)).toBe("42 s");
  expect(duration(600)).toBe("10 min");
  expect(duration(9000)).toBe("2,5 h");
});
