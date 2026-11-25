/**
 * Working live with an assistant (MCP): what a change event means for the open page, the commands pages carry out,
 * and the screen state the page reports. The App shell listens (app/App.tsx); pages only register what they can do
 * (useCommand) and what they know beyond their picture (useSnapshotDetail, useReportPage, useUnsaved).
 */
import { createContext, useContext, useEffect, useRef } from "react";
import { CLIENT_ID, reportUi, type LiveEvent, type UiReport } from "../api";

/** What someone else's change means for the open page: start over ("reload": another data folder), re-read the
 * page ("refresh": this data center, or the shared components), or nothing (null: own save, other data center). */
export function effectOf(e: LiveEvent, dataset: string): "reload" | "refresh" | null {
  if (e.type !== "changed" || e.client === CLIENT_ID) return null;
  if (e.path.startsWith("/api/data-versions")) return "reload";
  if (e.path.startsWith(`/api/datasets/${dataset}/`) || e.path === "/api/datasets/refresh" || e.path.startsWith("/api/components")) return "refresh";
  return null;
}

/** Sent on window (detail: the path written) when someone else changed a P&ID view or the names shown: the Physical
 * structure page reads them again itself (without a remount, so unsaved edits stay). */
export const PAGE_CHANGED = "page-data-changed";
/** An agent connected or disconnected (Connect AI): the window event the shell sends, `detail` true when connected. */
export const AGENT_CHANGED = "agent-connection";
export const isPageChange = (e: LiveEvent) => e.type === "changed" && e.client !== CLIENT_ID && (e.path.includes("/pid/views/") || e.path.endsWith("/names"));

/** A page's gesture for the assistant: returns what it did (in words), or throws the reason it cannot. */
type Handler = (args: Record<string, unknown>) => unknown;
// per action, every part on screen that offers it, the last mounted first in line (it hands over when it leaves)
const handlers = new Map<string, Handler[]>();
const PENDING_MS = 10_000;
type Waiting = { action: string; args: Record<string, unknown>; done: (r: unknown) => void; fail: (e: Error) => void };
let waiting: Waiting | null = null;

/** Run a gesture on the page that can do it. One for a page still loading (sent right after "navigate") waits a few
 * seconds for it, then fails. */
export function runCommand(action: string, args: Record<string, unknown>): Promise<unknown> {
  const run = handlers.get(action)?.at(-1);
  if (run) return Promise.resolve().then(() => run(args));
  return new Promise((done, fail) => {
    waiting?.fail(new Error("Replaced by a newer command"));
    const timer = setTimeout(() => {
      if (waiting?.action === action) waiting = null;
      fail(new Error(`"${action}" is not available on this page (${state.route}): navigate to the page that has it first`));
    }, PENDING_MS);
    waiting = { action, args, done: (r) => (clearTimeout(timer), done(r)), fail: (e) => (clearTimeout(timer), fail(e)) };
  });
}

/** The gestures the page on screen offers now (ui_snapshot `commands`), beyond click, fill and navigate. */
export const pageCommands = () => [...handlers.keys()].sort();

/** Register what this page can do for the assistant (per action the part mounted last; several parts offering the
 * same one, e.g. two profile generators, share one handler that picks among them). */
/** False for a page kept mounted out of sight (App: Planning beside the Site map): it takes no commands and reports
 * nothing, so the assistant sees only the page on screen. */
export const PageActive = createContext(true);

export function useCommand(action: string, handler: Handler) {
  const latest = useRef(handler);
  latest.current = handler;
  const active = useContext(PageActive);
  useEffect(() => {
    if (!active) return;
    const run: Handler = (args) => latest.current(args);
    handlers.set(action, [...(handlers.get(action) ?? []), run]);
    if (waiting?.action === action) {
      const w = waiting;
      waiting = null;
      Promise.resolve()
        .then(() => run(w.args))
        .then(w.done, w.fail);
    }
    return () => {
      const rest = (handlers.get(action) ?? []).filter((h) => h !== run);
      if (rest.length) handlers.set(action, rest);
      else handlers.delete(action);
    };
  }, [action, active]);
}

/** What the open page knows that its picture does not say (positions as fractions, links, toggles, KPIs), for
 * ui_snapshot. Every part of the page on screen may add its own (the structure and its Modelling under it, the site
 * map and its quick analysis): their details are merged, a later part's key over an earlier one's. */
type Detail = () => Record<string, unknown>;
const details = new Set<Detail>();
/** Add a reader of page details; returns its removal (the hook below does both). */
export function addDetail(read: Detail): () => void {
  details.add(read);
  return () => void details.delete(read);
}
export function useSnapshotDetail(fn: Detail) {
  const latest = useRef(fn);
  latest.current = fn;
  const active = useContext(PageActive);
  useEffect(() => (active ? addDetail(() => latest.current()) : undefined), [active]);
}
export const snapshotDetail = (): Record<string, unknown> => Object.assign({}, ...[...details].map((read) => read()));

// --- the screen state the assistant reads -------------------------------------------------------------------
let state: UiReport = { client: CLIENT_ID, route: "", dataset: "", page: {} };
let timer: ReturnType<typeof setTimeout> | undefined;
let unsaved = false;

function send() {
  clearTimeout(timer);
  // one report per burst of changes; whether this tab is in front decides whether it takes the assistant's requests
  timer = setTimeout(() => reportUi({ ...state, focused: document.hasFocus() }).catch(() => undefined), 250);
}

/** The tab came to the front or went to the background: the assistant's requests go to the tab in front. */
export const claimFocus = () => send();

/** Shell-level facts (route, data center, data version); a new route starts with empty page details. */
export function reportShell(patch: Partial<Omit<UiReport, "page">>) {
  const newPage = patch.route !== undefined && patch.route !== state.route;
  state = { ...state, ...patch, page: newPage ? {} : state.page };
  if (newPage) unsaved = false;
  send();
}

/** Details of the open page: selected variable, map centre, ... (merged into what the page reported before). */
export function useReportPage(page: Record<string, unknown>) {
  const key = JSON.stringify(page);
  const active = useContext(PageActive);
  useEffect(() => {
    if (!active) return;
    state = { ...state, page: { ...state.page, ...(JSON.parse(key) as Record<string, unknown>) } };
    send();
  }, [key, active]);
}

/** The page has edits it has not saved: someone else's change then waits for the user instead of replacing them. */
export function useUnsaved(dirty: boolean) {
  const active = useContext(PageActive);
  useEffect(() => {
    if (!active) return;
    unsaved = dirty;
    state = { ...state, page: { ...state.page, unsaved: dirty } };
    send();
    return () => {
      unsaved = false;
    };
  }, [dirty, active]);
}

export const hasUnsaved = () => unsaved;

/** What this tab last reported (client, route, data center, data version, page details). */
export const screenState = () => state;
