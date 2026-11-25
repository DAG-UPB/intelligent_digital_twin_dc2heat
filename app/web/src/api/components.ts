/** Components (backend routers/components.py): presets and saved components, and running one. */
import { getJson, postJson } from "./http";

export type ComponentKind = "heat_exchanger" | "heat_pump" | "storage" | "data_center" | "custom";

export interface ComponentInput {
  name: string;
  unit: string;
  default: number;
}
export interface ComponentNode {
  name: string;
  unit: string;
  equation: string;
  init: number; // value before the first step, read by [t-k] references to this node
}
export interface ComponentParam {
  name: string;
  value: number;
  fixed: boolean; // false: learned by Fit
  unit: string;
  note: string;
}
export interface Component {
  id: string;
  name: string;
  kind: ComponentKind;
  inputs: ComponentInput[];
  nodes: ComponentNode[];
  outputs: string[];
  params: ComponentParam[];
  notes: string;
  source: string;
  preset: boolean;
}

const BASE = "/api/components";

export const listComponents = async () => (await getJson<{ components: Component[] }>(BASE, "Failed to load the components")).components;

/** Run `c` over `inputs` (a number is held, a series sets the length; missing: the default); only `outputs` if given. */
export const simulateComponent = async (c: Component, inputs: Record<string, number | number[]>, steps?: number, outputs?: string[]) =>
  (await postJson<{ series: Record<string, number[]> }>(`${BASE}/simulate`, { component: c, inputs, steps, outputs }, "Running the component failed")).series;
