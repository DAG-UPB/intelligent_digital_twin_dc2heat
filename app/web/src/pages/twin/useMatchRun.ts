/**
 * Heat Matching's run: the plant models of the heat distribution's units (usePartSeries, over the source and the
 * network's temperatures), then the hour-by-hour matching (lib/matching.ts matchHeat) on them. A unit's run of the
 * previous period (shorter or longer) is not used: its built-in formula holds until the new one is in.
 */
import { useMemo } from "react";
import type { Component } from "../../api";
import { matchHeat, type MatchOptions } from "../../lib/matching";
import type { PartContext, Plant } from "../heat/partComponents";
import type { Profile } from "../heat/points";
import { usePartSeries } from "../heat/usePartComponents";

export interface MatchInputs {
  active: Partial<Record<Plant, Component>>; // the units run by a plant model
  src: Profile | undefined; // the data center's heat and temperature at its extraction point
  n: number; // steps matched
  q: number[]; // kW offered (the first n, scaled)
  demand: number[] | null | undefined;
  supply: number | number[] | undefined; // °C network supply
  ret: number | undefined; // °C network return
  opts: MatchOptions;
  stepHours: number;
}

/** The matching's result (null until source, demand and supply are in), the units' series it ran on, and their error. */
export function useMatchRun({ active, src, n, q, demand, supply, ret, opts, stepHours }: MatchInputs) {
  const partCtx = useMemo<PartContext | null>(() => (src && supply !== undefined && ret !== undefined ? { tSource: src.t.slice(0, n), qSource: q, supply, ret } : null), [src, n, q, supply, ret]);
  const runs = usePartSeries(active, partCtx);
  const partSeries = useMemo(() => (Object.values(runs.series).every((a) => a && a.length === n) ? runs.series : {}), [runs.series, n]);
  const res = useMemo(
    () => (src && demand && supply !== undefined ? matchHeat(q, src.t, demand, supply, opts, stepHours, undefined, partSeries) : null),
    [q, src, demand, supply, opts, stepHours, partSeries],
  );
  return { res, partSeries, error: runs.error };
}
