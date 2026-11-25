/** What-if state: re-train the 'linear' model with a new split, simulate from the playhead, reveal the prediction step by step. */
import { useCallback, useMemo, useState } from "react";
import { simulateModel, trainModel, type SimulateResponse, type StructureScope, type TrainedModel } from "../../../../api";
import { errorMessage } from "../../../../lib/errors";
import { MODEL_NAME } from "../../../../lib/modelCatalog";
import { overlaysOf, retrainRequest, whatIfResultOf, type PredictionOverlay, type WhatIfConfig, type WhatIfResult } from "./whatIf";

/**
 * `model` is the dataset's saved 'linear' model (undefined while loading, null when there is none); `onModel`
 * receives the re-trained one. Errors go to `setError` (the page's error banner). `scope`: whose structure's model.
 * `kpiColumns`: the KPI columns the twin gives (RunKpis); a run then also returns them, and with overrides the
 * twin without them too (`response.baseline`), for the run's KPIs.
 */
export function useWhatIf(
  datasetId: string | null,
  file: string | null,
  playheadIndex: number,
  model: TrainedModel | null | undefined,
  onModel: (m: TrainedModel) => void,
  setError: (msg: string | null) => void,
  scope?: StructureScope,
  kpiColumns: string[] = [],
) {
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [response, setResponse] = useState<SimulateResponse | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);

  const prepare = useCallback(
    async (split: number) => {
      if (!datasetId || !file) return;
      setPreparing(true);
      setError(null);
      try {
        onModel(await trainModel(datasetId, retrainRequest(model, file, split), scope));
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setPreparing(false);
      }
    },
    [datasetId, file, model, onModel, setError, scope],
  );

  const activate = useCallback(
    async (config: WhatIfConfig) => {
      if (!datasetId || !model) return;
      setLoading(true);
      setError(null);
      try {
        const interventions = Object.entries(config.overrides).map(([variable, value]) => ({ variable, kind: "set" as const, value }));
        const kpi = kpiColumns.length > 0;
        const res = await simulateModel(
          datasetId,
          MODEL_NAME,
          {
            start: playheadIndex,
            steps: config.steps,
            interventions,
            ...(kpi && { columns: [...new Set([...model.drivers, ...model.order, ...kpiColumns])], baseline: interventions.length > 0 }),
          },
          scope,
        );
        setResult(whatIfResultOf(res, model, config.futureKnownVars));
        setResponse(res);
        setStep(0);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [datasetId, model, playheadIndex, setError, scope, kpiColumns],
  );

  const deactivate = useCallback(() => {
    setResult(null);
    setResponse(null);
    setStep(0);
  }, []);

  const stepForward = useCallback(() => result && setStep((s) => Math.min(s + 1, result.steps)), [result]);

  // stable between playhead moves, so the charts are not rebuilt while playing
  const predictionOverlays = useMemo<Record<string, PredictionOverlay>>(() => (result ? overlaysOf(result, step) : {}), [result, step]);

  return {
    active: result !== null,
    response,
    loading,
    step,
    totalSteps: result?.steps ?? 0,
    preparing,
    prepare,
    activate,
    deactivate,
    stepForward,
    predictionOverlays,
  };
}
