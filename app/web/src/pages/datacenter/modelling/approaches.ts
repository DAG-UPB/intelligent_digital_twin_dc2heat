/**
 * How each variable is made (Modelling): learned from the data on the causal graph (data-driven, the SCM), by an
 * equation (physical: fixed numbers only; semi-physical: coefficients learned from the data), or by a profile. Each
 * variable has one approach; the user moves it between them. An input (no causes in the graph: weather, actuators)
 * is taken from the data or given a profile; a variable without data cannot be learned; a calculated column
 * (Q = ṁ·cₚ·ΔT) is computed, never made, so it has none. Any other variable may also be left out: not modelled. Pure: the choice is kept by the page.
 */
export type Approach = "data" | "physics" | "profile" | "off";

/** In the order shown: not modelled first, on the left. */
export const APPROACHES: { id: Approach; label: string; short: string }[] = [
  { id: "off", label: "Not modelled", short: "Not modelled" },
  { id: "data", label: "Data-driven", short: "Data-driven" },
  { id: "physics", label: "Physical and semi-physical", short: "Physical" },
  { id: "profile", label: "Measurement or profile", short: "Profile" }, // a measured input, or a curve made for it
];

export interface VariableKind {
  calculated: boolean;
  noData: boolean;
  input: boolean;
}

/** The approaches a variable may have, its default first. */
export const choicesOf = (k: VariableKind): Approach[] =>
  k.calculated ? [] : k.noData ? ["profile", "physics", "off"] : k.input ? ["data", "profile", "off"] : ["data", "physics", "profile", "off"];

/** Why a variable cannot go to a column (null: it can). The Data-driven column is "data"; an input's "data" choice
 * is "from the data", which it may always have. */
export function whyNot(k: VariableKind, column: Approach): string | null {
  if (k.calculated) return "calculated from other variables, never modelled";
  if (column === "data" && k.noData) return "no data to learn it from";
  if ((column === "data" || column === "physics") && k.input) return "an input: the graph gives it no causes; link one to it in the graph above";
  return null;
}

/** Where a structure's variables start: the data center's learned from its data, the heat distribution's by its
 * physics; the district's are not modelled, but its heat demand, a profile (startOf). */
export const STARTS: Record<"dc" | "heat" | "district", Approach> = { dc: "data", heat: "physics", district: "off" };

/** Where one variable starts: the structure's start, the district's heat demand (`demand`) a profile. */
export const startOf = (scope: keyof typeof STARTS, v: string, demand?: string): Approach => (scope === "district" && v === demand ? "profile" : STARTS[scope]);

/** A variable's approach: the one chosen, if it may have it; else the structure's start, if it may; else its default
 * (an input stays from the data, a variable without data a profile). */
export function approachOf(k: VariableKind, chosen: Approach | undefined, start: Approach): Approach | null {
  const ch = choicesOf(k);
  if (chosen && ch.includes(chosen)) return chosen;
  if (!k.input && ch.includes(start)) return start;
  return ch[0] ?? null;
}

/** What a variable's approach depends on besides its choice: the data's columns, the model columns among them (all but
 * the calculated ones), the inputs the graph implies, the data columns the training uses (Modelling's Use), the choices
 * (readChosen) and the structure. */
export interface ApproachData {
  columns: string[];
  modelled: string[];
  inputs: string[];
  used: string[];
  chosen: Record<string, Approach>;
  scope: keyof typeof STARTS;
  demand?: string; // the district's heat demand (startOf)
}

/** What a variable is, for its choices. */
export const kindIn = (d: ApproachData, v: string): VariableKind => ({
  calculated: d.columns.includes(v) && !d.modelled.includes(v),
  noData: !d.columns.includes(v),
  input: d.inputs.includes(v),
});

/** Each variable's approach as Modelling has it: a data column left out of the training not modelled, any other by its
 * choice (approachOf); null: calculated. Shared by Modelling and the structure above it, so both say the same. */
export const approachesOf = (d: ApproachData, vars: string[]): Record<string, Approach | null> =>
  Object.fromEntries(
    vars.map((v) => [v, d.modelled.includes(v) && !d.used.includes(v) ? "off" : approachOf(kindIn(d, v), d.chosen[v], startOf(d.scope, v, d.demand))]),
  );

/** The Modelling column a variable is shown in: an input taken from the data, and a calculated one, under Not modelled. */
export const columnOf = (a: Approach | null, input: boolean): Approach => (a === null || (a === "data" && input) ? "off" : a);

/** Each variable as Modelling shows it, its column (columnOf), a calculated one null: what the structure above colours
 * its variables and links by and filters its Variables menu by. */
export function shownApproaches(d: ApproachData, vars: string[]): Record<string, Approach | null> {
  const a = approachesOf(d, vars);
  return Object.fromEntries(vars.map((v) => [v, a[v] === null ? null : columnOf(a[v], d.inputs.includes(v))]));
}

/** Where this browser keeps the approach each variable was moved to, per data center and structure. */
export const chosenKeyOf = (dataset: string, scope: keyof typeof STARTS) => `approach:${dataset}:${scope}`;

/** The approaches chosen (storage off or an old entry: none, the defaults). */
export const readChosen = (key: string): Record<string, Approach> => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};
