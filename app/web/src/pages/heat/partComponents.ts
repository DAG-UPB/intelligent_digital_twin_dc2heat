/**
 * Components in Heat distribution: a part's built-in formula (lib/matching.ts) can be replaced by a component of the
 * part's kind (Heat Distribution › Components). The page runs the component over the evaluated period with the
 * inputs below and hands its outputs to the matching per step. Pure: no React, no fetching.
 *
 *   heat pump        T_source = source temperature, T_supply = network supply  ->  COP, Q_max (kW)
 *   heat exchanger   T_hot_in = source temperature, Q_hot = source heat (kW), T_cold_in = network return  ->  Q (kW), T_cold_out (°C)
 *   storage          T_supply, T_return of the network  ->  E_max (kWh), loss_pct (%/h)
 * An input the component does not have is not sent; inputs it has beyond these take their defaults.
 */
import type { Component, ComponentKind } from "../../api";
import type { PartSeries } from "../../lib/matching";

export type Plant = "hex" | "hp" | "tank";
export const PLANTS: Plant[] = ["hex", "hp", "tank"];

export const CONTRACT: Record<Plant, { kind: ComponentKind; outputs: [string, string]; reads: string }> = {
  hp: { kind: "heat_pump", outputs: ["COP", "Q_max"], reads: "COP and capacity" },
  hex: { kind: "heat_exchanger", outputs: ["Q", "T_cold_out"], reads: "heat passed and outlet temperature" },
  tank: { kind: "storage", outputs: ["E_max", "loss_pct"], reads: "capacity and standing loss" },
};

/** The components part `p` can use: of its kind, with the two nodes it reads. */
export const usableFor = (p: Plant, list: Component[]) =>
  list.filter((c) => c.kind === CONTRACT[p].kind && CONTRACT[p].outputs.every((o) => c.nodes.some((n) => n.name === o)));

/** The component replacing each part's formula: the picked one, while the part runs `fromPhysics` and the component is still usable. */
export function activeComponents(picked: PartComponents, list: Component[], fromPhysics: Plant[]): Partial<Record<Plant, Component>> {
  const out: Partial<Record<Plant, Component>> = {};
  for (const p of fromPhysics) {
    const c = usableFor(p, list).find((x) => x.id === picked[p]);
    if (c) out[p] = c;
  }
  return out;
}

/** The period as the parts see it: source temperature and heat per step, network supply and return. */
export interface PartContext {
  tSource: number[];
  qSource: number[];
  supply: number | number[]; // °C, fixed or per step (a heating curve)
  ret: number;
}

/** The inputs part `p` gives component `c` (only those it has). */
export function partInputs(p: Plant, c: Component, x: PartContext): Record<string, number | number[]> {
  const all: Record<string, number | number[]> =
    p === "hp" ? { T_source: x.tSource, T_supply: x.supply } : p === "hex" ? { T_hot_in: x.tSource, Q_hot: x.qSource, T_cold_in: x.ret } : { T_supply: x.supply, T_return: x.ret };
  return Object.fromEntries(Object.entries(all).filter(([k]) => c.inputs.some((i) => i.name === k)));
}

/** The matching's per-step series from a run of part `p`'s component. */
export function toPartSeries(p: Plant, run: Record<string, number[]>): PartSeries {
  const [a, b] = CONTRACT[p].outputs.map((o) => run[o]);
  return p === "hp" ? { hpCop: a, hpCap: b } : p === "hex" ? { hexQ: a, hexTOut: b } : { tankKwh: a, tankLossPct: b };
}

/** Which component replaces which part's formula; saved in site.json heat_components (missing or old: none). */
export type PartComponents = Partial<Record<Plant, string>>;

export function asPartComponents(x: unknown): PartComponents {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  return Object.fromEntries(PLANTS.filter((k) => typeof o[k] === "string" && o[k]).map((k) => [k, o[k] as string]));
}
