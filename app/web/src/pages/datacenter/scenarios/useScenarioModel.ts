/** Loads the trained 'linear' model that every Scenarios view simulates, and lets a re-train replace it. */
import { useCallback, useEffect, useState } from "react";
import { getModel, listModels, type StructureScope, type TrainedModel } from "../../../api";
import { MODEL_NAME } from "../../../lib/modelCatalog";

/**
 * The model of `datasetId` (of its structure `scope`: the data center's by default): undefined while loading (or
 * without a dataset), null when none is trained.
 * The setter shows a freshly trained model everywhere without fetching it again.
 */
export function useScenarioModel(datasetId: string | null, scope?: StructureScope): [TrainedModel | null | undefined, (m: TrainedModel) => void] {
  const [loaded, setLoaded] = useState<{ id: string; model: TrainedModel | null } | null>(null);

  useEffect(() => {
    if (!datasetId) return;
    let live = true; // a slower answer for a dataset left meanwhile is dropped
    // listed first: a model not trained yet is no 404 in the console
    listModels(datasetId, scope)
      .then((names) => (names.includes(MODEL_NAME) ? getModel(datasetId, MODEL_NAME, scope) : null))
      .then(
        (model) => live && setLoaded({ id: datasetId, model }),
        () => live && setLoaded({ id: datasetId, model: null }),
      );
    return () => {
      live = false;
    };
  }, [datasetId, scope]);

  const replace = useCallback((model: TrainedModel) => datasetId && setLoaded({ id: datasetId, model }), [datasetId]);
  return [loaded && loaded.id === datasetId ? loaded.model : undefined, replace];
}
