/**
 * Inputs taken from another dataset on Heat Matching: a district's measured heat demand (a dataset whose
 * dataset.json kpi.heat_demand is one of its columns, e.g. sim_district_heat) or another outdoor temperature. They
 * replace the shared weather and the district's demand, and go into the data center's Model as its drivers, so its
 * learned pattern gives the heat for them. Pure: the page's hook (pages/heat/useExternalInputs.ts) loads the data.
 */
import type { DatasetInfo } from "../api";
import { alignToTimes } from "./demand";

/** A dataset and the column taken from it. */
export type InputSource = { id: string; name: string; column: string };

/** The outdoor-temperature columns read as the weather, in order (as demandStore's evaluatedYear). */
export const WEATHER_COLUMNS = ["Out_Temp", "temperature_2m"];

/** The datasets (other than `self`) that can give a demand, and those that can give a weather. */
export function inputSources(datasets: DatasetInfo[], self: string): { demand: InputSource[]; weather: InputSource[] } {
  const others = datasets.filter((d) => d.id !== self);
  const cfg = (d: DatasetInfo) => (d.config ?? {}) as { name?: string; kpi?: { heat_demand?: string } };
  // its dataset.json name, as the data-center picker shows it
  const of = (d: DatasetInfo, column: string | undefined) => (column && d.columns.includes(column) ? [{ id: d.id, name: cfg(d).name ?? d.name, column }] : []);
  return {
    demand: others.flatMap((d) => of(d, cfg(d).kpi?.heat_demand)),
    weather: others.flatMap((d) =>
      of(
        d,
        WEATHER_COLUMNS.find((c) => d.columns.includes(c)),
      ),
    ),
  };
}

/** A series (ISO timestamps, no zone, as the API sends them) on the period's steps (unix s); null when it does not
 * cover the period: another year cannot stand in for this one step by step. Gaps are carried over by the alignment. */
export function onPeriod(iso: string[], values: (number | null)[], times: number[]): number[] | null {
  if (!times.length || !iso.length) return null;
  const src = iso.map((t) => Date.parse(`${t}Z`) / 1000);
  if (src[0] > times[0] || src[src.length - 1] < times[times.length - 1]) return null;
  const keep = values.map((v, i) => (v != null && Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
  return alignToTimes(
    keep.map((i) => src[i]),
    keep.map((i) => values[i] as number),
    times,
  );
}
