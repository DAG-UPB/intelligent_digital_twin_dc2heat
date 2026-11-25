/**
 * Heat distribution's components: the list (presets and saved), and a run of each part's chosen component over the
 * evaluated period, merged into the matching's per-step series (partComponents.ts).
 */
import { useEffect, useState } from "react";
import { listComponents, simulateComponent, type Component } from "../../api";
import { errorMessage } from "../../lib/errors";
import type { PartSeries } from "../../lib/matching";
import { CONTRACT, partInputs, toPartSeries, type PartContext, type Plant } from "./partComponents";

/** The components; none when they cannot be loaded (the parts keep their built-in formulas). */
export function useComponentList() {
  const [list, setList] = useState<Component[]>([]);
  useEffect(() => {
    listComponents()
      .then(setList)
      .catch(() => setList([]));
  }, []);
  return { list };
}

/** The series of the parts' components (`active`: part -> component), rerun shortly after the period or a choice changes. */
export function usePartSeries(active: Partial<Record<Plant, Component>>, ctx: PartContext | null) {
  const [series, setSeries] = useState<PartSeries>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const parts = Object.entries(active) as [Plant, Component][];
    if (!ctx || !parts.length || !ctx.tSource.length) {
      setSeries((old) => (Object.keys(old).length ? {} : old)); // keep the same object: no new matching for nothing
      setError(null);
      return;
    }
    let live = true;
    // a drag of the scale slider changes the source heat every frame: run once it rests
    const timer = window.setTimeout(() => {
      Promise.all(parts.map(([p, c]) => simulateComponent(c, partInputs(p, c, ctx), ctx.tSource.length, CONTRACT[p].outputs).then((run) => toPartSeries(p, run))))
        .then((runs) => live && (setSeries(Object.assign({}, ...runs)), setError(null)))
        .catch((e) => live && (setSeries({}), setError(errorMessage(e))));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [active, ctx]);
  return { series, error };
}
