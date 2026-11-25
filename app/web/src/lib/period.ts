/**
 * The evaluated period (the dataset's test period) and helpers for time series over it: step length,
 * durations, binning, and loading columns measured or from the trained model's free run.
 */
import { fetchDatasets, fetchTimeSeriesData, getModel, simulateModel, type TrainedModel } from "../api";
import { DATASET } from "../dataset";
import type { DcDrivers } from "./matching";
import { stepHoursOf } from "./clock";
import { MODEL_NAME } from "./modelCatalog";
import { DRIVER_COLUMNS } from "./sourceMap";
import { LANG } from "./i18n";

/** At most this many steps are evaluated (a year of hourly data is 8760). */
export const MAX_STEPS = 20000;

export { stepHoursOf }; // in lib/clock.ts (pure: lib/demand.ts needs it without the HTTP client); kept here for its callers

/** A duration in seconds as "30 s", "5 min", "6 h", "2 d", "3 mo". */
export function durationLabel(sec: number): string {
  const r = (x: number) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10);
  if (sec < 60) return `${r(sec)} s`;
  if (sec < 3600) return `${r(sec / 60)} min`;
  if (sec < 2 * 86400) return `${r(sec / 3600)} h`;
  if (sec < 60 * 86400) return `${r(sec / 86400)} d`;
  if (sec < 360 * 86400) return `${r(sec / (30.44 * 86400))} ${LANG === "de" ? "Mon." : "mo"}`;
  return `${r(sec / (365.25 * 86400))} ${LANG === "de" ? "J" : "y"}`; // German "J" for a year (the text swap cannot: one letter; "a" read as English prose)
}

/**
 * The evaluated period: the dataset's test period (after the trained model's split, or the last
 * 50 % of rows without a model), at the data's own resolution, at most MAX_STEPS steps.
 */
export interface Period {
  dataset: string; // the data center it belongs to: its columns are loaded from there
  times: number[]; // unix seconds
  stepHours: number; // hours per step (1 = hourly, 1/720 = 5 s)
  start: number; // row index of the first step
  file: string;
  columns: string[]; // the dataset's columns
  model: TrainedModel | null; // the trained model whose free run "model" columns are (default MODEL_NAME)
}

const loading = new Map<string, Promise<Period>>();

/**
 * The evaluated period of a data center, after the split of its trained model `name`. Calls while one load of the
 * same data center and model is in flight share it (a page and its demand model ask at the same time). A settled
 * load is not kept: training a model moves the split, so the next page visit loads again.
 */
export function testPeriod(dataset = DATASET, name = MODEL_NAME): Promise<Period> {
  const key = `${dataset}\n${name}`;
  let p = loading.get(key);
  if (!p) {
    p = loadPeriod(dataset, name).finally(() => loading.delete(key));
    loading.set(key, p);
  }
  return p;
}

async function loadPeriod(dataset: string, name: string): Promise<Period> {
  const [model, info] = await Promise.all([
    getModel(dataset, name).catch(() => null),
    fetchDatasets().then((r) => r.datasets.find((d) => d.id === dataset)),
  ]);
  if (!info) throw new Error(`Dataset ${dataset} not found`);
  const file = model?.file ?? info.files[0];
  const any = info.columns.find((c) => c !== "time");
  if (!any) throw new Error(`${dataset} has no data columns`);
  const res = await fetchTimeSeriesData(dataset, file, [any]);
  const start = model ? model.split_index : Math.floor(res.time.length / 2);
  const times = res.time.slice(start, start + MAX_STEPS).map((t) => Date.parse(`${t}Z`) / 1000);
  return { dataset, times, stepHours: stepHoursOf(times), start, file, columns: info.columns, model };
}

/** Columns over the period: measured, or from the trained model's free run (a calculated Q from its predicted parts),
 * there with `drivers` put in for the model's drivers of those names (other weather, another demand; one value per step). */
export async function periodColumns(
  p: Period,
  cols: string[],
  series: "actual" | "model" = "actual",
  drivers: Record<string, number[]> = {},
): Promise<Record<string, number[]>> {
  const n = p.times.length;
  const want = [...new Set(cols)];
  let raw: Record<string, (number | null)[]>;
  if (series === "model" && p.model) {
    const own = p.model.drivers;
    const put = Object.fromEntries(Object.entries(drivers).filter(([k]) => own.includes(k)));
    const res = await simulateModel(p.dataset, p.model.name, { start: p.start, steps: n, columns: want, ...(Object.keys(put).length ? { drivers: put } : {}) });
    raw = res.scenario as Record<string, number[]>;
  } else {
    const res = await fetchTimeSeriesData(p.dataset, p.file, want);
    raw = Object.fromEntries(want.map((c) => [c, res.columns[c].slice(p.start, p.start + n)]));
  }
  // gaps (null / NaN) and a series that ends early carry the last value forward
  const pad = (xs: (number | null)[] = []) => {
    let last = xs.find((x) => x != null && Number.isFinite(x)) ?? 0;
    return Array.from({ length: n }, (_, i) => {
      const x = xs[i];
      if (x != null && Number.isFinite(x)) last = x;
      return last;
    });
  };
  return Object.fromEntries(want.map((c) => [c, pad(raw[c])]));
}

/** kW per step -> MWh over the series (kWh = kW x hours per step). */
export const mwh = (xs: number[], stepHours: number) => (xs.reduce((a, b) => a + b, 0) * stepHours) / 1000;

/**
 * Means over coarser bins for long charts: daily from 20 days on, hourly from 2 days, else every step.
 * Returns the bin starts, the means and what a bin is.
 */
export function binned(times: number[], vs: number[]): { xs: number[]; vs: number[]; label: string } {
  const span = times.length > 1 ? times[times.length - 1] - times[0] : 0;
  const bin = span >= 20 * 86400 ? 86400 : span >= 2 * 86400 ? 3600 : 0;
  if (!bin || bin <= stepHoursOf(times) * 3600) return { xs: times, vs, label: "every step" };
  const xs: number[] = [];
  const out: number[] = [];
  let key = NaN, sum = 0, k = 0;
  for (let i = 0; i < times.length; i++) {
    const b = Math.floor(times[i] / bin);
    if (b !== key) {
      if (k) out.push(sum / k);
      xs.push(b * bin);
      key = b;
      sum = 0;
      k = 0;
    }
    sum += vs[i] ?? 0;
    k++;
  }
  if (k) out.push(sum / k);
  return { xs, vs: out, label: bin === 86400 ? "daily mean" : "hourly mean" };
}

/** The data center's IT / HVAC power (kW) and room / outdoor temperatures (°C) over the period. */
export async function dcDrivers(p: Period): Promise<DcDrivers> {
  const c = await periodColumns(p, DRIVER_COLUMNS);
  return { ite: c.ITE_Ener, hvac: c.HVAC_Ener, inT: c.In_Temp, outT: c.Out_Temp };
}
