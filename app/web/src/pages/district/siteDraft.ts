/**
 * The Site map's unsaved edits, kept in this browser (localStorage `site-draft:<data center>`) until Save writes them
 * to the site: leaving the page or reloading does not lose them. Storage full or blocked: they live as long as the page.
 */
import type { Site } from "../../api";

const key = (dataset: string) => `site-draft:${dataset}`;

export function keepDraft(dataset: string, site: Site) {
  try {
    localStorage.setItem(key(dataset), JSON.stringify(site));
  } catch {
    // not kept: the page still has them
  }
}

/** The kept draft of this data center's site, or null. */
export function draftOf(dataset: string): Site | null {
  try {
    const s = JSON.parse(localStorage.getItem(key(dataset)) ?? "null") as Site | null;
    return s && Array.isArray(s.sinks) ? s : null;
  } catch {
    return null;
  }
}

export function dropDraft(dataset: string) {
  try {
    localStorage.removeItem(key(dataset));
  } catch {
    // nothing kept
  }
}

/**
 * Forget what this browser keeps for the app (the bin, with nothing unsaved): every data center's unsaved map edits,
 * Heat Matching's last year (Operation and the Quick analysis show it), the case and the data centers last picked.
 * The saved sites and project files, the user's own cases and the theme and palette stay. The keys removed.
 */
export function resetBrowser(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("site-draft:") || k === "heat-matching" || k === "case" || k === "dataset" || k.startsWith("dataset:"))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // storage blocked: nothing kept to forget
  }
  return keys;
}
