/**
 * The graph being edited on the Physical structure page: variables, links, strengths, instrument positions,
 * variable -> component assignment and heat-exchanger choice, loaded from a graph file plus site.json.
 *
 * It reloads when the file changes, or once the diagram is first known, but NOT when the diagram is switched:
 * switching keeps the unsaved graph, and `stash` keeps the unsaved positions of the diagram not shown. A draft kept
 * in this browser (draft.ts) replaces what was loaded, unsaved; `reload` reads the files again (after Discard).
 */
import { useEffect, useRef, useState } from "react";
import { fetchCausalGraph, fetchSite, type CausalLinkStrength, type StructureScope } from "../../../api";
import { DATASET } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import { clearDraft, loadDraft, storeKey, versionOf } from "./draft";
import type { Notes } from "./notes";
import { assignmentsFromLayout, layoutFor, type Diagram, type Frame, type Pos } from "./layout";
import { linksFromTargets, withDataColumns, type Link } from "./links";

export type Hex = "condenser" | "hall" | "liquid"; // the extraction points of dataset.json heat_source the drawing knows

const NONE = { starter: [], starterLinks: [], starterNotes: {} };

/** What a structure's browser keys are tied to (PidPage too): its starting variables, links and spots; none for the data center's. */
export const starterOf = (s: { starter: string[]; starterLinks: Link[]; defaults?: Pos }) =>
  s.starter.length ? [s.starter, s.starterLinks, s.defaults ?? {}] : undefined;

/** `columns`: the data columns, all drawn as instruments (they are known when the diagram is, from the same request).
 * `scope`: whose structure (PidPage). */
export function usePidGraph(
  scope: StructureScope,
  file: string | null,
  diagram: Diagram | null,
  frame: Frame,
  columns: string[],
  onLoaded: () => void,
  onError: (message: string) => void,
  starter: { starter: string[]; starterLinks: Link[]; starterNotes: Notes; defaults?: Pos } = NONE, // what a new structure starts with, while its graph file is empty
) {
  const [vars, setVars] = useState<string[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [strengths, setStrengths] = useState<CausalLinkStrength[]>([]);
  const [pos, setPos] = useState<Pos>({});
  const [siteLayout, setSiteLayout] = useState<Pos>({}); // pid_layout as last loaded or saved
  const [assign, setAssign] = useState<Record<string, string>>({}); // variable -> plant component id
  const [hex, setHex] = useState<Hex>("condenser");
  const [notes, setNotes] = useState<Notes>({}); // what each variable is and how sure (site.json pid_notes)
  const [noEvidence, setNoEvidence] = useState<Set<string>>(new Set()); // links lag discovery found nothing for
  const [dirty, setDirty] = useState(false);
  const stash = useRef<Partial<Record<Diagram, Pos>>>({}); // unsaved positions of the other diagram
  const [loaded, setLoaded] = useState<string | null>(null); // the graph file the state above belongs to
  const [draftAt, setDraftAt] = useState<number | null>(null); // when the draft restored or last kept was written
  const [restored, setRestored] = useState(false); // the state came from a draft, not from the files
  const [version, setVersion] = useState(0);
  const [base, setBase] = useState<string>(); // versionOf the graph file's links as loaded (Draft.base)

  useEffect(() => {
    if (!file || !diagram) return;
    let live = true; // a late answer for a file no longer selected must not land in (and then be saved to) the new one
    Promise.all([fetchCausalGraph(DATASET, file, scope), fetchSite(DATASET, scope)])
      .then(([g, site]) => {
        if (!live) return;
        const fresh = !Object.keys(g.targets).length; // nothing saved yet: the starting graph
        const { vars: graphVars, links: graphLinks } = linksFromTargets(g.targets);
        const ls = fresh ? starter.starterLinks : graphLinks;
        const vs = withDataColumns(fresh ? starter.starter : graphVars, columns);
        const saved = site.pid_layout ?? {};
        const key = storeKey(DATASET, scope, starterOf(starter));
        const fileBase = versionOf(g.targets);
        const kept = loadDraft(key, file, frame.trayTop);
        // a draft made on another version of the file (it was saved or regenerated since), or before drafts said which
        // (no base): the file wins, not old edits
        const d = kept && kept.base !== fileBase ? null : kept;
        if (kept && !d) clearDraft(key, file);
        setBase(fileBase);
        const dvs = d ? withDataColumns(d.vars, columns) : vs;
        stash.current = d ? Object.fromEntries(Object.entries(d.positions).filter(([k]) => k !== diagram)) : {};
        setSiteLayout(saved);
        setAssign(d ? d.assign : assignmentsFromLayout(saved));
        setVars(dvs);
        setLinks(d ? d.links : ls);
        setStrengths(d ? d.strengths : (g.link_strengths ?? []));
        // a variable the draft has no spot for (a new data column) gets its own, as without a draft
        setPos({ ...layoutFor(diagram, dvs, saved, frame), ...d?.positions[diagram] });
        setDirty(d !== null || (fresh && starter.starter.length > 0)); // a new structure's starting graph is not saved yet
        setNoEvidence(new Set());
        setHex(d ? d.hex : (site.hex_option ?? "condenser"));
        const notes = site.pid_notes ?? {};
        setNotes(d?.notes ?? (fresh && !Object.keys(notes).length ? starter.starterNotes : notes));
        setDraftAt(d?.at ?? null);
        setRestored(d !== null);
        setLoaded(file);
        onLoaded();
      })
      .catch((e) => live && onError(errorMessage(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on a new file; switching diagrams keeps the graph
  }, [file, diagram === null, version]);

  return {
    vars,
    setVars,
    links,
    setLinks,
    strengths,
    setStrengths,
    pos,
    setPos,
    siteLayout,
    setSiteLayout,
    assign,
    setAssign,
    hex,
    setHex,
    notes,
    setNotes,
    noEvidence,
    setNoEvidence,
    dirty,
    setDirty,
    stash,
    loaded,
    draftAt,
    setDraftAt,
    base,
    // after a Save: the file as written is what the next draft is made on
    rebase: (name: string) => void fetchCausalGraph(DATASET, name, scope).then((r) => setBase(versionOf(r.targets)), () => setBase(undefined)),
    restored,
    setRestored,
    reload: () => setVersion((n) => n + 1),
  };
}
