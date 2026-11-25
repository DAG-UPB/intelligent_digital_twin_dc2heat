/** The causal mini map's graph logic: parents from a trained model or a graph file, what lies downstream, and a circular layout. */
import type { CausalParent, TrainedModel } from "../../../api";

/** What the mini map draws: the nodes, and each node's parents (own past left out). */
export interface MapGraph {
  nodes: string[];
  parents: Record<string, string[]>;
}

/** Parents of each predicted variable from the trained model's inputs (self-lags dropped). */
export function parentsOf(model: TrainedModel): Record<string, string[]> {
  return Object.fromEntries(Object.entries(model.variables).map(([v, fit]) => [v, [...new Set(fit.inputs.map((i) => i.parent))].filter((p) => p !== v)]));
}

/** A trained model's graph: drivers and predicted variables, minus the `hidden` ones. */
export const modelMap = (model: TrainedModel, hidden: Set<string> = new Set()): MapGraph => ({
  nodes: [...new Set([...model.drivers, ...model.order])].filter((v) => !hidden.has(v)),
  parents: parentsOf(model),
});

/** A graph file's map: its targets and parents (lags ignored, own past left out), minus the `hidden` ones. */
export function fileMap(targets: Record<string, CausalParent[]>, hidden: Set<string> = new Set()): MapGraph {
  const parents = Object.fromEntries(Object.entries(targets).map(([v, ps]) => [v, [...new Set(ps.map((p) => p.parent))].filter((p) => p !== v)]));
  const nodes = [...new Set([...Object.keys(parents), ...Object.values(parents).flat()])].filter((v) => !hidden.has(v));
  return { nodes, parents };
}

/** Everything reachable from `v` following parent -> child edges (cycles terminate). */
export function downstreamOf(parents: Record<string, string[]>, v: string): Set<string> {
  const out = new Set<string>();
  const queue = [v];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const [child, ps] of Object.entries(parents))
      if (ps.includes(cur) && !out.has(child) && child !== v) {
        out.add(child);
        queue.push(child);
      }
  }
  return out;
}

/**
 * Nodes on an ellipse in a w x h box, the first one at the top, going clockwise. `side` is the room kept left and
 * right for the names (written beside the nodes); 20 px stay free above and below.
 */
export function circleLayout(nodes: string[], w: number, h: number, side = 30): Record<string, { x: number; y: number }> {
  const [rx, ry] = [w / 2 - side, h / 2 - 20];
  return Object.fromEntries(
    nodes.map((v, i) => {
      const a = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      return [v, { x: w / 2 + rx * Math.cos(a), y: h / 2 + ry * Math.sin(a) }];
    }),
  );
}
