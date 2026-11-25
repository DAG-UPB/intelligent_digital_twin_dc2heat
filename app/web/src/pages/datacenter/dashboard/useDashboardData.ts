/** What the Dashboard reads about its data center: the dataset's files, columns, span and step and its dataset.json
 * (names, KPI variables, prepared and aggregated variables), again on every `rev`; and the groups marked on the
 * Physical structure page (site.json pid_notes of `scope`), once per scope. A failed read goes to `onError`. */
import { useEffect, useState } from "react";
import { fetchDatasets, fetchSite, type KpiMapping, type PreparedStep, type StructureScope } from "../../../api";
import { configOf, DATASET, type DatasetConfig } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import type { Names } from "../../../lib/names";
import type { Notes } from "../structure/notes";

const NO_NAMES: Names = {};
const NO_STEPS: PreparedStep[] = [];
const NO_FILES: { name: string; source: string; step: string }[] = [];

export function useDashboardData(scope: StructureScope, rev: number, onError: (message: string) => void) {
  const [files, setFiles] = useState<string[]>([]);
  const [info, setInfo] = useState<{ columns: string[]; start: string; end: string; resolution: number | null }>({ columns: [], start: "", end: "", resolution: null });
  const [config, setConfig] = useState<DatasetConfig>(configOf(undefined));
  const [kpi, setKpi] = useState<KpiMapping | null>(null); // dataset.json "kpi", null until loaded
  const [notes, setNotes] = useState<Notes>({});

  useEffect(() => {
    fetchSite(DATASET, scope)
      .then((site) => setNotes(site.pid_notes ?? {}))
      .catch(() => setNotes({})); // no site.json yet: no groups
  }, [scope]); // once: the page is mounted per scope

  useEffect(() => {
    let live = true; // an older read must not overwrite the one after a prepared variable was added
    fetchDatasets()
      .then((r) => {
        if (!live) return;
        const d = r.datasets.find((x) => x.id === DATASET);
        setFiles(d?.files ?? []);
        setInfo({ columns: d?.columns ?? [], start: d?.time_range.start ?? "", end: d?.time_range.end ?? "", resolution: d?.resolution_seconds ?? null });
        const c = configOf(d);
        setConfig(c);
        setKpi((c.kpi ?? {}) as KpiMapping); // dataset.json keeps the whole mapping; DatasetConfig names only heat_demand
      })
      .catch((e) => live && onError(errorMessage(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onError is the page's setter
  }, [rev]);

  return {
    files,
    info,
    config,
    kpi,
    notes,
    names: config.names ?? NO_NAMES, // dataset.json names: the names shown in place of the variables' own
    recipe: config.prepared ?? NO_STEPS,
    made: config.resampled ?? NO_FILES,
  };
}
