/**
 * Visualization and Scenarios of one part of the twin (#/dc/dashboard, #/heat/dashboard, #/district/dashboard; one
 * module, `scope` the part): the data of the page's data center at a glance, before any modelling. The heat
 * distribution's and the district's show only their own variables and KPIs (partView.ts); the data center's all of
 * them, with its KPIs and the data editing.
 * How much data over which period; what to fix before modelling (recommendations) and preparing new variables from
 * the data (combine, transform, time features); the time series, the weekly rhythm and where data is missing;
 * descriptive statistics, correlations and the data-center KPIs. The numbers come from
 * GET /api/datasets/{id}/summary (backend/core/summary.py), the prepared variables from backend/core/prepare.py, the
 * groups marked on the Physical structure page from site.json.
 */
import { changeSaid, toneOf, valueOf, WhatIfCard, type ScenarioKpi } from "./WhatIfCard";
import { useKept } from "../../../lib/kept";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchCausalGraph,
  fetchCausalGraphFiles,
  fetchSummary,
  fetchTimeSeriesData,
  type CausalParent,
  type DatasetSummary,
  type PreparedStep,
  type StructureScope,
} from "../../../api";
import { DATASET } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import { fmt } from "../../../lib/format";
import { Card } from "../../../ui/Card";
import { ErrorBanner } from "../../../ui/ErrorBanner";
import { Field } from "../../../ui/Field";
import { Kpi, KpiRow } from "../../../ui/Kpi";
import { Segmented } from "../../../ui/Segmented";
import { CorrelationMatrix } from "./CorrelationMatrix";
import { KpiVariables } from "./KpiVariables";
import { compact, duration, resolution } from "./dashboard";
import { AggregateData } from "./AggregateData";
import { BigFile } from "./BigFile";
import { MissingMap } from "./MissingMap";
import { PrepareVariables } from "./PrepareVariables";
import { ProfileHeatmap } from "./ProfileHeatmap";
import { Recommendations } from "./Recommendations";
import { PeriodPicker, SeriesCharts } from "./SeriesCharts";
import { Autocorrelation, DailyProfile, MonthlyHeatmap } from "./Shapes";
import { groupsIn, memberOf } from "../structure/notes";
import { Groups } from "./Groups";
import { VariablesTable } from "./VariablesTable";
import { Distributions } from "./Distributions";
import "./dashboard.css";
import { CausalMiniMap } from "../shared/CausalMiniMap";
import { GraphSidebar } from "../shared/GraphSidebar";
import { fileMap, modelMap } from "../shared/causalGraph";
import { useHexView } from "../shared/useHexView";
import { pickFile } from "../structure/usePidSources";
import { useScenarioModel } from "../scenarios/useScenarioModel";
import { FocusContext, nextPick, type Picked } from "../shared/focus";
import "../shared/minimap.css";
import type { StructureSetup } from "../structure/structureSetup";
import { toSavePayload } from "../structure/links";
import { graphVariables, kpiColumns, onlyVariables, partKpis, partVariables, shownKpis, statsOf, summaryStats } from "./partView";
import { kpiInputs, kpisOf } from "./whatIf";
import { useApproaches } from "../structure/useApproaches";
import { useDashboardData } from "./useDashboardData";
import { coverageOf, FINE_ROWS, periodKpis, periodLabel, periodRows, yearsOf, type SeriesPeriod } from "./seriesPeriod";
import { unixSeconds } from "./dashboard";
import { useSnapshotDetail } from "../../../lib/live";

/** Each part's page: its name, its KPI card's title, and where its structure (and its models) is drawn. */
const PARTS: Record<StructureScope, { name: string; title: string; structure: string }> = {
  dc: { name: "data center", title: "Data center KPIs", structure: "#/dc/pid" },
  heat: { name: "heat distribution", title: "Heat distribution KPIs", structure: "#/heat/structure" },
  district: { name: "district", title: "District KPIs", structure: "#/district/structure" },
};

// Explore's tabs: every view of the data in one card (the page one screen high); the data center's also edits it
type View = "series" | "daily" | "profile" | "acf" | "corr" | "dists" | "vars" | "missing" | "recs" | "edit";
const VIEWS: { id: View; label: string }[] = [
  { id: "series", label: "Time series" },
  { id: "daily", label: "Daily profile" },
  { id: "profile", label: "Weekly and monthly" }, // the week by weekday and hour, and every variable's months
  { id: "acf", label: "Autocorrelation" },
  { id: "corr", label: "Correlation" },
  { id: "dists", label: "Distributions" },
  { id: "vars", label: "Variables" },
  { id: "missing", label: "Missing data" },
  { id: "recs", label: "Recommendations" },
  { id: "edit", label: "Edit data" },
];

const ScenariosPage = lazy(() => import("../scenarios/ScenariosPage"));
const NONE_REPORTED = {}; // no Modelling open here to report its unsaved moves (useApproaches)
type Mode = "historical" | "scenarios";
const modeKey = (scope: StructureScope) => `${scope}-dashboard-mode`; // per viewer and part: the mode last chosen
const savedMode = (scope: StructureScope): Mode => {
  // an old link to the Scenarios page opens this page in Scenarios mode
  if (/^#\/(dc\/)?(scenarios|step|year)/.test(window.location.hash)) return "scenarios";
  try {
    return localStorage.getItem(modeKey(scope)) === "scenarios" ? "scenarios" : "historical";
  } catch {
    return "historical";
  }
};

/** `starter`: the part's structure (heat distribution, district): its starting graph is shown while its graph file is
 * empty, as on its Structure and Modelling. */
export default function DashboardPage({ scope = "dc", starter }: { scope?: StructureScope; starter?: StructureSetup }) {
  const dc = scope === "dc";
  // Historical: the measured data; Scenarios: the same page with the twin's KPIs and the levers (amber, as on Scenarios)
  const [mode, setMode] = useState<Mode>(() => savedMode(scope));
  // the causal graph on the left: the data center's graph file, or in Scenarios the twin's; a click there picks a
  // variable for the replay's what-if, as on the Scenarios page
  const hexView = useHexView();
  const [model] = useScenarioModel(DATASET, scope);
  const [graphFiles, setGraphFiles] = useState<string[]>([]);
  const [graphFile, setGraphFile] = useState<string | null>(null);
  const [fileTargets, setTargets] = useState<Record<string, CausalParent[]> | null>(null);
  const targets = useMemo(
    () =>
      fileTargets && !Object.keys(fileTargets).length && starter?.starter.length
        ? toSavePayload(starter.starter, starter.starterLinks, []).targets
        : fileTargets,
    [fileTargets, starter],
  );
  const [picked, setPicked] = useState<Picked | null>(null);
  useEffect(() => {
    fetchCausalGraphFiles(DATASET, scope)
      .then((r) => {
        setGraphFiles(r.files);
        setGraphFile(pickFile(r.files));
      })
      .catch(() => setTargets(null));
  }, [scope]);
  useEffect(() => {
    if (!graphFile) return;
    let live = true; // a slower answer for a graph file left meanwhile is dropped
    fetchCausalGraph(DATASET, graphFile, scope)
      .then((g) => live && setTargets(g.targets))
      .catch(() => live && setTargets(null));
    return () => {
      live = false;
    };
  }, [graphFile, scope]);
  const hidden = dc ? hexView?.hidden : undefined; // the data center shows its HEX option; the heat distribution both
  // the same graph in both modes, the saved one; Scenarios without one draws its twin's
  const map = useMemo(
    () => (targets ? fileMap(targets, hidden) : mode === "scenarios" && model ? modelMap(model, hidden) : null),
    [mode, model, targets, hidden],
  );
  const chooseMode = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem(modeKey(scope), m);
    } catch {
      /* storage off: the mode is not remembered */
    }
  };
  const [file, setFile] = useKept<string | undefined>(`${scope}-dash-file`, undefined); // kept when the page is left
  const [summary, setSummary] = useState<DatasetSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PreparedStep | null>(null);
  const [view, setView] = useKept<View>(`${scope}-dash-view`, "series");
  const shown: View = view === "edit" && scope !== "dc" ? "series" : view; // Edit data: the data center's only
  const [rev, setRev] = useState(0); // a prepared variable added or removed: read everything again
  // the dataset's files and dataset.json (read again on every rev), the groups of site.json pid_notes
  const { files, info, config, kpi, notes, names, recipe, made } = useDashboardData(scope, rev, setError);
  const groups = groupsIn(notes);

  // the page stays on screen while another file or a refresh loads, so its forms and messages survive
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true; // a slower answer for a file left meanwhile is dropped
    setLoading(true);
    setError(null);
    fetchSummary(DATASET, file)
      .then((s) => live && setSummary(s))
      .catch((e) => live && setError(errorMessage(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [file, rev]);

  // the part's own variables (null: the data center's page, all of them) and its KPIs
  const keep = useMemo(() => partVariables(scope, config, info.columns, graphVariables(targets)), [scope, config, info.columns, targets]);
  // a part's page waits for its variables: its cards pick their first variables when they open
  const s = useMemo(() => (summary && (dc || info.columns.length) ? onlyVariables(summary, keep) : null), [summary, keep, dc, info.columns.length]);
  const notOurs = useMemo(() => (keep ? new Set(info.columns.filter((c) => !keep.includes(c))) : undefined), [keep, info.columns]);
  // from every column, not only the shown ones: a KPI's variable may be outside its graph
  const allKpis = useMemo(
    () => (s && summary && !dc ? partKpis(scope, config, summaryStats(summary), (s.resolution_seconds ?? 3600) / 3600) : []),
    [s, summary, dc, scope, config],
  );
  // a KPI whose variables the data lacks is named under the tiles with what it needs, not shown as an empty tile
  const kpis = useMemo(() => shownKpis(allKpis), [allKpis]);
  const lackingKpis = allKpis.filter((k) => k.lacking);
  const scenario = mode === "scenarios";
  // how each variable is modelled, as Structure and Modelling colours it: the time series take its colour
  const varNames = useMemo(() => s?.variables.map((v) => v.name) ?? [], [s]);
  const approach = useApproaches(scope, graphFiles, graphFile, 0, varNames, NONE_REPORTED);
  const [side, setSide] = useState<HTMLDivElement | null>(null); // under the graph on the left: the time series' filters
  // Scenarios: in `side` what the replay plots (where Historical has its variables), under it the intervention variables
  // (`levers`, the KPIs' and the step-through's)
  const [leverSide, setLeverSide] = useState<HTMLDivElement | null>(null);
  const [levers, setLevers] = useState<string[] | null>(null);
  const [replaySide, setReplaySide] = useState<HTMLDivElement | null>(null); // in the band: the replay's buttons
  // the band under the KPIs at least as high as Scenarios' levers and buttons have been, in both modes, so the charts
  // start at the same height; Historical's data overview opens and closes over that (ponytail: only grows; a narrower
  // window keeps it)
  const [band, setBand] = useState<HTMLDivElement | null>(null);
  const [bandHeight, setBandHeight] = useState(0);
  // the KPI card's tabs under its tiles: one open at a time under them (none: undefined, the KPI variables when none can be computed)
  const [kpiTab, setKpiTab] = useKept<"more" | "vars" | "overview" | null | undefined>(`${scope}-dash-kpi-tab`, undefined);
  useEffect(() => {
    if (!band || !scenario) return;
    const watch = new ResizeObserver(() => setBandHeight((h) => Math.max(h, band.offsetHeight)));
    watch.observe(band);
    return () => watch.disconnect();
  }, [band, scenario]);
  // Scenarios: what the twin runs and the KPIs of a run, by the part's formulas (the same as on the measured data)
  const cols = s?.kpi_columns;
  const runColumns = useMemo(
    () =>
      dc
        ? // not the facility's other power: its meters are rarely in the model, and simulate refuses a column it does not have
          [cols?.it_power, cols?.cooling_power, ...(cols?.heat_power ?? [])].filter((c): c is string => !!c)
        : kpiColumns(scope, config, info.columns).filter((c) => info.columns.includes(c)),
    [dc, cols, scope, config, info.columns],
  );
  const runKpis = useCallback(
    (series: Record<string, (number | null)[]>, stepHours: number) =>
      dc ? (cols ? kpisOf(series, cols, stepHours) : []) : shownKpis(partKpis(scope, config, statsOf(series), stepHours)),
    [dc, cols, scope, config],
  );
  const [played, setPlayed] = useState<ScenarioKpi[] | null>(null); // the KPIs of the levers moved, for the tiles

  // the period the time series show (the first year to start with); in Historical the KPIs follow it: the KPI columns
  // over its rows, by the same formulas as a Scenarios run (whatIf kpisOf, partView partKpis)
  const years = useMemo(() => yearsOf(s?.start ?? null, s?.end ?? null), [s]);
  const [chosenPeriod, setPeriod] = useKept<SeriesPeriod | null>(`${scope}-dash-period`, null);
  const period: SeriesPeriod =
    chosenPeriod && (chosenPeriod.year == null || years.includes(chosenPeriod.year)) ? chosenPeriod : { year: years[0] ?? null, month: null };
  // the period's KPIs read every KPI column, the facility's other power too (whatIf kpiInputs)
  const kpiCols = useMemo(
    () => [...new Set([...runColumns, ...(dc && cols ? [...kpiInputs(cols), ...(cols.heat_demand ? [cols.heat_demand] : [])] : [])])],
    [runColumns, dc, cols],
  );
  const kpiKey = s && s.rows <= FINE_ROWS && kpiCols.length && period.year != null ? `${s.file}|${rev}|${kpiCols.join(",")}` : "";
  const [kpiRows, setKpiRows] = useState<{ key: string; times: number[]; cols: Record<string, (number | null)[]> | null } | null>(null);
  useEffect(() => {
    if (!kpiKey || kpiRows?.key === kpiKey || !s) return;
    let live = true;
    fetchTimeSeriesData(DATASET, s.file, kpiCols)
      .then((r) => live && setKpiRows({ key: kpiKey, times: unixSeconds(r.time), cols: r.columns }))
      .catch(() => live && setKpiRows({ key: kpiKey, times: [], cols: null })); // the whole file's, said so
    return () => {
      live = false;
    };
  }, [kpiKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the key names what is loaded
  const rowsOfPeriod = useMemo(
    () => (period.year != null && kpiRows?.key === kpiKey && kpiRows.cols ? periodRows(kpiRows.times, kpiRows.cols, period) : null),
    [period.year, period.month, kpiRows, kpiKey], // eslint-disable-line react-hooks/exhaustive-deps -- period by its parts
  );
  const step = (s?.resolution_seconds ?? 3600) / 3600;
  const dcTiles = useMemo(
    () =>
      rowsOfPeriod && s && cols
        ? periodKpis(s.kpis, kpisOf(rowsOfPeriod, cols, step), cols.heat_demand ? coverageOf(rowsOfPeriod, cols.heat_power, cols.heat_demand) : null)
        : null,
    [rowsOfPeriod, s, cols, step],
  );
  const partTiles = useMemo(
    () => (rowsOfPeriod && summary && !dc ? shownKpis(partKpis(scope, config, { ...summaryStats(summary), ...statsOf(rowsOfPeriod) }, step)) : null),
    [rowsOfPeriod, summary, dc, scope, config, step],
  );
  const periodSaid =
    period.year == null || rowsOfPeriod
      ? periodLabel(period, years)
      : kpiKey && kpiRows?.key !== kpiKey
        ? `loading ${periodLabel(period, years)}…`
        : "all data"; // too many rows to load, or the load failed: the whole file's
  const kpiTitle = scenario ? PARTS[scope].title : `${PARTS[scope].title} · ${periodSaid}`;
  const scenarioReady = dc ? !!cols?.it_power : runColumns.length > 0;
  // what the page shows, for the assistant (lib/live.ts): the KPIs as numbers with units over the period chosen
  useSnapshotDetail(() => ({
    dashboard: {
      part: scope,
      mode,
      view: VIEWS.find((v) => v.id === view)?.label,
      data_file: s?.file ?? file ?? files[0] ?? null,
      data_files: files,
      graph_file: graphFile,
      period: periodSaid,
      years,
      kpis_title: kpiTitle,
      kpis:
        scenario && played
          ? played.map((k) => ({ label: k.label, unit: k.unit, measured: k.value, twin_no_change: k.without, twin_with_levers: k.with }))
          : (dc ? (!scenario && dcTiles ? dcTiles : (s?.kpis ?? [])) : !scenario && partTiles ? partTiles : kpis).map((k) => ({
              label: k.label,
              value: k.value,
              unit: k.unit ?? null,
              note: "note" in k ? k.note : undefined,
            })),
      overview: s
        ? { rows: s.rows, variables: s.variables.length, start: s.start, end: s.end, resolution_s: s.resolution_seconds, completeness: s.completeness, gaps: s.gaps.count }
        : null,
      groups: groups.length,
      recommendations: s?.recommendations.length ?? 0,
      note: "Period: the Period / Month selects (in the panel left of the charts); variables: their chips (All / None); views: the View radios. Statistics per variable: get_summary.",
    },
  }));
  return (
    <div className={`dash-layout${scenario ? " dash--scenario" : ""}`}>
      <GraphSidebar
        title={
          !targets && scenario && model ? (
            "Causal graph · the twin"
          ) : graphFiles.length > 1 ? (
            <select className="field field--sm" value={graphFile ?? ""} onChange={(e) => setGraphFile(e.target.value)} aria-label="Graph file">
              {graphFiles.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          ) : (
            <>Causal graph · {graphFile ?? "…"}</>
          )
        }
      >
        <CausalMiniMap
          graph={map}
          config={hexView?.config ?? null}
          selected={picked && !picked.off ? picked.v : null}
          onSelect={(v) => setPicked((p) => nextPick(p, v))}
          onDoubleSelect={(v) => setPicked((p) => ({ v, n: (p?.n ?? 0) + 1, only: true }))}
          // one text in both modes: the panel stays the same when switching
          hint="Click a variable: the charts on the right show it (in Scenarios it is an intervention variable too); click again to remove it, double-click to show only it."
          empty={`No causal graph yet: draw it on the ${PARTS[scope].name}'s Structure and Modelling.`}
        />
        <div ref={setSide} className="dash-side-slot" />
        {scenario && <div ref={setLeverSide} className="dash-side-slot" />}
      </GraphSidebar>
    <FocusContext.Provider value={picked}>
    <div className="page dash">
      <h1 className="page__title">Visualization and Scenarios</h1>
      {/* the mode switch is in the KPI card, top left; a data file to pick, when there are several */}
      {files.length > 1 && (
      <header className="dash__head">
        {files.length > 1 && (
          <Field label="Data file">
            <select className="field field--sm" value={file ?? files[0]} onChange={(e) => setFile(e.target.value)}>
              {files.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </Field>
        )}
      </header>
      )}

      {/* a file too big to load: its variables, and what to make of it */}
      {error?.includes("too big to load") ? (
        <Card title="A very large data file">
          <BigFile
            key={file ?? files[0]}
            file={file ?? files[0]}
            why={error}
            variables={info.columns}
            start={info.start}
            end={info.end}
            resolution={info.resolution}
            onMade={(made) => {
              setFile(made);
              setRev((r) => r + 1);
            }}
          />
        </Card>
      ) : (
        <ErrorBanner error={error} />
      )}
      {loading && <p className="muted dash__note">Loading {file ?? "the data"}…</p>}

      {groups.length > 0 && (
        <Card title={`Groups (${groups.length})`}>
          <Groups groups={groups} />
        </Card>
      )}

      {s && (
        <>

          {/* the part's KPIs, in both modes: measured, and in Scenarios the twin's with your levers once one moved */}
          <Card title={kpiTitle} className="dash__kpi-card">
            <div className="dash__mode">
              <Segmented<Mode>
                label="Mode"
                value={mode}
                onChange={chooseMode}
                options={[
                  { id: "historical", label: "Historical" },
                  { id: "scenarios", label: "Scenarios" },
                ]}
              />
            </div>
            {scenario && played ? (
              <KpiRow open={kpiTab === "more"} className="dash__kpis dash__kpis--center" label="KPIs of the scenario">
                {played.map((k) => {
                  const tone = toneOf(k);
                  return (
                    <Kpi
                      key={k.label}
                      label={k.label}
                      value={compact(k.with)}
                      unit={k.unit ?? undefined}
                      sub={`measured ${valueOf(k.value, k.unit)} · twin, no change ${valueOf(k.without, k.unit)}${changeSaid(k)}`}
                      edge
                      tone={tone === "good" ? "var(--ok)" : tone === "bad" ? "var(--danger)" : "var(--accent)"}
                    />
                  );
                })}
              </KpiRow>
            ) : dc ? (
              s.kpis.length > 0 && (
                <KpiRow open={kpiTab === "more"} className="dash__kpis dash__kpis--center">
                  {(!scenario && dcTiles ? dcTiles : s.kpis).map((k) => (
                    <Kpi key={k.label} label={k.label} value={compact(k.value)} unit={k.unit ?? undefined} sub={k.note} edge tone="var(--accent)" />
                  ))}
                </KpiRow>
              )
            ) : kpis.length > 0 ? (
              <KpiRow open={kpiTab === "more"} className="dash__kpis dash__kpis--center">
                {(!scenario && partTiles ? partTiles : kpis).map((k) => (
                  <Kpi
                    key={k.label}
                    label={k.label}
                    value={compact(k.value)}
                    unit={k.value == null ? undefined : (k.unit ?? undefined)}
                    sub={k.note ?? "measured"}
                    edge
                    tone="var(--accent)"
                  />
                ))}
              </KpiRow>
            ) : (
              <p className="muted dash__note">No heat-demand column in dataset.json (kpi.heat_demand): its heat demand is the district's KPI.</p>
            )}
            {!dc && lackingKpis.length > 0 && (
              <p className="muted dash__note">
                Not shown, their variables are not in the data:{" "}
                {lackingKpis.map((k, i) => (
                  <span key={k.label}>
                    {i ? ", " : ""}
                    {k.label} ({k.note})
                  </span>
                ))}
              </p>
            )}
            {dc && !scenario && s.kpi_note && <p className="muted dash__note">{s.kpi_note}</p>}
            {/* one row of tabs under the tiles, as Explore's; the open one under it, one at a time */}
            {(() => {
              const tiles = scenario && played ? played : dc ? (!scenario && dcTiles ? dcTiles : s.kpis) : !scenario && partTiles ? partTiles : kpis;
              const extra = Math.max(0, tiles.length - 5); // KpiRow shows five
              const open = kpiTab ?? null; // closed until clicked (a data center without IT power never gets its KPIs)
              const tabs = [
                ...(extra ? [{ id: "more" as const, label: `More figures (${extra})` }] : []),
                ...(dc && !scenario && kpi ? [{ id: "vars" as const, label: "Choose the KPI variables" }] : []),
                ...(!scenario ? [{ id: "overview" as const, label: "Data overview" }] : []),
              ];
              return (
                tabs.length > 0 && (
                  <>
                    <div className="dash__kpi-tabs" role="group" aria-label="More on the KPIs">
                      {tabs.map((t) => (
                        <button key={t.id} type="button" className="dash__kpi-tab" aria-expanded={open === t.id} onClick={() => setKpiTab(open === t.id ? null : t.id)}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                    {open === "vars" && kpi && (
                      <KpiVariables key={JSON.stringify(kpi)} variables={s.variables.map((v) => v.name)} mapping={kpi} open bare onSaved={() => setRev((r) => r + 1)} />
                    )}
                    {open === "overview" && (
                      <div aria-label="Data overview">
                        <div className="dash__kpis dash__overview">
                          <Kpi label="Rows" value={fmt(s.rows)} sub={`file ${s.file}`} />
                          <Kpi label="Variables" value={String(s.variables.length)} sub="numeric columns" />
                          <Kpi label="Time span" value={duration(s.duration_hours)} sub={s.start && s.end ? `${s.start.replace("T", " ")} → ${s.end.replace("T", " ")}` : undefined} />
                          <Kpi label="Resolution" value={resolution(s.resolution_seconds)} sub="median step" />
                          <Kpi label="Completeness" value={s.completeness == null ? "–" : `${Math.floor(s.completeness * 1e4) / 100}` /* floor: 99.996 % is not 100 % */} unit="%" bar={(s.completeness ?? 0) * 100} sub="non-missing values" />
                          <Kpi label="Gaps" value={String(s.gaps.count)} sub={s.gaps.count ? `longest step ${duration(s.gaps.longest_hours)}` : "steps > 1.5 × median"} />
                        </div>
                      </div>
                    )}
                  </>
                )
              );
            })()}
          </Card>
          {/* under the KPIs, the band: in Scenarios the levers and the replay's buttons (Historical's data overview is in the KPI card), in its
              place; as high in both modes, so the charts under it start at the same height when the mode changes */}
          <div ref={setBand} className="dash__band" style={{ minHeight: bandHeight || undefined }}>
          {scenario &&
            (scenarioReady ? (
              <WhatIfCard
                summary={s}
                title={PARTS[scope].title}
                columns={runColumns}
                kpis={runKpis}
                scope={scope}
                structure={PARTS[scope].structure}
                onResult={setPlayed}
                chosen={levers}
                onChosen={setLevers}
                side={leverSide}
                focus={picked}
              />
            ) : (
              <Card title="Scenarios">
                <p className="muted dash__note">{dc ? (s.kpi_note ?? "No KPI columns: choose them under Data center KPIs in Historical.") : "No KPI columns for the twin to run."}</p>
              </Card>
            ))}
          {scenario && <div ref={setReplaySide} className="dash-side-slot" />}

          </div>

          {scenario ? (
            // the Scenarios page's own tools in place of the measured charts, titled as Explore: replay, what-if, simulation
            <section className="card card--titled dash__scenarios" aria-label="Replay and simulation">
              <div className="caps card__title">Explore</div>
              <Suspense fallback={<p className="muted dash__note">Loading the scenarios…</p>}>
                <ScenariosPage picked={picked} scope={scope} hide={notOurs} levers={levers ?? []}
                  side={side}
                  period={period}
                  periodPick={<PeriodPicker summary={s} period={period} onPeriod={setPeriod} />}
                  controls={replaySide}
                />
              </Suspense>
            </section>
          ) : (
            <>
          {/* the other views show one variable: the variables stay on the left, one picked at a time (as a click in the graph) */}
          {shown !== "series" &&
            side &&
            createPortal(
              <div className="dash-filters">
                <span className="caps">Variables</span>
                <div className="chips dash-filters__vars" role="group" aria-label="Variable to show">
                  {s.variables.map((v) => (
                    <button
                      key={v.name}
                      type="button"
                      className={picked && !picked.off && picked.v === v.name ? "chip chip--on dash-chip" : "chip dash-chip"}
                      aria-pressed={!!picked && !picked.off && picked.v === v.name}
                      onClick={() => setPicked((p) => ({ v: v.name, n: (p?.n ?? 0) + 1 }))}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
                <p className="muted dash-filters__hint">Click one: the view on the right shows it.</p>
              </div>,
              side,
            )}
          <Card title="Explore" className="dash__explore">
            <Segmented
              label="View"
              value={shown}
              onChange={setView}
              options={VIEWS.filter((v) => v.id !== "edit" || dc).map((v) => (v.id === "recs" ? { ...v, label: `${v.label} (${s.recommendations.length})` } : v))}
            />
            {shown === "series" && <SeriesCharts key={s.file} scope={scope} summary={s} approach={approach} side={side} period={period} onPeriod={setPeriod} />}
            {shown === "daily" && <DailyProfile summary={s} />}
            {shown === "profile" && (
              // side by side, about as wide: the week of one variable and every variable's months
              <div className="dash-weekmonth">
                <ProfileHeatmap summary={s} />
                <MonthlyHeatmap summary={s} />
              </div>
            )}
            {shown === "acf" && <Autocorrelation summary={s} />}
            {shown === "corr" && <CorrelationMatrix summary={s} />}
            {shown === "dists" && <Distributions variables={s.variables} names={names} />}
            {shown === "vars" && <VariablesTable variables={s.variables} rows={s.rows} groups={memberOf(notes)} names={names} />}
            {shown === "missing" && <MissingMap summary={s} />}
            {shown === "recs" && (
              <Recommendations
                items={s.recommendations}
                onPrepare={(step) => {
                  setDraft({ ...step });
                  if (dc) setView("edit"); // the step to prepare, in Prepare variables
                }}
              />
            )}
            {shown === "edit" && dc && (
              <>
                <p className="muted dash__note">Saved in your data folder's silver; the delivered files stay as they are.</p>
                <div className="dash__pair">
                  <Card title="Prepare variables">
                    <PrepareVariables variables={s.variables} recipe={recipe} draft={draft} onChanged={() => setRev((r) => r + 1)} />
                  </Card>
                  <Card title="Aggregate data">
                    <AggregateData
                      variables={s.variables}
                      files={files}
                      made={made}
                      resolution={s.resolution_seconds}
                      onDone={(opened, removed) => {
                        if (removed && removed === file) setFile(undefined); // the open file is gone: back to the first
                        if (opened) setFile(opened);
                        setRev((r) => r + 1);
                      }}
                      onOpen={(f) => setFile(f)}
                    />
                  </Card>
                </div>
              </>
            )}
          </Card>
            </>
          )}
        </>
      )}
    </div>
    </FocusContext.Provider>
    </div>
  );
}
