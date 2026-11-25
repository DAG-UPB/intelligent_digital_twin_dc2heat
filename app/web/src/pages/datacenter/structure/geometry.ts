/**
 * Geometry of the Physical structure drawing: the SVG frame, the built-in P&ID's equipment (for sensor taps),
 * the causal arcs, the three slider stages and the morph of the instruments into a circle. Pure functions only.
 */
import { keyOf, type Link } from "./links";

/** viewBox width, drawn-diagram height, instrument radius, snap grid (SVG units). */
export const W = 1100;
export const H = 640;
export const R = 22;
export const GRID = 10;

export type Pt = [number, number];
export interface XY {
  x: number;
  y: number;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const snap = (v: number) => Math.round(v / GRID) * GRID;

/**
 * Equipment boxes (x, y, w, h) of the built-in drawing (DrawnEquipment). A sensor taps onto the equipment it
 * measures; the loop's two pipes to the heat distribution (PORT_Y, connection.ts) are the only pipes tapped.
 */
const UNITS: Record<string, Box> = {
  rackRow1: [140, 270, 300, 30],
  rackRow2: [140, 350, 300, 30],
  crah: [520, 200, 110, 280],
  hexHall: [555, 150, 40, 24],
  chiller: [760, 280, 90, 90],
  hexCond: [880, 308, 40, 24],
  tower: [960, 280, 80, 80],
  phe: [700, 470, 40, 24], // the free-cooling plate HEX (drawn for a plant with free cooling)
  loopWarm: [1000, 199, 100, 2], // the loop's pipe on to the heat distribution, from the box's edge
  loopCold: [1000, 239, 100, 2], // and back
};
/** What each known variable measures: a unit id, a unit-id prefix ("rackRow": the nearest row), or null (room air,
 * weather, clock, heat demand: no tap). Variables not listed tap onto the nearest unit within TAP_MAX. */
const MEASURES: Record<string, string | null> = {
  IT_Load: "rackRow",
  ITE_Ener: "rackRow",
  HVAC_Ener: "chiller", // the cooling electricity is the chiller's
  Cool_Set: "crah",
  HEX_Hall_T_in: "hexHall",
  HEX_Hall_T_out: "hexHall",
  HEX_Hall_m: "hexHall",
  HEX_Cond_T_in: "hexCond",
  HEX_Cond_T_out: "hexCond",
  HEX_Cond_m: "hexCond",
  FC_Share: "phe",
  Loop_T_warm: "loopWarm",
  Loop_T_warm_Cond: "loopWarm",
  Loop_T_cold: "loopCold",
  Heat_Demand: null, // the heat demand of the recovery loop: not on the drawing
  In_Temp: null,
  In_Hum: null,
  Out_Temp: null,
  Out_Hum: null,
  Out_Wind: null,
  Out_Wind_Dir: null,
  Hour: null,
  solar_radiation: null,
};
const TAP_MAX = 60;

/** A unit (or a stretch of pipe) of a built-in drawing: x, y, w, h. */
export type Box = [number, number, number, number];
/** What a built-in drawing's sensors tap onto: its units, and what each known variable measures (a unit id, a
 * unit-id prefix, or null: no tap); a variable not listed taps onto the nearest unit within TAP_MAX. */
export interface Taps {
  units: Record<string, Box>;
  measures: Record<string, string | null>;
  /** The units in the new form (the drawing inside its part's box): changed (the pipes run on to the box's edge) or gone
   * (null: a neighbour's box, drawn on the margin instead). */
  framed?: Record<string, Box | null>;
}
/** The taps of a drawing in the new form (Taps.framed): a tap then lands on the pipe near the margin's instrument. */
export function framedTaps(taps: Taps): Taps {
  if (!taps.framed) return taps;
  const units = Object.entries({ ...taps.units, ...taps.framed }).filter((e): e is [string, Box] => !!e[1]);
  return { ...taps, units: Object.fromEntries(units) };
}
/** The data center's cooling loop (DrawnEquipment). */
export const DC_TAPS: Taps = { units: UNITS, measures: MEASURES };
/** The same loop with the hall HEX on the chilled-water return instead of in the warm air (DrawnEquipment hallOnWater). */
export const DC_TAPS_HALL_WATER: Taps = { units: { ...UNITS, hexHall: [555, 150, 40, 24] }, measures: MEASURES };

/** Nearest point on the edge of box (x, y, w, h) to (px, py). */
function edgePoint(px: number, py: number, [x, y, w, h]: Box): Pt {
  const cx = clamp(px, x, x + w);
  const cy = clamp(py, y, y + h);
  if (cx !== px || cy !== py) return [cx, cy]; // outside: the clamped point is on the edge
  const d = [px - x, x + w - px, py - y, y + h - py];
  const i = d.indexOf(Math.min(...d));
  return [i === 0 ? x : i === 1 ? x + w : px, i === 2 ? y : i === 3 ? y + h : py];
}

/**
 * Where the instrument of `v` at (x, y) taps onto the drawing: the nearest edge point of the equipment it measures,
 * or null (room air, weather, clock, or an unknown variable farther than TAP_MAX from every unit).
 */
export function tapFor(v: string, x: number, y: number, taps: Taps = DC_TAPS): Pt | null {
  const what = taps.measures[v];
  if (what === null) return null;
  const units = Object.entries(taps.units).filter(([id]) => what === undefined || id.startsWith(what));
  let best: Pt | null = null;
  let bestD = what === undefined ? TAP_MAX : Infinity;
  for (const [, box] of units) {
    const q = edgePoint(x, y, box);
    const d = Math.hypot(q[0] - x, q[1] - y);
    if (d < bestD) [best, bestD] = [q, d];
  }
  return best;
}

/** True when the tap of `v` at (x, y) runs steeply down through the name under the bubble: put the name above. */
export function nameAbove(v: string, x: number, y: number, taps: Taps = DC_TAPS): boolean {
  const q = tapFor(v, x, y, taps);
  return !!q && q[1] - y > R && Math.abs(q[0] - x) < q[1] - y;
}

/**
 * A causal link is one gentle arc straight from source to target, always bent clockwise so that
 * A->B and B->A don't overlap. `turn` spreads a target's inputs around its edge.
 * It leaves the source's circle and its arrow tip ends on the target's: `ra`, `rb` are their drawn radii (a smaller
 * or scaled bubble has a smaller one; with R for both a small bubble would float apart from its lines).
 * Returns [start, control, end] of a quadratic curve.
 */
export function arc(a: XY, b: XY, turn: number, ra = R, rb = R): Pt[] {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const [ux, uy] = [(b.x - a.x) / d, (b.y - a.y) / d];
  const bend = Math.min(60, d * 0.18);
  const c: Pt = [(a.x + b.x) / 2 - uy * bend, (a.y + b.y) / 2 + ux * bend];
  const from = (p: XY, q: Pt, extra: number, r: number): Pt => {
    const th = Math.atan2(q[1] - p.y, q[0] - p.x) + extra;
    return [p.x + Math.cos(th) * r, p.y + Math.sin(th) * r];
  };
  return [from(a, c, 0, ra), c, from(b, c, turn, rb + 1)]; // +1: the tip on the outline's stroke, not inside it
}

export const arcPath = ([s0, c, e]: Pt[]) => `M${s0[0]},${s0[1]} Q${c[0]},${c[1]} ${e[0]},${e[1]}`;

/** Middle of a quadratic curve, B(0.5) = 0.25 P0 + 0.5 C + 0.25 P2: where the lag label sits. */
export const arcMid = ([p0, c, p1]: Pt[]): Pt => [0.25 * p0[0] + 0.5 * c[0] + 0.25 * p1[0], 0.25 * p0[1] + 0.5 * c[1] + 0.25 * p1[1]];

export const PALETTE = ["#4e79a7", "#f28e2b", "#e15759", "#59a14f", "#b07aa1", "#17becf", "#d4a017", "#9c755f", "#ff7f9e", "#76b7b2", "#b07c62", "#8b5cf6"];

/** One drawn causal arc: its link, "from->to" key and curve points. */
export interface DrawnArc {
  link: Link;
  key: string;
  pts: Pt[];
}

/**
 * Arcs of the links between variables that are on the drawing, and the variables they point to (sorted by name); the
 * inputs of each target enter side by side, 0.22 rad apart.
 */
export function layoutArcs(crossLinks: Link[], at: Record<string, XY>, radius: (v: string) => number = () => R): { arcs: DrawnArc[]; receivers: string[] } {
  const usable = crossLinks.filter((l) => at[l.from] && at[l.to]);
  const sources = [...new Set(usable.map((l) => l.from))].sort();
  const receivers = [...new Set(usable.map((l) => l.to))].sort();
  const inputs = new Map<string, string[]>();
  for (const l of usable) inputs.set(l.to, [...(inputs.get(l.to) ?? []), l.from]);
  for (const ins of inputs.values()) ins.sort((u, v) => sources.indexOf(u) - sources.indexOf(v));
  const turn = (l: Link) => {
    const ins = inputs.get(l.to)!;
    return (ins.indexOf(l.from) - (ins.length - 1) / 2) * 0.22;
  };
  const arcs = usable.map((l) => ({ link: l, key: keyOf(l), pts: arc(at[l.from], at[l.to], turn(l), radius(l.from), radius(l.to)) }));
  return { arcs, receivers };
}

/**
 * The slider has three stages:
 *   0 .. FADE_END             the P&ID fades out, the causal links fade in
 *   FADE_END .. CIRCLE_FROM   graph in place: links on the instruments' P&ID positions
 *   CIRCLE_FROM .. 1          the instruments move into a circle (complete at the end)
 */
export const FADE_END = 0.45;
export const CIRCLE_FROM = 0.55;
export const STOPS = [
  { at: 0, label: "Topology" },
  { at: (FADE_END + CIRCLE_FROM) / 2, label: "Graph in place" },
  { at: 1, label: "Causal graph" },
];

/** t: 0 = only the P&ID, 1 = only the causal links. pull: 0 = P&ID positions, 1 = on the circle. */
export function stageOf(slider: number) {
  return { t: Math.min(1, slider / FADE_END), pull: Math.max(0, (slider - CIRCLE_FROM) / (1 - CIRCLE_FROM)) };
}

/**
 * Positions `pull` of the way (smoothstep) from where they are onto a circle around the middle of a W x vh frame,
 * like the circular view. Each takes the slot in its own direction from the centroid, so the zones keep their order.
 */
export function circleMorph<T extends XY>(pos: Record<string, T>, vars: string[], pull: number, vh: number): Record<string, T> {
  const placed = vars.filter((v) => pos[v]);
  if (pull === 0 || !placed.length) return pos;
  const ease = pull * pull * (3 - 2 * pull);
  const mx = placed.reduce((a, v) => a + pos[v].x, 0) / placed.length;
  const my = placed.reduce((a, v) => a + pos[v].y, 0) / placed.length;
  const ang = (v: string) => Math.atan2(pos[v].y - my, pos[v].x - mx);
  const order = [...placed].sort((u, v) => ang(u) - ang(v));
  const r = Math.min(W, vh) * 0.4;
  const out = { ...pos };
  order.forEach((v, i) => {
    const a = ang(order[0]) + (i / order.length) * 2 * Math.PI;
    const p = pos[v];
    out[v] = { ...p, x: p.x + (W / 2 + r * Math.cos(a) - p.x) * ease, y: p.y + (vh / 2 + r * Math.sin(a) - p.y) * ease };
  });
  return out;
}
