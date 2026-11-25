/**
 * The Site map's Heat distribution card: the heat network that takes the data center's heat to the buildings. A
 * transmission line runs from the data center to a heat-pump station (straight across its grounds, then along the
 * streets), and from the station distribution pipes run under the streets and house connections into the buildings
 * it can supply (network.ts picks them: most demand per metre of pipe, while the data center's heat still gives the
 * target share of the year's heat; a peak boiler covers the coldest hours). The card itself stays short: Plan, the
 * buildings supplied, the pipe, the NPV and the break-even. "Details…" opens the rest in a bigger panel: where the
 * inputs come from ("How it works"), every figure, which heat sinks it leaves out and why (they leave the map while the
 * network is shown), the hour by hour (NetworkTime.tsx) and the year, the months and a winter beside a summer day
 * (networkFigures.tsx); "Costs and assumptions…" the breakdown, the cash flows and the assumptions with their sources
 * (NetworkCosts.tsx). The hour shown is turned and played on the map's own dials (MapTime.tsx) and drawn there
 * (networkLayer.ts: the water moving in the pipes, the buildings' heat, the station's load). The station can be
 * dragged, and the plan follows it. The streets are the example's (streets.json) or, on a click, OpenStreetMap's. With
 * the Wärmeatlas imported, the streets' heat line density of the box is loaded too (tile by tile, from the local import)
 * and the pipes prefer the dense streets (network.ts densityPull). The user's assumptions and a moved station are kept
 * in this browser; the moved station goes into the site too (`onStation`, kept with Save: a case opens with its station
 * where it was placed).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { fetchStreets, type Site } from "../../api";
import { DATASET } from "../../dataset";
import { demandEntries, hottestIncluded } from "../../lib/demand";
import { errorMessage } from "../../lib/errors";
import { fmt } from "../../lib/format";
import { defaultCurve, DESIGN_OUTDOOR, HEATING_LIMIT } from "../../lib/networkTemps";
import { useSnapshotDetail } from "../../lib/live";
import { readJson, writeJson } from "../../lib/storage";
import { Dialog } from "../../ui/Dialog";
import { InfoMark } from "../../ui/InfoMark";
import { Kpi } from "../../ui/Kpi";
import { Segmented } from "../../ui/Segmented";
import { buildingsOf, planNetwork, type HeatNetwork as Network, type NetworkInput } from "./network";
import NetworkCosts from "./NetworkCosts";
import { capacityOnCurve, copLabel, DEFAULT_PARAMS, hourAt, networkEconomics, networkHours, wholeYears, type NetworkParams } from "./networkCost";
import { DayPair, FigureLegend, MonthBars, YearFlow } from "./networkFigures";
import NetworkTime from "./NetworkTime";
import MapTime from "./MapTime";
import { atHour, dayOf, hourLabel, hourOf, midMonth, monthOf, notSupplied, presetsOf, type Why } from "./networkView";
import { streetsIn } from "./osm";
import { wasteKw } from "./siteEdits";
import { LINES_ATTRIBUTION } from "./waermeatlas";
import { useNetworkData } from "./useNetworkData";
import { useNetworkLayer } from "./useNetworkLayer";

const PARAMS_KEY = "site-network"; // the user's assumptions, in this browser
const stationKey = () => `site-network-station:${DATASET}`; // a station moved by hand, per data center

/** `onPlanned`: whether a network is planned now (one with buildings supplied): the Site panel's step ③ is done then.
 * `onShown`: the heat sinks supplied while the network is on the map (null: none shown): the map draws only those. */
export default function HeatNetwork({
  site,
  map,
  open,
  onPlanned,
  onShown,
  onMap = true,
  onStation,
  show,
  onShow,
}: {
  site: Site | null;
  map: { current: L.Map | null };
  open?: boolean; // the card is open: the network is planned then by itself (on stored streets; OpenStreetMap only on a click)
  onPlanned?: (planned: boolean) => void;
  onShown?: (supplied: Set<string> | null) => void;
  onMap?: boolean; // false: planned, but not drawn (another step of the panel is shown)
  onStation?: (at: { lat: number; lon: number } | null) => void; // the station moved by hand (null: back to the plan's), into the site
  show: boolean; // drawn on the map (its "On the map", and the panel's "Show all")
  onShow: (show: boolean) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planned, setPlanned] = useState(false);
  const [station, setStationState] = useState<{ lat: number; lon: number } | null>(() => readJson(stationKey(), null));
  const [params, setParamsState] = useState<NetworkParams>(() => wholeYears({ ...DEFAULT_PARAMS, ...readJson<Partial<NetworkParams>>(PARAMS_KEY, {}) }));
  const [panel, setPanel] = useState<"details" | "costs" | null>(null); // the bigger panel open over the page
  const [hour, setHour] = useState<number | null>(null); // the hour shown (null: the coldest day's evening)
  const setStation = (s: { lat: number; lon: number } | null) => {
    setStationState(s);
    writeJson(stationKey(), s);
    onStation?.(s);
  };
  const setParams = (typed: NetworkParams) => {
    const p = wholeYears(typed); // the horizon and the lives in whole years: what the cash flows count and the labels say
    setParamsState(p);
    writeJson(PARAMS_KEY, p);
  };

  const { streets, setStreets, noStreets, setNoStreets, inputs, src, box, lines, heatLines } = useNetworkData(site, planned);
  const placed = station ?? inputs?.network_station ?? null; // moved by hand here, else as the site keeps it
  const plan = useMemo(() => {
    if (!planned || !streets || !inputs || !src || !heatLines) return null;
    const t0 = performance.now();
    const hot = inputs.sinks.length ? hottestIncluded(demandEntries(inputs)) : null;
    const capacityKw = capacityOnCurve(src, hot?.supplyTemp ?? 70, hot?.returnTemp ?? 40);
    const buildings = buildingsOf(inputs);
    const input: NetworkInput = {
      streets: streets.ways,
      source: { lat: src.lat, lon: src.lon, outline: inputs.building?.outline },
      buildings,
      capacityKw,
      station: placed,
      minDensity: params.minDensity,
      reachM: params.reachM > 0 ? params.reachM : Infinity,
      hpShare: params.hpSharePct / 100,
      minDcShare: params.dcSharePct / 100,
      fullPeak: params.fullPeak,
      useAll: params.useAll,
      heatLines,
      densityPull: params.densityPullPct / 100,
    };
    const net: Network = planNetwork(input);
    const ms = performance.now() - t0;
    // the same plan without the density rule, from the same station: who that rule alone leaves out (networkView.ts)
    const loose = net.station && net.chosen.length && params.minDensity > 0 ? planNetwork({ ...input, station: net.station, minDensity: 0 }) : null;
    return { net, buildings, loose, capacityKw, ms };
  }, [
    planned,
    streets,
    inputs,
    src,
    placed,
    heatLines,
    params.minDensity,
    params.reachM,
    params.hpSharePct,
    params.dcSharePct,
    params.fullPeak,
    params.useAll,
    params.densityPullPct,
  ]);
  const net = plan?.net;
  const econ = useMemo(() => (inputs && net && !net.problem && net.chosen.length ? networkEconomics(inputs, net, params) : null), [inputs, net, params]);
  // breaks even in the last year only by what is left of the plant then (its residual value): said on the card
  const lastYearOnly = !!econ && econ.breakEven === params.years && (econ.flows[params.years]?.residual ?? 0) > 0 && (econ.flows[params.years - 1]?.cum ?? 0) + (econ.flows[params.years]?.disc ?? 0) - (econ.flows[params.years]?.residual ?? 0) / (1 + params.discountPct / 100) ** params.years < -1;
  useEffect(() => onPlanned?.(!!econ), [econ, onPlanned]);
  // the year hour by hour (built once per plan), the hour shown and the tints' scale: the peak hour of the building at
  // the 90th percentile (one very large building would leave the others pale)
  const hours = useMemo(() => (inputs && net && econ ? networkHours(inputs, net, econ, params) : null), [inputs, net, econ, params]);
  const presets = useMemo(() => (hours ? presetsOf(hours) : null), [hours]);
  const h = hour ?? presets?.winterEvening ?? 0;
  const now = useMemo(() => (hours ? hourAt(hours, h) : null), [hours, h]);
  const topKw = useMemo(() => {
    const p = (hours?.kw ?? []).map((k) => k.reduce((a, b) => Math.max(a, b), 0)).sort((a, b) => a - b);
    return p.length ? p[Math.floor(0.9 * (p.length - 1))] : 0;
  }, [hours]);
  const left = useMemo(
    () =>
      inputs && plan && econ
        ? notSupplied(
            inputs.sinks.map((s) => s.id),
            plan.buildings,
            plan.net,
            plan.loose,
            params.fullPeak,
          )
        : null,
    [inputs, plan, econ, params.fullPeak],
  );
  const shown = show && !!econ && onMap;
  useEffect(() => onShown?.(shown && net ? new Set(net.chosen) : null), [shown, net, onShown]);

  /** Plan: the stored streets first (an example's); a station moved by hand stays. Plan again: the station back where
   * the optimisation puts it. */
  const start = async () => {
    setError(null);
    if (planned) setStation(null);
    if (streets) return setPlanned(true);
    setBusy("Loading the streets…");
    try {
      const s = await Promise.race([
        fetchStreets(DATASET),
        new Promise<never>((_, no) => window.setTimeout(() => no(new Error("The app sent no streets within 20 s")), 20_000)),
      ]);
      setStreets({ ways: s.ways, from: "stored with the data center, © OpenStreetMap contributors (ODbL)" });
      setNoStreets(null);
      setPlanned(true);
    } catch (e) {
      setNoStreets(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  // opened: planned by itself, once, when there is something to plan
  const tried = useRef(false);
  useEffect(() => {
    if (!open || tried.current || planned || busy || !site?.source || !site.sinks.length) return;
    tried.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start reads the latest state; once per page
  }, [open, site, planned, busy]);
  /** The streets of the sinks' box from OpenStreetMap (Overpass): only on this click; kept on this page, never saved. */
  const fromOsm = async () => {
    if (!box) return;
    setError(null);
    setBusy("Asking OpenStreetMap for the streets… (up to 45 s)");
    try {
      const ways = await streetsIn(box);
      setStreets({ ways, from: "from OpenStreetMap just now (not saved), © OpenStreetMap contributors (ODbL)" });
      setNoStreets(null);
      setPlanned(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  // the plan on the map, in its own pane over the site's outlines and bubbles (networkLayer.ts)
  useNetworkLayer({ map, show, onMap, net, econ, inputs, src, topKw, now, onStation: setStation });

  const all = inputs?.sinks.length ?? 0;
  const usedPct = econ && econ.year.wasteMwh ? (100 * econ.year.sourceMwh) / econ.year.wasteMwh : 0;
  const one = (x: number) => Math.round(x * 10) / 10;
  const why: Record<Why, string> = {
    share: params.fullPeak
      ? "beyond the heat pump at the design peak"
      : params.useAll
        ? "would take almost none of the data center's heat (the boiler's)"
        : `beyond what the data center's heat gives at ${fmt(params.dcSharePct)} % of the year`,
    peak: "beyond the heat pump at the design peak",
    density: `too little heat per metre (under ${fmt(params.minDensity, 1)} MWh/(m·a))`,
    far: "too far from a street (over 150 m)",
    street: "on a street not joined to the network's",
    reach: `more than ${fmt(params.reachM)} m along the streets from the station`,
    demand: "no heat demand",
  };
  const byWhy = left ? (Object.keys(why) as Why[]).map((w) => ({ w, n: [...left.values()].filter((x) => x === w).length })).filter((x) => x.n) : [];
  useSnapshotDetail(() => ({
    heat_network: {
      planned,
      streets: streets ? `${streets.ways.length} ways · ${streets.from}` : (noStreets ?? "not loaded (Plan loads them)"),
      problem: net?.problem ?? null,
      station: net?.station ? { ...net.station, moved_by_hand: !!placed } : null,
      plan_ms: plan ? one(plan.ms) : null,
      ...(net && econ
        ? {
            buildings_supplied: net.chosen.length,
            buildings_of_all: all,
            not_supplied: {
              count: left?.size ?? 0,
              hidden_on_map: shown,
              by_reason: Object.fromEntries(byWhy.map((x) => [why[x.w], x.n])),
            },
            unreached: net.unreached,
            pipe_m: {
              transmission: Math.round(net.m.transmission),
              distribution: Math.round(net.m.distribution),
              service: Math.round(net.m.service),
              total: Math.round(net.totalM),
            },
            heat_sold_mwh_per_year: Math.round(econ.year.soldMwh),
            data_center_heat_used_pct: one(usedPct),
            linear_heat_density_mwh_per_m_a: one(net.density),
            street_heat_line_density_mwh_per_m_a: net.streetDensity == null ? (lines.note ?? "not loaded") : one(net.streetDensity),
            wärmeatlas_street_segments: heatLines?.length ?? 0,
            design_peak_kw: Math.round(net.peakKw),
            peak_hour_kw: Math.round(net.yearPeakKw),
            heat_pump_kw: Math.round(econ.hpKw),
            heat_pump_sizing: params.fullPeak
              ? "for the full design peak (only the buildings it covers)"
              : `${fmt(params.hpSharePct)} % of the peak hour (larger if the data center's ${fmt(params.dcSharePct)} % needs it), a gas peak boiler for the rest`,
            heat_pump_capacity_from_the_data_center_kw: Math.round(econ.capacityKw),
            heat_from_heat_pump_pct: one(econ.dcShare * 100), // the data center's heat and the heat pump's electricity
            heat_from_boiler_pct: one(econ.boilerShare * 100),
            seasonal_cop: one(econ.cop), // the year's heat-pump heat ÷ its electricity (the supply on the heating curve)
            peak_boiler_kw: econ.boilerKw,
            year_mwh: {
              data_center_heat_offered: Math.round(econ.year.wasteMwh),
              data_center_heat_used: Math.round(econ.year.sourceMwh),
              heat_pump_electricity: Math.round(econ.year.hpElecMwh),
              from_heat_pump: Math.round(econ.year.hpMwh),
              from_boiler: Math.round(econ.year.boilerMwh),
              sold: Math.round(econ.year.soldMwh),
              lost_by_the_pipes: Math.round(econ.year.lossMwh),
            },
            ...(hours
              ? {
                  months_mwh: Object.fromEntries(
                    (["demand", "hp", "taken", "hpElec", "boiler", "spare"] as const).map((k) => [k, hours.months[k].map(Math.round)]),
                  ),
                }
              : {}),
            ...(now
              ? {
                  hour_shown: {
                    hour_of_year: now.h,
                    when: hourLabel(now.h),
                    outdoor_c: one(now.outdoorC),
                    demand_kw: Math.round(now.demandKw),
                    pipe_loss_kw: Math.round(now.lossKw),
                    heat_pump_kw: Math.round(now.hpKw),
                    heat_pump_electricity_kw: Math.round(now.hpElecKw),
                    boiler_kw: Math.round(now.boilerKw),
                    data_center_heat_kw: Math.round(now.dcKw),
                    data_center_heat_taken_kw: Math.round(now.takenKw),
                    data_center_heat_spare_kw: Math.round(now.spareKw),
                    fastest_water_m_s: Math.round(Math.max(0, ...now.pipes.map((x) => x.velocity)) * 100) / 100,
                  },
                }
              : {}),
            heat_from_heat_pump_mwh: Math.round(econ.year.hpMwh),
            heat_from_boiler_mwh: Math.round(econ.year.boilerMwh),
            heat_pump_electricity_mwh: Math.round(econ.year.hpElecMwh),
            heat_loss_pct: one(econ.lossShare * 100),
            investment_eur: Object.fromEntries(econ.lines.map((l) => [l.key, Math.round(l.eur)])),
            capex_eur: Math.round(econ.capex),
            grant_eur: Math.round(econ.grant),
            bew: econ.bewWhy ?? (econ.gap ? "granted, at most the funding gap" : "no funding gap: no BEW aid (Modul 1 only)"),
            bew_funding_gap_eur: Math.round(econ.gap),
            investment_after_grant_eur: Math.round(econ.invest),
            npv_eur: Math.round(econ.npv),
            break_even_year: econ.breakEven,
            simple_payback_years: econ.payback == null ? null : one(econ.payback),
            lcoh_eur_per_mwh: one(econ.lcoh),
            parameters: params,
          }
        : {}),
      next: "click Plan the heat network (Plan again: the station back to its automatic place); move the hour with the Day of the year and Hour of the day sliders or the presets (Winter evening, Summer noon), or play the year or the day; a month or an hour in the figures shows it too; Costs and assumptions… opens the breakdown, the cash flows and every assumption with its source; the HP station on the map can be dragged",
    },
  }));

  const close = () => setPanel(null);
  return (
    <div className="net">
      <div className="site__buttons">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void start()}
          disabled={!site?.source || !!busy}
          title="Plan again also puts a moved station back where the plan places it"
        >
          {planned ? "Plan again" : "Plan the heat network"}
        </button>
        <InfoMark
          term="the planning"
          mark="?"
          hover
          text="The data center's heat goes to a heat-pump station and from there under the streets into the buildings it can supply. The figures, the hour by hour and the costs open under Details; turn the time on the map's dials."
        />
        {planned && (
          <label className="net__show">
            <input type="checkbox" checked={show} onChange={(e) => onShow(e.target.checked)} /> On the map
          </label>
        )}
      </div>
      <Segmented<"compact" | "all">
        label="Plan for"
        value={params.useAll ? "all" : "compact"}
        onChange={(g) => setParams({ ...params, useAll: g === "all" })}
        options={[
          { id: "compact", label: "Compact, round the station" },
          { id: "all", label: "All the data center's heat" },
        ]}
      />
      {busy && <div className="site__hint">{busy}</div>}
      {error && <div className="site__hint net__problem">{error}</div>}
      {noStreets && box && (
        <div className="net__osm">
          <div className="site__hint">{noStreets}.</div>
          <button type="button" className="btn btn--sm" onClick={() => void fromOsm()} disabled={!!busy}>
            Load streets from OpenStreetMap
          </button>
          <div className="site__hint">
            Sends only this box (south, west, north, east: the heat sinks plus 150 m) to overpass-api.de: {box.map((x) => fmt(x, 5)).join(", ")}. The streets
            stay on this page, they are not saved.
          </div>
        </div>
      )}
      {!src && <p className="site__hint">Pick the data center&apos;s building first.</p>}
      {planned && net?.problem && <p className="site__hint net__problem">{net.problem}</p>}
      {planned && net?.warning && (
        <p className="site__hint net__problem" role="note" aria-label="Transmission line">
          {net.warning}
        </p>
      )}
      {planned && net && !net.problem && !net.chosen.length && (
        <p className="site__hint">
          No building can be supplied: none with a heat demand near a street fits the {fmt(plan.capacityKw)} kW the data center&apos;s heat gives.
        </p>
      )}
      {net && econ && (
        <>
          <div className="quick__kpis" aria-label="The heat network">
            <Kpi
              label="Buildings supplied"
              value={fmt(net.chosen.length)}
              unit={`of ${fmt(all)}`}
              tone="var(--heat-strong)"
              bar={all ? (100 * net.chosen.length) / all : 0}
              sub={`${fmt(econ.year.soldMwh)} MWh/yr sold · ${fmt(usedPct)} % of the data center's heat used`}
            />
            <Kpi
              label="Pipes"
              value={fmt(net.totalM / 1000, 2)}
              unit="km"
              sub={
                net.streetDensity == null
                  ? `${fmt(net.m.distribution)} m under the streets`
                  : `${fmt(net.m.distribution)} m under streets of ${fmt(net.streetDensity, 1)} MWh/(m·a)`
              }
            />
            <Kpi
              label={`NPV, ${fmt(params.years)} years`}
              value={fmt(econ.npv / 1e6, 1)}
              unit="M€"
              tone={econ.npv >= -1 ? "var(--ok)" : "var(--danger)"}
              sub={`${fmt(econ.invest / 1e6, 1)} M€ invested`}
            />
            <Kpi
              label="Break-even"
              value={econ.breakEven == null ? "none" : `year ${fmt(econ.breakEven)}`}
              tone={econ.breakEven == null ? "var(--danger)" : "var(--ok)"}
              sub={econ.breakEven == null ? `not within ${fmt(params.years)} years` : "discounted"}
            />
          </div>
          {left && left.size > 0 && (
            <div className="site__hint net__left">
              {fmt(left.size)} heat sink{left.size === 1 ? "" : "s"} not supplied{shown ? ", not drawn on the map" : ""} (why: under Details).
            </div>
          )}
          <div className="site__buttons">
            <button type="button" className="btn btn--sm" onClick={() => setPanel("details")}>
              Details…
            </button>
            <button type="button" className="btn btn--sm" onClick={() => setPanel("costs")}>
              Costs and assumptions…
            </button>
          </div>
        </>
      )}
      {shown && hours && now && <MapTime map={map} hours={hours} h={h} now={now} onHour={setHour} />}
      {panel === "details" && net && econ && (
        <Dialog label="Heat distribution: the plan in detail" onClose={close} className="net__dialog">
          <div className="net__dialog-head">
            <h2>Heat distribution: the plan in detail</h2>
            <button type="button" className="btn btn--xs" aria-label="Close" onClick={close}>
              ×
            </button>
          </div>
          <details className="net__how">
            <summary>How it works: the data and the plan</summary>
            <dl>
              <dt>The data center&apos;s heat</dt>
              <dd>
                {src ? `${fmt(wasteKw(src))} kW at ${fmt(src.temp_c)} °C` : "its power and temperature"}, from the Data center card, the same every hour of the
                year.
              </dd>
              <dt>The buildings&apos; demand</dt>
              <dd>
                Each heat sink&apos;s yearly heat (the District card) shaped by its profile, hour by hour on the typical Frankfurt year (8.760 hours, its outdoor
                temperature).
              </dd>
              <dt>The streets</dt>
              <dd>
                {streets ? `OpenStreetMap's, ${streets.from.replace(", © OpenStreetMap contributors (ODbL)", "")} (ODbL).` : "OpenStreetMap's, loaded by Plan."}
              </dd>
              <dt>The streets&apos; heat</dt>
              <dd>
                {net.streetDensity == null
                  ? `No heat line density: ${lines.note ?? "not loaded"}; the pipes take the shortest ways.`
                  : `The heat line density of ${fmt(heatLines?.length ?? 0)} street segments (${LINES_ATTRIBUTION}): the pipes prefer the dense streets (${fmt(params.densityPullPct)} %, under Costs and assumptions); the streets under the distribution pipe carry ${fmt(net.streetDensity, 1)} MWh/(m·a) on average.`}
              </dd>
              <dt>The heat pump</dt>
              <dd>
                Heat Matching&apos;s formulas: COP = 0,5 × Carnot between the data center&apos;s water and the network&apos;s supply
                {econ
                  ? ` (hour by hour on a heating curve: ${fmt(econ.supplyC)} °C at ${fmt(DESIGN_OUTDOOR)} °C outside and below, ${fmt(defaultCurve(econ.supplyC, econ.returnC).summer)} °C at ${fmt(HEATING_LIMIT)} °C and above, Heat Matching's defaults; ${econ.cop > 0 ? `${copLabel(econ.cop)}, the year's heat ÷ its electricity` : copLabel(0)})`
                  : ""}; the data center&apos;s heat is the heat used (the Data center card&apos;s): all of it reaches the heat pump, less the transmission line&apos;s loss.
              </dd>
              <dt>The costs</dt>
              <dd>The cost catalogue (KWW Technikkatalog, DEA) and the BEW grant: every figure and its source under “Costs and assumptions…”.</dd>
            </dl>
            <ol>
              <li>A transmission line takes the data center&apos;s warm water straight across its grounds and, for a station further off, along the streets to the heat-pump station.</li>
              <li>
                Pipes run under the streets on the shortest tree that joins the buildings (with the heat line density: the cheapest, dense streets counting
                fewer metres), none fed the long way round a block (at most 1,5 times its shortest way); a house connection runs to each one&apos;s wall.
              </li>
              <li>
                Buildings join by the most heat per metre of pipe added, while the data center&apos;s heat still gives {fmt(params.dcSharePct)} % of the year&apos;s
                heat; branches under {fmt(params.minDensity, 1)} MWh per metre and year are cut.
              </li>
              <li>
                The heat pump is sized to {fmt(params.hpSharePct)} % of the network&apos;s peak hour (at most what the data center&apos;s heat allows); a gas peak
                boiler covers the cold hours above it.
              </li>
              <li>Every hour of the year is then run: the heat pump, the boiler, the pipes&apos; losses, the data center&apos;s heat taken and left.</li>
            </ol>
          </details>
          <div className="net__dialog-grid">
            <section>
              <div className="quick__kpis" aria-label="The heat network">
                <Kpi
                  label="Buildings supplied"
                  value={fmt(net.chosen.length)}
                  unit={`of ${fmt(all)}`}
                  tone="var(--heat-strong)"
                  bar={all ? (100 * net.chosen.length) / all : 0}
                  sub={`${fmt(econ.year.soldMwh)} MWh/yr sold · ${fmt(usedPct)} % of the data center's heat used`}
                />
                <Kpi
                  label="Pipes"
                  value={fmt(net.totalM / 1000, 2)}
                  unit="km"
                  sub={`${fmt(net.m.transmission)} m to the station · ${fmt(net.m.distribution)} m under the streets · ${fmt(net.m.service)} m into the buildings`}
                />
                <Kpi
                  label="Heat pump"
                  value={fmt(econ.hpKw / 1000, 1)}
                  unit="MW"
                  sub={`${copLabel(econ.cop)} · ${fmt(econ.dcShare * 100)} % of the heat · peak boiler ${fmt(econ.boilerKw)} kW`}
                />
                <Kpi
                  label="Heat density"
                  value={fmt(net.density, 1)}
                  unit="MWh/(m·a)"
                  sub={`heat losses ${fmt(econ.lossShare * 100, 1)} % · rule of thumb > ${fmt(1.5, 1)}`}
                />
              </div>
              {left && left.size > 0 && (
                <div className="site__hint net__left" aria-label="Not supplied">
                  <b>
                    {fmt(left.size)} heat sink{left.size === 1 ? "" : "s"} not supplied
                  </b>
                  {shown ? " (not drawn on the map while the network is shown)" : ""}: {byWhy.map((x) => `${fmt(x.n)} ${why[x.w]}`).join(", ")}.
                </div>
              )}
              <span className="caps site__sub-head">Investment and payback</span>
              <div className="quick__kpis" aria-label="Investment and payback">
                <Kpi
                  label="Investment"
                  value={fmt(econ.invest / 1e6, 1)}
                  unit="M€"
                  sub={
                    econ.bewWhy
                      ? `no BEW grant: ${econ.bewWhy}`
                      : econ.gap
                        ? `after ${fmt(econ.grant / 1e6, 1)} M€ BEW grant · ${fmt(econ.capex / 1e6, 1)} M€ before`
                        : `no BEW grant: it pays without (no funding gap)${econ.grant > 0 ? `; Modul 1: half the study, ${fmt(econ.grant / 1e3)} k€` : ""}`
                  }
                />
                <Kpi
                  label={`NPV, ${fmt(params.years)} years`}
                  value={fmt(econ.npv / 1e6, 1)}
                  unit="M€"
                  tone={econ.npv >= -1 ? "var(--ok)" : "var(--danger)"}
                  sub={econ.gap && !econ.bewWhy ? `at ${fmt(params.discountPct, 1)} % a year; the BEW aid is sized to close the gap: 0 at most` : `at ${fmt(params.discountPct, 1)} % a year`}
                />
                <Kpi
                  label="Break-even"
                  value={econ.breakEven == null ? "none" : `year ${fmt(econ.breakEven)}`}
                  tone={econ.breakEven == null ? "var(--danger)" : "var(--ok)"}
                  sub={
                    econ.breakEven == null
                      ? `not within ${fmt(params.years)} years`
                      : `discounted${econ.payback != null ? ` · simple payback ${fmt(econ.payback, 1)} years` : ""}${
                          lastYearOnly ? ` · only with what is left of the plant in year ${fmt(params.years)}` : ""
                        }`
                  }
                />
                <Kpi
                  label="Cost of heat"
                  value={fmt(econ.lcoh)}
                  unit="€/MWh"
                  sub={`levelised, year 1's (rising ${fmt(params.escalationPct, 1)} % a year): the heat price at which it just pays${econ.gap && !econ.bewWhy ? " without the BEW aid" : ""}; sold at ${fmt(params.heatPrice)} €/MWh`}
                />
              </div>
              <div className="site__buttons">
                <button type="button" className="btn btn--sm" onClick={() => setPanel("costs")}>
                  Costs and assumptions…
                </button>
              </div>
            </section>
            <section>
              {hours && now && (
                <>
                  <span className="caps site__sub-head net__box">
                    Hour by hour
                    <InfoMark
                      term="Hour by hour"
                      text="Pick an hour of the typical year: the map shows it (the water's flow in each pipe, each building's heat, the station's load) and these figures say what the network does then. The coldest hours need the boiler; in summer the data center's heat is mostly left unused."
                    />
                  </span>
                  <NetworkTime hours={hours} h={h} now={now} onHour={setHour} />
                  <div className="net__legend" aria-label="Heat network legend">
                    <span>
                      <i className="net__key net__key--transmission" /> data center → station ({fmt(src?.temp_c ?? 0)}/{fmt((src?.temp_c ?? 0) - params.sourceDtK)}{" "}
                      °C water)
                    </span>
                    <span>
                      <i className="net__key net__key--distribution" /> under the streets ({fmt(econ.supplyC)}/{fmt(econ.returnC)} °C)
                    </span>
                    <span>
                      <i className="net__key net__key--service" /> into the buildings
                    </span>
                    <span>
                      <i className="net__key net__key--flow" /> the water moving: faster dots, faster water
                    </span>
                    <span>
                      <i className="net__key net__key--heat" /> buildings: their heat now, little → the most
                    </span>
                    <span>
                      <i className="net__key net__key--station" /> station: pulses with the heat pump&apos;s load, a blue flame while the boiler runs
                    </span>
                  </div>

                  <span className="caps site__sub-head net__box">
                    The year, MWh
                    <InfoMark
                      term="The year"
                      text="The typical year's heat in MWh, top to bottom: what goes in (the data center's heat, the part used and the part left unused, with what the transmission line loses on the way; the heat pump's electricity; the boiler's heat from gas), what the station makes, and what reaches the buildings or is lost by the pipes. The widths are to one scale."
                    />
                  </span>
                  <YearFlow y={econ.year} />
                  <span className="caps site__sub-head net__box">
                    Month by month, MWh
                    <InfoMark
                      term="Month by month"
                      text="Each month's heat from the heat pump (the data center's heat and its electricity), from the peak boiler, and the data center's heat left over (what the heat pump could still take), stacked; the line is the buildings' demand (the bars without the left-over part are the demand plus the pipes' losses). Click a month to show it on the map."
                    />
                  </span>
                  <FigureLegend />
                  <MonthBars m={hours.months} picked={monthOf(dayOf(h))} onPick={(mo) => setHour(atHour(midMonth(mo), hourOf(h)))} />
                  <span className="caps site__sub-head net__box">
                    Winter and summer, MW
                    <InfoMark
                      term="Winter and summer"
                      text="The coldest and the warmest day of the typical year hour by hour, on one scale, in the same colours as the months. In winter the heat pump runs at its size and the boiler covers the rest; in summer only hot water is needed and most of the data center's heat is left. Click an hour to show it on the map."
                    />
                  </span>
                  <DayPair x={hours} h={h} onHour={setHour} />
                </>
              )}
            </section>
          </div>
          <div className="site__hint">
            Streets: {streets?.from}. A fast estimate on the typical year, hour by hour; drag the HP station on the map to move it.
          </div>
        </Dialog>
      )}
      {panel === "costs" && econ && net && (
        <NetworkCosts econ={econ} net={net} hours={hours} params={params} onParams={setParams} onClose={close} />
      )}
    </div>
  );
}
