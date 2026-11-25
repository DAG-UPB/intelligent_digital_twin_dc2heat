/**
 * The models the app trains: model kinds x structures, each saved under a fixed name.
 * The names are a persisted contract (files in models/ on disk, simulate URLs): never rename them.
 */
import type { ModelKind } from "../api";

/** The causal-graph linear model; Scenarios and Heat distribution use this one. */
export const MODEL_NAME = "linear";
/** The comparison model without a graph: every variable at lags 1..max lag. */
export const MODEL_ALL = "linear_all";

export type Kind = ModelKind;
export type Structure = "graph" | "all";

export const KINDS: { id: Kind; label: string; short: string }[] = [
  { id: "linear", label: "Linear regression", short: "LR" },
  { id: "xgboost", label: "XGBoost", short: "XGB" },
  { id: "physics", label: "Physics (your equations)", short: "PHY" },
  { id: "symbolic", label: "Symbolic regression", short: "SR" },
  { id: "tabpfn", label: "TabPFN", short: "TPF" },
];

export const STRUCTS: { id: Structure; label: string }[] = [
  { id: "graph", label: "Causal graph" },
  { id: "all", label: "All vs all" },
];

export interface ModelDef {
  name: string;
  kind: Kind;
  structure: Structure;
  label: string;
  color: string; // chart line (canvas: no CSS vars)
}

/** Every model type x structure; each is saved under its own name. */
export const STRUCTURES: ModelDef[] = [
  { name: MODEL_NAME, kind: "linear", structure: "graph", label: "LR · Causal graph", color: "#3b82f6" },
  { name: MODEL_ALL, kind: "linear", structure: "all", label: "LR · All vs all", color: "#ea580c" },
  { name: "xgb", kind: "xgboost", structure: "graph", label: "XGB · Causal graph", color: "#16a34a" },
  { name: "xgb_all", kind: "xgboost", structure: "all", label: "XGB · All vs all", color: "#a855f7" },
  // physics: your equations where given, linear on the graph elsewhere (no all-vs-all version)
  { name: "phys", kind: "physics", structure: "graph", label: "Physics · Causal graph", color: "#14b8a6" },
  // symbolic regression (gplearn): a formula evolved from each variable's graph parents
  { name: "sym", kind: "symbolic", structure: "graph", label: "Symbolic · Causal graph", color: "#db2777" },
  // TabPFN: pretrained transformer, predicts from a sample of the training rows (in-context learning)
  { name: "tabpfn", kind: "tabpfn", structure: "graph", label: "TabPFN · Causal graph", color: "#ca8a04" },
  // no all-vs-all version: its memory grows with the number of inputs (80 inputs need > 2 GB)
];

const tag = (text: string, color: string) => ({
  text,
  bg: `color-mix(in srgb, ${color} 18%, transparent)`,
  fg: `color-mix(in srgb, ${color} 75%, var(--foreground))`,
});
/** Badge of each model kind (text and colours). */
export const TAG: Record<Kind, { text: string; bg: string; fg: string }> = {
  linear: tag("LR", "#3b82f6"),
  xgboost: tag("XGB", "#a855f7"),
  physics: tag("PHY", "#14b8a6"),
  symbolic: tag("SR", "#db2777"),
  tabpfn: tag("TPF", "#ca8a04"),
};
