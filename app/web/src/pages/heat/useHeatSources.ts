/**
 * Data loading of Heat Matching and Operation: the evaluated period, dataset.json, the saved heat source mapping and
 * the switched-on parts (site.json), the district demand, the data center's drivers and the columns of every
 * extraction point (measured, or the data center's Model: the trained model's free run where it gives the column).
 * A data center with no heat source in its data (none configured, saved or guessed from the column names) delivers the
 * Site map's: its waste heat kW at its temperature, held flat (`siteDc`, the point "site").
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSite, updateSite, type HeatPoint, type Site } from "../../api";
import { DATASET, datasetConfig, type DatasetConfig } from "../../dataset";
import { districtYear } from "../../lib/demandStore";
import { errorMessage } from "../../lib/errors";
import type { DcDrivers } from "../../lib/matching";
import { dcDrivers, periodColumns, testPeriod, type Period } from "../../lib/period";
import { DRIVER_COLUMNS, applyMap, asHeatSourceMap, derivable, guessHeatSourceMap, mapColumns, type HeatSourceMap } from "../../lib/sourceMap";
import { asPartComponents, type PartComponents } from "./partComponents";
import { ALL_ON, asPartsOn, type ModelInfo, type PartsOn, type Series } from "./parts";
import type { Profile } from "./points";
import { wasteKw } from "../district/siteEdits";

export type District = Awaited<ReturnType<typeof districtYear>>;

/** The data center model's IT load driver, by its name. */
// ponytail: by name (the examples' IT_Load); a variable marked "it_load" on the Physical structure page when real data names it otherwise
const IT_DRIVER = /^IT[_ ]?Load$/i;

/** Columns over the period, measured or from the model's free run (with `drivers` put in: lib/period periodColumns);
 * reloads when they, the series or the drivers change. */
export function usePeriodColumns(period: Period | null, cols: string[], series: Series, drivers?: Record<string, number[]>) {
  const [raw, setRaw] = useState<Record<string, number[]> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = cols.join("\n");
  useEffect(() => {
    if (!period || !key) return setRaw(null);
    let live = true;
    setLoading(true);
    setError(null);
    periodColumns(period, key.split("\n"), series, drivers)
      .then((c) => live && setRaw(c))
      .catch((e) => live && setError(errorMessage(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [period, key, series, drivers]);
  return { raw, loading, error };
}

/** `model`: the trained model whose free run is the data center's Model (default MODEL_NAME; null: not known yet, wait
 * for it rather than run another); `drivers`: series put in
 * for its drivers (Heat Matching's weather and demand from another dataset), memoized by the caller; `heatFrom`: the
 * dataset whose heat distribution runs (its units on or off and their plant models, in its site.json; default the
 * data center's own: each system is picked on its own); `itLoad`: the IT load as a share of the data's, put in for
 * the model's IT load driver, so its free run over the whole period answers it (heat and temperatures). */
export function useHeatSources(
  series: Series,
  opts: { model?: string | null; drivers?: Record<string, number[]>; heatFrom?: string; itLoad?: number } = {},
) {
  const { model: modelName, drivers: given, itLoad = 1 } = opts;
  const heatFrom = opts.heatFrom ?? DATASET;
  const [period, setPeriod] = useState<Period | null>(null);
  const [config, setConfig] = useState<DatasetConfig | null>(null);
  const [map, setMap] = useState<HeatSourceMap | null>(null);
  const [parts, setParts] = useState<PartsOn>(ALL_ON);
  const [partComponents, setPartComponents] = useState<PartComponents>({});
  const [district, setDistrict] = useState<District | null>(null);
  const [drivers, setDrivers] = useState<DcDrivers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapDc, setMapDc] = useState<HeatPoint | null>(null);
  const [hexOption, setHexOption] = useState<string | null>(null); // the extraction point the Structure page chose

  useEffect(() => {
    if (modelName === null) return;
    let live = true; // a slower answer for a model left meanwhile is dropped
    Promise.all([testPeriod(DATASET, modelName), datasetConfig(), fetchSite(DATASET).catch(() => null)])
      .then(([p, c, site]) => {
        if (!live) return;
        setPeriod(p);
        setConfig(c);
        const cols = p.columns.filter((x) => x !== "time");
        setMapDc(site?.source ?? null);
        setHexOption(site?.hex_option ?? null);
        // nothing to guess from: the Site map's data center, else the first column as a start to map
        const first: HeatSourceMap | null = site?.source || !cols.length ? null : { kind: "column", q: cols[0], factor: 1, t: cols[0] };
        setMap(asHeatSourceMap(site?.heat_source_map, cols) ?? guessHeatSourceMap(cols, c.heat) ?? first);
      })
      .catch((e) => live && setError(`Data center data: ${errorMessage(e)}`));
    districtYear(modelName)
      .then((d) => live && setDistrict(d))
      .catch((e) => live && setError(`District demand: ${errorMessage(e)}`));
    return () => {
      live = false;
    };
  }, [modelName]);
  // the heat distribution's units and plant models: its own dataset's
  useEffect(() => {
    let live = true; // another dataset's parts must not arrive late and be saved into this one's site.json
    fetchSite(heatFrom)
      .catch(() => null)
      .then((site) => {
        if (!live) return;
        setParts(asPartsOn(site?.heat_parts));
        setPartComponents(asPartComponents(site?.heat_components));
      });
    return () => {
      live = false;
    };
  }, [heatFrom]);

  const columns = useMemo(() => period?.columns.filter((c) => c !== "time") ?? [], [period]);
  // dataset.json heat_source (e.g. the simulation's hall and condenser HEX), when its columns exist; else the mapping
  const configured = useMemo(() => {
    const hs = Object.entries(config?.heat_source ?? {}).filter(([, v]) => columns.includes(v.q) && columns.includes(v.t));
    const back = (v: { t_out?: string; t_return?: string }) => v.t_return ?? v.t_out; // the water back from the heat distribution
    return hs.length
      ? Object.fromEntries(
          hs.map(([k, v]) => [k, { kind: "column", q: v.q, t: v.t, factor: 1, ...(back(v) && columns.includes(back(v)!) ? { t_out: back(v) } : {}) } as HeatSourceMap]),
        )
      : null;
  }, [config, columns]);
  const dataMaps = useMemo<Record<string, HeatSourceMap>>(() => configured ?? (map ? { mapped: map } : {}), [configured, map]);
  const siteDc = period && !Object.keys(dataMaps).length ? mapDc : null;
  const physicsOk = DRIVER_COLUMNS.every((c) => columns.includes(c));

  // what the trained model's free run gives: its predicted variables and drivers, and a calculated heat Q
  // (dataset.json "derived") whose parts it predicts: the free run computes Q from them
  const needed = useMemo(() => [...new Set(Object.values(dataMaps).flatMap(mapColumns))], [dataMaps]);
  const model = useMemo<ModelInfo>(() => {
    const predicted = [...(period?.model?.order ?? []), ...(period?.model?.drivers ?? [])];
    return { trained: !!period?.model, vars: new Set([...predicted, ...derivable(config?.derived, predicted)]) };
  }, [period, config]);
  // "model": each column from the free run when the trained model gives it, else as measured (not modelled: the
  // data center delivers it by its measurements)
  const fromModel = useMemo(() => (series === "model" && model.trained ? needed.filter((c) => model.vars.has(c)) : []), [series, model, needed]);
  const measured = useMemo(() => needed.filter((c) => !fromModel.includes(c)), [needed, fromModel]);

  // every change is saved to site.json by a read-modify-write, one after the other: two at once could each
  // overwrite the field the other one just wrote
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const save = (what: string, fn: (s: Site) => Site, into = DATASET) => {
    saving.current = saving.current.then(() => updateSite(into, fn)).catch((e) => setError(`Saving the ${what}: ${errorMessage(e)}`));
  };
  // the mapping once the user stops editing it
  const saveTimer = useRef<number | undefined>(undefined);
  const changeMap = (m: HeatSourceMap) => {
    setMap(m);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => save("heat source", (s) => ({ ...s, heat_source_map: m as unknown as Record<string, unknown> })), 600);
  };
  // a switched part at once (a click, not a drag), so the last click wins
  const changeParts = (p: PartsOn) => {
    setParts(p);
    save("heat distribution parts", (s) => ({ ...s, heat_parts: { ...p } }), heatFrom);
  };
  // the component replacing a part's formula, the same way
  const changePartComponents = (c: PartComponents) => {
    setPartComponents(c);
    save("heat distribution components", (s) => ({ ...s, heat_components: { ...c } as Record<string, string> }), heatFrom);
  };

  useEffect(() => {
    if (!period || !physicsOk) return;
    let live = true;
    dcDrivers(period)
      .then((d) => live && setDrivers(d))
      .catch((e) => live && setError(`Data center power and temperatures: ${errorMessage(e)}`));
    return () => {
      live = false;
    };
  }, [period, physicsOk]);

  // the columns of every extraction point: switching the extraction is then instant, and the diagram can show all
  // the IT load the model runs on: its measured IT load driver, times the what-if's share (loaded beforehand, so a moved
  // slider runs the model once)
  const itCol = period?.model?.drivers.find((d) => IT_DRIVER.test(d));
  const itRaw = usePeriodColumns(period, series === "model" && opts.itLoad !== undefined && itCol ? [itCol] : [], "actual").raw;
  const putIn = useMemo(() => {
    const it = itCol && itLoad !== 1 ? itRaw?.[itCol] : undefined;
    return it ? { ...given, [itCol!]: it.map((x) => x * itLoad) } : given;
  }, [given, itCol, itLoad, itRaw]);
  const colsModel = usePeriodColumns(period, fromModel, "model", putIn);
  const colsData = usePeriodColumns(period, measured, "actual");
  const raw = useMemo(() => {
    const m = fromModel.length ? colsModel.raw : {};
    const d = measured.length ? colsData.raw : {};
    return m && d ? { ...d, ...m } : null;
  }, [fromModel, measured, colsModel.raw, colsData.raw]);
  const cols = { loading: colsModel.loading || colsData.loading, error: colsModel.error ?? colsData.error };
  const sources = useMemo<Partial<Record<string, Profile>>>(() => {
    if (siteDc && period) return { site: { q: period.times.map(() => wasteKw(siteDc)), t: period.times.map(() => siteDc.temp_c) } };
    if (!raw) return {};
    const out: Partial<Record<string, Profile>> = {};
    for (const [k, m] of Object.entries(dataMaps)) if (mapColumns(m).every((c) => raw[c])) out[k] = applyMap(m, raw);
    return out;
  }, [raw, dataMaps, siteDc, period]);

  return {
    period,
    config,
    columns,
    configured,
    dataMaps,
    needed,
    fromModel,
    map,
    changeMap,
    parts,
    changeParts,
    partComponents,
    changePartComponents,
    physicsOk,
    model,
    district,
    drivers,
    sources,
    siteDc,
    mapDc, // the Site map's data center (Konzeption's values), also when its data runs
    hexOption,
    loading: !period || cols.loading,
    error: error ?? (cols.error && `Data center profile: ${cols.error}`),
  };
}
