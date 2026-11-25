/**
 * Which datasets the project's three systems work on: a menu each under the sub-tabs (data center, heat distribution,
 * district), with the datasets of the project (the data folder version chosen in the top bar, ProjectPicker) by kind,
 * the examples (in every project), then "Add a data center from a folder…"; and a case before them, which picks all three
 * and their models at once (cases.ts).
 * Real data never leaves this machine (see .gitignore).
 */
import { useCallback, useEffect, useReducer, useState } from "react";
import { fetchSite, saveSite, type DataFolderEntry, type DataVersions } from "../api";
import { chooseDataset, chooseSectionDataset, DATASET, datasetOf, PICKED } from "../dataset";
import { STRUCTURES } from "../lib/modelCatalog";
import { TABS } from "./routes";
import { caseOn, caseShort, EXAMPLE_CASES, pickCase, pickedCase, removeCase, saveCase, savedCases, type Case } from "./cases";
import { AddDataCenterDialog } from "./AddDataCenterDialog";

export const LOCAL = "local";
const ADD = "__add_data_center__";
const KIND_LABEL: Record<string, string> = { simulation: "Simulations", testbed: "Testbed", real: "Real data centers" };

/** A version's own name (its project.json), else "version_2" → "Version 2"; "local" → "Examples". */
export const versionLabel = (v: string, names?: Record<string, string>) =>
  v === LOCAL ? "Examples" : (names?.[v] ?? v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()));

/** The menu groups: per folder (the user's versions newest first, then the examples) and kind, in KIND_LABEL order,
 * then a version's examples (the ones it has no copy of) in a group of their own; an unknown kind is left out. */
export function pickerGroups(state: DataVersions): { label: string; folder: string; items: DataFolderEntry[] }[] {
  return [...[...state.versions].reverse(), LOCAL].flatMap((folder) => {
    const all = state.folders[folder] ?? [];
    const own = all.filter((d) => !d.example);
    return [
      ...Object.entries(KIND_LABEL).map(([kind, kindLabel]) => ({
        label: `${versionLabel(folder, state.names)} · ${kindLabel}`,
        folder,
        items: own.filter((d) => d.kind === kind),
      })),
      { label: "Examples", folder, items: all.filter((d) => d.example) },
    ].filter((g) => g.items.length > 0);
  });
}

// What makes names long without telling datasets apart; the part that does (number, variant) stays.
const ABBREVIATIONS: [RegExp, string][] = [
  [/\s*\([^)]*\)/g, ""], // "(water-cooled)": a description, the same for all racks
  [/\bwith heat exchangers?\b/gi, "HEX"],
  [/\bsimulation\b/gi, "Sim"],
  [/\bexperiment\b/gi, "exp"],
  [/\btestbed\b/gi, ""],
];

/** Short label for the narrow closed picker: "Lab testbed · experiment 1" → "Lab · exp 1", "Plant A (water-cooled) · rack 1" → "Plant A · rack 1". */
export function shortName(name: string): string {
  const s = ABBREVIATIONS.reduce((acc, [re, to]) => acc.replace(re, to), name);
  return s.replace(/\s+/g, " ").trim() || name;
}

/** The project's three systems, each picked on its own under the sub-tabs, on every page: the data center's (for its
 * own tab and the whole twin's), the heat distribution's and the district's (each for its tab). The page on screen
 * runs on its tab's system (DATASET); Heat Matching reads the other two from their tabs (datasetOf). */
export const SYSTEMS: { id: string; label: string; tabs: string[] }[] = [
  { id: "dc", label: "Data center", tabs: ["dc", "twin"] },
  { id: "heat", label: "Heat distribution", tabs: ["heat"] },
  { id: "district", label: "District", tabs: ["district"] },
];
const routesOf = (tabs: string[]) => TABS.filter((t) => tabs.includes(t.id)).flatMap((t) => t.subs.map((s) => `${t.id}/${s.id}`));

/**
 * The case the app was started with (`?case=1`: start.sh opens it so), before the first page renders: its three
 * datasets for their sections, its models into their site.json, then the address without it (a reload keeps the
 * user's own choice). Nothing without the parameter or for an unknown case.
 */
export function openStartCase(search = window.location.search) {
  const want = new URLSearchParams(search).get("case");
  const c = want && EXAMPLE_CASES.find((x) => caseShort(x.name) === `Case ${want}` || x.name === want);
  if (!c) return;
  pickCase(c.name);
  for (const sys of SYSTEMS) chooseSectionDataset(routesOf(sys.tabs), c[sys.id as "dc" | "heat" | "district"]);
  chooseDataset(routesOf(SYSTEMS[0].tabs)[0], c.dc); // where a page without a choice of its own opens
  if (c.dcModel !== undefined) void setModel(c.dc, c.dcModel).catch(() => {});
  if (c.districtModel !== undefined) void setModel(c.district, c.districtModel, "district").catch(() => {});
  window.history.replaceState(null, "", window.location.pathname + window.location.hash);
}

/** A structure's twin model in its site.json: written only when it changes (an example's file stays as it is). */
async function setModel(id: string, model: string | null, scope?: "district") {
  const s = await fetchSite(id, scope);
  if ((s.twin_model ?? null) !== model) await saveSite(id, { ...s, twin_model: model }, scope);
}

/** Case `c` on: its three datasets for their sections (the data center's also where a page without a choice opens, or
 * on `route`) and the models it names into their site.json (not saved where read-only: the datasets still switch). */
export async function applyCase(c: Case, route?: string) {
  pickCase(c.name);
  for (const sys of SYSTEMS) {
    const routes = routesOf(sys.tabs);
    chooseSectionDataset(routes, c[sys.id as "dc" | "heat" | "district"]);
    if (sys.id === "dc") chooseDataset(route && sys.tabs.includes(route.split("/")[0]) ? route : routes[0], c.dc);
  }
  await Promise.all([
    c.dcModel !== undefined && setModel(c.dc, c.dcModel).catch(() => {}),
    c.districtModel !== undefined && setModel(c.district, c.districtModel, "district").catch(() => {}),
  ]);
}

/** Whether case `c` is on: picked last, its three datasets on their sections. */
export const caseIsOn = (c: Case) => pickedCase() === c.name && SYSTEMS.every((s) => datasetOf(routesOf(s.tabs)[0]) === c[s.id as "dc" | "heat" | "district"]);

type Shown = { dcModel: string | null; heatComponents: string[]; districtModel: string | null };
const NONE: Shown = { dcModel: null, heatComponents: [], districtModel: null };
const modelLabel = (m: string | null) => (m ? (STRUCTURES.find((d) => d.name === m)?.label ?? m) : null);

export default function DataCenterPicker({ project, route, onChange }: { project: DataVersions | null; route: string; onChange: () => void }) {
  const tab = route.split("/")[0];
  const [n, shown] = useReducer((k: number) => k + 1, 0);
  useEffect(() => {
    window.addEventListener(PICKED, shown);
    return () => window.removeEventListener(PICKED, shown);
  }, []);
  const ids = Object.fromEntries(SYSTEMS.map((s) => [s.id, s.tabs.includes(tab) ? DATASET : datasetOf(routesOf(s.tabs)[0])])) as Record<string, string>;

  // the models each system runs (its site.json): read again on a pick, and when the pointer comes onto the pickers
  const [models, setModels] = useState<Shown>(NONE);
  const read = useCallback(() => {
    Promise.all([
      fetchSite(ids.dc).catch(() => null),
      fetchSite(ids.heat).catch(() => null),
      fetchSite(ids.district, "district").catch(() => null),
    ]).then(([d, h, k]) =>
      setModels({ dcModel: d?.twin_model ?? null, heatComponents: Object.values(h?.heat_components ?? {}), districtModel: k?.twin_model ?? null }),
    );
  }, [ids.dc, ids.heat, ids.district]);
  useEffect(read, [read, n]);
  const modelOf: Record<string, string> = {
    dc: `model: ${modelLabel(models.dcModel) ?? "linear (none chosen)"}`,
    heat: `plant: ${models.heatComponents.join(", ") || "built-in equations"}`,
    district: `demand: ${modelLabel(models.districtModel) ?? "its own profile or measured"}`,
  };

  const pick = (sys: (typeof SYSTEMS)[number], v: string) => {
    const routes = routesOf(sys.tabs);
    chooseSectionDataset(routes, v);
    if (sys.id === "dc") chooseDataset(sys.tabs.includes(tab) ? route : routes[0], v); // where a page without a choice opens
  };
  const now: Case = { name: "", dc: ids.dc, heat: ids.heat, district: ids.district, dcModel: models.dcModel, districtModel: models.districtModel };
  const have = new Set((project?.folders[project.current ?? LOCAL] ?? []).map((d) => d.id));
  const cases = [...EXAMPLE_CASES.filter((c) => [c.dc, c.heat, c.district].every((id) => have.has(id))), ...savedCases()];
  const on = caseOn(cases, now, pickedCase());
  const openCase = async (c: Case) => {
    await applyCase(c, route);
    onChange();
  };
  const chooseCase = (v: string) => {
    if (v === SAVE) {
      const name = window.prompt("Name of the case (the three datasets and their models as they are now)", `Case ${cases.length + 1}`)?.trim();
      if (name) {
        saveCase({ ...now, name });
        pickCase(name);
      }
      return shown();
    }
    if (v.startsWith(REMOVE)) {
      removeCase(v.slice(REMOVE.length));
      return shown();
    }
    const c = cases.find((x) => x.name === v);
    if (c) void openCase(c);
  };

  return (
    <div className="subtabs__pickers" onPointerEnter={read}>
      <div className="topbar__picker subtabs__picker">
        <span className="topbar__picker-label" aria-hidden>
          <span className="subtabs__picker-caps">Case</span> {on ? caseShort(on.name) : "—"}
        </span>
        <select
          value={on?.name ?? ""}
          onChange={(e) => chooseCase(e.target.value)}
          aria-label="Case"
          title={on ? `${on.name}: ${SYSTEMS.map((s) => `${s.label} ${nameOf(project, ids[s.id])}`).join(", ")}` : "No case: the three systems as picked one by one"}
        >
          {!on && <option value="">No case (picked one by one)</option>}
          {cases.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
          <optgroup label="Your cases">
            <option value={SAVE}>Save the three as a case…</option>
            {on && !on.example && <option value={REMOVE + on.name}>Remove “{on.name}”</option>}
          </optgroup>
        </select>
      </div>
      {/* the case's three systems, one by one: folded under one button (less on the bar) */}
      <details className="subtabs__systems">
        <summary className="topbar__picker subtabs__picker" title="The case's three systems, one by one">
          Systems
        </summary>
        <div className="subtabs__systems-pop">
          {SYSTEMS.map((sys) => (
            <SystemPicker
              key={sys.id}
              label={sys.label}
              value={ids[sys.id]}
              model={modelOf[sys.id]}
              project={project}
              mine={sys.tabs.includes(tab)}
              onPick={(v) => {
                pick(sys, v);
                onChange();
              }}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

const SAVE = "__save_case__";
const REMOVE = "__remove_case__:";
const nameOf = (project: DataVersions | null, id: string) => project?.folders[project.current ?? LOCAL]?.find((d) => d.id === id)?.name ?? id;

/** One system's dataset: the pill shows only the system; hovered, or opened, its dataset and the model it runs. */
function SystemPicker({
  label,
  value,
  model,
  project,
  mine,
  onPick,
}: {
  label: string;
  value: string;
  model: string;
  project: DataVersions | null;
  mine: boolean; // the page on screen is this system's: it runs on DATASET
  onPick: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const folder = project?.current ?? LOCAL;
  const current = project?.folders[folder]?.find((d) => d.id === value);
  const full = current?.name ?? value;

  // The pill shows the system; the invisible select on top of it opens the menu with the full names.
  return (
    <div className={`topbar__picker subtabs__picker${mine ? " subtabs__picker--mine" : ""}`}>
      <span className="topbar__picker-label" aria-hidden>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => (e.target.value === ADD ? setAdding(true) : onPick(e.target.value))}
        aria-label={label}
        title={`${label}: ${versionLabel(folder, project?.names)} › ${full} · ${model}`}
      >
        {!current && <option value={value}>{`${value} · ${model}`}</option>}
        {project &&
          pickerGroups(project)
            .filter((g) => g.folder === folder)
            .map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.id === value ? `${d.name} · ${model}` : d.name}
                  </option>
                ))}
              </optgroup>
            ))}
        {project?.linked && folder !== LOCAL && (
          <optgroup label="Project">
            <option value={ADD}>Add a data center from a folder…</option>
          </optgroup>
        )}
      </select>
      {adding && <AddDataCenterDialog version={versionLabel(folder, project?.names)} onClose={() => setAdding(false)} />}
    </div>
  );
}
