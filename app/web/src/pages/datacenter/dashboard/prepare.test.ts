/** The Prepare-variables form: the default names, readiness, and what is sent to the backend. */
import { expect, test } from "vitest";
import { cleanStep, defaultName, initialParams, notReady, OPERATIONS } from "./prepare";

test("every operation has a label, an explanation and starting settings", () => {
  for (const o of OPERATIONS) {
    expect(o.label && o.about).toBeTruthy();
    expect(Object.keys(initialParams(o.id))).toEqual(o.params.map((p) => p.key));
  }
});

test("fill gaps and standardise say that they use the whole series, the test period too (audit B-W11)", () => {
  for (const id of ["fill_gaps", "standardize"]) expect(OPERATIONS.find((o) => o.id === id)?.about).toContain("whole series");
});

test("default names come from the inputs and avoid names in use", () => {
  expect(defaultName("mean", ["T1", "T2"], [])).toBe("T1_T2_mean");
  expect(defaultName("diff", ["Meter"], ["Meter_per_step"])).toBe("Meter_per_step_2");
  expect(defaultName("time_since_start", [], [])).toBe("time_since_start");
  expect(defaultName("unit", ["1st.T"], [])).toBe("v_1st_T_conv");
});

test("a step is ready once it has the right number of inputs, a formula and a valid name", () => {
  expect(notReady({ name: "a", op: "mean", inputs: ["x"], params: {} })).toContain("at least 2");
  expect(notReady({ name: "a", op: "difference", inputs: ["x", "y", "z"], params: {} })).toContain("Choose 2");
  expect(notReady({ name: "a", op: "formula", inputs: [], params: { expr: " " } })).toContain("formula");
  expect(notReady({ name: "2a", op: "log", inputs: ["x"], params: {} })).toContain("name");
  expect(notReady({ name: "x_log", op: "log", inputs: ["x"], params: {} })).toBeNull();
});

test("only the operation's own settings are sent, numbers as numbers, empty ones left out", () => {
  expect(cleanStep({ name: " c ", op: "clip", inputs: ["x"], params: { min: "0", max: "", window: 5 } })).toEqual({ name: "c", op: "clip", inputs: ["x"], params: { min: 0 } });
  expect(cleanStep({ name: "h", op: "hour_of_day", inputs: ["x"], params: {} })).toEqual({ name: "h", op: "hour_of_day", inputs: [], params: {} });
});
