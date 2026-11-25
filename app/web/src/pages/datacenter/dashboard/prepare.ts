/**
 * The "Prepare variables" form as data: every operation the backend knows (backend/core/prepare.py), how many
 * variables it takes, its settings and what it does, plus a sensible default name. Pure: tested in prepare.test.ts.
 */
import type { PreparedStep } from "../../../api";

export interface ParamField {
  key: string;
  label: string;
  kind: "number" | "choice" | "text";
  options?: string[];
  initial: number | string | null;
}

export interface Operation {
  id: string;
  label: string;
  group: "Combine" | "Transform" | "Time" | "Formula";
  inputs: [number, number | null]; // least, most (null: any number)
  params: ParamField[];
  about: string;
  suffix: string; // for the default name
}

export const UNIT_CONVERSIONS = ["K -> °C", "°C -> K", "°F -> °C", "W -> kW", "kW -> W", "kW -> MW", "MW -> kW", "Wh -> kWh", "kWh -> MWh", "J -> kWh", "m³/h -> l/s", "l/s -> m³/h"];

const combine = (id: string, label: string, about: string): Operation => ({ id, label, group: "Combine", inputs: [2, null], params: [], about, suffix: id });
const single = (id: string, label: string, about: string, suffix: string, params: ParamField[] = []): Operation => ({ id, label, group: "Transform", inputs: [1, 1], params, about, suffix });
const time = (id: string, label: string, about: string, params: ParamField[] = []): Operation => ({ id, label, group: "Time", inputs: [0, 0], params, about, suffix: id });
const steps = (label = "Steps"): ParamField => ({ key: "steps", label, kind: "number", initial: 1 });

export const OPERATIONS: Operation[] = [
  combine("mean", "Average", "The mean of the chosen variables at each time step (e.g. redundant sensors)."),
  combine("sum", "Sum", "The sum of the chosen variables at each time step (e.g. the power of several racks)."),
  combine("min", "Minimum", "The smallest of the chosen variables at each time step."),
  combine("max", "Maximum", "The largest of the chosen variables at each time step."),
  combine("product", "Product", "The chosen variables multiplied (e.g. flow × temperature difference)."),
  { id: "difference", label: "Difference (A − B)", group: "Combine", inputs: [2, 2], params: [], about: "The first variable minus the second (e.g. supply − return temperature).", suffix: "minus" },
  { id: "ratio", label: "Ratio (A / B)", group: "Combine", inputs: [2, 2], params: [], about: "The first variable divided by the second (empty where B is 0).", suffix: "per" },
  single("scale", "Scale and offset", "value × factor + offset.", "scaled", [
    { key: "factor", label: "Factor", kind: "number", initial: 1 },
    { key: "offset", label: "Offset", kind: "number", initial: 0 },
  ]),
  single("unit", "Convert unit", "Another unit for the same quantity.", "conv", [{ key: "conversion", label: "Conversion", kind: "choice", options: UNIT_CONVERSIONS, initial: UNIT_CONVERSIONS[0] }]),
  single("diff", "Change per step", "The difference to the value k steps before: a meter count becomes what it measured.", "per_step", [steps()]),
  single("rolling_mean", "Rolling mean", "The mean over the last k steps: smooths noise.", "smooth", [{ key: "window", label: "Window (steps)", kind: "number", initial: 4 }]),
  single("shift", "Shift (earlier value)", "The value k steps before, as its own variable.", "before", [steps()]),
  single("clip", "Clip to a range", "Values below min become min, above max become max (empty: no limit).", "clipped", [
    { key: "min", label: "Min", kind: "number", initial: null },
    { key: "max", label: "Max", kind: "number", initial: null },
  ]),
  single("fill_gaps", "Fill gaps", "Missing values filled: linear between neighbours, the previous value, zero or the mean. Interpolation and the mean use the whole series, the test period too: a model's test score sees a little of it.", "filled", [
    { key: "method", label: "Method", kind: "choice", options: ["interpolate", "previous", "zero", "mean"], initial: "interpolate" },
  ]),
  single("log", "Logarithm", "The natural logarithm (empty where ≤ 0): for long-tailed variables.", "log"),
  single("sqrt", "Square root", "The square root (empty where < 0).", "sqrt"),
  single("abs", "Absolute value", "The value without its sign.", "abs"),
  single("standardize", "Standardise", "(value − mean) / standard deviation: comparable scales. Mean and deviation of the whole series, the test period too: a model's test score sees a little of it.", "z"),
  time("time_since_start", "Time since start", "How long since the first row, as a number (e.g. for slow drifts).", [
    { key: "unit", label: "Unit", kind: "choice", options: ["seconds", "minutes", "hours", "days"], initial: "hours" },
  ]),
  time("hour_of_day", "Hour of day", "0 to 24, with minutes as fractions: the daily rhythm."),
  time("day_of_week", "Day of week", "0 = Monday … 6 = Sunday: the weekly rhythm."),
  time("is_weekend", "Weekend", "1 on Saturday and Sunday, else 0."),
  time("month", "Month", "1 to 12: the seasons."),
  time("day_of_year", "Day of year", "1 to 366: the seasons, finer."),
  {
    id: "formula",
    label: "Formula",
    group: "Formula",
    inputs: [0, 0],
    params: [{ key: "expr", label: "Formula", kind: "text", initial: "" }],
    about: "Any formula of the variables, written as in the equations: A[t] + 0.5 * B[t-1], log(A[t]), maximum(A[t], B[t]).",
    suffix: "formula",
  },
];

export const operation = (id: string) => OPERATIONS.find((o) => o.id === id) ?? OPERATIONS[0];

/** The settings an operation starts with. */
export const initialParams = (op: string): Record<string, unknown> => Object.fromEntries(operation(op).params.map((p) => [p.key, p.initial]));

/** A name for the new variable from what it is made of, unique among `taken`. */
export function defaultName(op: string, inputs: string[], taken: string[]): string {
  const o = operation(op);
  const base = (o.group === "Time" || o.group === "Formula" ? o.suffix : `${inputs.join("_")}_${o.suffix}`).replace(/[^A-Za-z0-9_]/g, "_").slice(0, 60);
  let name = /^[A-Za-z_]/.test(base) ? base : `v_${base}`;
  for (let i = 2; taken.includes(name); i++) name = `${base}_${i}`;
  return name;
}

/** Why the step cannot be previewed yet (null: it can). */
export function notReady(step: PreparedStep): string | null {
  const o = operation(step.op);
  const [least, most] = o.inputs;
  if (step.inputs.length < least) return least === 1 ? "Choose the variable" : `Choose at least ${least} variables`;
  if (most !== null && step.inputs.length > most) return most === 0 ? "This one uses no variables" : `Choose ${most} variable${most === 1 ? "" : "s"}`;
  if (o.id === "formula" && !String(step.params.expr ?? "").trim()) return "Write the formula";
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(step.name)) return "Give it a name: letters, digits and _, starting with a letter";
  return null;
}

/** The step as the backend wants it: only the operation's own settings, empty numbers left out. */
export function cleanStep(step: PreparedStep): PreparedStep {
  const o = operation(step.op);
  const params = Object.fromEntries(
    o.params.flatMap((p) => {
      const v = step.params[p.key];
      if (v === null || v === undefined || v === "") return [];
      return [[p.key, p.kind === "number" ? Number(v) : v]];
    }),
  );
  return { name: step.name.trim(), op: o.id, inputs: o.inputs[1] === 0 ? [] : step.inputs, params };
}
