/**
 * The P&ID's views (PidPage): areas of the drawing with a picture of their own (views.ts), kept in site.json
 * `pid_views` and written at once, like the P&ID picture; each view's picture version (past the cache) and the construct
 * read from it. Marking an area makes a new one (named before it is stored); a view opens by zooming onto it. Read again
 * when the assistant changes a view (PAGE_CHANGED), or the names shown when it renames (`loadNames`).
 */
import { useEffect, useState } from "react";
import { fetchPidViewConstruct, fetchSite, pidViewImageUrl, removePidViewPicture, setPidViewPicture, updateSite, type StructureScope } from "../../../api";
import { DATASET } from "../../../dataset";
import { PAGE_CHANGED } from "../../../lib/live";
import { centreOf, type Shape } from "./construct";
import { W } from "./geometry";
import type { Pos } from "./layout";
import type { Change } from "./notes";
import type { useView } from "./useView";
import { areaOf, fromView as onPidOf, viewAt, viewId, type PidView } from "./views";

export interface PidViewsContext {
  scope: StructureScope;
  setStatus: (s: string | null) => void;
  logChange: (text: string, by: Change["by"]) => void;
  loadNames: () => Promise<void>;
  locked: boolean;
  view: ReturnType<typeof useView>;
  frameH: number;
  pos: Pos;
}

export function usePidViews({ scope, setStatus, logChange, loadNames, locked, view, frameH, pos }: PidViewsContext) {
  const [views, setViews] = useState<PidView[]>([]);
  const [pictures, setPictures] = useState<Record<string, number>>({}); // view id -> picture version
  const [viewShapes, setViewShapes] = useState<Record<string, Shape[]>>({}); // view id -> the construct read from its picture
  const [marking, setMarking] = useState(false); // the next drag marks an area as a new view
  const [newArea, setNewArea] = useState<Omit<PidView, "id" | "name"> | null>(null); // marked, waiting for its name
  /** The views from site.json, and which have a picture (`v`: a new version of the pictures, past the cache). */
  const loadViews = (v = 0) =>
    fetchSite(DATASET, scope)
      .then((s) => {
        const vs = s.pid_views ?? [];
        setViews(vs);
        setPictures({});
        setViewShapes({});
        for (const x of vs) {
          const im = new Image();
          im.onload = () => setPictures((ps) => ({ ...ps, [x.id]: v }));
          im.src = pidViewImageUrl(DATASET, x.id, v, scope);
          fetchPidViewConstruct(DATASET, x.id, scope)
            .then((c) => c.shapes.length && setViewShapes((ss) => ({ ...ss, [x.id]: c.shapes })))
            .catch(() => {}); // none: the picture alone
        }
      })
      .catch(() => {}); // no site.json: no views
  useEffect(() => {
    loadViews();
    // the assistant changed a view (a picture, a construct) or the names shown: read them again, unsaved work stays
    const changed = (e: Event) => ((e as CustomEvent<string>).detail.includes("/names") ? loadNames() : loadViews(Date.now()));
    window.addEventListener(PAGE_CHANGED, changed);
    return () => window.removeEventListener(PAGE_CHANGED, changed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, []);
  const viewOf = (id: unknown) => {
    const v = views.find((x) => x.id === String(id));
    if (!v) throw new Error(`There is no view ${String(id)}. Views: ${views.map((x) => x.id).join(", ") || "none"}`);
    return v;
  };
  const storeViews = async (next: PidView[]) => {
    await updateSite(DATASET, (s) => ({ ...s, pid_views: next }), scope);
    setViews(next);
  };
  const markArea = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    setMarking(false);
    const area = areaOf(a, b, W, frameH);
    if (!area) return setStatus("That area is too small for a view: drag a bigger box");
    setNewArea(area);
  };
  const addView = async (name: string, area: Omit<PidView, "id" | "name">, by: Change["by"]) => {
    name = name.trim();
    if (!name || name.length > 80) throw new Error("A view needs a name of 1 to 80 characters");
    const v = {
      id: viewId(
        name,
        views.map((x) => x.id),
      ),
      name,
      ...area,
    };
    await storeViews([...views, v]);
    logChange(`made the view ${name}`, by);
    return v;
  };
  /** A drawing as the view's picture; the area takes the picture's shape (in site.json, done by the backend). */
  const setViewPicture = async (id: string, file: Blob, by: Change["by"]) => {
    const v = viewOf(id);
    const r = await setPidViewPicture(DATASET, v.id, file, scope);
    await loadViews(Date.now());
    logChange(`gave the view ${v.name} a picture${r.shapes ? ` and read its construct (${r.shapes} shapes)` : " (no construct)"}`, by);
    setStatus(
      r.shapes
        ? `${v.name}: picture saved, and its construct read from it (${r.shapes} shapes). Open the view to see it.`
        : `${v.name}: picture saved, but no construct could be read: a PNG or a scanned PDF has no lines or texts. Use the drawing as a PDF, SVG or DEXPI file.`,
    );
  };
  const removeView = async (id: string, by: Change["by"]) => {
    const v = viewOf(id);
    await removePidViewPicture(DATASET, v.id, scope);
    await storeViews(views.filter((x) => x.id !== v.id));
    logChange(`removed the view ${v.name} (its variables stay where they are)`, by);
  };
  const openView = (id: unknown) => {
    const v = viewOf(id);
    if (locked) throw new Error("The drawing is locked (the user's Lock): ask the user to unlock it, or click Locked to unlock");
    view.show({ x: v.x * W, y: v.y * frameH, w: v.w * W, h: v.h * frameH });
    return v;
  };
  /** A component or instrument of a view's construct by its name (its label: "TT1", "valve 3"; case and spaces do
   * not matter; a text of the drawing too): its spot as fractions of the P&ID, and an instrument's ISA letters. */
  const componentOf = (viewId: unknown, name: unknown) => {
    const v = viewOf(viewId);
    const norm = (t: string) => t.toLowerCase().replace(/\s+/g, "");
    const shapes = viewShapes[v.id] ?? [];
    const named = shapes.filter((s) => s.label && norm(s.label) === norm(String(name)));
    const s = named.find((x) => x.role === "component" || x.role === "instrument") ?? named[0];
    if (!s) {
      const known = [...new Set(shapes.filter((x) => x.role === "component" || x.role === "instrument").map((x) => x.label))];
      throw new Error(
        `The view ${v.name} has no component ${String(name)}. ${known.length ? `Its components: ${known.slice(0, 40).join(", ")}` : "Its picture has no construct (a PNG): give x and y instead"}`,
      );
    }
    const c = centreOf(s);
    return { ...onPidOf(v, c.x, c.y), tag: s.role === "instrument" ? (s.label.match(/^[A-Z]{1,4}/)?.[0] ?? null) : null };
  };
  const viewHolding = (v: string) => (pos[v] ? viewAt(views, pos[v].x / W, pos[v].y / frameH) : null);
  return { views, pictures, viewShapes, marking, setMarking, newArea, setNewArea, viewOf, storeViews, markArea, addView, setViewPicture, removeView, openView, componentOf, viewHolding };
}
