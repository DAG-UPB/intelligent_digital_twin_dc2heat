/** Text of the AI modelling page: percentages, colours, lags, coefficient names, structural equations. */
import { expect, test } from "vitest";
import type { TrainedModel, VariableFit } from "../../../api";
import { equation, lagRange, learnedText, nextCoef, nmaeColor, pct, withParams } from "./format";

const fit = (over: Partial<VariableFit>): VariableFit => ({ intercept: 1, inputs: [], sigma: 0, r2_train: null, r2_test: null, min: 0, max: 1, mean: 0, ...over });
const model = (kind: TrainedModel["kind"], v: VariableFit): TrainedModel =>
  ({ name: "m", file: "", graph_file: "", order: ["y"], drivers: [], kind, variables: { y: v }, max_lag: 1, split_index: 0, split_time: null, rows: 0 }) as TrainedModel;

test("pct and nmaeColor", () => {
  expect(pct(null)).toBe("–");
  expect(pct(undefined)).toBe("–");
  expect(pct(0.1234)).toBe("12,3%"); // the locale's comma, as fmt beside it
  expect(pct(12.3456)).toBe("1.234,6%");
  expect(pct(-0.00001)).toBe("0,0%");
  expect(nmaeColor(0.05)).toBe("var(--ok)");
  expect(nmaeColor(0.15)).toBe("var(--warn)");
  expect(nmaeColor(0.151)).toBe("var(--danger)");
  expect(nmaeColor(null)).toBe("var(--foreground-tertiary)");
});

test("lagRange compresses runs of three or more", () => {
  expect(lagRange([1, 2, 3, 5])).toBe("t−1…3, t−5");
  expect(lagRange([0, 1])).toBe("t, t−1");
  expect(lagRange([2, -1, 1])).toBe("t−1, t−2");
});

test("nextCoef finds the first free cN", () => {
  expect(nextCoef("")).toBe("c1");
  expect(nextCoef("c1*x + c2")).toBe("c3");
  expect(nextCoef("c10 + c2")).toBe("c1");
});

test("withParams fills coefficients but never touches data references", () => {
  expect(withParams("a*In_Temp[t-1] + b", { a: 0.5, b: -2 })).toBe("0.500*In_Temp[t-1] + -2.00");
  // a coefficient named like a column, or "t", stays inside the index
  expect(withParams("t*In_Temp[t-1] + In_Temp", { t: 2, In_Temp: 3 })).toBe("2.00*In_Temp[t-1] + 3.00");
  expect(withParams("exp(k)*x1[t]", { k: 1 })).toBe("exp(1.00)*x1[t]");
});

test("equation: linear ranks by effect size and caps the terms", () => {
  const inputs = [
    { parent: "a", lag: 1, coef: 0.1, std: 1 },
    { parent: "b", lag: 2, coef: -1, std: 1 },
    { parent: "c", lag: 0, coef: 0.01, std: 1000 },
  ];
  expect(equation("y", model("linear", fit({ inputs })), 2)).toBe("y(t) = 1.00 + 0.0100·c(t) − 1.00·b(t−2) + … (1 more terms)");
  expect(equation("y", model(undefined, fit({ inputs })))).toBe("y(t) = 1.00 + 0.0100·c(t) − 1.00·b(t−2) + 0.100·a(t−1)");
});

test("equation: black boxes list their inputs, physics fills its parameters", () => {
  const inputs = [1, 2, 3].map((lag) => ({ parent: "P", lag, coef: 0 }));
  expect(equation("y", model("xgboost", fit({ inputs })))).toBe("y(t) = f( P(t−1…3) )");
  expect(equation("y", model("tabpfn", fit({ inputs: [{ parent: "P", lag: 1, coef: 0 }] })))).toBe("y(t) = f( P(t−1) )");
  expect(equation("y", model("physics", fit({ equation: "k*P[t-1]", params: { k: 0.12345 } })))).toBe("y(t) = 0.123*P[t-1]");
  expect(learnedText({ k: 0.12345, b: 2 })).toBe("k = 0.123 · b = 2.00");
});
