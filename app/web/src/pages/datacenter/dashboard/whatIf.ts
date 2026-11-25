/**
 * The Dashboard's what-if: the data-center KPIs (PUE, ERF, ERE, energies) of one run, the same formulas as the
 * backend's (core/summary.kpis), so the measured period, the twin without a change and the twin with the user's
 * levers moved compare like for like. Pure: no React, no fetching.
 */
import type { Band, DatasetSummary } from "../../../api";

export type KpiColumns = NonNullable<DatasetSummary["kpi_columns"]>;

export interface WhatIfKpi {
  label: string;
  value: number | null;
  unit: string | null;
  better: "lower" | "higher"; // which way the change is good
}

/** The KPIs of a run: `series` the columns over the same steps (null or NaN: a gap, that step left out). */
export function kpisOf(series: Record<string, (number | null)[]>, cols: KpiColumns, stepHours: number): WhatIfKpi[] {
  const it = cols.it_power;
  if (!it || !series[it]) return [];
  const cool = cols.cooling_power && series[cols.cooling_power] ? cols.cooling_power : null;
  const heat = cols.heat_power.filter((c) => series[c]);
  // the facility's other electricity completes E_DC, so (as the backend) it counts only with the cooling
  const other = cool ? (cols.other_power ?? []).filter((c) => series[c]) : [];
  const used = [it, ...(cool ? [cool] : []), ...other, ...heat];
  const n = series[it].length;
  let eIt = 0;
  let eCool = 0;
  let eOther = 0;
  let eReuse = 0;
  for (let i = 0; i < n; i++) {
    const row = used.map((c) => series[c][i]);
    if (row.some((v) => v == null || !Number.isFinite(v))) continue; // as the backend: rows where every column has a value
    eIt += series[it][i]!;
    if (cool) eCool += series[cool][i]!;
    for (const c of other) eOther += series[c][i]!;
    for (const c of heat) eReuse += series[c][i]!;
  }
  const eDc = eIt + eCool + eOther;
  const unit = { W: "kWh", kW: "MWh", MW: "GWh" }[cols.power_unit ?? ""] ?? null;
  const energy = (e: number) => (unit ? (e * stepHours) / 1000 : null);
  const out: WhatIfKpi[] = [];
  if (cool && eIt > 0) out.push({ label: other.length ? "PUE" : "PUE (partial)", value: eDc / eIt, unit: null, better: "lower" });
  if (cool && heat.length && eDc > 0) {
    out.push({ label: "ERF", value: eReuse / eDc, unit: null, better: "higher" });
    out.push({ label: "ERE", value: eIt > 0 ? (eDc - eReuse) / eIt : null, unit: null, better: "lower" });
  }
  if (unit) {
    out.push({ label: "IT energy", value: energy(eIt), unit, better: "lower" });
    if (cool) out.push({ label: "Cooling energy", value: energy(eCool), unit, better: "lower" });
    if (heat.length) out.push({ label: "Heat reused", value: energy(eReuse), unit, better: "higher" });
  }
  return out;
}

/** The columns the KPIs read: the IT power, the cooling power, the facility's other power and every reused-heat column. */
export const kpiInputs = (cols: KpiColumns): string[] =>
  [cols.it_power, cols.cooling_power, ...(cols.other_power ?? []), ...cols.heat_power].filter((c): c is string => !!c);

/**
 * A run's KPI series: for each column what the twin's run gives (its prediction, its input, or a column calculated
 * from predicted parts; the median of a Monte Carlo band), else the measured one.
 */
export const runSeries = (columns: string[], measured: Record<string, (number | null)[]>, run?: Record<string, number[] | Band>) =>
  Object.fromEntries(columns.map((c) => [c, seriesOf(run?.[c]) ?? measured[c]]));

const seriesOf = (x: number[] | Band | undefined) => (x === undefined ? undefined : Array.isArray(x) ? x : x.p50);

/** One KPI measured (`value`), by the twin without a change and with it (null: no run with a change). */
export type ScenarioKpi = WhatIfKpi & { without: number | null; with: number | null };

/** The KPIs of the measured period, the twin without a change and the twin with it, side by side, by label. */
export function compareKpis(measured: WhatIfKpi[], without: WhatIfKpi[], withChange: WhatIfKpi[] | null): ScenarioKpi[] {
  const at = (ks: WhatIfKpi[] | null, label: string) => ks?.find((k) => k.label === label)?.value ?? null;
  return measured.map((k) => ({ ...k, without: at(without, k.label), with: at(withChange, k.label) }));
}

/** The change from `base` to `value`, as a share of `base` (null when either is missing or base is 0). */
export const changeOf = (value: number | null, base: number | null) => (value == null || base == null || base === 0 ? null : (value - base) / Math.abs(base));
