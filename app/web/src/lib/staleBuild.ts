/**
 * A tab opened before the app was rebuilt (start.sh builds web/dist again after a change) asks for the old build's
 * page files, which the new build replaced (their names carry a hash): "Failed to fetch dynamically imported module".
 * Trying again cannot help, the file is gone: the tab needs the new build, a reload. Pure but for the browser's
 * sessionStorage and location.
 */

/** The browsers' messages for a page file that could not be loaded (Chrome, Safari, Firefox; Vite's CSS preload). */
const STALE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

/** Whether `error` is a page file of an older build that is gone. */
export const isStaleBuild = (error: unknown) => STALE.test(error instanceof Error ? error.message : String(error ?? ""));

const KEY = "stale-build-reload";
/** A second reload within this time does not happen: the file is missing for another reason, the error shows. */
export const RELOAD_GAP_MS = 30_000;

/** Whether the tab was just reloaded for a new build: a page file still missing then is not an older build's. */
export function justReloaded(now = Date.now()): boolean {
  try {
    return now - (Number(sessionStorage.getItem(KEY)) || 0) < RELOAD_GAP_MS;
  } catch {
    return false;
  }
}

/** Reload the tab for the new build, once: false (and no reload) when it was just done. */
export function reloadForNewBuild(now = Date.now(), reload = () => location.reload()): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY)) || 0;
    if (now - last < RELOAD_GAP_MS) return false;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    return false; // storage off: no guard against a loop, so no automatic reload (the error box offers one)
  }
  reload();
  return true;
}
