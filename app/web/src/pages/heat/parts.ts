/**
 * The parts on Heat Matching (data center, heat distribution with its heat exchanger, heat pump and
 * thermal storage, district heat): how each runs (its Model or the Calculation), which of the heat distribution's
 * units are switched on, and the loop temperatures. Pure: no React, no fetching.
 */
import type { DatasetConfig } from "../../dataset";
import type { Recovery } from "../../lib/matching";
import type { Approach } from "../datacenter/modelling/approaches";
import { meanOver } from "./window";

/** The twin's three parts on Heat Matching. */
export type Part = "dc" | "heat" | "district";
/** Where the data center's heat comes from, for the flow diagram: the data (its model or measurements) or the formulas. */
export type Logic = "data" | "physics";
export type Series = "actual" | "model";

/** How a part runs there: its Model (what its Structure and Modelling delivers at its connection points) or the
 * page's own Calculation (the built-in formulas). */
export type Way = "model" | "calculation";
export const WAYS: { id: Way; label: string }[] = [
  { id: "model", label: "Model" },
  { id: "calculation", label: "Calculation" },
];

/** Every part runs its Model when it can. */
export const DEFAULT_WAYS: Record<Part, Way> = { dc: "model", heat: "model", district: "model" };

/** Why a way cannot run (a short hint), or null when it can. */
export type WhyNot = Record<Way, string | null>;

/** The way that runs: the picked one unless only the other can. */
export function wayOf(w: Way, why: WhyNot): Way {
  const other: Way = w === "model" ? "calculation" : "model";
  return why[w] !== null && why[other] === null ? other : w;
}

/** Where the district's Model takes its demand from: the profile of its demand variable, or its measured column (the
 * variable left as data: not modelled, or an input from the data), by how District › Structure and Modelling makes it
 * (`approach`). Not moved yet: its measured column where the data has one, else a profile (before, a profile always: a
 * district with a measured demand of 0.17 GWh ran on a default profile of 2.4 GWh). */
export function districtSource(
  approach: Approach | undefined,
  v: string,
  columns: string[],
): { from: "profile" } | { from: "measured"; column: string } | { why: string } {
  const a = approach ?? (columns.includes(v) ? "data" : "profile");
  if (a === "profile") return { from: "profile" };
  if (columns.includes(v) && (a === "off" || a === "data")) return { from: "measured", column: v };
  // ponytail: a district model is not run here yet; simulate its scope's model (api simulateModel with scope "district") when one is trained there
  return {
    why: a === "off" ? `${v} is not modelled and has no data` : `Heat Matching runs the district's profile or its measured demand: give ${v} a profile`,
  };
}

/** The trained model: does one exist, and which columns its free run gives (predicted, drivers, calculated from them). */
export type ModelInfo = { trained: boolean; vars: Set<string> };

/** The measured district heat demand (kW): dataset.json kpi.heat_demand when the column exists, else null. */
export function demandColumn(config: DatasetConfig | null, columns: string[]): string | null {
  const c = config?.kpi?.heat_demand;
  return c && columns.includes(c) ? c : null;
}

/** Which parts of the heat distribution run; saved in site.json heat_parts (a missing key, or an old site.json: on). */
export interface PartsOn {
  hex: boolean;
  hp: boolean;
  tank: boolean;
}
export const ALL_ON: PartsOn = { hex: true, hp: true, tank: true };

export function asPartsOn(x: unknown): PartsOn {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const on = (k: keyof PartsOn) => (typeof o[k] === "boolean" ? (o[k] as boolean) : true);
  return { hex: on("hex"), hp: on("hp"), tank: on("tank") };
}

/** The matching's recovery for the switched-on parts: both = auto (direct when hot enough), one of them, or none. */
export const recoveryOf = (on: PartsOn): Recovery => (on.hex && on.hp ? "auto" : on.hex ? "direct" : on.hp ? "heatpump" : "none");

/** Assumed temperature drop (K) of the data center's heat loop when its return is not measured: a typical cooling-water ΔT. */
export const LOOP_DT = 5;

/** Supply and return temperature (°C) of a pair of lines; `approx` marks a return that is an assumption. */
export type Temps = { supply: number; ret: number; approx: boolean };

/** Window means of a loop: its supply t, and the measured return tOut or, when there is none, t − assumedDt (approx). */
export function loopTemps(p: { t: number[]; tOut?: number[] }, a: number, b: number, assumedDt = LOOP_DT): Temps {
  const supply = meanOver(p.t, a, b);
  return p.tOut ? { supply, ret: meanOver(p.tOut, a, b), approx: false } : { supply, ret: supply - assumedDt, approx: true };
}
