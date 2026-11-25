/**
 * The digital construct's edits on the Structure page (PidPage): a shape put back, made, changed (construct.ts edited)
 * or deleted, a variable put on a shape (its instrument at the shape's centre, an instrument bubble's ISA code its tag),
 * and the shapes as the assistant reads and gives them (fractions of the P&ID picture). Every edit is unsaved until
 * Save, like the graph.
 */
import { centreOf, edited, type Shape, type ShapeEdit } from "./construct";
import { W } from "./geometry";
import { guessTag } from "./layout";
import type { useConstruct } from "./useConstruct";
import type { usePidGraph } from "./usePidGraph";

export interface ConstructEditsContext {
  k: ReturnType<typeof useConstruct>;
  g: ReturnType<typeof usePidGraph>;
  selShape: string | null;
  setSelShape: (id: string | null) => void;
  select: (v: string | null, link?: string | null) => void;
  change: () => void;
  addVariable: (name: string) => void;
  showVar: (v: string) => void;
  frameH: number;
  constructOn: boolean;
  frac: (n: number, of: number) => number;
}

export function useConstructEdits({ k, g, selShape, setSelShape, select, change, addVariable, showVar, frameH, constructOn, frac }: ConstructEditsContext) {
  const shapeChanged = () => {
    k.setDirty(true);
    change();
  };
  const putShape = (s: Shape) => k.setShapes((ss) => ss.map((x) => (x.id === s.id ? s : x)));
  const shapeOf = (id: unknown) => {
    const s = k.shapes.find((x) => x.id === String(id));
    if (!s) throw new Error(`There is no shape ${String(id)}. Shapes: ${k.shapes.map((x) => x.id).join(", ") || "none"}`);
    return s;
  };
  const createShape = (s: Shape) => {
    k.setShapes((ss) => [...ss, s]);
    select(null);
    setSelShape(s.id);
    shapeChanged();
  };
  const editShape = (s: Shape, e: ShapeEdit) => {
    putShape(edited(s, e));
    shapeChanged();
  };
  const deleteShape = (id: string) => {
    k.setShapes((ss) => ss.filter((x) => x.id !== id));
    if (selShape === id) setSelShape(null);
    shapeChanged();
  };
  /** Put a variable on a shape (added to the drawing first when it is not on it): its instrument moves to the
   * shape's centre, and an instrument bubble's ISA code becomes its tag. */
  const matchVariable = (v: string, s: Shape) => {
    const c = centreOf(s);
    if (!g.vars.includes(v)) addVariable(v);
    else showVar(v);
    const code = s.role === "instrument" ? s.label.trim().split(/\s+/)[0].slice(0, 5).toUpperCase() : "";
    g.setPos((ps) => ({ ...ps, [v]: { tag: code || ps[v]?.tag || guessTag(v), x: c.x * W, y: c.y * frameH } }));
    select(null);
    setSelShape(s.id);
    change();
    return `put ${v} on ${s.id}${s.label ? ` (${s.label})` : ""}`;
  };

  // the assistant works the construct in fractions of the P&ID picture, as the shapes are stored and as move_instrument
  const toView = (y: number) => frac(y, 1);
  const fromView = (y: unknown) => Number(y);
  const shapeView = (s: Shape) => ({
    id: s.id,
    kind: s.kind,
    role: s.role,
    label: s.label,
    ...(s.props ? { props: s.props } : {}),
    ...(s.kind === "line"
      ? {
          points: (s.points ?? []).slice(0, 40).map(([x, y]) => [frac(x * W, W), toView(y)]),
          ...((s.points ?? []).length > 40 ? { points_total: s.points!.length } : {}),
        }
      : { x: frac((s.x ?? 0) * W, W), y: toView(s.y ?? 0), ...(s.kind === "text" ? {} : { w: frac((s.w ?? 0) * W, W), h: toView(s.h ?? 0) }) }),
  });
  const viewEdit = (a: Record<string, unknown>): ShapeEdit => ({
    ...(a.x !== undefined ? { x: Number(a.x) } : {}),
    ...(a.y !== undefined ? { y: fromView(a.y) } : {}),
    ...(a.w !== undefined ? { w: Number(a.w) } : {}),
    ...(a.h !== undefined ? { h: fromView(a.h) } : {}),
    ...(Array.isArray(a.points) ? { points: (a.points as number[][]).map(([x, y]) => [Number(x), fromView(y)] as [number, number]) } : {}),
    ...(a.label !== undefined ? { label: String(a.label) } : {}),
    ...(a.role !== undefined ? { role: String(a.role) as Shape["role"] } : {}),
    ...(a.props && typeof a.props === "object" ? { props: a.props as ShapeEdit["props"] } : {}),
  });
  const needConstruct = () => {
    if (!constructOn) throw new Error("The construct is drawn on the P&ID drawing: switch the diagram to it first");
  };
  return { shapeChanged, putShape, shapeOf, createShape, editShape, deleteShape, matchVariable, shapeView, viewEdit, needConstruct };
}
