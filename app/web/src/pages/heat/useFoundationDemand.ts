/**
 * The district's demand from the pretrained forecaster (Chronos-2, backend core/foundation.py) over Heat Matching's
 * period: "rolling", each day forecast from the measurement before it; "weather", a year from the weather on screen
 * (the what-if's shift or another dataset's), each day from the measured year before it. A run takes about a minute
 * (the backend keeps the last few). `mode` null: it does not run.
 */
import { useEffect, useMemo, useState } from "react";
import { foundationDemand, type FoundationMode, type FoundationResponse } from "../../api";
import { alignToTimes } from "../../lib/demand";
import { errorMessage } from "../../lib/errors";
import { stepHoursOf } from "../../lib/period";

/**
 * Step values as hours from the first step on (the backend runs hourly; `steps` and `out_temp` are hours): the mean of
 * the steps in each hour, or the step that covers it when steps are coarser than an hour.
 */
export function toHours(times: number[], values: number[], stepHours = stepHoursOf(times)): number[] {
  const n = times.length;
  if (!n) return [];
  const out: number[] = [];
  let j = 0;
  for (let h = 0; h < Math.round(n * stepHours); h++) {
    const a = times[0] + h * 3600;
    while (j < n && times[j] < a) j++;
    let [sum, c] = [0, 0];
    for (let k = j; k < n && times[k] < a + 3600; k++) [sum, c] = [sum + values[k], c + 1];
    out.push(c ? sum / c : values[Math.max(0, j - 1)]);
  }
  return out;
}

export function useFoundationDemand(dataset: string, column: string, times: number[] | null, mode: FoundationMode | null, outTemp: number[] | null) {
  const [run, setRun] = useState<FoundationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // the weather of a "weather" run, as a value: a new array of the same numbers does not run it again
  const weather = mode === "weather" && outTemp && times ? JSON.stringify(toHours(times, outTemp).map((x) => Math.round(x * 10) / 10)) : "";
  useEffect(() => {
    setRun(null);
    setError(null);
    if (!mode || !times?.length) return;
    let live = true;
    setBusy(true);
    const steps = Math.round(times.length * stepHoursOf(times)); // hours, whatever the period's step
    foundationDemand(dataset, { column, start_time: times[0], steps, mode, ...(weather ? { out_temp: JSON.parse(weather) } : {}) })
      .then((r) => live && setRun(r))
      .catch((e) => live && setError(`The foundation model: ${errorMessage(e)}`))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [dataset, column, times, mode, weather]);
  // the hourly forecast on the period's steps, by time (interpolated). A rolling run may stop short at the end of the
  // data: those steps keep its last value, not 0 (counted as met) nor NaN (matchHeat's sums would turn NaN).
  // Memoized: a new array each render would rerun the matching.
  const kw = useMemo(() => (run?.time.length && times ? alignToTimes(run.time, run.p50, times) : null), [run, times]);
  return { kw, run, error, busy };
}
