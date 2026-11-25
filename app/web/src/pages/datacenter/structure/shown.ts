/**
 * Which variables the Physical structure drawing shows, and the short labels of long names. A real data center can
 * have hundreds of variables: they are all on the drawing (in the graph), but only the ones the user ticks in the
 * Variables menu are drawn. The choice and the instrument size are remembered per data center in this browser.
 * Pure functions, plus the two localStorage helpers.
 */
import { snap } from "./geometry";
import type { Pos } from "./layout";

export const MANY = 40; // above this many variables, a new drawing starts with only the placed ones shown
export const MAX_LABEL = 16; // longer names get a short label on the drawing (the menu gives the full name)
export const SIZES = { min: 0.15, max: 2 };

/** A long name shortened: its words cut to a few letters each (numbers kept whole), "_" between them. */
function shorten(name: string, max: number): string {
  const words = name.split(/[_\s\-.:/]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean);
  for (const len of [4, 3, 2, 1]) {
    const s = words.map((w) => (/^\d/.test(w) ? w : w.slice(0, len))).join("_");
    if (s.length <= max) return s;
  }
  return `${name.slice(0, max - 1)}…`;
}

/** variable -> the label drawn: the name itself when short, else a short label; every label is unique. */
export function shortNames(names: string[], max = MAX_LABEL): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set(names.filter((n) => n.length <= max)); // a short name keeps itself, before any short label
  for (const n of names) {
    if (n.length <= max) {
      out[n] = n;
      continue;
    }
    const base = shorten(n, max);
    let s = base;
    for (let k = 2; used.has(s); k++) s = `${base.slice(0, max - String(k).length - 1)}~${k}`;
    used.add(s);
    out[n] = s;
  }
  return out;
}

/** The variables shown when nothing was chosen yet: all of a small graph, else only those placed on the drawing
 * (a paper P&ID draws only placed ones anyway; the others wait in the menu). */
export function defaultShown(vars: string[], pos: Pos, paper: boolean, trayTop: number): string[] {
  if (vars.length <= MANY) return vars;
  return vars.filter((v) => paper && pos[v] && pos[v].y < trayTop);
}

export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Spots for variables that appear (ticked in the menu) inside an area of the drawing (the part in view): a grid of
 * cells `gap` apart from its top left, each cell skipped while an instrument already sits in it; when the area is
 * full, the cells are used again. */
export function spotsInView(vars: string[], pos: Pos, area: Area, gap: number): Pos {
  const cols = Math.max(1, Math.floor((area.x1 - area.x0) / gap));
  const rows = Math.max(1, Math.floor((area.y1 - area.y0) / gap));
  const taken = Object.values(pos).map((p) => [p.x, p.y]);
  const out: Pos = {};
  let k = 0;
  for (const v of vars) {
    let spot: [number, number] = [0, 0];
    for (let tries = 0; tries <= cols * rows; tries++, k++) {
      const cell = k % (cols * rows);
      spot = [snap(area.x0 + gap / 2 + (cell % cols) * gap), snap(area.y0 + gap / 2 + Math.floor(cell / cols) * gap)];
      if (!taken.some(([x, y]) => Math.hypot(x - spot[0], y - spot[1]) < gap * 0.8)) break;
    }
    k++;
    taken.push(spot);
    out[v] = { ...(pos[v] ?? { tag: "XT" }), x: spot[0], y: spot[1] };
  }
  return out;
}

const key = (what: string, dataset: string) => `pid-${what}:${dataset}`;

/** The remembered choice of a data center (null: none yet). localStorage may be off: then nothing is remembered. */
export function loadShown(dataset: string): string[] | null {
  try {
    const raw = localStorage.getItem(key("shown", dataset));
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list.map(String) : null;
  } catch {
    return null;
  }
}

export function saveShown(dataset: string, shown: string[]): void {
  try {
    localStorage.setItem(key("shown", dataset), JSON.stringify(shown));
  } catch {
    // private mode: the choice lasts until the page reloads
  }
}

/** The bubble size chosen in the Variables menu, else `initial` (the structure's own default). */
export function loadSize(dataset: string, initial = 1): number {
  try {
    const v = Number(localStorage.getItem(key("size", dataset)));
    return v >= SIZES.min && v <= SIZES.max ? v : initial;
  } catch {
    return initial;
  }
}

export function saveSize(dataset: string, size: number): void {
  try {
    localStorage.setItem(key("size", dataset), String(size));
  } catch {
    // as above
  }
}
