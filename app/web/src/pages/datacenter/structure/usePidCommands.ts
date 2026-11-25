/**
 * What the assistant can do on the Structure page (PidPage), beyond click and fill (lib/live.ts useCommand): the
 * views (open, add, edit, close, remove), the draft (keep, discard), the variables (select, click, move, place many,
 * add, delete, select several, group, ungroup, mark), the links (set many, select), the layers, and the construct's
 * shapes (add, edit, delete, select, put a variable on one). Positions are fractions of the P&ID picture, as
 * ui_snapshot's grid shows them. Each command does what the page's own controls do (usePidViews, useVariableOps,
 * useConstructEdits); a locked drawing refuses every move.
 */
import type { Dispatch, SetStateAction } from "react";
import type { ShapeKind } from "../../../api";
import { useCommand } from "../../../lib/live";
import type { Layers } from "./ConstructBar";
import { drawn, edited } from "./construct";
import { clamp, R, snap, W } from "./geometry";
import { guessTag, type Pos } from "./layout";
import { keyOf, type Link } from "./links";
import type { Change, NoteEdit } from "./notes";
import type { useConstruct } from "./useConstruct";
import type { useConstructEdits } from "./useConstructEdits";
import type { usePidGraph } from "./usePidGraph";
import type { usePidViews } from "./usePidViews";
import { listed, type useVariableOps } from "./useVariableOps";
import type { useView } from "./useView";
import { groupName } from "./notes";
import { fromView as onPidOf, SHOW_AS, toView as inViewOf, type PidView, type ShowAs, type ViewsAs } from "./views";

export interface PidCommandsContext {
  views: ReturnType<typeof usePidViews>;
  ops: ReturnType<typeof useVariableOps>;
  construct: ReturnType<typeof useConstructEdits>;
  g: ReturnType<typeof usePidGraph>;
  k: ReturnType<typeof useConstruct>;
  vars: string[];
  links: Link[];
  crossLinks: Link[];
  pos: Pos;
  pull: number;
  layers: Layers;
  setLayers: Dispatch<SetStateAction<Layers>>;
  viewsAs: ViewsAs;
  setViewsAs: Dispatch<SetStateAction<ViewsAs>>;
  locked: boolean;
  view: ReturnType<typeof useView>;
  frameH: number;
  viewH: number;
  linking: boolean;
  pending: string | null;
  selVar: string | null;
  select: (v: string | null, link?: string | null) => void;
  toggleVar: (v: string) => void;
  linkStep: (v: string) => void;
  change: () => void;
  logChange: (text: string, by: Change["by"]) => void;
  edit: (f: (ls: Link[]) => Link[]) => void;
  showVar: (v: string) => void;
  showVars: (next: Set<string>, place?: boolean) => void;
  pickedSet: Set<string>;
  setMulti: Dispatch<SetStateAction<Set<string>>>;
  setSelShape: (id: string | null) => void;
  keepDraft: () => boolean;
  discard: () => void;
  file: string | null;
  columns: string[];
  frac: (n: number, of: number) => number;
}

export function usePidCommands(c: PidCommandsContext) {
  const { viewOf, openView, addView, storeViews, removeView, componentOf, views } = c.views;
  const { addVariable, deleteVariable, groupVars, ungroup, annotate } = c.ops;
  const { shapeOf, createShape, editShape, deleteShape, matchVariable, viewEdit, needConstruct } = c.construct;
  const { g, k, vars, links, crossLinks, pos, pull, layers, setLayers, viewsAs, setViewsAs, locked, view, frameH, viewH, linking, pending, selVar } = c;
  const { select, toggleVar, linkStep, change, logChange, edit, showVar, showVars, pickedSet, setMulti, setSelShape, keepDraft, discard, file, columns, frac } = c;
  useCommand("open_view", (args) => `zoomed onto the view ${openView(args.view).name}`);
  const showArg = (x: unknown): ShowAs => {
    if (!(SHOW_AS as readonly unknown[]).includes(x)) throw new Error(`show: one of ${SHOW_AS.join(", ")}`);
    return x as ShowAs;
  };
  const checkArea = (x: number, y: number, w: number, h: number) => {
    if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001)
      throw new Error("x, y, w, h: the area as fractions of the P&ID (0..1, x + w and y + h at most 1)");
  };
  useCommand("add_view", async (args) => {
    const [x, y, w, h] = [args.x, args.y, args.w, args.h].map(Number);
    checkArea(x, y, w, h);
    const v = await addView(String(args.name ?? ""), { x, y, w, h, ...(args.show === undefined ? {} : { show: showArg(args.show) }) }, "AI");
    return `made the view ${v.name} (id ${v.id}), written to site.json; its picture: the tool use_as_view_picture {view_id: "${v.id}", file_path} (or the user's Picture…)`;
  });
  /** Rename, move or resize a view (written at once). What lies in it moves with it: its variables (unsaved, like any
   * move) and the views inside it. Only w (or only h) given: the other follows, so the picture keeps its shape. */
  useCommand("edit_view", async (args) => {
    const v = viewOf(args.view);
    const name = args.name === undefined ? v.name : String(args.name).trim();
    if (!name || name.length > 80) throw new Error("A view needs a name of 1 to 80 characters");
    const num = (k: "x" | "y" | "w" | "h") => (args[k] === undefined ? undefined : Number(args[k]));
    const [w0, h0] = [num("w"), num("h")];
    const w = w0 ?? (h0 !== undefined ? (h0 * v.w) / v.h : v.w);
    const h = h0 ?? (w0 !== undefined ? (w0 * v.h) / v.w : v.h);
    const r6 = (n: number) => Math.round(n * 1e6) / 1e6; // as the backend keeps them
    const next = {
      ...v,
      name,
      x: r6(num("x") ?? v.x),
      y: r6(num("y") ?? v.y),
      w: r6(w),
      h: r6(h),
      ...(args.show === undefined ? {} : { show: showArg(args.show) }),
    };
    checkArea(next.x, next.y, next.w, next.h);
    const inside = (x: number, y: number) => x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h;
    const carried = (x: number, y: number) => {
      const q = inViewOf(v, x, y);
      return onPidOf(next, q.x, q.y);
    };
    const moves = next.x !== v.x || next.y !== v.y || next.w !== v.w || next.h !== v.h;
    const riders = moves ? vars.filter((u) => pos[u] && inside(pos[u].x / W, pos[u].y / frameH)) : [];
    if (riders.length) {
      notLocked();
      g.setPos((ps) => ({
        ...ps,
        ...Object.fromEntries(
          riders.map((u) => {
            const p = carried(ps[u].x / W, ps[u].y / frameH);
            return [u, { ...ps[u], x: p.x * W, y: p.y * frameH }];
          }),
        ),
      }));
      change();
    }
    const nested = (o: PidView) => o.id !== v.id && moves && inside(o.x, o.y) && inside(o.x + o.w, o.y + o.h);
    await storeViews(
      views.map((o) => {
        if (o.id === v.id) return next;
        if (!nested(o)) return o;
        const [a, b] = [carried(o.x, o.y), carried(o.x + o.w, o.y + o.h)];
        return { ...o, x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      }),
    );
    logChange(`changed the view ${name}${riders.length ? ` (${riders.length} variables moved with it)` : ""}`, "AI");
    return `changed the view ${name}, written to site.json${riders.length ? `; ${riders.length} variables in it moved with it (not saved yet)` : ""}`;
  });
  useCommand("close_view", () => {
    if (locked) throw new Error("The drawing is locked (the user's Lock): ask the user to unlock it, or click Locked to unlock");
    view.fit();
    return "showing the whole P&ID";
  });
  useCommand("remove_view", async (args) => {
    const v = viewOf(args.view);
    await removeView(v.id, "AI");
    return `removed the view ${v.name}; its picture is backed up, its variables stay where they are`;
  });
  /** Drawing units of a spot given as fractions of the P&ID picture, snapped and kept on the canvas. */
  const spotAt = (fx: unknown, fy: unknown) => ({ x: snap(clamp(Number(fx) * W, R, W - R)), y: snap(clamp(Number(fy) * frameH, R, viewH - R)) });
  const known = (v: unknown) => {
    const name = String(v);
    if (!vars.includes(name))
      throw new Error(`${name} is not on this diagram. On it: ${vars.length > 40 ? `${vars.length} variables (ui_state lists them)` : vars.join(", ")}`);
    showVar(name); // what the assistant works on is drawn, as when the user ticks it in the Variables menu
    return name;
  };
  useCommand("save_draft", () => {
    if (!g.dirty) return "nothing unsaved: no draft needed";
    if (!keepDraft()) throw new Error("The browser would not store the draft (private mode or storage full)");
    return `kept the draft of ${file} in the browser (the graph file is not written: Save does that)`;
  });
  useCommand("discard_draft", () => {
    if (!g.dirty && g.draftAt === null) return "nothing to discard";
    discard();
    return `discarded the unsaved changes and the draft of ${file}`;
  });
  useCommand("select_variable", (args) => {
    const v = known(args.variable);
    select(v);
    return `selected ${v}`;
  });
  useCommand("click_instrument", (args) => {
    const v = known(args.variable);
    if (linking) {
      const from = pending;
      linkStep(v);
      return from ? `linked ${from} -> ${v}` : `picked ${v} as the link's source: click_instrument the target next`;
    }
    toggleVar(v);
    return selVar === v ? `deselected ${v}` : `selected ${v}`;
  });
  const notLocked = () => {
    if (locked) throw new Error("The drawing is locked (the user's Lock): ask the user to unlock it, or click Locked to unlock");
  };
  useCommand("move_instrument", (args) => {
    notLocked();
    const v = known(args.variable);
    if (pull > 0) throw new Error("Set the fade slider to 0 first: instruments move only on the drawing, not on the circle");
    // in a view: on a component of its construct, or x, y of its own picture
    const q =
      args.component !== undefined
        ? componentOf(args.view, args.component)
        : args.view === undefined
          ? { x: args.x, y: args.y, tag: null }
          : { ...onPidOf(viewOf(args.view), Number(args.x), Number(args.y)), tag: null };
    const { x, y } = spotAt(q.x, q.y);
    g.setPos((ps) => ({ ...ps, [v]: { ...ps[v], x, y, ...(q.tag ? { tag: q.tag } : {}) } }));
    change();
    logChange(`moved ${v}`, "AI");
    return `moved ${v} to x=${frac(x, W)}, y=${frac(y, frameH)} (not saved yet)`;
  });
  /** Many instruments in one call: [{variable, x, y}, ...], all checked before any moves. */
  useCommand("place_instruments", (args) => {
    notLocked();
    if (pull > 0) throw new Error("Set the fade slider to 0 first: instruments move only on the drawing, not on the circle");
    const list = Array.isArray(args.placements) ? (args.placements as Record<string, unknown>[]) : [];
    if (!list.length) throw new Error("placements: a list of {variable, x, y} (fractions of the P&ID picture)");
    const unknown = list.map((p) => String(p.variable)).filter((v) => !vars.includes(v));
    if (unknown.length)
      throw new Error(
        `Not on this diagram (nothing moved): ${unknown.slice(0, 20).join(", ")}${unknown.length > 20 ? ` and ${unknown.length - 20} more` : ""}`,
      );
    const bad = list.filter((p) => p.component === undefined && (!Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))));
    if (bad.length)
      throw new Error(
        `x and y must be numbers (nothing moved): ${bad
          .slice(0, 20)
          .map((p) => String(p.variable))
          .join(", ")}`,
      );
    // in a view: on a component of its construct by name, or x, y of the view's own picture
    const at = Object.fromEntries(
      list.map((p) => {
        const q =
          p.component !== undefined
            ? componentOf(p.view, p.component)
            : p.view === undefined
              ? { x: p.x, y: p.y, tag: null }
              : { ...onPidOf(viewOf(p.view), Number(p.x), Number(p.y)), tag: null };
        return [String(p.variable), { ...spotAt(q.x, q.y), ...(q.tag ? { tag: q.tag } : {}) }];
      }),
    );
    const named = Object.keys(at);
    showVars(new Set([...pickedSet, ...named]), false);
    g.setPos((ps) => ({ ...ps, ...Object.fromEntries(named.map((v) => [v, { ...(ps[v] ?? { tag: guessTag(v) }), ...at[v] }])) }));
    change();
    logChange(`placed ${named.length} variables: ${listed(named)}`, "AI");
    return `placed ${named.length} instruments (not saved yet)`;
  });
  /** Many links in one call: [{from, to, lags?}, ...] adds each (lags: steps back, default [1]) or sets its lags;
   * lags [] removes it; from = to is the variable's own past. All checked before any changes. */
  useCommand("set_links", (args) => {
    const list = Array.isArray(args.links) ? (args.links as Record<string, unknown>[]) : [];
    if (!list.length) throw new Error("links: a list of {from, to, lags?} (lags: steps back, default [1]; [] removes the link)");
    const unknown = [...new Set(list.flatMap((l) => [String(l.from), String(l.to)]).filter((v) => !vars.includes(v)))];
    if (unknown.length)
      throw new Error(
        `Not on this diagram (nothing changed): ${unknown.slice(0, 20).join(", ")}${unknown.length > 20 ? ` and ${unknown.length - 20} more` : ""}`,
      );
    const lagsOf = (l: Record<string, unknown>) => (l.lags === undefined ? [1] : l.lags);
    const bad = list.filter((l) => !Array.isArray(lagsOf(l)) || !(lagsOf(l) as unknown[]).every((x) => Number.isInteger(x) && (x as number) >= 1));
    if (bad.length)
      throw new Error(
        `lags: whole steps back, at least 1 (nothing changed): ${bad
          .slice(0, 20)
          .map((l) => keyOf({ from: String(l.from), to: String(l.to) }))
          .join(", ")}`,
      );
    const removed = list.filter((l) => !(lagsOf(l) as number[]).length).length;
    edit((ls) =>
      list.reduce((acc, l) => {
        const [from, to] = [String(l.from), String(l.to)];
        const lags = [...new Set(lagsOf(l) as number[])].sort((a, b) => a - b);
        const rest = acc.filter((x) => keyOf(x) !== keyOf({ from, to }));
        return lags.length ? [...rest, { from, to, lags }] : rest;
      }, ls),
    );
    logChange(`set ${list.length - removed} links, removed ${removed}`, "AI");
    return `set ${list.length - removed} links, removed ${removed} (not saved yet)`;
  });
  useCommand("select_link", (args) => {
    const key = keyOf({ from: String(args.from), to: String(args.to) });
    if (!links.some((l) => keyOf(l) === key)) throw new Error(`There is no link ${key}. Links: ${crossLinks.map(keyOf).join(", ")}`);
    select(null, key);
    return `selected the link ${key}`;
  });
  useCommand("add_variable", (args) => {
    const v = String(args.variable ?? "").trim();
    if (!v) throw new Error("Give the variable a name");
    if (g.vars.includes(v)) throw new Error(`${v} is already on the drawing`);
    addVariable(v, "AI");
    return `added ${v}${columns.includes(v) ? "" : ': not in the data, drawn dashed as "no data"'} (not saved yet: Save writes it to the graph file)`;
  });
  useCommand("delete_variable", (args) => deleteVariable(known(args.variable), "AI"));
  useCommand("select_variables", (args) => {
    const vs = (args.variables as unknown[]).map(String);
    const unknown = vs.filter((v) => !vars.includes(v));
    if (unknown.length) throw new Error(`Not on this diagram: ${listed(unknown)}`);
    showVars(new Set([...pickedSet, ...vs]));
    setMulti(new Set(vs));
    return vs.length ? `selected ${vs.length} variables: the user sees them marked, with what can be done to them` : "cleared the selection";
  });
  useCommand("group_variables", (args) => {
    const members = (args.variables as unknown[]).map(String);
    const method = String(args.method ?? "mean");
    const name = args.name ? String(args.name) : groupName(members, method, g.vars);
    const at = args.x !== undefined && args.y !== undefined ? { x: Number(args.x), y: Number(args.y) } : undefined;
    return groupVars(members, name, method, args.hide_members !== false, "AI", at);
  });
  useCommand("ungroup_variable", (args) => ungroup(known(args.variable), "AI"));
  useCommand("annotate_variables", (args) => {
    const list = args.annotations as NoteEdit[];
    const unknown = list.map((a) => String(a.variable)).filter((v) => !vars.includes(v));
    if (unknown.length) throw new Error(`Not on this diagram (nothing marked): ${listed(unknown)}`);
    annotate(list, "AI");
    return `marked ${list.length} variables (not saved yet)`;
  });
  useCommand("set_layers", (args) => {
    const next = { ...layers };
    for (const key of ["picture", "construct", "variables"] as const) if (args[key] !== undefined) next[key] = Boolean(args[key]);
    if (args.views !== undefined && args.views !== "own") showArg(args.views);
    const all = (args.views as ViewsAs | undefined) ?? viewsAs;
    setLayers(next);
    setViewsAs(all);
    return `layers: ${Object.entries(next)
      .map(([key, on]) => `${key} ${on ? "shown" : "hidden"}`)
      .join(", ")}; views: ${all === "own" ? "each at its own level" : `all as ${all}`}`;
  });
  useCommand("add_shape", (args) => {
    needConstruct();
    const kind = String(args.kind) as ShapeKind;
    if (!["rect", "circle", "line", "text"].includes(kind)) throw new Error("kind is rect, circle, line or text");
    const e = viewEdit(args);
    const pts = e.points ?? [];
    if (kind === "line" && pts.length < 2) throw new Error("A line needs points: [[x, y], [x, y], ...]");
    if (kind !== "line" && (e.x === undefined || e.y === undefined)) throw new Error("Give x and y (0..1 of the drawing)");
    const at = kind === "line" ? { x: pts[0][0], y: pts[0][1] } : { x: e.x!, y: e.y! };
    const s = edited(drawn(kind, at, at, k.shapes, e.label), e);
    createShape(s);
    return `added ${s.id} (not saved yet)`;
  });
  useCommand("edit_shape", (args) => {
    const s = shapeOf(args.shape);
    editShape(s, viewEdit(args));
    return `changed ${s.id} (not saved yet)`;
  });
  useCommand("delete_shape", (args) => {
    const s = shapeOf(args.shape);
    deleteShape(s.id);
    return `deleted ${s.id} (not saved yet)`;
  });
  useCommand("select_shape", (args) => {
    const s = shapeOf(args.shape);
    select(null);
    setSelShape(s.id);
    return `selected ${s.id}`;
  });
  useCommand("match_variable", (args) => {
    const v = String(args.variable ?? "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(v)) throw new Error("variable: letters, digits and _, starting with a letter");
    return matchVariable(v, shapeOf(args.shape));
  });
}
