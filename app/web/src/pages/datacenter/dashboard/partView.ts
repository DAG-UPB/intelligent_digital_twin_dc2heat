/**
 * Visualization and Scenarios of one part of the twin (the data center, the heat distribution, the district): which
 * variables the page shows and the part's KPIs. The data center's page shows every variable with the backend's KPIs;
 * the heat distribution's and the district's show only their own variables (their structure's variables with data,
 * and the columns dataset.json gives them) and KPIs computed here from per-variable statistics, so the measured data
 * (the summary) and a run of the twin (its series) give them by the same formulas. Pure: no React, no fetching.
 */
import type { CausalParent, DatasetSummary, StructureScope } from "../../../api";
import type { DatasetConfig } from "../../../dataset";
import { heatKpis } from "../../../lib/partKpis";
import { renameFor } from "../structure/bindSetup";
import type { WhatIfKpi } from "./whatIf";

const WEATHER = /^(out_|outdoor|ambient|t_outdoor|wind|humidity|solar|hour)/i;

/** The variables of a causal graph file (targets and their parents). */
export const graphVariables = (targets: Record<string, CausalParent[]> | null) =>
  targets ? [...new Set(Object.entries(targets).flatMap(([t, ps]) => [t, ...ps.map((p) => p.parent)]))] : [];

/** The columns dataset.json gives a part: the heat distribution its heat-recovery points (each HEX's Q, temperatures,
 * flow), the district its heat demand and the weather that drives it. */
function configured(scope: StructureScope, config: DatasetConfig, columns: string[]): string[] {
  if (scope === "heat") return Object.values(config.heat_source ?? {}).flatMap((p) => [p.q, p.t, p.t_in, p.t_out, p.t_return, p.m].filter((c): c is string => !!c));
  if (scope === "district") return [...(config.kpi?.heat_demand ? [config.kpi.heat_demand] : []), ...columns.filter((c) => WEATHER.test(c))];
  return [];
}

/** What the part's page shows, in the data's order: null for the data center (everything). */
export function partVariables(scope: StructureScope, config: DatasetConfig, columns: string[], graph: string[]): string[] | null {
  if (scope === "dc") return null;
  const keep = new Set([...configured(scope, config, columns), ...graph]);
  return columns.filter((c) => keep.has(c));
}

const pick = <T>(rec: Record<string, T> | null, keep: Set<string>) => (rec ? Object.fromEntries(Object.entries(rec).filter(([k]) => keep.has(k))) : rec);

/** The summary cut to the variables `keep` (null: unchanged): statistics, correlations, charts, recommendations. */
export function onlyVariables(s: DatasetSummary, keep: string[] | null): DatasetSummary {
  if (!keep) return s;
  const k = new Set(keep);
  const idx = s.correlation.names.map((n, i) => (k.has(n) ? i : -1)).filter((i) => i >= 0);
  return {
    ...s,
    variables: s.variables.filter((v) => k.has(v.name)),
    correlation: { names: idx.map((i) => s.correlation.names[i]), matrix: idx.map((i) => idx.map((j) => s.correlation.matrix[i][j])) },
    series: { time: s.series.time, columns: pick(s.series.columns, k)! },
    missing_map: pick(s.missing_map, k)!,
    profile: pick(s.profile, k),
    duration: pick(s.duration, k)!,
    daily: pick(s.daily, k)!,
    acf: pick(s.acf, k)!,
    monthly: pick(s.monthly, k)!,
    recommendations: s.recommendations.filter((r) => r.variables.some((v) => k.has(v))),
  };
}

/** Mean, peak and number of values of a column: what the parts' KPIs are made of. */
export interface Stats {
  mean: number | null;
  max: number | null;
  count: number;
}

/** Stats of each column of a run (null or NaN: a gap, left out). */
export function statsOf(series: Record<string, (number | null)[]>): Record<string, Stats> {
  return Object.fromEntries(
    Object.entries(series).map(([c, xs]) => {
      const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
      return [c, { mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, max: v.length ? Math.max(...v) : null, count: v.length }];
    }),
  );
}

/** Stats of the measured data, from the summary's statistics. */
export const summaryStats = (s: DatasetSummary): Record<string, Stats> =>
  Object.fromEntries(s.variables.map((v) => [v.name, { mean: v.mean, max: v.max, count: v.count }]));

const ENERGY: Record<string, string> = { W: "kWh", kW: "MWh", MW: "GWh" };

/** The heat distribution's variables the KPIs read beyond heat_source (the heat pump's heat and electricity, the
 * supply to the district), under the dataset's names (renameFor), as the Structure page's KPI variables (lib/partKpis). */
const HEAT_VARS = ["Q_hp", "P_el_hp", "T_dh_supply"] as const;
const heatNames = (config: DatasetConfig, columns: string[]) => {
  const rename = renameFor(columns, config);
  return (v: string) => rename[v] ?? v;
};

/** The columns a part's KPIs read (the twin runs these in Scenarios); `columns`: the data's, to bind the names. */
export function kpiColumns(scope: StructureScope, config: DatasetConfig, columns: string[] = []): string[] {
  if (scope === "heat") return [...Object.values(config.heat_source ?? {}).flatMap((p) => [p.q, p.t]), ...HEAT_VARS.map(heatNames(config, columns))];
  if (scope === "district") return config.kpi?.heat_demand ? [config.kpi.heat_demand] : [];
  return [];
}

/** A part's KPI with the line under its tile: how it is computed, or what it needs (`lacking`: its variables are not in
 * the data; the page does not show it as a tile, only names it, with what it needs). */
export interface PartKpi extends WhatIfKpi {
  note?: string;
  lacking?: boolean;
}

/** The KPIs whose variables the data has: the tiles to show (an empty tile on every example said nothing). */
export const shownKpis = <K extends PartKpi>(ks: K[]) => ks.filter((k) => !k.lacking);

/**
 * The heat distribution's KPIs (the heat recovered at its first extraction point: dataset.json heat_source lists
 * options, other designs of the same data center, never added up; the heat pump's electricity, the mean source and
 * sink temperatures, the heat pump's COP; a missing variable: null, "needs X") or the district's (its heat demand, the
 * peak and the mean). Energy = mean power x values x step; Σ over the period, as lib/partKpis.
 */
export function partKpis(scope: StructureScope, config: DatasetConfig, stats: Record<string, Stats>, stepHours: number): PartKpi[] {
  const power = (config.kpi as { power_unit?: string } | null | undefined)?.power_unit ?? "kW";
  const unit = ENERGY[power] ?? null;
  const sum = (c: string) => (stats[c]?.mean == null ? null : stats[c].mean! * stats[c].count);
  const energy = (c: string) => {
    const s = sum(c);
    return s == null || !unit ? null : (s * stepHours) / 1000;
  };
  const out: PartKpi[] = [];
  if (scope === "heat") {
    const n = heatNames(config, Object.keys(stats));
    const [qhp, pel, sink] = HEAT_VARS.map(n);
    const has = (c: string) => stats[c]?.mean != null;
    const formula = (label: string) => heatKpis(n).lines.find((l) => l.label === label)?.formula ?? undefined;
    const options = Object.entries(config.heat_source ?? {})
      .map(([name, p]) => ({ name, ...p }))
      .filter((p) => has(p.q));
    // one option: the others are other designs of the same plant (hall or condenser), their heat is not on top of it
    const point = options[0];
    const others = options.slice(1).map((p) => p.name);
    const at = point && others.length ? ` (at the ${point.name}; ${others.join(", ")}: another design)` : "";
    out.push({
      label: "Heat recovered",
      value: point ? energy(point.q) : null,
      unit,
      better: "higher",
      note: point ? `Σ ${point.q} × Δt${at}` : "needs heat_source in dataset.json",
      lacking: !point,
    });
    out.push({
      label: "Electricity consumption",
      value: energy(pel),
      unit,
      better: "lower",
      note: has(pel) ? formula("Electricity use") : `needs ${pel}`,
      lacking: !has(pel),
    });
    out.push({
      label: "Mean source temperature",
      value: point && has(point.t) ? stats[point.t].mean : null,
      unit: "°C",
      better: "higher",
      note: point && has(point.t) ? `mean of ${point.t}` : "needs heat_source t",
      lacking: !(point && has(point.t)),
    });
    out.push({
      label: "Mean sink temperature",
      value: stats[sink]?.mean ?? null,
      unit: "°C",
      better: "lower",
      note: has(sink) ? `mean of ${sink}` : `needs ${sink}`,
      lacking: !has(sink),
    });
    const lacking = [qhp, pel].filter((c) => !has(c));
    out.push({
      label: "COP",
      value: lacking.length || !sum(pel) ? null : sum(qhp)! / sum(pel)!,
      unit: null,
      better: "higher",
      note: lacking.length ? `needs ${lacking.join(", ")}` : formula("COP"),
      lacking: lacking.length > 0,
    });
  } else if (scope === "district") {
    const d = config.kpi?.heat_demand;
    if (d && stats[d]) {
      out.push({ label: "Heat demand", value: energy(d), unit, better: "lower" });
      out.push({ label: "Peak demand", value: stats[d].max, unit: power, better: "lower" });
      out.push({ label: "Mean demand", value: stats[d].mean, unit: power, better: "lower" });
    }
  }
  return out;
}
