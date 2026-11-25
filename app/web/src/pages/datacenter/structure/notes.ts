/**
 * What the variables on the P&ID are and how sure that is (site.json pid_notes: a kind, drawn as a coloured badge,
 * and a confidence, drawn as a coloured ring), groups (a variable marked as standing for several others, e.g. the
 * mean of a rack's CPUs: a mark only, nothing is computed), the name and spot of a new group, which
 * instruments a dragged box holds, and the log of changes made on the page (by the user or by the assistant), kept
 * per data center in this browser. Pure functions, plus the log's localStorage helpers.
 */
import type { PidNote } from "../../../api";
import { PALETTE } from "./geometry";
import type { Pos } from "./layout";

export type Kind = NonNullable<PidNote["kind"]>;
export type Confidence = NonNullable<PidNote["confidence"]>;
export type Notes = Record<string, PidNote>;

// colours from the drawing's palette (not its red, which reads as an error); the code is drawn in the badge, so the
// kind is readable without telling colours apart
export const KINDS: Record<Kind, { label: string; code: string; color: string }> = {
  sensor: { label: "Sensor (measured value)", code: "S", color: PALETTE[0] },
  setpoint: { label: "Setpoint", code: "SP", color: PALETTE[3] },
  actuator: { label: "Actuator (controller output)", code: "A", color: PALETTE[5] },
  meter: { label: "Meter (running total)", code: "M", color: PALETTE[4] },
  it_load: { label: "IT load (CPU, GPU, IT power)", code: "IT", color: PALETTE[1] },
  weather: { label: "Weather", code: "W", color: PALETTE[9] },
  time: { label: "Time feature", code: "t", color: PALETTE[7] },
  calculated: { label: "Calculated", code: "C", color: PALETTE[6] },
  status: { label: "Status / alarm", code: "St", color: PALETTE[8] },
};
export const CONFIDENCE: Record<Confidence, { label: string; color: string }> = {
  sure: { label: "Sure", color: "var(--ok)" },
  likely: { label: "Likely", color: "var(--warn)" },
  unsure: { label: "Unsure", color: "var(--danger)" },
};
/** How a group's members would be combined (the Dashboard's "combine" can compute it later). */
export const GROUP_METHODS = ["mean", "sum", "min", "max"] as const;

export interface NoteEdit {
  variable: string;
  kind?: string | null; // null removes it, missing keeps it
  confidence?: string | null;
  note?: string | null;
  group?: PidNote["group"]; // null removes it
}

/** The notes with these edits; a note left empty goes. Throws for a kind or confidence that does not exist. */
export function withNotes(notes: Notes, edits: NoteEdit[]): Notes {
  const out = { ...notes };
  for (const e of edits) {
    if (e.kind != null && !(e.kind in KINDS)) throw new Error(`kind "${e.kind}": one of ${Object.keys(KINDS).join(", ")}`);
    if (e.confidence != null && !(e.confidence in CONFIDENCE)) throw new Error(`confidence "${e.confidence}": one of ${Object.keys(CONFIDENCE).join(", ")}`);
    const n: PidNote = { ...out[e.variable] };
    if (e.kind !== undefined) n.kind = (e.kind as Kind | null) ?? undefined;
    if (e.confidence !== undefined) n.confidence = (e.confidence as Confidence | null) ?? undefined;
    if (e.note !== undefined) n.note = e.note ?? undefined;
    if (e.group !== undefined) n.group = e.group ?? undefined;
    const kept = Object.fromEntries(Object.entries(n).filter(([, x]) => x !== undefined && x !== null && x !== "")) as PidNote;
    if (Object.keys(kept).length) out[e.variable] = kept;
    else delete out[e.variable];
  }
  return out;
}

export interface Group {
  name: string;
  method: (typeof GROUP_METHODS)[number];
  members: string[];
}
/** The groups marked in the notes, by name. */
export const groupsIn = (notes: Notes): Group[] =>
  Object.entries(notes)
    .filter(([, n]) => n.group)
    .map(([name, n]) => ({ name, method: n.group!.method, members: n.group!.members }))
    .sort((a, b) => a.name.localeCompare(b.name));
/** variable -> the groups it is a member of. */
export function memberOf(notes: Notes): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const g of groupsIn(notes)) for (const m of g.members) (out[m] ??= []).push(g.name);
  return out;
}

/** A name for a group: what its members' names share (as a variable name: letters, digits, _), plus the method;
 * "group_<method>" when they share nothing; made unique against `taken`. */
export function groupName(members: string[], method: string, taken: string[]): string {
  const clean = members.map((m) => m.replace(/[^A-Za-z0-9_]+/g, "_"));
  let common = clean[0] ?? "";
  for (const c of clean) while (!c.startsWith(common)) common = common.slice(0, -1);
  common = common.replace(/[_\d]+$/, "").replace(/^[^A-Za-z_]+/, "");
  const base = `${(common || "group").slice(0, 50)}_${method}`;
  let name = base;
  for (let k = 2; taken.includes(name); k++) name = `${base}_${k}`;
  return name;
}

/** The middle of the members' spots (the group's place), or null when none has one. */
export function middleOf(members: string[], pos: Pos): { x: number; y: number } | null {
  const at = members.map((m) => pos[m]).filter(Boolean);
  if (!at.length) return null;
  return { x: at.reduce((s, p) => s + p.x, 0) / at.length, y: at.reduce((s, p) => s + p.y, 0) / at.length };
}

/** The variables whose instruments lie inside a dragged box (two corners, in drawing units). */
export function inBox(vars: string[], pos: Pos, a: { x: number; y: number }, b: { x: number; y: number }): string[] {
  const [x0, x1, y0, y1] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return vars.filter((v) => pos[v] && pos[v].x >= x0 && pos[v].x <= x1 && pos[v].y >= y0 && pos[v].y <= y1);
}

// --- the log of changes on the page ------------------------------------------------------------------------------
export interface Change {
  at: number; // ms since 1970
  by: "you" | "AI";
  text: string;
}
const MAX_LOG = 200;
/** The log with a new entry first, the oldest dropped past MAX_LOG. */
export const logged = (log: Change[], c: Change): Change[] => [c, ...log].slice(0, MAX_LOG);

const logKey = (dataset: string) => `pid-changes:${dataset}`;
export function loadChanges(dataset: string): Change[] {
  try {
    const list = JSON.parse(localStorage.getItem(logKey(dataset)) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
export function saveChanges(dataset: string, log: Change[]): void {
  try {
    localStorage.setItem(logKey(dataset), JSON.stringify(log));
  } catch {
    // private mode: the log lasts until the page reloads
  }
}
