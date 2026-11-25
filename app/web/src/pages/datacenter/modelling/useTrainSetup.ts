/**
 * State of the Modelling under a structure (`link`, PidPage): the page's data center, its training settings (restored
 * from the saved models, else defaults), the inputs the structure's graph implies, the saved models, their
 * evaluation, and training. It models that structure: its files (the heat distribution's own), the graph file
 * picked above and the graph as drawn there. Nothing is computed by itself: the saved models are evaluated when the
 * user asks, and each evaluation asked for is stored beside them; the stored one is shown when the page opens, while
 * it scored exactly the saved models (the server checks their content) on today's levers. Only the newest
 * evaluation is shown: an answer for an older window is dropped.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  evaluateModels,
  fetchDatasets,
  fetchStoredEvaluation,
  fetchSuggestedDrivers,
  getModel,
  listModels,
  saveEquations,
  estimateTraining,
  trainModel,
  type CausalGraphResponse,
  type DatasetInfo,
  type EvaluateResponse,
  type TrainedModel,
  type TrainRequest,
} from "../../../api";
import { DATASET, configOf } from "../../../dataset";
import type { StructureLink } from "../structure/structureLink";
import type { StructureScope } from "../../../api";
import { errorMessage } from "../../../lib/errors";
import { MODEL_NAME, STRUCTURES, type ModelDef } from "../../../lib/modelCatalog";
import { sumEstimates, type TrainingEstimate } from "./estimate";
import { defaultInputs, leversOf, modelColumns } from "./inputs";

/** Inputs taken from the data for a graph file: its drivers (no parents but their own past), the actuators, weather-like columns. */
export const inputsFor = (ds: DatasetInfo, file: string, scope?: StructureScope, saved = true) =>
  // a graph not saved yet (a starter the page draws) has no file to ask: its 404 was only noise in the console
  (saved ? fetchSuggestedDrivers(ds.id, file, scope) : Promise.resolve([] as string[]))
    .catch(() => [] as string[])
    .then((suggested) => defaultInputs(modelColumns(ds), suggested, configOf(ds).actuators));

/** The data columns the training uses, as the effect below restores them: the reference model's (MODEL_NAME, else the
 * first saved), else every model column. Fetches that one model only. */
export async function usedFor(ds: DatasetInfo, scope?: StructureScope): Promise<string[]> {
  const names = await listModels(ds.id, scope).catch(() => [] as string[]);
  const ref = names.includes(MODEL_NAME) ? MODEL_NAME : STRUCTURES.map((s) => s.name).find((n) => names.includes(n));
  const m = ref ? await getModel(ds.id, ref, scope).catch(() => null) : null;
  return m?.variables_used ? m.variables_used.filter((c) => modelColumns(ds).includes(c)) : modelColumns(ds);
}

export function useTrainSetup(link: StructureLink) {
  const scope = link.scope;
  const [dataset, setDataset] = useState<DatasetInfo | null>(null);
  const graphFile = link.file;
  // training and its estimate read the saved graph: they wait while it is unsaved or new
  const needsSave = link.dirty || !graphFile || !link.files.includes(graphFile);
  // the graph as drawn above, unsaved edits included
  const graph = useMemo<CausalGraphResponse | null>(
    () => (graphFile ? { source: graphFile, targets: link.targets, link_strengths: [] } : null),
    [graphFile, link.targets],
  );
  const [used, setUsed] = useState<string[]>([]);
  // inputs taken from the data (not predicted): decided by the graph, see the effect below
  const [inputs, setInputs] = useState<string[]>([]);
  const [split, setSplit] = useState(0.5);
  const [maxLag, setMaxLag] = useState(5);
  const [models, setModels] = useState<Record<string, TrainedModel>>({});
  const [evalRes, setEvalRes] = useState<EvaluateResponse | null>(null);
  const [evaluating, setEvaluating] = useState(0); // number of models being evaluated, 0 when idle
  // where the results shown come from: the stored evaluation ("loaded"), one asked for now and stored ("saved"), none
  // stored that fits the saved models ("none"); null while the stored one is still looked for
  const [stored, setStored] = useState<"loaded" | "saved" | "none" | null>(null);
  // steps after each setpoint change that the "after setpoints" metric looks at
  const [window_, setWindow] = useState(24);
  const windowRef = useRef(window_);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDatasets()
      .then((res) => setDataset(res.datasets.find((d) => d.id === DATASET) ?? null))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  // each evaluation gets a number; only the latest one may set the results
  const evalSeq = useRef(0);
  const evaluate = useCallback(async (ds: DatasetInfo, names: string[]) => {
    const seq = ++evalSeq.current;
    if (!names.length) {
      setEvalRes(null);
      setEvaluating(0);
      return;
    }
    setEvaluating(names.length);
    try {
      const res = await evaluateModels(ds.id, { names, levers: leversOf(ds), horizon: windowRef.current, store: true }, scope);
      if (seq === evalSeq.current) {
        setEvalRes(res);
        setStored("saved");
        if (res.skipped) setError(Object.values(res.skipped).join("; ")); // scored without them: say why they are missing
      }
    } catch (e) {
      if (seq === evalSeq.current) setError(errorMessage(e));
    } finally {
      if (seq === evalSeq.current) setEvaluating(0);
    }
  }, [scope]);

  // Once the data center is known: restore the saved models and their settings (evaluated when the user asks).
  useEffect(() => {
    if (!dataset) return;
    let live = true;
    setUsed(modelColumns(dataset));
    // only the saved models are loaded (GET /models), so missing ones do not log 404s
    listModels(dataset.id, scope)
      .catch(() => [] as string[])
      .then((names) => Promise.all(STRUCTURES.filter((s) => names.includes(s.name)).map((s) => getModel(dataset.id, s.name, scope).then((m) => [s.name, m] as const).catch(() => null))))
      .then((found) => {
        const saved = Object.fromEntries(found.filter((x): x is readonly [string, TrainedModel] => !!x));
        if (!live) return;
        setModels(saved);
        const ref = saved[MODEL_NAME] ?? Object.values(saved)[0];
        if (ref) {
          setSplit(ref.split_index / ref.rows);
          if (ref.variables_used) setUsed(ref.variables_used.filter((c) => modelColumns(dataset).includes(c)));
          if (ref.max_lag_setting) setMaxLag(ref.max_lag_setting);
        }
        const names = Object.keys(saved);
        const seq = evalSeq.current;
        return (names.length ? fetchStoredEvaluation(dataset.id, scope).catch(() => null) : Promise.resolve(null)).then((st) => {
          if (!live) return;
          if (seq !== evalSeq.current) return setStored((x) => x ?? "none"); // an evaluation asked for meanwhile wins (if it fails: none)
          // stale: other models than the saved ones, or other levers (dataset.json changed)
          const fits = !!st && st.names.length === names.length && names.every((n) => st.names.includes(n)) && st.levers.join() === leversOf(dataset).join();
          if (fits) {
            windowRef.current = st.horizon; // its window after a setpoint change
            setWindow(st.horizon);
            setEvalRes(st);
          }
          setStored(fits ? "loaded" : "none");
        });
      });
    return () => {
      live = false;
    };
  }, [dataset, scope]);

  // On graph change: take from the data what it gives no causes: the graph's drivers (no parents but their own
  // past), the actuators and weather-like columns.
  const graphSaved = !!graphFile && link.files.includes(graphFile);
  useEffect(() => {
    if (!dataset || !graphFile) return;
    let live = true;
    inputsFor(dataset, graphFile, scope, graphSaved).then((inputs) => live && setInputs(inputs));
    return () => {
      live = false;
    };
    // the drivers come from the saved graph: again after a save above (link.saved)
  }, [dataset, graphFile, scope, link.saved, graphSaved]);

  /** Add a data column to the structure above as a node without links (unsaved there, like any edit). */
  const addVariable = async (v: string): Promise<string | null> => {
    if (!dataset || !graphFile) return null;
    link.onAddVariable(v);
    return `Added ${v} to the structure above (not saved yet: Save there).`;
  };

  /** A new setpoint window: evaluate the shown models again (free runs are cached on the server). */
  const changeWindow = (steps: number) => {
    windowRef.current = steps;
    setWindow(steps);
    const names = Object.keys(models);
    if (dataset && names.length) evaluate(dataset, names);
  };

  /** Save the equations, train the given models one after the other (in parallel they could exceed the memory budget), evaluate them. */
  /** The request that trains one model definition: Train and its estimate both send this. `only`: the variables
   * Modelling keeps (not in Not modelled); the used ones among them are sent. */
  const requestFor = (s: ModelDef, drivers: string[], equations: Record<string, string>, file: string, only?: string[]): TrainRequest => {
    const vars = only ? used.filter((c) => only.includes(c)) : used;
    return {
      name: s.name,
      structure: s.structure,
      graph_file: file,
      max_lag: maxLag,
      variables: vars,
      drivers: drivers.filter((c) => vars.includes(c)),
      split_fraction: split,
      model: s.kind,
      ...(s.kind === "physics" ? { equations } : {}),
    };
  };

  /** How many variable models Train would fit and roughly how long it would take, per definition and in total. */
  const estimate = async (toTrain: ModelDef[], equations: Record<string, string>, only?: string[]): Promise<TrainingEstimate | null> => {
    if (!dataset || !graphFile || !toTrain.length || needsSave) return null;
    const drivers = await inputsFor(dataset, graphFile, scope);
    const each = await Promise.all(
      toTrain.map((s) =>
        estimateTraining(dataset.id, requestFor(s, drivers, equations, graphFile, only), scope)
          .then((e) => ({ def: s, e, error: null as string | null }))
          .catch((err) => ({ def: s, e: null, error: errorMessage(err) })),
      ),
    );
    return sumEstimates(each);
  };

  const train = async (toTrain: ModelDef[], equations: Record<string, string>, only?: string[]) => {
    if (!dataset || !graphFile) return;
    if (needsSave) return setError("Save the structure above first: training reads its saved graph.");
    setBusy(true);
    setError(null);
    try {
      await saveEquations(dataset.id, equations, scope);
      const drivers = await inputsFor(dataset, graphFile, scope); // fresh: the state may still be the previous graph file's
      const trained: Record<string, TrainedModel> = {};
      for (const s of toTrain) {
        trained[s.name] = await trainModel(dataset.id, requestFor(s, drivers, equations, graphFile, only), scope);
      }
      // the other saved models stay (and in the evaluation: the stored one must cover every saved model to be loaded again)
      const all = { ...models, ...trained };
      setModels(all);
      await evaluate(dataset, Object.keys(all));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return {
    estimate,
    dataset,
    // the structure's graph files, the pick shared with the structure above
    graphFiles: [...new Set([...link.files, ...(link.file ? [link.file] : [])])],
    graphFile,
    setGraphFile: link.onFile,
    needsSave,
    /** Evaluate the saved models on the test period: only when asked (TabPFN can take a minute). */
    evaluateSaved: () => dataset && evaluate(dataset, Object.keys(models)),
    graph,
    addVariable,
    used,
    setUsed,
    inputs,
    split,
    setSplit,
    maxLag,
    setMaxLag,
    models,
    evalRes,
    evaluating,
    stored,
    window_,
    changeWindow,
    busy,
    train,
    error,
  };
}
