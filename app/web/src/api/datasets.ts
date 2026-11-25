/** Datasets (data centers) and their raw time series. */
import { getJson, putJson, query } from "./http";
import type { PreparedStep } from "./prepare";

export interface DatasetInfo {
  id: string;
  name: string;
  files: string[];
  columns: string[];
  time_range: { start: string; end: string };
  row_count: number;
  resolution_seconds: number | null;
  config?: Record<string, unknown>; // dataset.json (see dataset.ts DatasetConfig)
}

export interface TimeSeriesResponse {
  time: string[];
  columns: Record<string, (number | null)[]>; // null: a gap (the backend sends NaN as null)
  count: number;
}

/** Every dataset the backend found under app/data. */
export const fetchDatasets = () => getJson<{ datasets: DatasetInfo[] }>("/api/datasets", "Failed to fetch datasets");

/** Columns of one data file (all of them when `columns` is empty). */
export const fetchTimeSeriesData = (datasetId: string, file: string, columns?: string[]) =>
  getJson<TimeSeriesResponse>(`/api/datasets/${datasetId}/data${query({ file, columns: columns?.join(",") })}`, "Failed to fetch time series");

export interface VariableSummary {
  name: string;
  role: "actuator" | "heat" | "lever" | "measured";
  calculated?: boolean; // dataset.json "derived": Q = m · cp · (T_in − T_out), not a model target
  prepared?: boolean; // made on the Dashboard (dataset.json "prepared"), kept next to the data
  count: number;
  missing: number;
  mean: number | null;
  std: number | null;
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
  histogram: { edges: number[]; counts: number[] };
}

/** A data-center KPI the data supports; `unit` null: the note names the column instead. */
export interface SummaryKpi {
  label: string;
  value: number | null;
  unit: string | null;
  note: string;
}

/** GET /summary: what the Dashboard shows for one data file (docs/concepts/dashboard.md). */
export interface DatasetSummary {
  file: string;
  rows: number;
  start: string | null;
  end: string | null;
  resolution_seconds: number | null;
  duration_hours: number;
  completeness: number | null;
  gaps: { count: number; longest_hours: number };
  variables: VariableSummary[];
  correlation: { names: string[]; matrix: (number | null)[][] };
  series: { time: string[]; columns: Record<string, (number | null)[]> };
  kpis: SummaryKpi[];
  kpi_note: string | null;
  /** which column plays which KPI role (backend core/summary.kpi_columns): the what-if recomputes the KPIs on the twin.
   * other_power: the facility's other electricity (UPS and distribution losses, lighting, building), summed; absent = none */
  kpi_columns?: { it_power: string | null; cooling_power: string | null; heat_demand: string | null; heat_power: string[]; other_power?: string[]; reuse_point: string | null; power_unit: string | null };
  /** share missing per variable, in the same bins as series */
  missing_map: Record<string, number[]>;
  /** mean by weekday (Monday first) and hour, 7 x 24, per variable; null without rows */
  profile: Record<string, (number | null)[][]> | null;
  recommendations: Recommendation[];
  /** load duration curve: the value exceeded 0 %, 1 %, ..., 100 % of the time (101 points, highest first) */
  duration: Record<string, number[]>;
  /** by hour of day (24): mean and the 10-90 % band */
  daily: Record<string, { p10: (number | null)[]; mean: (number | null)[]; p90: (number | null)[] }>;
  /** autocorrelation at lags 1, 2, ... steps */
  acf: Record<string, (number | null)[]>;
  /** mean by month (January first, 12; null without data) */
  monthly: Record<string, (number | null)[]>;
}

/** A preprocessing recommendation (backend/core/recommend.py); `step` prepares the fix with one click. */
export interface Recommendation {
  kind: string;
  severity: "warn" | "info";
  variables: string[];
  text: string;
  step?: PreparedStep;
}

/** Statistics, correlations, a downsampled view and KPIs of one data file (default: the first). */
export const fetchSummary = (datasetId: string, file?: string) =>
  getJson<DatasetSummary>(`/api/datasets/${datasetId}/summary${query({ file })}`, "Failed to load the dashboard");

/** Which variables stand for the data-center KPIs (dataset.json "kpi"); what is left out is not in the data. */
export interface KpiMapping {
  it_power?: string | null;
  cooling_power?: string | null;
  other_power?: string[]; // the facility's other electricity, summed: with it and the cooling, PUE is the full one
  heat_power?: string[];
  heat_demand?: string | null;
  reuse?: Record<string, string> | null; // without heat_power: alternative heat-recovery points, option -> heat
  power_unit?: "W" | "kW" | "MW" | null;
}

/** Save the KPI variables (an empty mapping removes it: back to the default names). */
/** Names shown in place of variables' own ({variable: name}; "" gives the own name back): all names now set. */
export const saveVariableNames = (datasetId: string, names: Record<string, string>) =>
  putJson<{ names: Record<string, string> }>(`/api/datasets/${datasetId}/names`, { names }, "Could not save the names");
export const saveKpiMapping = (datasetId: string, mapping: KpiMapping) =>
  putJson<KpiMapping>(`/api/datasets/${datasetId}/kpi`, mapping, "Could not save the KPI variables");
