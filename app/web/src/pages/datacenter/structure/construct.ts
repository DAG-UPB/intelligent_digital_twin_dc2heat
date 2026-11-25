/**
 * The digital construct of the P&ID (level 2 of 3: picture, construct, variables): the drawing as shapes the user
 * and the assistant edit, stored as pid_construct.json (backend/pid/construct.py). Positions are fractions of the
 * drawing: x of its width, y of its height (down). Pure functions only.
 */
import type { PidShape, ShapeKind } from "../../../api";

export type Shape = PidShape;
export interface XY {
  x: number;
  y: number;
}

/** Size of a new shape placed with a click, as fractions of the drawing (w, h). */
export const NEW_SIZE: Record<"rect" | "circle", [number, number]> = { rect: [0.06, 0.05], circle: [0.025, 0.035] };
const MIN = 0.004; // smaller than this a shape cannot be grabbed again
export const KIND_LABEL: Record<ShapeKind, string> = { rect: "Rectangle", circle: "Circle", line: "Line", text: "Text" };

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const keep = (v: number) => r4(Math.max(-0.5, Math.min(1.5, v))); // the backend's range: a little off the sheet is fine

/** A free id for a new shape of this kind: "rect:1", "rect:2", ... */
export function newId(shapes: Shape[], kind: ShapeKind): string {
  const taken = new Set(shapes.map((s) => s.id));
  let n = 1;
  while (taken.has(`${kind}:${n}`)) n++;
  return `${kind}:${n}`;
}

/** A shape drawn from `a` to `b` (a drag; a click when they are the same point: then the default size). */
export function drawn(kind: ShapeKind, a: XY, b: XY, shapes: Shape[], label = ""): Shape {
  const id = newId(shapes, kind);
  const role = kind === "line" ? "pipe" : kind === "text" ? "note" : kind === "circle" ? "instrument" : "component";
  if (kind === "text") return { id, kind, x: keep(a.x), y: keep(a.y), label: label || "Text", role };
  const click = Math.abs(b.x - a.x) < MIN && Math.abs(b.y - a.y) < MIN;
  if (kind === "line") {
    const end = click ? { x: a.x + 0.08, y: a.y } : b;
    return {
      id,
      kind,
      points: [
        [keep(a.x), keep(a.y)],
        [keep(end.x), keep(end.y)],
      ],
      label,
      role,
    };
  }
  const [w, h] = click ? NEW_SIZE[kind] : [Math.max(MIN, Math.abs(b.x - a.x)), Math.max(MIN, Math.abs(b.y - a.y))];
  const centre = click ? a : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return { id, kind, x: keep(centre.x), y: keep(centre.y), w: r4(w), h: r4(h), label, role };
}

/** The shape moved by (dx, dy). */
export function moved(s: Shape, dx: number, dy: number): Shape {
  if (s.kind === "line") return { ...s, points: (s.points ?? []).map(([x, y]) => [keep(x + dx), keep(y + dy)]) };
  return { ...s, x: keep((s.x ?? 0) + dx), y: keep((s.y ?? 0) + dy) };
}

/** A rectangle or circle with its bottom-right corner at `corner` (the top-left one stays). */
export function resized(s: Shape, corner: XY): Shape {
  if (s.kind === "line" || s.kind === "text") return s;
  const left = (s.x ?? 0) - (s.w ?? 0) / 2;
  const top = (s.y ?? 0) - (s.h ?? 0) / 2;
  const w = Math.max(MIN, corner.x - left);
  const h = Math.max(MIN, corner.y - top);
  return { ...s, x: keep(left + w / 2), y: keep(top + h / 2), w: r4(Math.min(1, w)), h: r4(Math.min(1, h)) };
}

/** Where a variable on this shape goes: its centre (a line: the middle of its points). */
export function centreOf(s: Shape): XY {
  if (s.kind !== "line") return { x: s.x ?? 0, y: s.y ?? 0 };
  const ps = s.points ?? [];
  const xs = ps.map((p) => p[0]);
  const ys = ps.map((p) => p[1]);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** A value typed in: a number when it reads as one ("50", "0.8"), else the text. */
export const valueOf = (t: string): string | number => (t.trim() !== "" && Number.isFinite(Number(t)) ? Number(t) : t.slice(0, 80));

/** What an edit may change; a value set to null (or "") is removed. */
export type ShapeEdit = Partial<Pick<Shape, "x" | "y" | "w" | "h" | "points" | "label" | "role">> & { props?: Record<string, string | number | null> };

/** The shape with the fields an edit gives (from the inspector or the assistant); the rest stays. */
export function edited(s: Shape, e: ShapeEdit): Shape {
  const out: Shape = { ...s };
  if (e.props) {
    const next = { ...s.props };
    for (const [k, v] of Object.entries(e.props)) {
      if (v === null || v === "") delete next[k];
      else next[k] = v;
    }
    out.props = Object.keys(next).length ? next : undefined;
  }
  if (e.label !== undefined) out.label = String(e.label).slice(0, 80);
  if (e.role !== undefined) out.role = e.role;
  if (e.points !== undefined && s.kind === "line") out.points = e.points.map(([x, y]) => [keep(x), keep(y)]);
  if (s.kind !== "line") {
    if (e.x !== undefined) out.x = keep(e.x);
    if (e.y !== undefined) out.y = keep(e.y);
  }
  if (s.kind === "rect" || s.kind === "circle") {
    if (e.w !== undefined) out.w = r4(Math.max(MIN, Math.min(1, e.w)));
    if (e.h !== undefined) out.h = r4(Math.max(MIN, Math.min(1, e.h)));
  }
  return out;
}

/** The area between two corners of a drag on the import preview (fractions of the page, clamped to it), or null
 * when it is too small to mean a selection (the backend's crop.MIN_SIZE). */
export function areaBetween(a: XY, b: XY): [number, number, number, number] | null {
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1e4) / 1e4;
  const [x0, x1] = [c(Math.min(a.x, b.x)), c(Math.max(a.x, b.x))];
  const [y0, y1] = [c(Math.min(a.y, b.y)), c(Math.max(a.y, b.y))];
  return x1 - x0 < 0.02 || y1 - y0 < 0.02 ? null : [x0, y0, x1, y1];
}
