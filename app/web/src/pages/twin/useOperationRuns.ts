/**
 * Operation's runs in the worker (operation.worker.ts): one worker per page, a job 250 ms after the last change of its
 * input (operationJob), and only the latest job's answer is shown (a sequence number; an older answer is dropped).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { operationJob, type JobInput } from "./operation";
import type { ScenarioRun } from "./operation.worker";

/** Every scenario's runs for `input` (null until the first answer) and whether a job is running. */
export function useOperationRuns(input: JobInput): { out: ScenarioRun[] | null; busy: boolean } {
  const worker = useMemo(() => new Worker(new URL("./operation.worker.ts", import.meta.url), { type: "module" }), []);
  useEffect(() => () => worker.terminate(), [worker]);
  const [out, setOut] = useState<ScenarioRun[] | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    worker.onmessage = (e: MessageEvent<{ seq: number; out: ScenarioRun[] }>) => {
      if (e.data.seq !== seq.current) return;
      setOut(e.data.out);
      setBusy(false);
    };
  }, [worker]);
  // the job reruns when one of its inputs changes (by identity, as the page passes them)
  const { times, q, cop, demand, supply, tSrc, stepHours, horizonH, objective, fees, market, cool, direct, plant, spread, scenarios } = input;
  useEffect(() => {
    const t = window.setTimeout(() => {
      seq.current += 1;
      setBusy(true);
      const job = { times, q, cop, demand, supply, tSrc, stepHours, horizonH, objective, fees, market, cool, direct, plant, spread, scenarios };
      worker.postMessage(operationJob(seq.current, job));
    }, 250);
    return () => window.clearTimeout(t);
  }, [worker, times, q, tSrc, cop, demand, supply, stepHours, horizonH, objective, fees, scenarios, plant, spread, market, cool, direct]);
  return { out, busy };
}
