/**
 * The data center (dataset) a page works on. The project (the data folder version, in the top bar) holds many; each page
 * picks its own in the bar under the sub-tabs (DatasetPicker), remembered per page in this browser. The shell sets
 * DATASET before it renders the page (openDataset), so every module reads the page's dataset through this one binding.
 */
import { fetchDatasets, putDataVersion, type DatasetInfo, type PreparedStep } from "./api";
import type { Derived } from "./lib/sourceMap";

const KEY = "dataset"; // the last one chosen: where a page without a choice of its own opens
const pageKey = (route: string) => `dataset:${route}`;
export const DEFAULT_DATASET = "sim_recovery_air"; // a fresh browser opens the main example: Case 1, at the European Central Bank

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage off: the default, not remembered
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: the choice is not remembered
  }
};

/** The dataset of the page on screen (a live binding: set by openDataset before the page renders). */
export let DATASET: string = read(KEY) || DEFAULT_DATASET;

/** The dataset page `route` ("tab/sub") opens on: its own choice, else the last one chosen, else the default. */
export const datasetOf = (route: string) => read(pageKey(route)) || read(KEY) || DEFAULT_DATASET;

/** Make `id` the dataset of what renders next (the shell, before the page). */
export function openDataset(id: string) {
  DATASET = id;
}

/** Page `route` works on `id` from now on (and a page without a choice of its own opens on it). No reload. */
export function chooseDataset(route: string, id: string) {
  write(pageKey(route), id);
  write(KEY, id);
}

/** A whole section works on `id`: every one of its pages (`routes`), e.g. the heat distribution's or the district's,
 * which are picked on their own, apart from the data center's (so not where a page without a choice opens). */
export function chooseSectionDataset(routes: string[], id: string) {
  for (const r of routes) write(pageKey(r), id);
  window.dispatchEvent(new Event(PICKED)); // the pickers under the sub-tabs show it (a page's own pick, e.g. Heat Matching's)
}
export const PICKED = "dataset-picked";

const routeOnScreen = () => window.location.hash.replace(/^#\/?/, "");

/** Open `id` on the page on screen, and reload (after a project switch, or for the assistant's open_dataset). */
export function switchDataset(id: string) {
  const route = routeOnScreen();
  if (route) write(pageKey(route), id);
  write(KEY, id);
  window.location.reload();
}

/** The data center to open after a data-version switch: the current one if the new version has it, else its first. */
export function datasetAfterSwitch(ids: string[], current: string): string {
  return ids.includes(current) || ids.length === 0 ? current : ids[0];
}

/** The data center a project opens on: the current one if it is one of the project's own, else the project's first
 * own one (the examples are in every project, so keeping an open example would never show the project), else as
 * datasetAfterSwitch. */
export function projectDataset(entries: { id: string; example?: boolean }[], current: string): string {
  const own = entries.filter((d) => !d.example).map((d) => d.id);
  if (own.length && !own.includes(current)) return own[0];
  return datasetAfterSwitch(
    entries.map((d) => d.id),
    current,
  );
}

/** Every page opens on `id` (each page's own pick forgotten): after a project switch to another data center. */
function forgetPagePicks() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(pageKey(""))) localStorage.removeItem(k);
  } catch {
    // storage off: nothing remembered
  }
}

const PROJECT_KEY = "dataset-project"; // the project the pages' picks were made in

/** On every start: when this browser's picks were made in another project than `project` (switched elsewhere, or before
 * this was remembered), every page opens on the project's own data center (projectDataset). True when the picks
 * changed: the page has to load again on them. */
export function enterProject(project: string, entries: { id: string; example?: boolean }[]): boolean {
  if (read(PROJECT_KEY) === project) return false;
  write(PROJECT_KEY, project);
  const next = projectDataset(entries, read(KEY) || DEFAULT_DATASET);
  if (next === (read(KEY) || DEFAULT_DATASET)) return false;
  forgetPagePicks();
  write(KEY, next);
  return true;
}

/** Point the backend at another data folder, then reload on `id` there (default: projectDataset), every page on it
 * when that is another data center. */
export async function switchDataVersion(version: string, id?: string) {
  const state = await putDataVersion(version);
  const next = id ?? projectDataset(state.folders[version] ?? [], DATASET);
  if (next !== DATASET) forgetPagePicks();
  write(PROJECT_KEY, version);
  switchDataset(next);
}

/** dataset.json of a data center: which variables are actuators (green), heat (orange), setpoints to evaluate. */
export interface DatasetConfig {
  name?: string;
  kind?: "simulation" | "testbed" | "real";
  actuators: string[];
  heat: string[];
  levers: string[];
  pid_image?: string | null;
  heat_source?: Record<string, HeatPoint> | null;
  /** How the plant is built (the example cases: scripts/make_sim_cases.py), e.g. free_cooling "plate_hex": the tower
   * free-cools the chilled water through a plate HEX, the chiller trims (both cases; the liquid one's facility water on the tower too). */
  plant?: { cooling?: "air" | "liquid"; heat_rejection?: string; free_cooling?: string; chiller?: string } | null;
  /** A blank structure (the example sim_blank): no built-in drawing, only the data center's inputs and outputs, to draw. */
  blank?: boolean;
  /** Its built-in drawing inside the data center's box, its inputs and outputs on the margins (make_sim_box.py). */
  frame?: boolean;
  /** Calculated columns, Q = m · cp · (T_in − T_out): kept in the data, never a model target or a graph node. */
  derived?: Record<string, Derived> | null;
  /** Columns of the data-center KPIs (the backend reads the rest); heat_demand is the measured district demand. */
  kpi?: { heat_demand?: string } | null;
  /** Variables made on the Dashboard (silver), not delivered with the data. */
  prepared?: PreparedStep[] | null;
  /** Names shown in place of the variables' own (lib/names.ts); the data keeps its own names. */
  names?: Record<string, string> | null;
  /** Data files aggregated on the Dashboard (core/resample.py): each file's name, the file it came from, its step. */
  resampled?: { name: string; source: string; step: string }[] | null;
}

/** One heat-recovery option of dataset.json heat_source: heat q (kW), the temperature it reaches the heat distribution
 * at t (°C), and optionally the HEX's hot side, inlet / outlet temperature and mass flow (sim_1_modified: the four
 * columns of each HEX; there t is the hot inlet), and t_return, the water back from the heat distribution when it is
 * not the hot outlet (sim_recovery_air: the loop's water on the HEX's cold side, t its warm pipe). */
export type HeatPoint = {
  q: string;
  t: string;
  t_in?: string;
  t_out?: string;
  m?: string;
  t_return?: string;
};

export function configOf(d: DatasetInfo | undefined): DatasetConfig {
  const c = (d?.config ?? {}) as Partial<DatasetConfig>;
  return { actuators: [], heat: [], levers: [], ...c };
}

const cached = new Map<string, Promise<DatasetConfig>>();
/** The page's data center's config (fetched once per data center; a failed fetch is retried on the next call). */
/** The prepared variables made for another part than `scope` (PreparedStep.scope; none: the data center's): they are
 * in the data, but not on this part's structure (the district's demand inputs are not the data center's). */
export const otherPartsPrepared = (config: DatasetConfig, scope: string): Set<string> =>
  new Set((config.prepared ?? []).filter((s) => s.scope && s.scope !== scope).map((s) => s.name));

export function datasetConfig(): Promise<DatasetConfig> {
  const id = DATASET;
  if (!cached.has(id))
    cached.set(
      id,
      fetchDatasets()
        .then((r) => configOf(r.datasets.find((d) => d.id === id)))
        .catch((e) => {
          cached.delete(id);
          throw e;
        }),
    );
  return cached.get(id)!;
}
