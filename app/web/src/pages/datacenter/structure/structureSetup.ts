/** What another structure drawn with PidPage brings (the heat distribution's, the district's): a type only, so the
 * setups and the pages that pass one on need not import the page. */
import type { ReactNode } from "react";
import type { StructureScope } from "../../../api";
import type { LibraryEquation } from "../../../lib/physicsLibrary";
import type { PointVars } from "../../../lib/ports";
import type { Side } from "./connection";
import type { Taps } from "./geometry";
import type { Pos } from "./layout";
import type { Link } from "./links";
import type { Notes } from "./notes";

/** Another structure drawn with this page (the heat distribution's, pages/heat/structure): whose files (api
 * StructureScope), the title and intro, its built-in drawing with the default spots and taps, and the variables and
 * causal links it starts with. Everything else is the same module: links, lags and TempCaFe on the data center's data, views, the
 * construct, groups, names, the assistant's commands. Without a setup the page is the data center's own: its data
 * columns are always drawn, on its cooling loop with the heat-recovery choice. The browser keeps each structure's
 * view, draft and log apart. */
export interface StructureSetup {
  scope: StructureScope;
  title: string;
  intro: string;
  drawing: (opacity: number, framed?: boolean) => ReactNode; // framed: inside the part's box, its neighbours on the margins
  defaults: Pos;
  taps: Taps;
  starter: string[];
  starterLinks: Link[]; // the causal links it starts with, between its starting variables
  starterNotes: Notes; // what its starting variables are (kind, note), until it has notes of its own
  ports: string[]; // its connection points' variables and the weather (pages/heat/ports.ts): always drawn, whatever its graph file has
  portPoints: Partial<Record<Side, PointVars>>; // its connection points' variables on each side (connection.ts), for their spots
  // the new form (the data center's examples with dataset.json frame or blank): its drawing inside a box of this name,
  // the weather and these outputs above it, its connection points on the margins
  frame?: { name: string; outputs: { v: string; tag: string }[] };
  actuators: string[]; // what a controller sets: drawn as a square, as dataset.json "actuators" on the data center's
  library: LibraryEquation[]; // the standard equations of this system, for its Physics model
  size?: number; // the bubbles' size until one is chosen in the Variables menu (1: the data center's)
}
