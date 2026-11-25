/**
 * Intelligent Digital Twin › Heat Matching (#/twin/matching; #/heat/flow before): the data center's waste heat against the district's
 * demand, step by step over the evaluated period, through the heat distribution (direct HEX, heat pump, thermal storage;
 * each can be switched off). Each of the three parts runs its Model, what its Structure and Modelling delivers at its
 * connection points (pages/heat/ports.ts), or the page's Calculation, the built-in formulas. This page holds the
 * user's choices and lays out the flow diagram, KPIs, cards and charts; loading is in useHeatSources, the part logic
 * in ../heat/parts.ts, the matching in lib/matching.ts and the window maths in ../heat/window.ts.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useKept } from "../../lib/kept";
import { fetchSite, listModels, pidImageUrl, updateSite, type FoundationMode } from "../../api";
import { chooseSectionDataset, DATASET, datasetOf } from "../../dataset";
import { TABS } from "../../app/routes";
import { syntheticOutdoor } from "../../lib/demand";
import { CP_WATER } from "../../lib/constants";
import { fmt } from "../../lib/format";
import { DEFAULT_OPTIONS, DEFAULT_SOURCE_PHYSICS, physicsSource, type MatchOptions, type SourcePhysics } from "../../lib/matching";
import { CO2, co2SavedT } from "../../lib/partKpis";
import { profileKw } from "../../lib/profile";
import { shiftOf, withWeather, type Season } from "../../lib/weatherFit";
import { YearPicker } from "./YearPicker";
import { AALBORG_RESIDENTIAL, loadProfile } from "../../lib/profilePresets";
import { MODEL_NAME, STRUCTURES } from "../../lib/modelCatalog";
import { DRIVER_COLUMNS } from "../../lib/sourceMap";
import { ErrorBanner } from "../../ui/ErrorBanner";
import { Kpi, KpiRow } from "../../ui/Kpi";
import { MatchDetail } from "./MatchDetail";
import { WeatherWindow } from "./WeatherWindow";
import { chosenKeyOf, readChosen } from "../datacenter/modelling/approaches";
import { renameFor } from "../datacenter/structure/bindSetup";
import { Note } from "../heat/controls";
import { WindowChart, type ChartSeries } from "../heat/HeatCharts";
import { HeatFlowDiagram, type DiagramProps, type WeatherMeans } from "../heat/HeatFlowDiagram";
import { alignedCards } from "../heat/PartViews";
import { DEFAULT_WAYS, districtSource, LOOP_DT, loopTemps, recoveryOf, wayOf, type Logic, type Part, type Way, type WhyNot } from "../heat/parts";
import { activeComponents, PLANTS, type Plant } from "../heat/partComponents";
import { DistrictCard, HeatDistributionCard, type SetOption } from "../heat/PlantCards";
import { LIQUID_POINTS, PHYSICS_POINTS, type Profile } from "../heat/points";
import { dcPoints, pointTitle } from "../heat/ports";
import { heatFacts } from "../../lib/heatFacts";
import { Co2Info, HouseholdsInfo } from "./HeatFactsInfo";
import { SourceCard } from "../heat/SourceCard";
import { useDistrictModel } from "../heat/useDistrictModel";
import { useFoundationDemand } from "../heat/useFoundationDemand";
import { useExternalInputs } from "../heat/useExternalInputs";
import { useHeatSources, usePeriodColumns } from "../heat/useHeatSources";
import { useComponentList } from "../heat/usePartComponents";
import { defaultCurve, DESIGN_OUTDOOR, HEATING_LIMIT } from "../../lib/networkTemps";
import { meanOver, whenOf, windowAt, windowFlows, windowOf } from "../heat/window";
import { useCommand, useSnapshotDetail } from "../../lib/live";
import { matchingKpis, partWay } from "./matchingDetail";
import { buildSetup, saveSetup } from "./matchingSetup";
import { resolveDemand, supplyOf } from "./matchingInputs";
import { useMatchRun } from "./useMatchRun";
import { DcSystemLoad, DistrictSystemLoad, HeatSystemLoad } from "./SystemLoads";
import { IDLE_SHARE, wasteKw } from "../district/siteEdits";
import "../heat/heat.css";

/** The what-if levers: changed on the page, applied together by "Run scenario". */
type Levers = {
  dT: number;
  season: Season;
  cold: number;
  demScale: number;
  tSup: number | null;
  tRet: number | null;
  curve: boolean;
  tSummer: number | null;
  srcDT: number;
  itLoad: number;
  weatherFrom: string;
  demandFrom: string;
  at: string; // the data center's heat extraction point (dataset.json heat_source: hall, condenser…)
  // the data center as on the Site map (Konzeption), null: as there: installed kW, utilization, idle power, heat used (0..1)
  dcKw: number | null;
  dcUtil: number | null;
  dcIdle: number | null;
  dcUsed: number | null;
};

export default function HeatDistributionPage() {
  const [ways, setWays] = useKept<Record<Part, Way>>("hm-ways", DEFAULT_WAYS);
  const pickWay = (k: Part) => (w: Way) => setWays((o) => ({ ...o, [k]: w }));
  const [phys, setPhys] = useKept<SourcePhysics>("hm-phys", DEFAULT_SOURCE_PHYSICS);
  const [compare, setCompare] = useKept("hm-compare", true);
  const [atPick, setAt] = useKept<string | null>("hm-atPick", null);
  const [scale, setScale] = useKept("hm-scale", 1); // how many such data centers
  const [itRun, setItRun] = useKept("hm-itRun", 1); // what if: the IT load, as a share of the data's (the model runs the year on it)
  const [opts, setOpts] = useKept<MatchOptions>("hm-opts", DEFAULT_OPTIONS);
  const [week, setWeek] = useKept("hm-week", 2);
  const [cpWater, setCpWater] = useKept("hm-cpWater", CP_WATER); // kJ/(kg·K), for the water where the data gives none
  const [dT, setDT] = useKept("hm-dT", 0); // what if: the outdoor temperature shifted, for every part that runs on the weather
  const [season, setSeason] = useKept<Season>("hm-season", "year"); // what if: when the shift applies
  const [cold, setCold] = useKept("hm-cold", 0); // what if: the coldest week this many K colder still (a cold spell)
  const [weatherOpen, setWeatherOpen] = useState(false); // the weather window (WeatherWindow): a click on the weather band
  const [demScale, setDemScale] = useKept("hm-demScale", 1); // what if: the district's demand, as a share of its profile's or data's
  // what if: the network's temperatures (null: the Site map's), the supply on a heating curve, the data center's water warmer
  const [tSup, setTSup] = useKept<number | null>("hm-tSup", null);
  const [tRet, setTRet] = useKept<number | null>("hm-tRet", null);
  const [curve, setCurve] = useKept("hm-curve", false);
  const [tSummer, setTSummer] = useKept<number | null>("hm-tSummer", null);
  const [srcDT, setSrcDT] = useKept("hm-srcDT", 0);
  const [dcKw, setDcKw] = useKept<number | null>("hm-dcKw", null);
  const [dcUtil, setDcUtil] = useKept<number | null>("hm-dcUtil", null);
  const [dcIdle, setDcIdle] = useKept<number | null>("hm-dcIdle", null);
  const [dcUsed, setDcUsed] = useKept<number | null>("hm-dcUsed", null);
  const set: SetOption = (k) => (v) => setOpts((o) => ({ ...o, [k]: v }));

  // what if: the weather and the demand from another dataset (a district's), also into the data center's Model, and
  // which of its trained models runs
  const [dcModel, setDcModel] = useState<string | null>(null); // null until its site.json says which: no run of another first
  const ext = useExternalInputs(dcModel); // on the same period as the data center's model
  const [dcModels, setDcModels] = useState<string[]>([]);
  useEffect(() => void listModels(DATASET).then(setDcModels, () => setDcModels([])), []);
  // the model each structure runs here is kept in its own site.json: the data center's in the data center's
  useEffect(() => void fetchSite(DATASET).then((s) => setDcModel(s.twin_model || MODEL_NAME), () => setDcModel(MODEL_NAME)), []);
  const chooseDcModel = (m: string) => {
    setDcModel(m);
    updateSite(DATASET, (s) => ({ ...s, twin_model: m })).catch(() => {}); // not saved (read-only): it still runs
  };
  // the three systems, each picked on its own: the data center is the page's, the heat distribution and the district
  // those picked for their sections (and picked here for them too)
  const [heatFrom, setHeatFrom] = useState(() => datasetOf("heat/dashboard"));
  const sectionRoutes = (tab: string) => TABS.find((t) => t.id === tab)?.subs.map((x) => `${tab}/${x.id}`) ?? [];
  const pickHeat = (id: string) => {
    setHeatFrom(id);
    chooseSectionDataset(sectionRoutes("heat"), id);
  };
  // the district picked as the system is the standard, not a what-if (Reset goes back to it)
  const pickDistrict = (id: string) => {
    ext.setDemandFrom(id === DATASET ? "" : id);
    chooseSectionDataset(sectionRoutes("district"), id);
  };
  const data = useHeatSources("model", { model: dcModel, drivers: ext.drivers, heatFrom, itLoad: itRun });
  // what if the data center were as set here and not as on the Site map: its heat (model, data or the map's) times the
  // change of its mean waste heat (siteEdits.wasteKw). ponytail: one factor for the whole year, not a new model run
  const site0 = data.mapDc;
  const dcFactor =
    site0 && wasteKw(site0) > 0
      ? wasteKw({
          power_kw: dcKw ?? site0.power_kw,
          utilization: dcUtil ?? site0.utilization,
          idle_share: dcIdle ?? site0.idle_share,
          heat_used_share: dcUsed ?? site0.heat_used_share,
        }) / wasteKw(site0)
      : 1;
  const heatX = scale * dcFactor;
  // a dataset's name as the pickers show it (its dataset.json name)
  const nameOf = (id: string) => {
    const d = ext.datasets.find((x) => x.id === id);
    return (d?.config as { name?: string } | undefined)?.name ?? d?.name ?? id;
  };
  const { period, config, columns, district, drivers, sources, physicsOk, parts } = data;

  // the data center: its Model at its extraction points, or the formulas at theirs (a liquid-cooled one has its rack water)
  const liquid = !!config?.heat_source?.liquid;
  const dcWhy: WhyNot = {
    model: Object.keys(data.dataMaps).length || data.siteDc ? null : "no waste heat delivered yet: set its connection points in Data Center › Structure and Modelling",
    calculation: physicsOk ? null : `needs the columns ${DRIVER_COLUMNS.join(", ")}`,
  };
  const mode: Logic = wayOf(ways.dc, dcWhy) === "model" ? "data" : "physics";
  // no heat source in its data: the Site map's data center (its kW and °C, flat)
  const keys = mode === "physics" ? (liquid ? LIQUID_POINTS : PHYSICS_POINTS) : data.siteDc ? ["site"] : Object.keys(data.dataMaps);
  // the picked point (a what-if); else the one the data center's Structure page chose (site.json hex_option); else the
  // rack water of a liquid-cooled data center (the hottest), else the condenser
  const at =
    atPick && keys.includes(atPick)
      ? atPick
      : data.hexOption && keys.includes(data.hexOption)
        ? data.hexOption
        : (["liquid", "condenser"].find((k) => keys.includes(k)) ?? keys[0]);
  const pointVars = useMemo(() => dcPoints(config, data.map).find((x) => x.id === at)?.vars ?? null, [config, data.map, at]);

  // the heat distribution: the plant models picked under its Structure and Modelling (a built-in formula for the rest),
  // or the built-in formulas; keyed by a string, as a new `active` reruns the components
  const comps = useComponentList();
  const { partComponents } = data;
  const onUnits = PLANTS.filter((k) => parts[k]).join();
  const picked = useMemo(() => activeComponents(partComponents, comps.list, (onUnits ? onUnits.split(",") : []) as Plant[]), [partComponents, comps.list, onUnits]);
  // its models trained in its Modelling: its Model, shown (its units still run their plant models or formulas)
  const [heatTrained, setHeatTrained] = useState<string[]>([]);
  useEffect(() => {
    let live = true; // another heat distribution's models must not arrive late
    listModels(heatFrom, "heat").then(
      (m) => live && setHeatTrained(m),
      () => live && setHeatTrained([]),
    );
    return () => {
      live = false;
    };
  }, [heatFrom]);
  const heatWhy: WhyNot = {
    model:
      Object.keys(picked).length || heatTrained.length
        ? null
        : "no model yet: train one, or pick its plant models, under Heat Distribution › Structure and Modelling",
    calculation: null,
  };
  const heatModel = wayOf(ways.heat, heatWhy) === "model";
  const active = useMemo(() => (heatModel ? picked : {}), [heatModel, picked]);

  // the district: its demand as its Structure and Modelling makes it (a profile, or measured), or the Site map's heat sinks
  const demVar = config?.kpi?.heat_demand ?? "Q_houses";
  // the shared weather, shifted by the what-if: the demand's profile and the data center's calculation run on it
  const baseOut = useMemo(() => ext.outTemp ?? district?.outTemp ?? [], [ext.outTemp, district]);
  // the shift per step: in its season, plus the cold spell (lib/weatherFit shiftOf)
  const dTs = useMemo(() => (district ? shiftOf(district.times, baseOut, dT, season, cold, district.stepHours) : []), [district, baseOut, dT, season, cold]);
  const shifted = dTs.some((d) => d !== 0);
  const outTemp = useMemo(() => (district ? baseOut.map((x, i) => x + (dTs[i] ?? 0)) : []), [district, baseOut, dTs]);
  // and the IT load: the IT power and the cooling's with it
  // ponytail: the cooling's power scaled with the IT's, as a share; its fixed part (fans, pumps at idle) when it matters
  const weatherDrivers = useMemo(() => {
    const outT = ext.outTemp ?? drivers?.outT;
    const it = drivers && itRun !== 1 ? { ...drivers, ite: drivers.ite.map((x) => x * itRun), hvac: drivers.hvac.map((x) => x * itRun) } : drivers;
    return it && outT && (shifted || ext.outTemp) ? { ...it, outT: outT.map((x, i) => x + (dTs[i] ?? 0)) } : it;
  }, [drivers, dTs, shifted, ext.outTemp, itRun]);
  const distSrc = useMemo(() => districtSource(readChosen(chosenKeyOf(DATASET, "district"))[demVar], demVar, columns), [demVar, columns]);
  const distWhy: WhyNot = { model: "why" in distSrc ? distSrc.why : null, calculation: null };
  const distModel = wayOf(ways.district, distWhy) === "model";
  const demCol = "column" in distSrc ? distSrc.column : null;
  const demLoad = usePeriodColumns(period, distModel && demCol ? [demCol] : [], "actual");
  const profiled = useMemo(() => {
    if (!distModel || !district || !("from" in distSrc) || distSrc.from !== "profile") return null;
    const { spec } = loadProfile(`profiles:${DATASET}:district:${demVar}`, AALBORG_RESIDENTIAL);
    return profileKw(spec, district.times, outTemp, district.stepHours, syntheticOutdoor);
  }, [distModel, district, distSrc, demVar, outTemp]);
  const measuredDemand = distModel ? (profiled ? undefined : demCol ? demLoad.raw?.[demCol] : undefined) : district?.kw;
  // or the district's own trained model (its Structure and Modelling), picked under its switch and kept in its site.json
  const [distModels, setDistModels] = useState<string[]>([]);
  const [distTrained, setDistTrained] = useState<string | null>(null);
  useEffect(() => {
    listModels(DATASET, "district").then(setDistModels, () => setDistModels([]));
    fetchSite(DATASET, "district").then((s) => setDistTrained(s.twin_model ?? null), () => {});
  }, []);
  const distRun = useDistrictModel(distModel && distTrained && distModels.includes(distTrained) ? period : null, distTrained, demVar, outTemp.length ? outTemp : null);
  // or the pretrained forecaster (Chronos-2) on the district's measured demand: day-ahead on it, or a year from the weather on screen
  const [fmMode, setFmMode] = useKept<FoundationMode | null>("hm-fmMode", null);
  const fmFrom = ext.demandSrc ?? { id: DATASET, name: config?.name ?? DATASET, column: demVar };
  const fm = useFoundationDemand(fmFrom.id, fmFrom.column, district?.times ?? null, fmMode, outTemp.length ? outTemp : null);
  // measured, it follows the shifted weather by its own fitted slope (lib/weatherFit); a profile runs on the weather itself
  // another dataset's demand stands in for all of it, and follows the shifted weather the same way
  const demand = useMemo(
    () =>
      resolveDemand({ fmMode, fmKw: fm.kw, extDemand: ext.demand, distRunKw: distRun.kw, profiled, measured: measuredDemand, districtOut: district?.outTemp, baseOut, dTs, shifted, demScale }),
    [ext.demand, baseOut, profiled, measuredDemand, district, dTs, shifted, demScale, distRun.kw, fmMode, fm.kw],
  );
  const distSource = fmMode
    ? fm.run
      ? `${fmFrom.column} of ${fmFrom.name} from Chronos-2: ${fmMode === "rolling" ? "day-ahead forecasts" : "a year from the weather on screen"}, ${fm.run.history}`
      : fm.busy
        ? "Chronos-2 is forecasting the year (about a minute)…"
        : `Chronos-2: no demand yet`
    : ext.demandSrc
    ? `${ext.demandSrc.column} of ${ext.demandSrc.name}, as measured`
    : distRun.kw && distTrained
      ? `${demVar} from the district's trained model ${STRUCTURES.find((d) => d.name === distTrained)?.label ?? distTrained}`
      : demCol
      ? `${demCol}, as measured`
      : `The profile of ${demVar}`;

  // the heat at an extraction point is already what its HEX passes (its data's HEX Q, or the calculation's η): the HEX
  // efficiency applies only to raw waste heat (the Site map's data center, a mapped column)
  const recovered = mode === "physics" || !!data.configured;
  const runOpts = useMemo<MatchOptions>(
    () => ({ ...opts, recovery: recoveryOf(parts), tankKwh: parts.tank ? opts.tankKwh : 0, ...(recovered && { hexEff: 1 }) }),
    [opts, parts, recovered],
  );

  const physSources = useMemo<Partial<Record<string, Profile>>>(
    () =>
      weatherDrivers
        ? Object.fromEntries((liquid ? LIQUID_POINTS : PHYSICS_POINTS).map((k) => [k, physicsSource(k as "hall" | "condenser" | "liquid", weatherDrivers, phys, liquid)]))
        : {},
    [weatherDrivers, phys, liquid],
  );
  const profiles = mode === "physics" ? physSources : sources;
  // the data center's waste heat and its water from its Model's data follow the shifted weather by their fitted slopes;
  // its Calculation runs on the weather itself (weatherDrivers)
  const src0 = profiles[at];
  const src1 = useMemo(
    () =>
      src0 && mode !== "physics" && shifted && district
        ? {
            ...src0,
            q: withWeather(src0.q, baseOut, dTs),
            t: withWeather(src0.t, baseOut, dTs, -273),
            // the water back from the heat distribution too: a warmer year warms the loop's return
            ...(src0.tOut && { tOut: withWeather(src0.tOut, baseOut, dTs, -273) }),
          }
        : src0,
    [src0, mode, dTs, shifted, district, baseOut],
  );
  const src = useMemo(() => (src1 && srcDT ? { ...src1, t: src1.t.map((x) => x + srcDT) } : src1), [src1, srcDT]);
  const dataSrc = sources[at] ?? Object.values(sources)[0];
  const stepHours = district?.stepHours ?? period?.stepHours ?? 1;
  const n = src && demand ? Math.min(src.q.length, demand.length) : 0;
  const q = useMemo(() => (src ? src.q.slice(0, n).map((x) => x * heatX) : []), [src, n, heatX]);
  const qData = useMemo(() => (mode === "physics" && compare && dataSrc ? dataSrc.q.slice(0, n).map((x) => x * heatX) : null), [mode, compare, dataSrc, n, heatX]);
  // the network's supply per step: the Site map's, or the what-if's, fixed or on the heating curve over the outdoor temperature
  const supplyBase = tSup ?? district?.settings.supplyTemp;
  const ret = tRet ?? district?.settings.returnTemp;
  const summerSup = tSummer ?? (supplyBase !== undefined && ret !== undefined ? defaultCurve(supplyBase, ret).summer : undefined);
  const supply = useMemo(() => supplyOf(supplyBase, curve, summerSup, outTemp, n), [supplyBase, curve, summerSup, outTemp, n]);
  const { res, partSeries, error: runsError } = useMatchRun({ active, src, n, q, demand, supply, ret, opts: runOpts, stepHours });
  const availLabel = mode === "physics" ? "DC heat · calculation" : "DC heat · model";
  const chartSeries = useMemo<ChartSeries | null>(() => {
    if (!res || !district || !demand) return null;
    const delivered = res.direct.map((d, i) => d + res.hp[i] + res.fromTank[i]);
    return { xs: district.times.slice(0, n), q, qData, demand: demand.slice(0, n), delivered, availLabel };
  }, [res, district, demand, n, q, qData, availLabel]);

  const spanSec = n * stepHours * 3600;
  const win = windowOf(n, stepHours, week);
  const { a, b } = win;
  const periodName = spanSec >= 360 * 86400 ? "Year" : "Test period";
  const flows = useMemo(() => (res && demand && src ? windowFlows(res, q, src.t, demand, a, b) : null), [res, demand, src, q, a, b]);

  // the weather the three parts share: the outdoor temperature the demand runs on, the humidity and the sun from the data
  const weatherCols = useMemo(() => {
    const to = config ? renameFor(columns, config) : {};
    const col = (v: string) => to[v] ?? (columns.includes(v) ? v : undefined);
    return { hum: col("humidity"), sun: col("solar_radiation") };
  }, [config, columns]);
  const weatherRaw = usePeriodColumns(period, [weatherCols.hum, weatherCols.sun].filter((c): c is string => !!c), "actual").raw;
  const humidity = weatherCols.hum ? weatherRaw?.[weatherCols.hum] : undefined;
  const weather: WeatherMeans = {
    t: outTemp.length ? meanOver(outTemp, a, b) : undefined,
    hum: weatherCols.hum && weatherRaw?.[weatherCols.hum] ? meanOver(weatherRaw[weatherCols.hum], a, b) : undefined,
    sun: weatherCols.sun && weatherRaw?.[weatherCols.sun] ? meanOver(weatherRaw[weatherCols.sun], a, b) : undefined,
  };
  // the data center's cₚ: its data's (Q calculated from ṁ, dataset.json derived), else air at the hall, else water
  const derivedQ = mode !== "physics" && pointVars?.q ? config?.derived?.[pointVars.q] : undefined;
  const cpDc = derivedQ?.cp ?? (at === "hall" ? 1.006 : cpWater);

  // window means of every extraction point, for the diagram's data-center box
  const points = useMemo(() => {
    const out: Partial<Record<string, { q: number; t: number }>> = {};
    for (const [x, p] of Object.entries(profiles)) if (p) out[x] = { q: meanOver(p.q, a, b) * heatX, t: meanOver(p.t, a, b) };
    return out;
  }, [profiles, a, b, heatX]);

  // supply and return of the data center's heat loop: delivered where its Model has a return, else assumed
  // (the hall air returns cooler by the rack ΔT, the rack water by its ΔT, other water by LOOP_DT)
  const loop = useMemo(() => {
    if (!src) return null;
    const source = loopTemps(src, a, b, mode !== "physics" ? LOOP_DT : at === "hall" ? phys.rackDt : at === "liquid" ? phys.liquidDt : LOOP_DT);
    return { hex: source, hp: source };
  }, [src, a, b, mode, at, phys.rackDt, phys.liquidDt]);

  // what the diagram shows of a part run by a component: its window mean
  const diagOpts = useMemo<MatchOptions>(() => {
    const { hpCap, tankKwh, hexTOut } = partSeries;
    return {
      ...runOpts,
      ...(hpCap && { hpCapacity: meanOver(hpCap, a, b) }),
      ...(tankKwh && parts.tank && { tankKwh: meanOver(tankKwh, a, b) }),
      ...(hexTOut && src && { approach: meanOver(src.t, a, b) - meanOver(hexTOut, a, b) }),
    };
  }, [runOpts, partSeries, a, b, parts.tank, src]);

  const xs = chartSeries?.xs ?? [];
  const T = res?.totals;
  const ds0 = district?.settings;
  // the network's temperatures the window shows: the supply's mean over it (on a heating curve it moves with the weather)
  const ds = ds0 && supply !== undefined ? { ...ds0, supplyTemp: typeof supply === "number" ? supply : meanOver(supply, a, b), returnTemp: ret ?? ds0.returnTemp } : ds0;
  // working live with the assistant (lib/live.ts): what the page shows as numbers, and the controls it cannot click
  const isoDay = (t: number | undefined) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : null);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  // the flow diagram as this page draws it (its window's means), for Operation's small copy of it
  const dcDrawing = config?.kind !== "simulation" || config.blank ? "picture" : liquid ? "liquid" : config.plant?.free_cooling === "plate_hex" ? "free-cooling" : "air";
  const picture = dcDrawing === "picture" ? pidImageUrl(DATASET) : undefined; // a real data center: its own P&ID
  const diagram = useMemo<DiagramProps | null>(
    () =>
      flows && ds
        ? {
            f: flows,
            opts: diagOpts,
            on: parts,
            settings: ds,
            at,
            points,
            keys,
            itKw: drivers ? meanOver(drivers.ite, a, b) * itRun * scale : undefined,
            mode,
            loop,
            cp: { dc: cpDc, water: cpWater },
            dcDerived: derivedQ ? "q" : "m",
            weather,
            models: { dc: mode !== "physics", heat: heatModel, district: distModel },
            dcDrawing,
            picture,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- weather is a new object each render: its numbers are the key
    [flows, ds, diagOpts, parts, at, points, keys, drivers, a, b, scale, itRun, mode, loop, cpDc, cpWater, derivedQ, weather.t, weather.hum, weather.sun, heatModel, distModel, dcDrawing, picture],
  );
  // what Operation runs on (matchingSetup.ts): this plant, its inputs as computed here, once they settle
  // what the heat came from: a data center without a trained model runs on its measurement or the Site map's (before, it
  // was named "Trained model · LR" whether one existed or not)
  const dcFromLabel =
    mode === "physics"
      ? "Calculation"
      : data.fromModel.length
        ? `Trained model · ${STRUCTURES.find((d) => d.name === dcModel)?.label ?? dcModel}`
        : data.siteDc
          ? "Site map"
          : "Measured";
  useEffect(() => {
    if (!res || !src || !demand || supply === undefined || !district || fm.busy) return;
    const t = window.setTimeout(() => {
      saveSetup(
        buildSetup({
          dataset: DATASET,
          saved: Date.now(),
          at: at ?? "",
          dcFrom: dcFromLabel,
          demandFrom: distSource,
          parts,
          opts: runOpts,
          partSeries,
          stepHours,
          n,
          times: district.times,
          q,
          tSrc: src.t,
          demand,
          supply,
          res,
          outTemp,
          humidity,
          diagram,
        }),
      );
    }, 800);
    return () => window.clearTimeout(t);
  }, [res, src, demand, supply, district, fm.busy, n, at, dcFromLabel, distSource, parts, partSeries, runOpts, stepHours, q, diagram, outTemp, humidity]);
  useSnapshotDetail(() => ({
    heat_matching: {
      period: { name: periodName, steps: n, step_hours: stepHours, from: isoDay(xs[0]), to: isoDay(xs[n - 1]) },
      parts: {
        dc: { chosen: ways.dc, runs: mode === "physics" ? "calculation" : "model", why_not: dcWhy },
        heat: { chosen: ways.heat, runs: heatModel ? "model" : "calculation", why_not: heatWhy, plant_models: Object.keys(active) },
        district: { chosen: ways.district, runs: distModel ? "model" : "calculation", why_not: distWhy, demand_from: distSource },
      },
      extraction_point: at ?? null,
      extraction_points: keys,
      dc_trained_model: { running: dcModel, saved: dcModels },
      units_on: parts,
      inputs: {
        weather_from: ext.custom ? `the Weather window: ${ext.custom.label}` : ext.weatherFrom || "this data center's",
        demand_from: ext.demandFrom || "the district's own",
        options: { weather: ext.options.weather.map((o) => `${o.id} (${o.name} · ${o.column})`), demand: ext.options.demand.map((o) => `${o.id} (${o.name} · ${o.column})`) },
      },
      what_if: {
        outdoor_shift_K: dT,
        outdoor_shift_in: season,
        cold_week_K: cold,
        it_load_pct: r2(itRun * 100),
        heat_demand_pct: r2(demScale * 100),
        heat_pump: opts.physics ? { carnot_share: opts.carnotEff } : { cop: opts.fixedCop },
      },
      options: opts,
      calculation: phys,
      scale_data_centers: scale,
      window: { kind: win.kind, number: win.index + 1, count: win.count, from: isoDay(xs[a]), to: isoDay(xs[b - 1]) },
      window_means: flows ? { ...Object.fromEntries(Object.entries(flows).map(([k, v]) => [k, r2(v)])), units: "kW, °C (srcT), kWh (level), % (coverage)" } : null,
      kpis: T ? matchingKpis(T) : null,
      note: "KPIs over the whole period; window_means over the window the heat flow shows (set_window).",
    },
  }));
  useCommand("set_window", (args) => {
    if (!chartSeries || win.count < 2) throw new Error("There is only one window: the period is short or not loaded yet");
    const per = windowOf(n, stepHours, 0).b;
    const step = xs.length > 1 ? xs[1] - xs[0] : stepHours * 3600;
    const i =
      args.date !== undefined
        ? windowAt(Date.parse(String(args.date)) / 1000, xs[0], step, per, win.count)
        : Math.max(0, Math.min(win.count - 1, Math.round(Number(args.number)) - 1));
    if (!Number.isFinite(i)) throw new Error("set_window needs number (1..count, as the page shows it) or date (YYYY-MM-DD)");
    setWeek(i);
    return `showing ${win.kind} ${i + 1} of ${win.count}`;
  });
  useCommand("set_part_way", (args) => {
    const { part, way } = partWay(args.part, args.way);
    const why = { dc: dcWhy, heat: heatWhy, district: distWhy }[part][way];
    if (why) throw new Error(`The ${part} cannot run its ${way}: ${why}`);
    pickWay(part)(way);
    return `the ${part} runs its ${way}`;
  });

  // what if: a lever's change waits in `draft` (shown on its control) until "Run scenario" applies them all at once:
  // then every part runs the whole year on them
  const now: Levers = { dT, season, cold, demScale, tSup, tRet, curve, tSummer, srcDT, itLoad: itRun, weatherFrom: ext.weatherFrom, demandFrom: ext.demandFrom, at, dcKw, dcUtil, dcIdle, dcUsed };
  const [draft, setDraft] = useKept<Partial<Levers>>("hm-draft", {});
  const whatIf = useRef<HTMLDetailsElement>(null);
  const lever = <K extends keyof Levers>(k: K): Levers[K] => (k in draft ? (draft[k] as Levers[K]) : now[k]);
  const change =
    <K extends keyof Levers>(k: K) =>
    (v: Levers[K]) =>
      setDraft((d) => {
        const next = { ...d, [k]: v };
        if (v === now[k]) delete next[k];
        return next;
      });
  // a data-center lever back at the Site map's value is no change (null)
  const dcLever = (k: "dcKw" | "dcUtil" | "dcIdle" | "dcUsed", was: number) => (v: number) => change(k)(Math.abs(v - was) < 1e-9 ? null : v);
  const runScenario = () => {
    const set: { [K in keyof Levers]: (v: Levers[K]) => void } = {
      dT: setDT,
      season: setSeason,
      cold: setCold,
      demScale: setDemScale,
      tSup: setTSup,
      tRet: setTRet,
      curve: setCurve,
      tSummer: setTSummer,
      srcDT: setSrcDT,
      itLoad: setItRun,
      weatherFrom: ext.setWeatherFrom,
      demandFrom: ext.setDemandFrom,
      at: setAt,
      dcKw: setDcKw,
      dcUtil: setDcUtil,
      dcIdle: setDcIdle,
      dcUsed: setDcUsed,
    };
    for (const k of Object.keys(draft) as (keyof Levers)[]) (set[k] as (v: unknown) => void)(draft[k]);
    setDraft({});
  };
  // back to the standard: every lever at its start value, run at once (the district picked as the system stays)
  const resetScenario = () => {
    setDT(0);
    setSeason("year");
    setCold(0);
    setDemScale(1);
    setTSup(null);
    setTRet(null);
    setCurve(false);
    setTSummer(null);
    setSrcDT(0);
    setItRun(1);
    ext.setWeatherFrom("");
    ext.setCustom(null);
    ext.setDemandFrom(ext.standard);
    setAt(null);
    setDcKw(null);
    setDcUtil(null);
    setDcIdle(null);
    setDcUsed(null);
    setDraft({});
  };
  const running = data.loading || distRun.loading || fm.busy;

  const error =
    data.error ??
    (ext.error && `Inputs from another dataset: ${ext.error}`) ??
    (demLoad.error && `District demand data: ${demLoad.error}`) ??
    fm.error ??
    (runsError && `Component: ${runsError}`); // no component list (an older backend): the built-in formulas only

  // each part's model and system, from a folder at the top right of its column in the diagram (the sub-tabs' pickers
  // pick the systems too)
  const dcSystem = (
    <DcSystemLoad
      model={dcModel}
      models={dcModels}
      onModel={chooseDcModel}
      systems={ext.datasets.map((d) => ({ id: d.id, label: nameOf(d.id) }))}
      onSystem={(id) => chooseSectionDataset([...sectionRoutes("dc"), ...sectionRoutes("twin")], id)}
    />
  );
  const heatSystem = (
    <HeatSystemLoad
      partComponents={partComponents}
      components={comps.list}
      onPartComponents={data.changePartComponents}
      system={heatFrom}
      systems={ext.datasets.map((d) => ({ id: d.id, label: d.id === DATASET ? `${nameOf(d.id)} (with the data center)` : nameOf(d.id) }))}
      onSystem={pickHeat}
    />
  );
  const districtSystem = (
    <DistrictSystemLoad
      fmMode={fmMode}
      demandFrom={ext.demandFrom}
      trained={distTrained}
      models={distModels}
      demandOptions={ext.options.demand}
      fromName={fmFrom.name}
      onModel={(v) => {
        if (v.startsWith("fm:")) return setFmMode(v.slice(3) as FoundationMode);
        setFmMode(null);
        const trained = v.startsWith("model:") ? v.slice(6) : null;
        ext.setDemandFrom(trained || !v ? "" : v);
        if (trained || !v) {
          setDistTrained(trained);
          updateSite(DATASET, (s) => ({ ...s, twin_model: trained }), "district").catch(() => {}); // the district's own site.json
        }
      }}
      systems={[{ id: DATASET, label: `${nameOf(DATASET)} (with the data center)` }, ...ext.options.demand.map((o) => ({ id: o.id, label: o.name }))]}
      onSystem={pickDistrict}
    />
  );

  // the delivered heat and the CO₂ saved in everyday terms (the KPI boxes)
  const co2 = T ? co2SavedT(T.deliveredMwh, T.hpElecMwh) : null;
  const facts = T && co2 !== null ? heatFacts(T.deliveredMwh, co2, T.hours / 24) : null;

  // a scenario: a what-if lever off its default. The KPIs then show their change against the last run without one.
  // ponytail: the reference is the last run without a scenario in this page visit, so a part or model changed while a
  // scenario is on counts into its change too; run the reference for the same settings if that matters
  const scenario = cold !== 0 || (dT !== 0 && season !== "year") || dcKw !== null || dcUtil !== null || dcIdle !== null || dcUsed !== null || dT !== 0 || demScale !== 1 || itRun !== 1 || tSup !== null || tRet !== null || curve || tSummer !== null || srcDT !== 0 || !!ext.weatherFrom || !!ext.custom || atPick !== null || ext.demandFrom !== ext.standard;
  const ref0 = useRef<typeof T>(undefined);
  useEffect(() => {
    if (!scenario && T && !running) ref0.current = T;
  });
  const base = scenario && !running ? ref0.current : undefined;
  const baseCo2 = base ? co2SavedT(base.deliveredMwh, base.hpElecMwh) : null;
  const baseFacts = base && baseCo2 !== null ? heatFacts(base.deliveredMwh, baseCo2, base.hours / 24) : null;
  const vs = (now: number | null | undefined, was: number | null | undefined, unit: string, digits = 0) =>
    base && now != null && was != null ? `${now - was >= 0 ? "+" : "−"}${fmt(Math.abs(now - was), digits)}${unit} vs. without the scenario` : undefined;
  const gwh = (mwh: number | null | undefined) => (mwh == null ? mwh : mwh / 1000); // a year of heat reads in GWh

  return (
    <div className="page hm-look">
      {/* the tab names the page: its title for screen readers only */}
      <h1 className="sr-only">Heat Matching</h1>
      <ErrorBanner error={error || null} />
      {weatherOpen && <WeatherWindow ext={ext} dT={dT} setDT={setDT} onClose={() => setWeatherOpen(false)} />}

      <KpiRow className={`heat-kpis${scenario ? " heat-kpis--scenario" : ""}`} more="More details" detail={res && demand ? <MatchDetail res={res} demand={demand} stepHours={stepHours} /> : undefined}>
        <Kpi
          label="Coverage"
          value={T ? fmt(T.coveragePct, 1) : "–"}
          unit="%"
          tone="var(--ok)"
          bar={T?.coveragePct ?? 0}
          sub={T ? `${fmt(T.hoursCovered, T.hours < 100 ? 1 : 0)} of ${fmt(T.demandHours, T.hours < 100 ? 1 : 0)} h with demand fully met` : undefined}
          delta={vs(T?.coveragePct, base?.coveragePct, " pp", 1)}
        />
        <Kpi
          label="Heat delivered"
          value={T ? fmt(T.deliveredMwh / 1000, 2) : "–"}
          unit="GWh"
          tone="var(--heat-strong)"
          sub={T ? `of ${fmt(T.demandMwh / 1000, 2)} GWh demand in ${fmt(T.hours / 24)} days` : undefined} // the model's test period, not always a year
          delta={vs(gwh(T?.deliveredMwh), gwh(base?.deliveredMwh), " GWh", 2)}
        />
        <Kpi
          label="Households supplied"
          value={facts ? fmt(facts.households) : "–"}
          tone="var(--accent)"
          delta={vs(facts?.households, baseFacts?.households, "")}
          info={facts && T ? <HouseholdsInfo f={facts} demandMwh={T.demandMwh} deliveredMwh={T.deliveredMwh} /> : undefined}
        />
        <Kpi
          label="CO₂ saved"
          value={co2 !== null ? fmt(co2) : "–"}
          unit="t"
          tone="var(--ok)"
          hint={`against gas (${CO2.gas} kg/kWh, ${CO2.boiler * 100} %), minus the heat pump's grid electricity (${CO2.grid} kg/kWh)`}
          delta={vs(co2, baseCo2, " t")}
          info={facts && co2 !== null ? <Co2Info f={facts} co2T={co2} /> : undefined}
        />
        <Kpi label="HP electricity" value={T ? fmt(T.hpElecMwh / 1000, 2) : "–"} unit="GWh" tone="var(--accent)" delta={vs(gwh(T?.hpElecMwh), gwh(base?.hpElecMwh), " GWh", 2)} />
        <Kpi label="SPF" value={T && T.spf ? fmt(T.spf, 2) : "–"} sub="heat pump heat / electricity" />
        <Kpi label="Unmet" value={T ? fmt(T.unmetMwh / 1000, 2) : "–"} unit="GWh" tone="var(--danger)" sub={T ? `DC heat used ${fmt(T.dcUsedPct)} %` : undefined} delta={vs(gwh(T?.unmetMwh), gwh(base?.unmetMwh), " GWh", 2)} />
        <Kpi label="Surplus" value={T ? fmt(T.surplusMwh / 1000, 2) : "–"} unit="GWh" tone="var(--warn)" sub="recoverable, no taker" delta={vs(gwh(T?.surplusMwh), gwh(base?.surplusMwh), " GWh", 2)} />
      </KpiRow>

      <section className={`card heat-flow-card${scenario ? " heat-flow-card--scenario" : ""}`} aria-label="Heat flow">
        {flows && ds ? (
          <div className="heat-diagram-scroll">
            <HeatFlowDiagram
              onWeather={() => setWeatherOpen(true)}
              when={whenOf(district?.times[a], district?.times[Math.max(a, b - 1)])}
              weatherSource={ext.custom ? (ext.custom.label.startsWith("file") ? "from a file" : "generated") : ext.weatherFrom ? "another dataset" : "shared"}
              f={flows}
              opts={diagOpts}
              on={parts}
              settings={ds}
              at={at}
              shown={lever("at")}
              onPick={(x) => {
                change("at")(x);
                if (whatIf.current) whatIf.current.open = true; // its Run scenario in sight
              }}
              points={points}
              keys={keys}
              itKw={drivers ? meanOver(drivers.ite, a, b) * itRun * scale : undefined}
              mode={mode}
              loop={loop}
              cp={{ dc: cpDc, water: cpWater }}
              dcDerived={derivedQ ? "q" : "m"}
              weather={weather}
              models={{ dc: mode !== "physics", heat: heatModel, district: distModel }}
              dcDrawing={dcDrawing}
              picture={picture}
              loads={{ dc: dcSystem, heat: heatSystem, district: districtSystem }}
            />
          </div>
        ) : (
          <div className="heat-empty">
            <Note>{data.loading ? "Loading profiles…" : !keys.length ? "No heat source: this dataset has no columns to take the heat from." : "No data."}</Note>
          </div>
        )}
        {/* under each part's box: its Model or Calculation, the rest under More options */}
        <div className="heat-cards heat-cards--aligned heat-cards--under" style={alignedCards()}>
          <SourceCard
            at={at}
            way={ways.dc}
            why={dcWhy}
            onWay={pickWay("dc")}
            vars={pointVars}
            fromModel={data.fromModel}
            phys={phys}
            onPhys={setPhys}
            compare={compare}
            onCompare={setCompare}
            scale={scale}
            onScale={setScale}
            liquid={liquid}
            models={dcModels}
            model={dcModel ?? undefined}
            onModel={chooseDcModel}
          />
          <HeatDistributionCard
            way={ways.heat}
            why={heatWhy}
            onWay={pickWay("heat")}
            opts={opts}
            recovered={recovered}
            set={set}
            on={parts}
            onParts={data.changeParts}
            active={active}
            cop={flows?.cop}
            windowKind={win.kind}
            cp={cpWater}
            onCp={setCpWater}
            trained={heatTrained}
          />
          <DistrictCard
            way={ways.district}
            why={distWhy}
            onWay={pickWay("district")}
            kw={demand ?? null}
            stepHours={stepHours}
            supply={ds?.supplyTemp}
            ret={ds?.returnTemp}
            isYear={periodName === "Year"}
            source={distSource}
          />
        </div>
        {/* what if: the weather, and each part's lever under its box; shown on a click */}
        {flows && (
          <details className={`twin-whatif${scenario ? " twin-whatif--on" : ""}`} ref={whatIf}>
            {/* its Run scenario on top, beside What if…: a click on it runs, it does not fold the panel */}
            <summary>
              <span className="twin-whatif__pill">
                <span>What if…</span> <span className="twin-whatif__what">weather, IT load, heat pump, demand, temperatures</span>
              </span>
              <button
                type="button"
                className={`btn btn--sm${Object.keys(draft).length ? " btn--primary" : ""}`}
                disabled={running || !Object.keys(draft).length}
                onClick={(e) => {
                  e.preventDefault();
                  runScenario();
                }}
                title="Every part runs the whole year on the changes below"
              >
                {running ? "Running…" : "Run scenario"}
              </button>
              <button
                type="button"
                className="btn btn--sm"
                disabled={running || (!scenario && !Object.keys(draft).length)}
                onClick={(e) => {
                  e.preventDefault();
                  resetScenario();
                }}
                title="Every lever back to its standard value: the run without a scenario"
              >
                Reset
              </button>
              {scenario && <span className="twin-whatif__on">Scenario active: the KPIs show the change against the run without it</span>}
            </summary>
            {/* the levers in four columns side by side, in the diagram's order: the shared weather, the data center, the
                network between them, the district; in each, one lever under the other; the run under them */}
            <div className="twin-whatif__list">
              <div className="twin-whatif__col">
              <span className="caps twin-whatif__group">Weather</span>
              <label title="The weather every part runs on: the district's demand profile and the data center's calculation run on it; measured data follows it by its fitted slope">
                <span className="caps">Outdoor temperature</span>
                <input type="range" min={-10} max={10} step={1} value={lever("dT")} onChange={(e) => change("dT")(Number(e.target.value))} aria-label="Outdoor temperature shift, °C" />
                <span className="heat-meta">
                  {lever("dT") > 0 ? "+" : ""}
                  {lever("dT")} °C
                </span>
              </label>
              <label title="When the shift applies: all year, only the heating season (October to April), or only the summer">
                <span className="caps">Shift in</span>
                <select className="field field--sm" value={lever("season")} onChange={(e) => change("season")(e.target.value as Season)} aria-label="Shift in">
                  <option value="year">The whole year</option>
                  <option value="winter">Heating season (Oct–Apr)</option>
                  <option value="summer">Summer (May–Sep)</option>
                </select>
                <span />
              </label>
              <label title="A cold spell: the coldest week of the year this much colder still, on top of the shift (does the heat cover the peak?)">
                <span className="caps">Cold week</span>
                <input type="range" min={0} max={15} step={1} value={lever("cold")} onChange={(e) => change("cold")(Number(e.target.value))} aria-label="Cold week, K colder" />
                <span className="heat-meta">{lever("cold") ? `−${lever("cold")} °C` : "off"}</span>
              </label>
              <label title="Put in another dataset's series: the shared weather, also into the data center's Model, whose learned pattern gives its heat for it">
                <span className="caps">Weather from</span>
                <select className="field field--sm" value={lever("weatherFrom")} onChange={(e) => change("weatherFrom")(e.target.value)} aria-label="Weather from">
                  <option value="">This data center's</option>
                  {ext.options.weather.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} · {o.column}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn--xs" onClick={() => setWeatherOpen(true)}>
                  Weather…
                </button>
              </label>

              </div>
              <div className="twin-whatif__col">
              <span className="caps twin-whatif__group">Data center</span>
              <label>
                <span className="caps">IT load</span>
                <input type="range" min={0.5} max={1.5} step={0.05} value={lever("itLoad")} onChange={(e) => change("itLoad")(Number(e.target.value))} aria-label="IT load, as a share of the data's" />
                <span className="heat-meta">{fmt(lever("itLoad") * 100)} %</span>
              </label>
              {keys.length > 1 && (
                <label>
                  <span className="caps">Heat extraction point</span>
                  <select className="field field--sm" value={lever("at")} onChange={(e) => change("at")(e.target.value)} aria-label="Heat extraction point">
                    {keys.map((k) => (
                      <option key={k} value={k}>
                        {pointTitle(k)}
                      </option>
                    ))}
                  </select>
                  <span />
                </label>
              )}
              {ds0 && (
                <label title="The data center's water at the extraction point warmer or cooler (e.g. higher cooling setpoints, warmer racks)">
                  <span className="caps">Source temperature</span>
                  <input type="range" min={-10} max={20} step={1} value={lever("srcDT")} onChange={(e) => change("srcDT")(Number(e.target.value))} aria-label="Source temperature shift, K" />
                  <span className="heat-meta">
                    {lever("srcDT") > 0 ? "+" : ""}
                    {lever("srcDT")} K
                  </span>
                </label>
              )}
              {site0 && (
                <>
                  {/* the Site map's data center (Konzeption): its mean waste heat scales the heat above */}
                  <label title="The data center's installed capacity (Site map › Data center)">
                    <span className="caps">Installed capacity</span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(1, Math.ceil((site0.power_kw * 3) / 1000))}
                      step={0.05}
                      value={(lever("dcKw") ?? site0.power_kw) / 1000}
                      onChange={(e) => dcLever("dcKw", site0.power_kw)(Number(e.target.value) * 1000)}
                      aria-label="Installed capacity, MW"
                    />
                    <span className="heat-meta">{fmt((lever("dcKw") ?? site0.power_kw) / 1000, 2)} MW</span>
                  </label>
                  {(
                    [
                      ["dcUtil", "Utilization", site0.utilization ?? 1, "How busy the IT is on average"],
                      ["dcIdle", "Idle power", site0.idle_share ?? IDLE_SHARE, "What it draws doing nothing, a share of its capacity"],
                      ["dcUsed", "Waste heat used", site0.heat_used_share ?? 1, "The share of the data center's heat taken for the district"],
                    ] as const
                  ).map(([k, label, was, why]) => (
                    <label key={k} title={why}>
                      <span className="caps">{label}</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round((lever(k) ?? was) * 100)}
                        onChange={(e) => dcLever(k, was)(Number(e.target.value) / 100)}
                        aria-label={`${label} %`}
                      />
                      <span className="heat-meta">{fmt((lever(k) ?? was) * 100)} %</span>
                    </label>
                  ))}
                </>
              )}
              </div>
              {ds0 && (
                <div className="twin-whatif__col">
                  <span
                    className="caps twin-whatif__group"
                    title="The district network's temperatures: they decide the direct HEX (source hot enough?) and the heat pump's lift and COP"
                  >
                    Network
                  </span>
                  <label>
                    <span className="caps">Network supply</span>
                    <input type="range" min={40} max={110} step={1} value={lever("tSup") ?? ds0.supplyTemp} onChange={(e) => change("tSup")(Number(e.target.value))} aria-label="Network supply temperature, °C" />
                    <span className="heat-meta">{fmt(lever("tSup") ?? ds0.supplyTemp)} °C{lever("curve") ? " in winter" : ""}</span>
                  </label>
                  <label>
                    <span className="caps">Return</span>
                    <input type="range" min={15} max={70} step={1} value={lever("tRet") ?? ds0.returnTemp} onChange={(e) => change("tRet")(Number(e.target.value))} aria-label="Network return temperature, °C" />
                    <span className="heat-meta">{fmt(lever("tRet") ?? ds0.returnTemp)} °C</span>
                  </label>
                  <label title={`On a heating curve the supply slides from its winter value (at ${DESIGN_OUTDOOR} °C outside and below) to the summer one (at ${HEATING_LIMIT} °C and above)`}>
                    <span />
                    <span className="twin-whatif__check">
                      <input type="checkbox" checked={lever("curve")} onChange={(e) => change("curve")(e.target.checked)} />
                      <span>Supply follows the outdoor temperature</span>
                    </span>
                    <span />
                  </label>
                  {lever("curve") && (
                    <label>
                      <span className="caps">Summer supply</span>
                      <input type="range" min={30} max={100} step={1} value={lever("tSummer") ?? summerSup ?? 55} onChange={(e) => change("tSummer")(Number(e.target.value))} aria-label="Network supply in summer, °C" />
                      <span className="heat-meta">{fmt(lever("tSummer") ?? summerSup ?? 55)} °C</span>
                    </label>
                  )}
                  {(lever("tSup") !== null || lever("tRet") !== null || lever("curve") || lever("tSummer") !== null || lever("srcDT") !== 0) && (
                    <div>
                      <span />
                      <button
                        type="button"
                        className="btn btn--xs"
                        onClick={() => {
                          change("tSup")(null);
                          change("tRet")(null);
                          change("curve")(false);
                          change("tSummer")(null);
                          change("srcDT")(0);
                        }}
                      >
                        As on the Site map
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="twin-whatif__col">
              <span className="caps twin-whatif__group">District</span>
              <label>
                <span className="caps">Heat demand</span>
                <input type="range" min={0.5} max={1.5} step={0.05} value={lever("demScale")} onChange={(e) => change("demScale")(Number(e.target.value))} aria-label="Heat demand, as a share of its profile's or data's" />
                <span className="heat-meta">{fmt(lever("demScale") * 100)} %</span>
              </label>
              <label title="Put in another dataset's demand, also into the data center's Model">
                <span className="caps">Heat demand from</span>
                <select className="field field--sm" value={lever("demandFrom")} onChange={(e) => change("demandFrom")(e.target.value)} aria-label="Heat demand from">
                  <option value="">The district's own</option>
                  {ext.options.demand.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} · {o.column}
                    </option>
                  ))}
                </select>
                <span />
              </label>
              </div>
            </div>
          </details>
        )}
      </section>

      {/* under the heat flow, the year to pick its window from: the outdoor temperature and the heat, the window a band on both */}
      {chartSeries && win.count > 1 && (
        <YearPicker
          s={chartSeries}
          outTemp={outTemp}
          win={win}
          per={win.b - win.a}
          onIndex={setWeek}
          label={`${win.kind} of the ${periodName.toLowerCase()}`}
          spanSec={spanSec}
        />
      )}



      <WindowChart s={chartSeries} res={res} win={win} stepHours={stepHours} spanSec={spanSec} onIndex={setWeek} />
    </div>
  );
}
