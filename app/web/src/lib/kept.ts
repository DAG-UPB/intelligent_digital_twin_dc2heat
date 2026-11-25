/**
 * State that outlives its page while the app stays open: leaving a page and coming back shows it as it was left (the
 * tab, the period, the variables picked). Kept per data center in memory, so a reload starts fresh, as the map's place
 * (`leftView` in pages/district/useSiteMap.ts).
 */
import { useCallback, useState, type SetStateAction } from "react";
import { DATASET } from "../dataset";

const kept = new Map<string, unknown>();

/** useState whose value is kept under `key` (per data center) when the page is left. */
export function useKept<T>(key: string, initial: T | (() => T)): [T, (v: SetStateAction<T>) => void] {
  const k = `${DATASET}|${key}`;
  const [value, setValue] = useState<T>(() => (kept.has(k) ? (kept.get(k) as T) : typeof initial === "function" ? (initial as () => T)() : initial));
  const set = useCallback(
    (v: SetStateAction<T>) =>
      setValue((old) => {
        const next = typeof v === "function" ? (v as (old: T) => T)(old) : v;
        kept.set(k, next);
        return next;
      }),
    [k],
  );
  return [value, set];
}
