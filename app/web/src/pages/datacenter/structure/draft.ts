/**
 * The unsaved work of the Physical structure page, kept in this browser per data center and graph file so that a
 * reload or a crash loses at most a moment of it: variables (with those added by "+ Variable"), links and lags,
 * strengths, instrument positions of both diagrams, component assignment, heat-recovery choice and the variables'
 * kinds and confidences (notes.ts). Only Save (to the graph file) or Discard clears it. The view (fade slider, layers, lock) is remembered apart, draft or not.
 * Which variables are shown, and their size, have their own keys (shown.ts).
 */
import type { CausalLinkStrength, StructureScope } from "../../../api";
import type { Layers } from "./ConstructBar";
import type { Diagram, Pos } from "./layout";
import type { Link } from "./links";
import type { Notes } from "./notes";
import type { Hex } from "./usePidGraph";
import type { ViewsAs } from "./views";

export interface Draft {
  at: number; // when it was written (ms since 1970)
  trayTop: number; // the P&ID image height it was made on: a draft for another picture is not restored
  diagram: Diagram; // the diagram on screen; `positions` holds both
  positions: Partial<Record<Diagram, Pos>>;
  vars: string[];
  links: Link[];
  strengths: CausalLinkStrength[];
  assign: Record<string, string>;
  hex: Hex;
  notes?: Notes; // kinds and confidences marked (an older draft has none)
  base?: string; // versionOf the graph file's links it was made on: a draft of a file changed since is not restored
}

export interface ViewPrefs {
  slider: number;
  layers: Layers;
  locked: boolean;
  viewsAs?: ViewsAs; // the layer bar's level for every view of the P&ID (older prefs: each its own)
}

/** A stored draft read back: null when missing, unreadable, or made on another picture. */
export function parseDraft(raw: string | null, trayTop: number): Draft | null {
  try {
    const d = raw ? (JSON.parse(raw) as Draft) : null;
    if (!d || !Array.isArray(d.vars) || !Array.isArray(d.links) || typeof d.positions !== "object" || d.trayTop !== trayTop) return null;
    return { ...d, strengths: Array.isArray(d.strengths) ? d.strengths : [], assign: d.assign ?? {} };
  } catch {
    return null;
  }
}

/** Stored view prefs read back, or null. */
export function parseView(raw: string | null): ViewPrefs | null {
  try {
    const v = raw ? (JSON.parse(raw) as ViewPrefs) : null;
    return v && typeof v.slider === "number" && typeof v.layers === "object" && typeof v.locked === "boolean" ? v : null;
  } catch {
    return null;
  }
}

/** Where the browser keeps a structure's view, draft, shown variables and log: the data center's own under its id
 * (as always), another structure (the heat distribution's) apart from it. */
export const storeKey = (dataset: string, scope: StructureScope = "dc", starter?: unknown) =>
  scope === "dc" ? dataset : `${dataset}~${scope}${starter === undefined ? "" : `@${versionOf(starter)}`}`;

/** A short fingerprint of another structure's starting layout (variables, links, spots): when an update changes it,
 * the view and the draft kept for the old one are not brought back over the new drawing. */
export function versionOf(x: unknown): string {
  let h = 0;
  for (const c of JSON.stringify(x)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}
const draftKey = (dataset: string, file: string) => `pid-draft:${dataset}:${file}`;
const viewKey = (dataset: string) => `pid-view:${dataset}`;

// localStorage may be off (private mode) or full: then nothing is kept, and the page works as before
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export const loadDraft = (dataset: string, file: string, trayTop: number) => parseDraft(read(draftKey(dataset, file)), trayTop);
/** Keep the draft; false when the browser would not store it. */
export const saveDraft = (dataset: string, file: string, d: Draft) => write(draftKey(dataset, file), JSON.stringify(d));
export const clearDraft = (dataset: string, file: string) => write(draftKey(dataset, file), null);
export const loadView = (dataset: string) => parseView(read(viewKey(dataset)));
export const saveView = (dataset: string, v: ViewPrefs) => write(viewKey(dataset), JSON.stringify(v));
