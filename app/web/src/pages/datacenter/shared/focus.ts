/**
 * The variable picked in the causal graph on the left of a page (GraphSidebar): given to everything on its right, so
 * each view shows or marks that variable (a chart plots it, a list highlights it, the replay adds it). `n` changes on
 * every click; a second click on the picked variable releases it (`off`: nothing marked, and what added it takes it back).
 */
import { createContext, useContext, useEffect, useRef } from "react";

export interface Picked {
  v: string;
  n: number;
  only?: boolean; // a double click: show only this one (where a view shows several)
  off?: boolean; // clicked again: released
}

/** The pick after a click on `v`: the same variable, picked, is released; any other is picked. */
export const nextPick = (p: Picked | null, v: string): Picked => (p && p.v === v && !p.off ? { v, n: p.n + 1, off: true } : { v, n: (p?.n ?? 0) + 1 });

export const FocusContext = createContext<Picked | null>(null);

/** The variable picked in the graph (to mark), or null (none, or released). */
export const useFocus = () => {
  const p = useContext(FocusContext);
  return p?.off ? null : p;
};

/** Calls `f` with the picked variable each time one is picked (and once when the view opens after a pick). */
export function useOnFocus(f: (v: string, picked: Picked) => void) {
  const picked = useContext(FocusContext); // a release too: a view that toggles takes it back
  const latest = useRef(f);
  latest.current = f;
  useEffect(() => {
    if (picked) latest.current(picked.v, picked);
  }, [picked?.n, picked?.v]); // eslint-disable-line react-hooks/exhaustive-deps -- a new pick, not a new callback
}
