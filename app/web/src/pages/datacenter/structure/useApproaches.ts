/**
 * How each variable on the structure is made, as Modelling shows it (its column, approaches.ts shownApproaches; null:
 * calculated), before Modelling below is opened:
 * read as Modelling reads it (the saved models' variables, the graph's drivers, the choices kept in this browser).
 * Once Modelling is open it reports its own (StructureLink onApproach), unsaved moves included, and that wins.
 */
import { useEffect, useMemo, useState } from "react";
import { fetchDatasets, type StructureScope } from "../../../api";
import { configOf, DATASET } from "../../../dataset";
import { chosenKeyOf, readChosen, shownApproaches, type Approach, type ApproachData } from "../modelling/approaches";
import { defaultInputs, demandOf, modelColumns } from "../modelling/inputs";
import { inputsFor, usedFor } from "../modelling/useTrainSetup";

// what was last read for each data center, part and graph file: a page opened again shows its colours at once (no grey
// first while the reads run), then the fresh reads replace it
const lastRead = new Map<string, ApproachData>();

export function useApproaches(
  scope: StructureScope,
  files: string[],
  file: string | null,
  saved: number,
  vars: string[],
  reported: Record<string, Approach | null>,
) {
  const key = `${DATASET}|${scope}|${file}`;
  const [data, setData] = useState<ApproachData | null>(() => lastRead.get(key) ?? lastRead.get(`${DATASET}|${scope}`) ?? null); // the graph file's name may come later
  const onDisk = !!file && files.includes(file); // a graph not saved yet (another part's starter) has no drivers to ask for
  useEffect(() => {
    if (!file) return;
    let live = true;
    fetchDatasets()
      .then(async (r) => {
        const ds = r.datasets.find((d) => d.id === DATASET);
        if (!ds) return;
        const drivers = onDisk ? inputsFor(ds, file, scope) : defaultInputs(modelColumns(ds), [], configOf(ds).actuators);
        const [inputs, used] = await Promise.all([drivers, usedFor(ds, scope)]);
        const chosen = readChosen(chosenKeyOf(DATASET, scope));
        const read: ApproachData = { columns: ds.columns, modelled: modelColumns(ds), inputs, used, chosen, scope, demand: demandOf(scope, ds) };
        lastRead.set(key, read);
        lastRead.set(`${DATASET}|${scope}`, read);
        if (live) setData(read);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [scope, file, saved, onDisk, key]);
  return useMemo(() => ({ ...(data ? shownApproaches(data, vars) : {}), ...reported }), [data, vars, reported]);
}
