/**
 * The Site map's Quick analysis: a small window over the map with what the data center gives the heat sinks over one
 * typical year (quickAnalysis.ts), live while the site is edited. Its data center is the one on the map (kW and °C,
 * flat) or, when the data center has more, its heat as Heat Matching gets it (useHeatSources: its Model's free run or
 * measured columns at the extraction point Heat Matching picks first, or the Calculation from IT and cooling power).
 * Heat Matching is the detailed view; the window's button goes there.
 */
import { useEffect, useMemo, useState } from "react";
import type L from "leaflet";
import type { HeatSource, Site } from "../../api";
import { fmt, fmtDate } from "../../lib/format";
import { useSnapshotDetail } from "../../lib/live";
import { DEFAULT_OPTIONS, DEFAULT_SOURCE_PHYSICS, physicsSource } from "../../lib/matching";
import { DESIGN_OUTDOOR, HEATING_LIMIT } from "../../lib/networkTemps";
import { co2Short } from "../../lib/partKpis";
import { InfoMark } from "../../ui/InfoMark";
import { Kpi, KpiRow } from "../../ui/Kpi";
import { heatFacts } from "../../lib/heatFacts";
import { Co2Info } from "../twin/HeatFactsInfo";
import { Segmented } from "../../ui/Segmented";
import { LIQUID_POINTS, PHYSICS_POINTS } from "../heat/points";
import { pointTitle } from "../heat/ports";
import { useHeatSources, usePeriodColumns } from "../heat/useHeatSources";
import { DATASET } from "../../dataset";
import { readSetup } from "../twin/matchingSetup";
import { DC_SHARE, HP_SHARE } from "./hpSizing";
import { flatDc, fromMatching, quickAnalysis, toTypicalYear, type QuickDc } from "./quickAnalysis";
import TreeGrove from "./TreeGrove";
import { sourceYear } from "./pfa";
import { fieldsFor, forestOf, treesFor } from "./trees";
import { wasteKw } from "./siteEdits";

type From = "map" | "twin";
const ELEC = ["ITE_Ener", "HVAC_Ener"]; // the data center's own electricity, where its data has it (kW)

/** The data center's heat as Heat Matching runs it by default, over the typical year; null while loading or without. */
function useTwinDc() {
  const hs = useHeatSources("model");
  const { period, config, dataMaps, physicsOk, drivers, sources, model, columns, configured } = hs;
  const liquid = !!config?.heat_source?.liquid;
  // Heat Matching's default: the Model (its columns) when it has them, else the Calculation
  const physics = !Object.keys(dataMaps).length && physicsOk;
  const keys = physics ? (liquid ? LIQUID_POINTS : PHYSICS_POINTS) : Object.keys(dataMaps);
  const at = ["liquid", "condenser"].find((k) => keys.includes(k)) ?? keys[0];
  const prof = useMemo(
    () =>
      !at
        ? undefined
        : physics
          ? drivers
            ? physicsSource(at as "hall" | "condenser" | "liquid", drivers, DEFAULT_SOURCE_PHYSICS, liquid)
            : undefined
          : sources[at],
    [at, physics, drivers, liquid, sources],
  );
  const elecCols = useMemo(() => ELEC.filter((c) => columns.includes(c)), [columns]);
  const elec = usePeriodColumns(period, elecCols, "actual").raw;
  const dc = useMemo(() => {
    if (!prof || !period || hs.siteDc) return null;
    const q = toTypicalYear(period.times, prof.q);
    const ownKw = elecCols.length && elec ? period.times.map((_, i) => elecCols.reduce((a, c) => a + (elec[c]?.[i] ?? 0), 0)) : null;
    const out: QuickDc = { q: q.kw, t: toTypicalYear(period.times, prof.t).kw, ...(ownKw ? { elecKw: toTypicalYear(period.times, ownKw).kw } : {}) };
    // as Heat Matching: the Calculation's heat and a configured HEX's are what the HEX recovered, not passed through it again
    return { dc: out, share: q.share, recovered: physics || !!configured };
  }, [prof, period, hs.siteDc, elecCols, elec, physics, configured]);
  const how = physics ? "the Calculation from IT and cooling power" : model.trained && hs.fromModel.length ? "its Model's free run" : "its data, as measured";
  return {
    dc,
    label: at ? `${pointTitle(at)} · ${how}` : "",
    loading: hs.loading && !hs.error,
    error: hs.error,
  };
}

/** The grove's forests in numbers (TreeGrove.tsx, trees.ts), for the assistant: hectares and soccer fields of 105 × 68 m. */
function forestEquivalents(co2T: number) {
  const one = (x: number) => Math.round(x * 10) / 10;
  const co2Ha = forestOf(treesFor(co2T)).ha;
  return {
    soccer_field: "105 × 68 m, 0.714 ha",
    trees_taking_up_the_co2: Math.round(treesFor(co2T)),
    co2_forest: { ha: one(co2Ha), soccer_fields: one(fieldsFor(co2Ha)) },
  };
}

export default function QuickWindow({
  site,
  onClose,
  onOpenMatching,
  map,
  extra,
}: {
  site: Site | null;
  onClose?: () => void; // none: no close button (in the Site panel it is a card that folds)
  onOpenMatching: () => void;
  map?: { current: L.Map | null }; // the Site map, for the grove's forest in the Stadtwald
  extra?: HeatSource | null; // a second source (Plattform für Abwärme): it covers what the data center leaves (On the map only)
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [pick, setPick] = useState<From | null>(null);
  const twin = useTwinDc();

  // the site as it was 200 ms ago: typing a power or adding sinks in a row runs once
  const [inputs, setInputs] = useState(site);
  useEffect(() => {
    const t = window.setTimeout(() => setInputs(site), 200);
    return () => window.clearTimeout(t);
  }, [site]);

  const src = inputs?.source;
  const kw = wasteKw(src);
  const tC = src?.temp_c ?? 0;
  const has = !!src;
  const mapDc = useMemo(() => (has ? flatDc(kw, tC) : null), [has, kw, tC]);
  const from: From = pick === "twin" && twin.dc ? "twin" : "map"; // On the map first; As in Heat Matching when picked
  const dc = from === "twin" ? twin.dc!.dc : mapDc;
  const hm = useMemo(() => (from === "twin" ? readSetup(DATASET) : null), [from]);
  const extraYear = useMemo(() => (extra ? sourceYear(extra) : null), [extra]);
  const run = useMemo(() => {
    if (!inputs || !dc) return null;
    const t0 = performance.now();
    // a Model's columns found by their names only (no heat_source): the heat ahead of the exchanger, as Heat Matching has it
    const opts = from === "twin" && !twin.dc?.recovered ? { hexEff: DEFAULT_OPTIONS.hexEff, eta: DEFAULT_OPTIONS.eta } : undefined;
    const r = quickAnalysis(inputs, dc, opts, from === "map" && extraYear ? extraYear : null);
    return { r, ms: performance.now() - t0 };
  }, [inputs, dc, from, extraYear, twin.dc?.recovered]);
  // As in Heat Matching, once it has run: its own year (its models, its period), the same numbers as there (Operation
  // counts the grid's CO₂ by the hour: its tonnes differ); the sinks on the map count On the map
  const hmYear = from === "twin" ? hm?.result : undefined;
  // every figure then from that one run, per year (quickAnalysis.ts fromMatching), and its date in the source line
  const r = (run?.r && hmYear && hm ? fromMatching(run.r, hm) : null) ?? run?.r;
  const hmDate = hmYear && hm ? fmtDate(hm.saved) : null;

  const top = r ? Math.max(...r.months.demand, ...r.months.recovered, 1e-9) : 1;
  const facts = r ? heatFacts(r.recoveredMwh, r.co2T) : null; // the CO₂ box's cars and trees
  const sourceLine =
    from === "twin"
      ? hmDate
        ? `Heat Matching's year as it last ran, ${hmDate} · ${hm ? `${pointTitle(hm.at)} · ${hm.dcFrom}` : twin.label}` // its own point and model, not this card's guess
        : `${twin.label}${twin.dc && twin.dc.share < 0.99 ? ` · ${fmt(twin.dc.share * 100)} % of the year from its period, the rest its mean day` : ""}`
      : src
        ? `${fmt(kw)} kW waste heat at ${fmt(tC)} °C, flat all year (the Data center card)`
        : "";
  const twinWhy = twin.dc
    ? null
    : twin.loading
      ? "Loading the data center's data…"
      : (twin.error ?? "This data center has no heat source in its data: the map's is Heat Matching's too");

  // what the window says, for the assistant (lib/live.ts): its source and its numbers over the typical year
  const one = (x: number) => Math.round(x * 10) / 10;
  useSnapshotDetail(() => ({
    quick_analysis: {
      collapsed,
      data_center_from: from === "map" ? "On the map" : "As in Heat Matching",
      as_in_heat_matching: twinWhy ?? "available",
      source: sourceLine,
      results: r
        ? {
            heat_recovered_mwh_per_year: one(r.recoveredMwh),
            demand_covered_pct: one(r.coveredPct),
            co2_saved_t_per_year: one(r.co2T),
            heat_pump_electricity_mwh_per_year: one(r.hpElecMwh),
            data_center_electricity_mwh_per_year: r.dcElecMwh == null ? null : one(r.dcElecMwh),
            sinks_demand_mwh_per_year: one(r.demandMwh),
            peak_demand_kw: one(r.peakKw),
            waste_heat_offered_mwh_per_year: one(r.wasteMwh),
            network_supply_return_c: [r.supply, r.ret],
            per_month_mwh: { demand: r.months.demand.map(one), recovered: r.months.recovered.map(one) },
            forest_equivalents: forestEquivalents(r.co2T),
            second_source: r.extra && extra
              ? {
                  name: extra.name,
                  company: extra.company,
                  temperature_c: extraYear?.tempC ?? null,
                  offered_mwh_per_year: one(r.extra.wasteMwh),
                  delivered_mwh_per_year: one(r.extra.recoveredMwh),
                  heat_pump_electricity_mwh_per_year: one(r.extra.hpElecMwh),
                  data_center_alone_covered_pct: one(r.extra.dcCoveredPct),
                }
              : extra
                ? "taken, counted only On the map"
                : null,
          }
        : null,
      next: "Open in Heat Matching → saves unsaved map edits first, then opens #/twin/matching",
    },
  }));

  return (
    <section className="quick" aria-label="Quick analysis" data-ms={run ? run.ms.toFixed(1) : undefined}>
      <header className="quick__head">
        <span className="caps">Quick analysis</span>
        <span className="quick__year">one typical year</span>
        <button
          type="button"
          className="btn btn--xs"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand the quick analysis" : "Collapse the quick analysis"}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "+" : "−"}
        </button>
        {onClose && (
          <button type="button" className="btn btn--xs" aria-label="Close the quick analysis" onClick={onClose}>
            ×
          </button>
        )}
      </header>
      {!collapsed && (
        <div className="quick__body">
          <Segmented<From>
            label="Data center of the analysis"
            value={from}
            onChange={setPick}
            options={[
              { id: "map", label: "On the map" },
              { id: "twin", label: "As in Heat Matching", disabled: twinWhy },
            ]}
          />
          <div className="quick__source" aria-label="Data center used">
            {sourceLine}
          </div>
          {!src && from === "map" ? (
            <p className="quick__note">Pick the data center's building first (“Pick a building”).</p>
          ) : !r ? (
            <p className="quick__note">Add heat sinks (“+ Buildings”, “+ Area (district)” or a Wärmeatlas building) to see what the data center covers.</p>
          ) : (
            <>
              <KpiRow fold="kpi-fold" className="quick__kpis">
                <Kpi
                  label="Heat delivered"
                  value={fmt(r.recoveredMwh / 1000, 1)}
                  unit="GWh/yr"
                  tone="var(--heat-strong)"
                  bar={r.coveredPct}
                  // what it is made of: the data center's waste heat, and the heat pump's electricity turned into heat too
                  hint={`${fmt(Math.max(0, r.recoveredMwh - r.hpElecMwh))} waste heat + ${fmt(r.hpElecMwh)} heat-pump electricity · ${fmt(r.coveredPct)} % of the demand covered`}
                />
                <Kpi
                  label="CO₂ saved"
                  value={fmt(r.co2T, 1)}
                  unit="t/yr"
                  tone="var(--ok)"
                  hint="against gas, minus the heat pump's grid power"
                  info={<Co2Info f={facts!} co2T={r.co2T} />}
                />
                <Kpi
                  label="Electricity needed"
                  value={fmt(r.hpElecMwh / 1000, 1)}
                  unit="GWh/yr"
                  tone="var(--accent)"
                  hint={`heat pump · data center ${r.dcElecMwh != null ? `${fmt(r.dcElecMwh)} MWh/yr` : "not known"}`}
                />
                <Kpi
                  label="Demand of the sinks"
                  value={fmt(r.demandMwh / 1000, 1)}
                  unit="GWh/yr"
                  hint={`peak ${fmt(r.peakKw)} kW · network ${r.ret == null ? `supply ${fmt(r.supply)}` : `${fmt(r.supply)}/${fmt(r.ret)}`} °C`}
                />
              </KpiRow>
              {r.extra && extra && (
                <div className="quick__source" aria-label="Second source">
                  <b>With {extra.name ?? "the waste heat source"}</b> ({extra.company ?? ""}, {extraYear?.tempC == null ? "temperature unknown" : `${fmt(extraYear.tempC)} °C`}):{" "}
                  {`+${fmt(r.extra.recoveredMwh)} MWh/yr of its ${fmt(r.extra.wasteMwh)} offered${r.extra.hpElecMwh > 0 ? ` (through its own heat pump, ${fmt(r.extra.hpElecMwh)} MWh/yr electricity)` : " (directly)"}; the data center alone covers ${fmt(r.extra.dcCoveredPct)} %, together ${fmt(r.coveredPct)} %.`}
                </div>
              )}
              {extra && !r.extra && <div className="quick__source">The second source counts On the map only.</div>}
              <TreeGrove co2T={r.co2T} heatMwh={r.recoveredMwh} map={map} near={site?.source} />
              <div className="quick__months" role="img" aria-label="Demand and recovered heat per month">
                {r.months.demand.map((d, i) => (
                  <span key={i} className="quick__month" title={`${fmt(d)} MWh demand, ${fmt(r.months.recovered[i])} MWh recovered`}>
                    <i className="quick__bar quick__bar--demand" style={{ height: `calc((100% - 12px) * ${d / top})` }} />
                    <i className="quick__bar quick__bar--recovered" style={{ height: `calc((100% - 12px) * ${r.months.recovered[i] / top})` }} />
                    <b>{"JFMAMJJASOND"[i]}</b>
                  </span>
                ))}
              </div>
              <div className="quick__legend">
                <span>
                  <i className="quick__bar--demand" /> demand
                </span>
                <span>
                  <i className="quick__bar--recovered" /> recovered
                </span>
                <span>{fmt(r.wasteMwh / 1000, 1)} GWh/yr waste heat offered</span>
              </div>
            </>
          )}
          <div className="site__buttons">
            <button type="button" className="btn btn--primary btn--sm" onClick={onOpenMatching}>
              Open in Heat Matching →
            </button>
            <InfoMark
              term="how the quick analysis is made"
              mark="?"
              hover
              text={
                hmYear
                  ? `Heat Matching's year as it last ran (${hmDate}): its models, its period, its heat pump and storage, the same numbers as there (${co2Short()}; Operation counts the grid's CO₂ hour by hour, so its tonnes differ). The heat sinks on the map and their edits count under On the map.`
                  : `Hourly, on the typical Frankfurt weather, with Heat Matching's built-in formulas and defaults (heat exchanger; a heat pump of ${fmt(HP_SHARE * 100)} % of the sinks' peak hour, larger until it gives ${fmt(DC_SHARE * 100)} % of the year's heat, at most what the data center's heat allows at its COP, as the heat network's; a tank of an hour of the smaller of it and the sinks' peak; the network's supply hour by hour on Heat Matching's heating curve at its defaults, the sinks' supply at ${fmt(DESIGN_OUTDOOR)} °C outside and below, 15 K less (at least 10 K above the return) at ${fmt(HEATING_LIMIT)} °C and above; ${co2Short()}, where Operation counts it hour by hour). Unsaved map edits count here; the button saves them first.${from === "twin" ? " Open Heat Matching once and its own year shows here." : ""}`
              }
            />
          </div>
        </div>
      )}
    </section>
  );
}
