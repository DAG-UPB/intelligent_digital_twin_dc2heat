/**
 * Training settings that come from the dataset and the graph: the inputs taken from data, the levers, the split
 * date, and a data column added to the graph file as a node without links.
 */
import type { DatasetInfo } from "../../../api";
import { configOf } from "../../../dataset";

/** Weather and clock columns: inputs from the data, not predicted. */
const WEATHER = /^(hour|minute|weekday|day_?of|month|out_|outdoor|ambient|temperature_2m|relative_humidity|dew_?point|apparent_temp|precipitation|rain|snow|cloud|wind|surface_pressure|pressure_msl|shortwave|direct_radiation|diffuse_radiation|global_radiation|solar|irradiance)/i;

/** Default inputs from the data: the graph's suggested drivers, the actuators, weather-like columns (only existing columns, once). */
export const defaultInputs = (columns: string[], suggested: string[], actuators: string[]) =>
  [...new Set([...suggested, ...actuators, ...columns.filter((c) => WEATHER.test(c))])].filter((c) => columns.includes(c));

/** The columns a model may use: all but the calculated ones (dataset.json "derived", the HEX heat Q), never a target or input. */
export const modelColumns = (dataset: DatasetInfo | null | undefined): string[] => {
  const derived = configOf(dataset ?? undefined).derived ?? {};
  return (dataset?.columns ?? []).filter((c) => !derived[c]);
};

/** The district's heat demand (approaches.ts startOf): the data's it is bound to (bindSetup), else the starter's Q_houses. */
export const demandOf = (scope: string, dataset: DatasetInfo | null | undefined) =>
  scope === "district" ? (configOf(dataset ?? undefined).kpi?.heat_demand ?? "Q_houses") : undefined;

/** Setpoints whose changes are evaluated: dataset.json levers, else its actuators, that are columns of the data. */
export function leversOf(dataset: DatasetInfo | null) {
  const config = configOf(dataset ?? undefined);
  return (config.levers.length ? config.levers : config.actuators).filter((c) => dataset?.columns.includes(c));
}

/** Date (YYYY-MM-DD) at `fraction` of the time range; approximate, it assumes evenly spaced rows. */
export function splitDate(range: { start: string; end: string }, fraction: number) {
  const a = new Date(range.start).getTime();
  const b = new Date(range.end).getTime();
  return new Date(a + (b - a) * fraction).toISOString().slice(0, 10);
}

/** The list with `x` added, or removed when it is in it (a checkbox in a list of choices). */
export const toggle = (list: string[], x: string) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
