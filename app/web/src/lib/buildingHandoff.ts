/**
 * A building of the Site map handed to the district's Modelling, to look at its profile there for a while and come
 * back: the Site map puts it (its settings travel along, so an unsaved sink works too), Modelling shows it until it is
 * closed or left by its Back (the page may mount more than once on the way in, so it is not taken on sight).
 * Kept in this tab only (sessionStorage); without storage nothing is handed over.
 */
import type { DemandEntry } from "./demand";

const KEY = "profile-building";

export type HandedBuilding = Pick<DemandEntry, "id" | "name" | "settings">;

export function putBuilding(b: HandedBuilding) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* storage off: Modelling opens without it */
  }
}

/** The building waiting for Modelling, if any. */
export function peekBuilding(): HandedBuilding | null {
  try {
    const b = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as HandedBuilding | null;
    return b && typeof b.id === "string" && b.settings ? b : null;
  } catch {
    return null;
  }
}

/** Done with it: closed, or back to the site map. */
export function dropBuilding() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
