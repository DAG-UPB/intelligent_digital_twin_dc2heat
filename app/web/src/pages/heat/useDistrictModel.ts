/**
 * The district's demand from a model trained in its own Structure and Modelling (scope "district"): its free run over
 * Heat Matching's period, with the shared weather put in for its outdoor temperature when it is one of its drivers (the
 * what-if's shift or another dataset's weather). `name` null: no trained model runs (its profile or measured demand do).
 */
import { useEffect, useState } from "react";
import { getModel, simulateModel } from "../../api";
import { DATASET } from "../../dataset";
import { errorMessage } from "../../lib/errors";
import type { Period } from "../../lib/period";

const OUT_T = "Out_Temp"; // the outdoor temperature's column (lib/sourceMap DRIVER_COLUMNS)

export function useDistrictModel(period: Period | null, name: string | null, target: string, outTemp: number[] | null) {
  const [kw, setKw] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // a new run keeps the last demand until its own is in: the page keeps its result (and its place) meanwhile
  useEffect(() => {
    setError(null);
    if (!period || !name) {
      setKw(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    const n = period.times.length;
    getModel(DATASET, name, "district")
      .then((m) => {
        if (!m.order.includes(target)) throw new Error(`the model ${name} does not make ${target}`);
        if (!outTemp && m.drivers.includes(OUT_T)) return null; // its weather is on its way: one run with it, not one before
        const drivers = outTemp && m.drivers.includes(OUT_T) ? { [OUT_T]: outTemp.slice(0, n) } : undefined;
        return simulateModel(DATASET, name, { start: period.start, steps: n, columns: [target], ...(drivers ? { drivers } : {}) }, "district");
      })
      .then((r) => r && live && setKw(((r.scenario[target] as number[]) ?? []).map((x) => Math.max(0, x ?? 0))))
      .catch((e) => live && setError(`The district's model: ${errorMessage(e)}`))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [period, name, target, outTemp]);
  return { kw, error, loading };
}
