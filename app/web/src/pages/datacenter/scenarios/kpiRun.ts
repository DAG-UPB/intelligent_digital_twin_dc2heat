/**
 * The data-center KPIs of a Scenarios run (Step-through what-if, Long period simulation): the Visualization's
 * kpisOf over the run's series, each KPI column the twin's where it gives it, else the measured one. Pure.
 */
import type { SimulateResponse, TrainedModel } from "../../../api";
import { derivable, type Derived } from "../../../lib/sourceMap";
import { compareKpis, kpiInputs, kpisOf, runSeries, type KpiColumns, type ScenarioKpi } from "../dashboard/whatIf";

/**
 * Which of `columns` the twin makes (its inputs, its predictions, and the calculated ones whose parts it has: a run asks
 * for these; simulate refuses any other) and the ones only the data has.
 */
export function twinSplit(columns: string[], model: Pick<TrainedModel, "drivers" | "order">, derived: Record<string, Derived> | null | undefined) {
  const names = [...model.drivers, ...model.order];
  const twin = new Set([...names, ...derivable(derived, names)]);
  return { twin: columns.filter((c) => twin.has(c)), measured: columns.filter((c) => !twin.has(c)) };
}

/** The KPI columns the twin gives and the ones only the data has. */
export const kpiSources = (cols: KpiColumns, model: Pick<TrainedModel, "drivers" | "order">, derived: Record<string, Derived> | null | undefined) =>
  twinSplit(kpiInputs(cols), model, derived);

/** A run's measured series: its own `actual`, and the whole file's series of the columns it was not asked for, at its steps. */
export function actualWith(res: Pick<SimulateResponse, "start" | "steps" | "actual">, measured: Record<string, (number | null)[]>) {
  const window = Object.fromEntries(Object.entries(measured).map(([c, v]) => [c, v.slice(res.start, res.start + res.steps)]));
  return { ...window, ...res.actual };
}

/**
 * A run's KPIs: measured, the twin without a change (the baseline; the run itself when it has none) and with it
 * (null without a baseline). `measured`: the whole file's series of the KPI columns the twin does not give, read at the
 * run's steps.
 */
export function runKpis(res: SimulateResponse, cols: KpiColumns, stepHours: number, measured: Record<string, (number | null)[]> = {}): ScenarioKpi[] {
  const actual = actualWith(res, measured);
  const inputs = kpiInputs(cols);
  const kpis = (run?: SimulateResponse["scenario"]) => kpisOf(runSeries(inputs, actual, run), cols, stepHours);
  return res.baseline ? compareKpis(kpis(), kpis(res.baseline), kpis(res.scenario)) : compareKpis(kpis(), kpis(res.scenario), null);
}
