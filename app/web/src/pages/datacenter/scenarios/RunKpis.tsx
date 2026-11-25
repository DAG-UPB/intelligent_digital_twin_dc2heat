/**
 * The data-center KPIs (PUE, ERF, ERE, the energies) of a Scenarios run, from the KPI variables the Visualization
 * defines (the summary's kpi_columns): measured against the twin, without and with the run's change. Only the data
 * center's twin: another part's Scenarios show none.
 */
import { useEffect, useMemo, useState } from "react";
import { fetchSummary, fetchTimeSeriesData, type DatasetSummary, type SimulateResponse, type StructureScope, type TrainedModel } from "../../../api";
import type { Derived } from "../../../lib/sourceMap";
import { KpiTable } from "../dashboard/WhatIfCard";
import { kpiSources, runKpis } from "./kpiRun";

export type RunKpiSetup = ReturnType<typeof useRunKpis>;

/**
 * The KPI variables of the model's data file and the columns a run asks the twin for (`columns`); the KPI columns the
 * twin does not give are read from the data once. `derived`: dataset.json "derived" (the HEX Q simulate calculates).
 */
export function useRunKpis(
  datasetId: string | null,
  model: TrainedModel | null | undefined,
  derived: Record<string, Derived> | null | undefined,
  scope?: StructureScope,
) {
  const dc = (scope ?? "dc") === "dc";
  const file = model?.file;
  const [summary, setSummary] = useState<DatasetSummary | null | undefined>(undefined); // undefined: loading, null: failed
  const [measured, setMeasured] = useState<Record<string, (number | null)[]>>({});
  useEffect(() => {
    setSummary(undefined);
    if (!dc || !datasetId || !file) return;
    let live = true;
    fetchSummary(datasetId, file).then(
      (s) => live && setSummary(s),
      () => live && setSummary(null), // no KPIs then; the run itself still shows
    );
    return () => {
      live = false;
    };
  }, [dc, datasetId, file]);
  const cols = summary?.kpi_columns?.it_power ? summary.kpi_columns : null;
  const sources = useMemo(() => (cols && model ? kpiSources(cols, model, derived) : null), [cols, model, derived]);
  const missing = sources?.measured.join(",") ?? "";
  useEffect(() => {
    setMeasured({});
    if (!datasetId || !file || !missing) return;
    let live = true;
    fetchTimeSeriesData(datasetId, file, missing.split(",")).then(
      (r) => live && setMeasured(r.columns),
      () => {}, // those columns stay out of the KPIs
    );
    return () => {
      live = false;
    };
  }, [datasetId, file, missing]);
  return {
    shown: dc && summary !== undefined && summary !== null,
    cols,
    stepHours: (summary?.resolution_seconds ?? 3600) / 3600,
    columns: sources?.twin ?? [],
    measured,
  };
}

/** The run's KPI table, or where to define the KPI variables when there are none. `withLabel`: the changed run's column. */
export function RunKpis({ setup, res, withLabel }: { setup: RunKpiSetup; res: SimulateResponse | null; withLabel: string }) {
  const { cols, stepHours, measured } = setup;
  const rows = useMemo(() => (cols && res ? runKpis(res, cols, stepHours, measured) : []), [cols, res, stepHours, measured]);
  if (!setup.shown) return null;
  if (!cols)
    return (
      <p className="muted dash__note" role="note">
        No KPI variables yet: choose them under “Choose the KPI variables” on this page’s Historical view (or KPI variables in Structure and Modelling’s
        Modelling) to see PUE, ERF and ERE of a run.
      </p>
    );
  if (!res || !rows.length) return null;
  return (
    <section aria-label="KPIs of the run">
      <div className="caps">KPIs of the run · {res.steps} steps</div>
      <KpiTable rows={rows} heads={res.baseline ? ["Measured", "Twin, no change", withLabel] : ["Measured", "Twin"]} label="KPIs: measured and the twin's" />
    </section>
  );
}
