/**
 * What the Structure page (PidPage) does to its variables, each logged in its Changes box by "you" or "AI": the names
 * shown (written at once, dataset.json), one made the same as another ("=": the one with data stays), added (no data:
 * drawn dashed), deleted (a prepared one with its column in silver; delivered data never), grouped as one (a mark in
 * the notes, no values computed), ungrouped, marked (kind, confidence), the selection hidden or deleted. Everything
 * but the names is unsaved until Save, like the layout.
 */
import type { MutableRefObject } from "react";
import { removePrepared, saveVariableNames } from "../../../api";
import { DATASET } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import type { Names } from "../../../lib/names";
import { GENERIC } from "./bindSetup";
import { clamp, R, snap, W } from "./geometry";
import { guessTag, spotForNewVar, type Pos } from "./layout";
import { mergedInto } from "./links";
import { GROUP_METHODS, middleOf, withNotes, type Change, type NoteEdit } from "./notes";
import type { usePidGraph } from "./usePidGraph";
import type { useView } from "./useView";
import type { VariableKind } from "./VariableInspector";

/** A list for a sentence: all of up to four, else the first three "and n more". */
export const listed = (vs: string[]) => (vs.length <= 4 ? vs.join(", ") : `${vs.slice(0, 3).join(", ")} and ${vs.length - 3} more`);

export interface VariableOpsContext {
  g: ReturnType<typeof usePidGraph>;
  pos: Pos;
  columns: string[];
  vars: string[];
  paper: boolean;
  frame: Parameters<typeof spotForNewVar>[4];
  frameH: number;
  view: ReturnType<typeof useView>;
  pickedSet: Set<string>;
  showVars: (next: Set<string>, place?: boolean) => void;
  multi: Set<string>;
  setMulti: (next: Set<string> | ((cur: Set<string>) => Set<string>)) => void;
  select: (v: string | null, link?: string | null) => void;
  change: () => void;
  logChange: (text: string, by: Change["by"]) => void;
  setStatus: (s: string | null) => void;
  setNames: (n: Names) => void;
  setAddingVar: (on: boolean) => void;
  kindOf: (v: string) => VariableKind;
  file: string | null;
  dragFrom: MutableRefObject<{ v: string; x: number; y: number } | null>;
}

export function useVariableOps(c: VariableOpsContext) {
  const { g, pos, columns, vars, paper, frame, frameH, view, pickedSet, showVars, multi, setMulti, select, change, logChange, setStatus, setNames, setAddingVar, kindOf, file, dragFrom } = c;
  // "=": the one with data stays (on the other's place, under its name when that is a generic one: dataset.json names,
  // so it is bound to it from now on), the other goes, its links and note passed on; both with data: combine them
  const sameRefusal = (a: string, b: string) =>
    columns.includes(a) && columns.includes(b) ? "Both have data of their own: combine them (mean, sum, ...) instead" : null;
  const makeSame = (v: string, onto: string) => {
    const keep = columns.includes(v) ? v : onto;
    const gone = keep === v ? onto : v;
    const from = dragFrom.current;
    const spot = gone === v && from?.v === v ? from : pos[gone];
    g.setLinks((ls) => mergedInto(ls, gone, keep));
    g.setPos((ps) => {
      const { [gone]: _, ...rest } = ps;
      return { ...rest, [keep]: { ...rest[keep], x: spot.x, y: spot.y } };
    });
    g.setVars((vs) => vs.filter((x) => x !== gone));
    g.setNotes((n) => {
      const { [gone]: moved, ...rest } = n;
      return moved && !rest[keep] ? { ...rest, [keep]: moved } : rest;
    });
    select(keep);
    change();
    logChange(`made ${keep} the same as ${gone}`, "you");
    if (GENERIC.has(gone) && columns.includes(keep)) void rename({ [keep]: gone }, "you").catch((e) => setStatus(errorMessage(e))); // written at once, like any name
    setStatus(`${keep} is ${gone} now: it takes its place and links. Save keeps the drawing.`);
  };
  /** New names shown ({variable: name}, "" its own name back): written at once (dataset.json, silver). */
  const rename = async (next: Names, by: Change["by"]) => {
    const r = await saveVariableNames(DATASET, next);
    setNames(r.names);
    const n = Object.keys(next).length;
    logChange(n === 1 ? `named ${Object.keys(next)[0]} "${next[Object.keys(next)[0]] || "(its own name)"}"` : `renamed ${n} variables`, by);
    setStatus(`Renamed ${n} variable${n === 1 ? "" : "s"} (the names shown; the data keeps its own names).`);
  };
  const addVariable = (name: string, by: Change["by"] = "you") => {
    const v = name.trim();
    if (!v || g.vars.includes(v)) return setStatus(v ? `${v} is already on the drawing.` : null);
    const spot = spotForNewVar(v, g.vars, pos, paper, frame);
    g.setVars((vs) => [...vs, v].sort());
    g.setPos((ps) => ({ ...ps, [v]: spot }));
    showVars(new Set([...pickedSet, v]));
    select(v);
    setAddingVar(false);
    change();
    logChange(`added ${v}${columns.includes(v) ? "" : " (no data)"}`, by);
    if (!columns.includes(v)) setStatus(`${v} is not in the data: it can be linked, but not trained or simulated.`);
  };

  /** Delete a variable that is not delivered data: off the drawing with its links (unsaved until Save); a prepared
   * one also loses its column in silver at once (the delivered data, bronze, is never touched). */
  const deleteVariable = async (v: string, by: Change["by"] = "you"): Promise<string> => {
    const kind = kindOf(v);
    if (kind === "delivered") throw new Error(`${v} is delivered data (bronze): it cannot be deleted and stays on the drawing`);
    if (kind === "prepared") await removePrepared(DATASET, v);
    g.setVars((vs) => vs.filter((x) => x !== v));
    g.setLinks((ls) => ls.filter((l) => l.from !== v && l.to !== v));
    g.setPos((ps) => Object.fromEntries(Object.entries(ps).filter(([k]) => k !== v)));
    select(null);
    change();
    const did = kind === "prepared" ? `Deleted ${v} and its column in silver.` : `Deleted ${v} from the drawing.`;
    logChange(kind === "prepared" ? `deleted ${v} (a prepared variable, its column too)` : `deleted ${v}`, by);
    setMulti((cur) => (cur.has(v) ? new Set([...cur].filter((x) => x !== v)) : cur));
    setStatus(`${did} Save to drop it from ${file ?? "the graph file"}.`);
    return `${did} Not saved in the graph file yet`;
  };
  /** Mark several variables as one (their mean, sum, min or max, e.g. one value per rack): only a mark in the notes,
   * unsaved until Save like the layout; no values are computed (the Dashboard's Prepare variables can do that later).
   * The group is a variable of its own, new (no data) or one already on the drawing without data, drawn in the middle of
   * its members (or at `at`, fractions of the picture); the members are hidden when `hide`. */
  const groupVars = (members: string[], name: string, method: string, hide: boolean, by: Change["by"], at?: { x: number; y: number }) => {
    members = [...new Set(members)];
    if (members.length < 2) throw new Error("A group needs at least two variables");
    const unknown = members.filter((m) => !g.vars.includes(m));
    if (unknown.length) throw new Error(`Not on this diagram: ${listed(unknown)}`);
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) throw new Error("The group's name: letters, digits and _, starting with a letter or _");
    if (members.includes(name)) throw new Error(`${name} cannot be a member of its own group`);
    if (columns.includes(name)) throw new Error(`${name} has data of its own: give the group another name`);
    if (!(GROUP_METHODS as readonly string[]).includes(method)) throw new Error(`method: one of ${GROUP_METHODS.join(", ")}`);
    const fresh = !g.vars.includes(name);
    const win = view.window;
    const placed = members.filter((m) => pickedSet.has(m));
    const spot = at ? { x: at.x * W, y: at.y * frameH } : (middleOf(placed, pos) ?? { x: win.x + win.w / 2, y: win.y + win.h / 2 });
    if (fresh) g.setVars((vs) => [...vs, name].sort());
    if (fresh || at || !pickedSet.has(name))
      g.setPos((ps) => ({
        ...ps,
        [name]: { tag: ps[name]?.tag ?? ps[members[0]]?.tag ?? guessTag(members[0]), x: snap(clamp(spot.x, R, W - R)), y: snap(clamp(spot.y, R, frameH - R)) },
      }));
    g.setNotes((n) => withNotes(n, [{ variable: name, group: { method: method as (typeof GROUP_METHODS)[number], members } }]));
    showVars(new Set([...[...pickedSet].filter((v) => !hide || !members.includes(v)), name]), false);
    setMulti(new Set());
    select(name);
    change();
    logChange(`grouped ${members.length} variables (${listed(members)}) as ${name}, their ${method}${hide ? "; members hidden" : ""}`, by);
    setStatus(`${name} now stands for the ${method} of ${members.length} variables (a mark, no values computed). Save keeps it.`);
    return `${fresh ? "made" : "used"} ${name} as the group (${method} of ${members.length}): a mark only, no values computed; not saved yet (save_draft or the user's Save)`;
  };
  /** Undo a group's mark (the group variable stays, its members are shown again). */
  const ungroup = (name: string, by: Change["by"]) => {
    const members = g.notes[name]?.group?.members;
    if (!members) throw new Error(`${name} is not a group`);
    g.setNotes((n) => withNotes(n, [{ variable: name, group: null }]));
    showVars(new Set([...pickedSet, ...members.filter((m) => vars.includes(m))]), false);
    change();
    logChange(`ungrouped ${name} (${members.length} members shown again)`, by);
    return `ungrouped ${name}: its ${members.length} members are shown again; ${name} stays on the drawing (delete_variable removes it)`;
  };
  /** Mark what variables are and how sure (unsaved until Save, like the layout). */
  const annotate = (edits: NoteEdit[], by: Change["by"]) => {
    const next = withNotes(g.notes, edits); // throws for a kind or confidence that does not exist
    g.setNotes(next);
    change();
    const what = [
      ...new Set(
        edits.map((e) =>
          [e.kind, e.confidence]
            .filter((x) => x !== undefined)
            .map((x) => x ?? "cleared")
            .join(", "),
        ),
      ),
    ].join("; ");
    logChange(`marked ${listed(edits.map((e) => e.variable))}${what ? `: ${what}` : ""}`, by);
  };
  const hideSelected = () => {
    showVars(new Set([...pickedSet].filter((v) => !multi.has(v))), false);
    setMulti(new Set());
  };
  const deleteSelected = async () => {
    const vs = [...multi];
    if (!window.confirm(`Delete ${vs.length} variables from the drawing? Delivered data cannot be deleted and stays.`)) return;
    const refused: string[] = [];
    for (const v of vs) await deleteVariable(v).catch(() => refused.push(v));
    setStatus(
      `Deleted ${vs.length - refused.length}.${refused.length ? ` ${listed(refused)}: delivered data, kept.` : ""} Save to drop them from the graph file.`,
    );
  };
  return { rename, sameRefusal, makeSame, addVariable, deleteVariable, groupVars, ungroup, annotate, hideSelected, deleteSelected };
}
