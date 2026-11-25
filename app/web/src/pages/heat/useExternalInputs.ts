/**
 * Heat Matching's inputs from another dataset (lib/externalInputs.ts): the district's demand and the outdoor
 * temperature, each from a dataset picked on the page ("" = the data center's own), loaded on the evaluated period's
 * steps, and as `drivers`: the same series under the data center's own column names (its heat demand, dataset.json
 * kpi.heat_demand, and its outdoor temperature), for its Model's free run.
 */
import { useEffect, useMemo, useState } from "react";
import { useKept } from "../../lib/kept";
import { fetchDatasets, fetchTimeSeriesData, type DatasetInfo } from "../../api";
import { DATASET, datasetConfig, datasetOf } from "../../dataset";
import { MODEL_NAME } from "../../lib/modelCatalog";
import { errorMessage } from "../../lib/errors";
import { inputSources, onPeriod, WEATHER_COLUMNS, type InputSource } from "../../lib/externalInputs";
import { testPeriod } from "../../lib/period";

/** One picked source on `times`: its values, or why not. */
function useSeries(src: InputSource | undefined, file: string | undefined, times: number[] | undefined) {
  const [out, setOut] = useState<{ values: number[] | null; error: string | null }>({ values: null, error: null });
  useEffect(() => {
    setOut({ values: null, error: null });
    if (!src || !file || !times?.length) return;
    let live = true;
    fetchTimeSeriesData(src.id, file, [src.column])
      .then((r) => {
        const values = onPeriod(r.time, r.columns[src.column] ?? [], times);
        if (live) setOut({ values, error: values ? null : `${src.name} does not cover the evaluated period` });
      })
      .catch((e) => live && setOut({ values: null, error: `${src.name}: ${errorMessage(e)}` }));
    return () => {
      live = false;
    };
  }, [src, file, times]);
  return out;
}

/** `model`: the data center's trained model, whose test period every input is put on (null: not known yet). */
export function useExternalInputs(model: string | null = MODEL_NAME) {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  // the district picked for the District section opens as the demand (the data center's own when it is the same)
  // kept when the page is left (per standard: another district picked meanwhile starts from it)
  const standard = datasetOf("district/dashboard") === DATASET ? "" : datasetOf("district/dashboard");
  const [demandFrom, setDemandFrom] = useKept(`hm-demand-from|${standard}`, standard);
  const [weatherFrom, setWeatherFrom] = useKept("hm-weather-from", "");
  // a weather of one's own (the weather window: generated or from a file), on the period's hours: before any other
  const [custom, setCustom] = useKept<{ label: string; values: number[] } | null>("hm-weather-custom", null);
  // the period's steps and the data center's own names of the two inputs
  const [own, setOwn] = useState<{ times: number[]; demand?: string; weather?: string } | null>(null);
  useEffect(() => {
    fetchDatasets().then(
      (r) => setDatasets(r.datasets),
      () => setDatasets([]),
    );
  }, []);
  useEffect(() => {
    if (model === null) return;
    let live = true; // a slower answer for a model left meanwhile is dropped
    Promise.all([testPeriod(DATASET, model), datasetConfig()]).then(
      ([p, c]) => live && setOwn({ times: p.times, demand: c.kpi?.heat_demand, weather: WEATHER_COLUMNS.find((x) => p.columns.includes(x)) }),
      () => live && setOwn(null),
    );
    return () => {
      live = false;
    };
  }, [model]);
  const times = own?.times;
  const options = useMemo(() => inputSources(datasets, DATASET), [datasets]);
  const demandSrc = options.demand.find((o) => o.id === demandFrom);
  const weatherSrc = options.weather.find((o) => o.id === weatherFrom);
  const fileOf = (s?: InputSource) => datasets.find((d) => d.id === s?.id)?.files[0];
  const demand = useSeries(demandSrc, fileOf(demandSrc), times);
  const weather = useSeries(weatherSrc, fileOf(weatherSrc), times);
  const weatherValues = custom?.values ?? weather.values;
  const drivers = useMemo(() => {
    const out: Record<string, number[]> = {};
    if (own?.demand && demand.values) out[own.demand] = demand.values;
    if (own?.weather && weatherValues) out[own.weather] = weatherValues;
    return Object.keys(out).length ? out : undefined;
  }, [own, demand.values, weatherValues]);
  return {
    drivers,
    datasets,
    options,
    demandFrom,
    standard, // the district picked as the system: what Reset goes back to
    setDemandFrom,
    weatherFrom,
    setWeatherFrom,
    demandSrc,
    demand: demand.values,
    outTemp: weatherValues,
    custom,
    setCustom,
    times,
    error: demand.error ?? weather.error,
  };
}
