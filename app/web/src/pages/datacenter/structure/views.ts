/**
 * Views inside the P&ID: an area of the drawing marked as a view of its own (one cooling unit, one room), with its
 * own picture drawn inside it (site.json pid_views, the picture in pid_views/<id>.png). A view inside another view's
 * area is nested in it. Everything stays on one canvas, so variables of every view are linked like any others; one
 * placed in a view is drawn at the view's scale, so zooming into the view (Open) shows it at its usual size.
 * Each view is shown at a level of detail (`show`): a plain box with its name, the sheet underneath (only its
 * frame), or its own picture; "auto" picks the box while the view is small on screen and its picture once it is
 * zoomed into. The layer bar can show every view at one level instead.
 * Areas are fractions of the P&ID, like the variables' spots. Pure functions only.
 */
import type { PidView } from "../../../api";

export type { PidView };
type Pt = { x: number; y: number };

/** The innermost view (the smallest area) holding this spot (fractions of the P&ID), or null. */
export function viewAt(views: PidView[], x: number, y: number): PidView | null {
  const holding = views.filter((v) => x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h);
  return holding.sort((a, b) => a.w * a.h - b.w * b.h)[0] ?? null;
}

/** A spot given in a view's own picture (fractions of it) as fractions of the P&ID, and back. */
export const fromView = (v: PidView, x: number, y: number): Pt => ({ x: v.x + x * v.w, y: v.y + y * v.h });
export const toView = (v: PidView, x: number, y: number): Pt => ({ x: (x - v.x) / v.w, y: (y - v.y) / v.h });

/** The bigger areas first, so a nested view is drawn over the one around it. */
export const outerFirst = (views: PidView[]) => [...views].sort((a, b) => b.w * b.h - a.w * a.h);

/** A new view's id from its name (lower case, digits, -), unique among `taken`. */
export function viewId(name: string, taken: string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 34) || "view";
  let id = base;
  for (let k = 2; taken.includes(id); k++) id = `${base}-${k}`;
  return id;
}

/** The area between two corners (drawing units) as fractions of a w x h drawing, kept on it; null when it is too
 * small to work in (under 2 % of the drawing's width or height). */
export function areaOf(a: Pt, b: Pt, w: number, h: number): Omit<PidView, "id" | "name"> | null {
  const clip = (v: number, max: number) => Math.min(max, Math.max(0, v));
  const [x0, x1] = [clip(Math.min(a.x, b.x), w), clip(Math.max(a.x, b.x), w)];
  const [y0, y1] = [clip(Math.min(a.y, b.y), h), clip(Math.max(a.y, b.y), h)];
  if (x1 - x0 < 0.02 * w || y1 - y0 < 0.02 * h) return null;
  return { x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h };
}

/** How a view is shown; "auto": a box while it is small on screen, its picture when zoomed into. */
export const SHOW_AS = ["auto", "box", "sheet", "picture"] as const;
export type ShowAs = (typeof SHOW_AS)[number];
/** The layer bar's choice for every view: each its own (`own`), or all at one level. */
export type ViewsAs = "own" | ShowAs;
/** "auto" shows the picture once the view takes this share of the window's width or height. */
export const AUTO_SHARE = 0.35;

/** What a view is drawn as: its own level (or the layer bar's for all), "auto" decided by `share` (how much of the
 * window it takes; without a picture yet it stays the sheet, so the area just marked shows what it holds); a
 * picture it does not have is the sheet underneath. */
export function shownAs(v: PidView, all: ViewsAs, hasPicture: boolean, share: number): Exclude<ShowAs, "auto"> {
  let mode = all === "own" ? (v.show ?? "auto") : all;
  if (mode === "auto") mode = !hasPicture ? "sheet" : share >= AUTO_SHARE ? "picture" : "box";
  return mode === "picture" && !hasPicture ? "sheet" : mode;
}
