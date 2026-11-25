/**
 * Cases: a named choice of the three systems (the data center's, the heat distribution's and the district's datasets)
 * and the trained models the data center and the district run in Heat Matching (their site.json twin_model). Picked
 * under the sub-tabs (DataCenterPicker); the examples' cases come with the app, your own are kept in this browser.
 */
export interface Case {
  name: string;
  dc: string;
  heat: string;
  district: string;
  dcModel?: string | null; // undefined: the case leaves the data center's model as it is
  districtModel?: string | null; // null: the district's own demand (profile or measured)
  example?: boolean;
}

export const EXAMPLE_CASES: Case[] = [
  { name: "Blank · start from scratch", dc: "sim_blank", heat: "sim_blank", district: "sim_blank", example: true }, // nothing placed on the map: Frankfurt
  { name: "Case 1 · Recovery, trained models", dc: "sim_recovery_air", heat: "sim_recovery_air", district: "sim_recovery_air", dcModel: "xgb", districtModel: "xgb", example: true },
  { name: "Case 2 · Recovery, physical models", dc: "sim_recovery_air", heat: "sim_recovery_air", district: "sim_recovery_air", dcModel: "phys", districtModel: "phys", example: true },
  { name: "Case 3 · Recovery, measured district", dc: "sim_recovery_air", heat: "sim_recovery_air", district: "sim_district_heat", dcModel: "xgb", example: true },
  { name: "Case 4 · Box, air cooled", dc: "sim_box_air", heat: "sim_box_air", district: "sim_box_air", example: true },
];

const KEY = "cases";

export function savedCases(): Case[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((c) => c && typeof c.name === "string" && c.dc && c.heat && c.district) : [];
  } catch {
    return []; // storage off or broken: none
  }
}

const store = (cases: Case[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(cases));
  } catch {
    // private mode: not remembered
  }
};

/** Keep `c` (one of the same name is replaced). */
export const saveCase = (c: Case) => store([...savedCases().filter((x) => x.name !== c.name), { ...c, example: undefined }]);
export const removeCase = (name: string) => store(savedCases().filter((x) => x.name !== name));

const PICKED_CASE = "case"; // the case picked last: shown while its three datasets are on, even if a model did not save

export const pickedCase = () => {
  try {
    return localStorage.getItem(PICKED_CASE);
  } catch {
    return null;
  }
};
export const pickCase = (name: string) => {
  try {
    localStorage.setItem(PICKED_CASE, name);
  } catch {
    // private mode: not remembered
  }
};

/** The case the three systems are on now: the one picked last while its datasets are on, else one with the same
 * datasets and the same models where it names them. */
export function caseOn(cases: Case[], now: Case, picked: string | null = null): Case | undefined {
  const last = cases.find((c) => c.name === picked);
  if (last && last.dc === now.dc && last.heat === now.heat && last.district === now.district) return last;
  return cases.find(
    (c) =>
      c.dc === now.dc &&
      c.heat === now.heat &&
      c.district === now.district &&
      (c.dcModel === undefined || (c.dcModel ?? null) === (now.dcModel ?? null)) &&
      (c.districtModel === undefined || (c.districtModel ?? null) === (now.districtModel ?? null)),
  );
}

/** "Case 1 · Recovery, trained models" → "Case 1" (the closed pill). */
export const caseShort = (name: string) => name.split(" · ")[0];
