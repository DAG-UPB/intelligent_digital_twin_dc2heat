/**
 * Where the instruments sit on the Physical structure drawing, and how that is stored in site.json pid_layout:
 *   "<var>"        drawn diagram, pixel coordinates in the W x H viewBox
 *   "paper:<var>"  paper P&ID, x and y as fractions of the image (x < 0: not placed yet, in the tray)
 *   "plant:<var>"  variable -> P&ID component: tag = component id ("" = none), x, y = the component's spot
 * Pure functions only.
 */
import type { Plant } from "../../../lib/plantLinks";
import { weatherSpots } from "./connection";
import { W } from "./geometry";

export interface Spot {
  x: number;
  y: number;
  tag: string; // ISA tag shown in the bubble
}
export type Pos = Record<string, Spot>;
export type Diagram = "drawn" | "paper";

export const PAPER = "paper:";
export const PLANT = "plant:";
export const SURFACE = "surface:"; // an empty structure's data-center surface: its height as y (connection.ts boundary)

/**
 * Hand-drawn P&ID of the data-center cooling loop (DrawnEquipment), for the simulation datasets.
 * Default spot and ISA tag of each sim_1 variable, next to the pipe or unit it measures.
 */
export const DEFAULTS: Pos = {
  // the weather, above the heat distribution's box (connection.ts weatherSpots: the same slots on every structure);
  // solar_radiation the shared weather's (pages/heat/ports.ts): a variable to make when the data has no column
  ...weatherSpots("dc", true, [
    ["Out_Temp", "TT"],
    ["Out_Hum", "MT"],
    ["solar_radiation", "RT"],
    ["Out_Wind", "ST"],
    ["Out_Wind_Dir", "ZT"],
    ["Hour", "KI"],
  ]),
  // hall HEX (hot side air): air in left, air out right, air flow above it (Q is calculated: a read-out, no instrument)
  HEX_Hall_T_in: { x: 460, y: 162, tag: "TT" },
  HEX_Hall_T_out: { x: 640, y: 160, tag: "TT" },
  HEX_Hall_m: { x: 560, y: 70, tag: "FT" }, // taps onto the top, apart from the T_in tap and the waste-heat riser
  Cool_Set: { x: 485, y: 395, tag: "TIC" },
  HVAC_Ener: { x: 765, y: 225, tag: "EQ" }, // the chiller's electricity, above the chiller, its name clear of the condenser HEX's T_in
  // room air in the cold aisle above the upper rack row; load and IT power below the lower row
  In_Hum: { x: 190, y: 205, tag: "MT" },
  In_Temp: { x: 320, y: 205, tag: "TT" },
  IT_Load: { x: 190, y: 470, tag: "JT" },
  ITE_Ener: { x: 320, y: 470, tag: "EQ" },
  // condenser HEX (hot side water): water from the chiller above it; flow and water on to the tower below it, their
  // taps framing the HEX label and the Q read-out
  HEX_Cond_T_in: { x: 880, y: 225, tag: "TT" },
  HEX_Cond_m: { x: 800, y: 450, tag: "FT" },
  HEX_Cond_T_out: { x: 990, y: 450, tag: "TT" },
  // the loop's water on its two pipes to and from the heat distribution: on to it (warm, above) and back (cold, below)
  Loop_T_warm: { x: 1040, y: 130, tag: "TT" },
  Loop_T_cold: { x: 1072, y: 295, tag: "TT" }, // right of the cooling tower
  // the demand of the recovery loop, where the waste heat leaves the drawing
  Heat_Demand: { x: 1060, y: 195, tag: "QT" },
  // the heat the cooling rejects to the environment: beside the cooling tower (pages/heat/ports.ts DC_INTERFACE)
  Heat_rejected: { x: 1060, y: 520, tag: "QT" },
};

/** The same drawing with free cooling (A1, sim_1_air): the plate HEX and its share below the chiller, the condenser's
 * flow and outlet moved up, clear of its tower-water pipes. */
export const FC_DEFAULTS: Pos = {
  ...DEFAULTS,
  FC_Share: { x: 765, y: 568, tag: "KI" },
  HEX_Cond_m: { x: 800, y: 415, tag: "FT" },
  HEX_Cond_T_out: { x: 1000, y: 420, tag: "TT" },
};

/** The hall HEX on the chilled-water return (DrawnEquipment hallOnWater): above the CRAH, as in the warm air: the water
 * in on its left, the outlet on its right, the flow below-left of it, apart from the waste-heat risers on its top. */
export const HALL_WATER: Pos = {
  // the condenser design's loop water on to the heat distribution: where the hall design's is (one shows at a time)
  Loop_T_warm_Cond: DEFAULTS.Loop_T_warm,
  HEX_Hall_T_in: { x: 460, y: 162, tag: "TT" },
  HEX_Hall_T_out: { x: 640, y: 160, tag: "TT" },
  HEX_Hall_m: { x: 480, y: 228, tag: "FT" }, // below-left, clear of the weather row, the waste-heat risers and T_out
};

/** ISA tag from a variable name, for variables without a default (first match wins, so "_q" beats "temp"). */
export function guessTag(v: string) {
  const n = v.toLowerCase();
  if (n.endsWith("_q") || n.includes("demand")) return "QT";
  if (n.endsWith("_m") || n.includes("flow") || n.includes("mass")) return "FT";
  if (n.includes("temp") || n.endsWith("_t") || /_t_(in|out)$/.test(n)) return "TT";
  if (n.includes("hum")) return "MT";
  if (n.includes("ener") || n.includes("power")) return "EQ";
  if (n.includes("load")) return "JT";
  if (n.includes("press")) return "PT";
  if (n.includes("set")) return "TIC";
  if (n.includes("fan") || n.includes("pump")) return "SC";
  if (n.includes("valve")) return "FV";
  return "XT"; // ISA: unclassified measurement
}

/** Spots of not-yet-placed instruments: below the paper image, where they are not drawn (they wait in the
 * Variables menu), or on the whole frame when nothing is drawn. */
export const TRAY_COLS = 11;
export const traySlot = (k: number, top: number) => ({ x: 70 + (k % TRAY_COLS) * 90, y: top + 50 + Math.floor(k / TRAY_COLS) * 80 });
/** Spare row under the hall, between the electricity and the free cooling, for variables without a default spot: far
 * enough apart for their names, a second row when it is full. */
const spareSpot = (k: number) => ({ x: 540 + (k % 2) * 100, y: 595 - Math.floor(k / 2) * 70 });

/** What the layout depends on: whether the built-in drawing applies, and the paper image height (0: no image). */
export interface Frame {
  canDraw: boolean;
  trayTop: number;
  defaults?: Pos; // the default spots of another structure's built-in drawing (PidPage setup); else DEFAULTS
  ports?: Pos; // where the connection points' variables start without a built-in drawing (connection.ts)
  weather?: Pos; // the weather's spots in its box, on every diagram: where its variables start until placed
  inside?: number; // an empty structure's box starts here: a variable without a spot goes below it, not into the band
}

/** Instrument positions of a diagram from the saved pid_layout; unknown ones go to a default spot or the tray. */
export function layoutFor(d: Diagram, vars: string[], saved: Pos, { canDraw, trayTop, defaults = DEFAULTS, ports = {}, weather = {}, inside = 0 }: Frame): Pos {
  let k = 0;
  if (d === "drawn" && canDraw)
    return Object.fromEntries(vars.map((v) => [v, saved[v] ?? weather[v] ?? defaults[v] ?? { ...spareSpot(k++), tag: guessTag(v) }]));
  if (d === "drawn") return Object.fromEntries(vars.map((v) => [v, saved[v] ?? weather[v] ?? ports[v] ?? { ...traySlot(k++, inside), tag: guessTag(v) }]));
  return Object.fromEntries(
    vars.map((v) => {
      const p = saved[PAPER + v];
      if (p && !(p.x === -1 && p.y === -1)) return [v, { x: p.x * W, y: p.y * trayTop, tag: p.tag }]; // also in a margin: x < 0 or > 1
      if (!p && weather[v]) return [v, weather[v]];
      return [v, !p && ports[v] ? ports[v] : { ...traySlot(k++, trayTop), tag: p?.tag ?? guessTag(v) }]; // one put back in the tray stays there
    }),
  );
}

/** pid_layout entries of one diagram's positions (paper: fractions of the image, the tray = not placed). */
export const encode = (d: Diagram, pos: Pos, trayTop: number): Pos =>
  d === "drawn"
    ? pos
    : Object.fromEntries(
        Object.entries(pos).map(([v, p]) => [PAPER + v, p.y < trayTop ? { x: p.x / W, y: p.y / trayTop, tag: p.tag } : { x: -1, y: -1, tag: p.tag }]),
      );

/**
 * pid_layout entries of both diagrams: the stashed one (unsaved positions of the diagram not on screen), then the
 * one on screen, which wins over its own stashed copy (a diagram left and returned to keeps a stale stash entry).
 */
export function diagramsToSave(current: Diagram, pos: Pos, stash: Partial<Record<Diagram, Pos>>, trayTop: number): Pos {
  const out: Pos = {};
  for (const [d, ps] of Object.entries(stash) as [Diagram, Pos][]) Object.assign(out, encode(d, ps, trayTop));
  return Object.assign(out, encode(current, pos, trayTop));
}

/** variable -> component id saved in pid_layout ("plant:" keys with a component). */
export const assignmentsFromLayout = (saved: Pos): Record<string, string> =>
  Object.fromEntries(
    Object.entries(saved)
      .filter(([k, p]) => k.startsWith(PLANT) && p.tag)
      .map(([k, p]) => [k.slice(PLANT.length), p.tag]),
  );

/** "plant:" entries of every variable: its component's spot, or {-1, -1, ""} when it is on none. */
export function plantLayoutEntries(vars: string[], components: Plant["components"], assign: Record<string, string>): Pos {
  const out: Pos = {};
  for (const v of vars) {
    const c = components.find((c) => c.id === assign[v]);
    out[PLANT + v] = c ? { x: c.x, y: c.y, tag: c.id } : { x: -1, y: -1, tag: "" };
  }
  return out;
}

/** Spot of a variable added by hand: the next tray slot (paper), its default or the spare row (drawn simulation), else the tray. */
export function spotForNewVar(
  v: string,
  vars: string[],
  pos: Pos,
  paper: boolean,
  { canDraw, trayTop, defaults = DEFAULTS, weather = {}, inside = 0 }: Frame,
): Spot {
  const spot = weather[v]
    ? weather[v]
    : paper
      ? traySlot(vars.filter((x) => pos[x] && pos[x].y >= trayTop).length, trayTop)
      : canDraw
        ? (defaults[v] ?? spareSpot(vars.filter((x) => !defaults[x]).length))
        : traySlot(vars.length, inside);
  return { tag: guessTag(v), ...spot };
}
