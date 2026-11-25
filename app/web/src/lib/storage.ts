/**
 * What a page remembers in this browser (localStorage): read and written in one place, so storage that is off (a
 * private window, a full quota) only means nothing is remembered. Values are JSON by default; `FLAG` keeps the
 * pages' on/off keys as "1" / "0", as they were always stored.
 */
import { useState } from "react";

/** How a value is kept as text. */
export interface Format<T> {
  parse(text: string): T;
  text(v: T): string;
}
// the default for any T: what JSON.parse gives back is trusted to be what JSON.stringify wrote
const JSON_TEXT: Format<never> = { parse: (s) => JSON.parse(s) as never, text: (v) => JSON.stringify(v) };
/** On or off as "1" / "0" (anything else stored reads as off). */
export const FLAG: Format<boolean> = { parse: (s) => s === "1", text: (v) => (v ? "1" : "0") };

/** The value kept under `key`, or `fallback` when there is none, it cannot be read or storage is off. */
export function readJson<T>(key: string, fallback: T, format: Format<T> = JSON_TEXT): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : format.parse(v);
  } catch {
    return fallback;
  }
}

/** Keep `v` under `key`; null or undefined removes it. */
export function writeJson<T>(key: string, v: T | null | undefined, format: Format<T> = JSON_TEXT) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, format.text(v));
  } catch {
    /* only not remembered */
  }
}

/** useState read once from `key` and written back on every set. */
export function useStored<T>(key: string, initial: T, format: Format<T> = JSON_TEXT) {
  const [value, set] = useState<T>(() => readJson(key, initial, format));
  const setStored = (v: T) => {
    set(v);
    writeJson(key, v, format);
  };
  return [value, setStored] as const;
}
