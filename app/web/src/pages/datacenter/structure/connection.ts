/**
 * Every structure's connection points, on any drawing: the sides where its heat comes in or goes out (the data center
 * out to the heat distribution, the heat distribution in from it and out to the district, the district in from the
 * heat distribution), at the heights every built-in drawing has them (PORT_Y), and the spots of their variables beside
 * them (pages/heat/ports.ts: two temperatures, the heat and the flow). The built-in drawings have them drawn in; with a
 * P&ID picture or an empty structure they are drawn by ConnectionPoints.tsx in a margin beside it (never over the
 * picture), so there is always something to connect the model to. Pure.
 */
import type { StructureScope } from "../../../api";
import type { PointVars, Role } from "../../heat/ports";
import { W } from "./geometry";
import type { Pos } from "./layout";

export type Side = "in" | "out";

/** The connection point's heights (the drawing frame's y): the supply and the return. */
export const PORT_Y: [number, number] = [200, 240];

/** Each structure's sides and the neighbour on each. */
export const SIDES: Record<StructureScope, { side: Side; neighbour: string }[]> = {
  dc: [{ side: "out", neighbour: "Heat distribution" }],
  heat: [
    { side: "in", neighbour: "Data center" },
    { side: "out", neighbour: "District heat" },
  ],
  district: [{ side: "in", neighbour: "Heat distribution" }],
};

/** The margin beside the picture on a side with a connection point: its variables, then the neighbour's box. */
export const MARGIN = 250;
/** An empty structure's, narrower: its connection point's variables in one column, the neighbour right beside them. */
export const MARGIN_NARROW = 180;
/** The neighbour's box on a side (x, width), at the outer edge of a margin `m` wide; the pipes run from the picture's
 * edge into it. */
export const neighbourX = (side: Side, m = MARGIN): [number, number] => (side === "in" ? [-m + 4, 96] : [W + m - 100, 96]);
export const NEIGHBOUR_X: Record<Side, [number, number]> = { in: neighbourX("in"), out: neighbourX("out") };
/** The picture's edge on each side, where the pipes start. */
export const EDGE_X: Record<Side, number> = { in: 0, out: W };
/** The drawing's left and right ends with the margins of a structure's sides (the picture spans 0..W). */
export function span(scope: StructureScope, m = MARGIN): { x0: number; x1: number } {
  const sides = SIDES[scope].map((s) => s.side);
  return { x0: sides.includes("in") ? -m : 0, x1: W + (sides.includes("out") ? m : 0) };
}

/** The connection point's heights on a picture `h` high: PORT_Y, and further down on a picture too short for it. */
export const portY = (h: number): [number, number] => (h >= 330 ? PORT_Y : [h * 0.4, h * 0.4 + 40]);

/** The spots of a side's variables: the supply's above its pipe, the return's below, the flow and the heat beside them. */
const SPOT: Record<Side, Record<Role, [number, "supply" | "return"]>> = {
  out: { t_supply: [W + 45, "supply"], q: [W + 115, "supply"], t_return: [W + 45, "return"], m: [W + 45, "return"] },
  in: { q: [-115, "supply"], t_supply: [-45, "supply"], m: [-45, "return"], t_return: [-45, "return"] },
};
const TAG: Record<Role, string> = { t_supply: "TT", t_return: "TT", q: "QT", m: "FT" };

/** The outer edge of the neighbour's box on each structure's built-in drawing (DrawnEquipment, HeatDrawing, DistrictDrawing). */
const DRAWN_EDGE: Record<StructureScope, number> = { dc: 1096, heat: 40, district: 40 };
const SLOT = 75;

/** The weather's box on every structure, the same way: at the top, above the neighbour's box on the first side, flush
 * with its outer edge (beside a picture or on an empty structure the box in the margin, on a built-in drawing the one
 * drawn in), one row of `n` slots (x, width; y 4 to 104). */
export function weatherBox(scope: StructureScope, drawn: boolean, n = 3): [number, number] {
  const out = SIDES[scope][0].side === "out";
  const w = 86 + (Math.max(n, 3) - 1) * SLOT;
  const edge = drawn ? DRAWN_EDGE[scope] : out ? W + MARGIN - 4 : -MARGIN + 4;
  return [out ? edge - w : edge, w];
}

/** The spots of the weather's variables (name, tag) in its box, in this order (WEATHER's first, so the same three
 * slots on every structure): where they start until placed by hand. */
export function weatherSpots(scope: StructureScope, drawn: boolean, vars: [string, string][]): Pos {
  const [wx] = weatherBox(scope, drawn, vars.length);
  return Object.fromEntries(vars.map(([v, tag], i) => [v, { x: wx + 40 + i * SLOT, y: 58, tag }]));
}

/** An empty structure (no picture, no drawing: the room is free) is the data center itself: a box to draw in
 * (boundary), below a band on top, its right edge the connection point (the pipes start there). Everything that goes
 * in or out sits outside it: the inputs (the weather, the IT load) and the outputs (the electricity, the heat
 * rejected) in the band above, an arrow across the border each (ConnectionPoints.tsx DcBoundary); the heat to recover
 * on its right, at the connection point. */
export type IO = "input" | "output";
export interface StripVar {
  v: string;
  tag: string;
  io: IO;
}
export const SURFACE_TOP = 80; // the band on top, for what goes in and out
export const SURFACE_MAX = 4000;
/** The data center's box on a surface `h` high (H to start, taller dragged at its bottom edge): all of it but the band. */
export const boundary = (h: number): [number, number, number, number] => [0, SURFACE_TOP, W, h - SURFACE_TOP - 2];
const STEP = 100;
const STRIP_Y = 40; // one row just above the box: its names end a few units over its edge at SURFACE_TOP
const LEFT: Record<IO, number> = { input: 140, output: 600 }; // the outputs' after the four inputs (WEATHER, IT_load)

/** Each one's spot in the thin band above the box: the inputs from the left, the outputs after them, in the order given;
 * closer together when many (a framed example's whole weather), so the row stays over the box. */
export function stripSpots(vars: StripVar[]): Pos {
  const out: Pos = {};
  const step = Math.min(STEP, (W - LEFT.input - 70) / vars.length);
  const inputs = vars.filter((s) => s.io === "input");
  const first: Record<IO, number> = { input: LEFT.input, output: Math.max(LEFT.output, LEFT.input + inputs.length * step + 40) };
  for (const io of ["input", "output"] as const)
    vars.filter((s) => s.io === io).forEach((s, i) => (out[s.v] = { x: first[io] + i * step, y: STRIP_Y, tag: s.tag }));
  return out;
}

/** One column beside the pipes (the narrow margin): the supply's above them, the return's, the flow and the heat below. */
const COLUMN: Record<Role, (s: number, r: number) => number> = {
  t_supply: (s) => s - 62,
  t_return: (_, r) => r + 48,
  m: (_, r) => r + 118,
  q: (_, r) => r + 188,
};

/** Where the connection points' variables start on a picture `h` high (until placed, by hand or from a saved layout),
 * two columns (the flow under the return), or one in the narrow margin (`column`); the data center's other inputs and outputs (pages/heat/ports.ts
 * DC_INTERFACE: name, tag) under its connection point, two to a row. */
export function portSpots(points: Partial<Record<Side, PointVars>>, h: number, more: [string, string][] = [], column = false): Pos {
  const [s, r] = portY(h);
  const out: Pos = {};
  more.forEach(([v, tag], i) => (out[v] = { x: SPOT.out[i % 2 ? "q" : "t_supply"][0], y: r + 210 + Math.floor(i / 2) * 70, tag }));
  for (const [side, vars] of Object.entries(points) as [Side, PointVars][])
    for (const [role, v] of Object.entries(vars) as [Role, string | undefined][]) {
      if (!v || out[v]) continue;
      const [x, pipe] = SPOT[side][role];
      if (column) out[v] = { x: side === "out" ? W + 45 : -45, y: COLUMN[role](s, r), tag: TAG[role] };
      else if (role === "m")
        out[v] = { x, y: COLUMN.m(s, r), tag: TAG.m }; // under the return
      else out[v] = { x, y: pipe === "supply" ? s - 62 : r + 48, tag: TAG[role] }; // the names under the circles clear of the pipes
    }
  return out;
}
