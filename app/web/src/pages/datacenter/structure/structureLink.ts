/**
 * What a structure (PidPage) shares with the page that models it, under it (TrainPage): whose files, the graph file
 * picked above and the graph as drawn there, unsaved edits included, so both show and change the same graph.
 */
import type { CausalParent, StructureScope } from "../../../api";
import type { LibraryEquation } from "../../../lib/physicsLibrary";
import type { Approach } from "../modelling/approaches";

export interface StructureLink {
  scope: StructureScope;
  files: string[]; // the structure's graph files
  file: string | null; // the one picked above
  onFile: (file: string) => void;
  targets: Record<string, CausalParent[]>; // the graph as drawn (variable -> its parents, negative lags)
  saved: number; // bumps on every save: what the server reads (drivers, training) changed
  dirty: boolean; // unsaved edits above: training reads the saved graph, so it waits for Save
  onAddVariable: (v: string) => void; // added to the drawing (unsaved, like any edit there)
  library?: LibraryEquation[]; // the standard equations of this system (default: the data center's)
  onSelect?: (v: string) => void; // a variable picked below (its graph): selected on the drawing too
  selected?: string | null; // the variable selected on the drawing: picked below too (its results)
  onApproach?: (approach: Record<string, Approach | null>) => void; // how each variable is made below (its column; null: calculated): coloured and filtered by it above
}
