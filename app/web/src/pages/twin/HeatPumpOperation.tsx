/**
 * Operation › Heat pump operation: how the heat pump and its storage are run, three strategies on the same plant and
 * data side by side (operation.ts: heat-led, a price rule, MPC with look-ahead), always over whole years: several
 * scenarios at once (the plant and the prices changed), what each strategy saves against heat-led as bars, then for the
 * picked scenario the same per month, every strategy per year, and one week or month of what each does. The plant's numbers, its COP model (the Carnot
 * formula or a heat pump plant model, as Heat Distribution's), the prices and the objective are set above. The runs go
 * to a worker (operation.worker.ts): a year of MPC plans takes a moment per scenario.
 */
import { useEffect, useMemo, useState } from "react";
import { useKept } from "../../lib/kept";
import { createPortal } from "react-dom";
import { fetchMarket, simulateComponent, type MarketHours } from "../../api";
import { errorMessage } from "../../lib/errors";
import { fmt } from "../../lib/format";
import { carnotCop, DEFAULT_OPTIONS } from "../../lib/matching";
import { CO2 } from "../../lib/partKpis";
import { BarChart } from "../../ui/BarChart";
import { Card } from "../../ui/Card";
import { Field } from "../../ui/Field";
import LineChart from "../../ui/LineChart";
import { NumberField } from "../../ui/NumberField";
import { Segmented } from "../../ui/Segmented";
import { usableFor } from "../heat/partComponents";
import { pointLabel } from "../heat/points";
import { useComponentList } from "../heat/usePartComponents";
import { COOLING, coolingPerKwh, defaultRc, hpMax, marketSeries, REJECTIONS, STRATEGIES, summaryOf, type Rejection, tankTemp, type Objective, type OpPlant, type OpScenario as Scenario, type OpSummary, type Strategy, type TankRc } from "./operation";
import { useOperationRuns } from "./useOperationRuns";

// canvas colours (uPlot can't read CSS vars), one per strategy
const COLOR: Record<Strategy, string> = { heat: "#94a3b8", price: "#f59e0b", mpc: "#7c5cff" };
// the bars (CSS): the two strategies that shift, each against heat-led
const BAR: Record<Strategy, string> = { heat: "var(--foreground-tertiary)", price: "var(--warn)", mpc: "var(--accent)" };
const SHIFTERS = STRATEGIES.filter((s) => s.id !== "heat");
const HOT_AISLE = "hall"; // the extraction point in the hot aisle (points.ts: Hall HEX, hot-aisle air)
const LIQUID = "liquid"; // the liquid cooling's loop (points.ts LIQUID_POINTS)
const LOOP_SPREAD = 10; // K between the liquid loop's return and supply (warm-water cooling, an assumption)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
type Metric = "saved" | "heat";

export type { OpSummary } from "./operation";

interface Props {
  onSummary?: (s: OpSummary | null) => void;
  settingsSlot?: HTMLElement | null; // where the plant's settings go (the page's top), else in the card
  times: number[]; // unix seconds
  q: number[]; // kW the data center offers
  tSrc: number[]; // °C at the extraction point
  demand: number[]; // kW
  supply: number | number[]; // °C network supply, fixed or per step
  at?: string; // the extraction point (points.ts): only the hot aisle's ("hall") heat relieves the data center's cooling
  tOut?: number[]; // °C outdoors per step (the data center's avoided cooling runs on it; none: it cannot be counted)
  hum?: number[]; // relative humidity per step, % or 0–1 (none: the wet bulb 5 K below the air)
  cop?: number[]; // the COP per step Heat Matching runs (its plant model or formula), offered under COP from
  direct?: boolean[]; // the steps the source feeds in directly (Heat Matching's direct HEX; operation.ts OpSeries.direct)
  stepHours: number;
  hpKw: number; // a starting size (the chosen design option's)
  tankKwh: number;
  sizedAs: string; // the design option it starts from
}

const STARTERS = (hp: number): Scenario[] => [
  { id: 1, name: "As set above", hpKw: null, tankKwh: null, spread: null },
  { id: 2, name: "Storage of 4 h", hpKw: null, tankKwh: Math.round(4 * hp), spread: null },
  { id: 3, name: "Wider price swings", hpKw: null, tankKwh: null, spread: 2 },
  { id: 4, name: "Storage of 8 h, wider swings", hpKw: null, tankKwh: Math.round(8 * hp), spread: 2 },
  { id: 5, name: "Demand ×2", hpKw: null, tankKwh: null, spread: null, demandX: 2 },
  { id: 6, name: "Data center heat ×2", hpKw: null, tankKwh: null, spread: null, supplyX: 2 },
];
const pct = (base: number, x: number) => (base ? (100 * (base - x)) / base : 0);
const saving = (base: number, x: number) => {
  const p = pct(base, x);
  return `${p >= 0 ? "−" : "+"}${fmt(Math.abs(p), 1)} %`;
};

export function HeatPumpOperation(p: Props) {
  const [plant, setPlant] = useKept<OpPlant>("op-plant", { hpKw: p.hpKw, tauH: 0.5, tankKwh: p.tankKwh, lossPctH: DEFAULT_OPTIONS.tankLossPct, backupPrice: 0.11, backupCo2: CO2.gas / CO2.boiler });
  useEffect(() => setPlant((x) => ({ ...x, hpKw: p.hpKw, tankKwh: p.tankKwh })), [p.hpKw, p.tankKwh, setPlant]);
  const setP =
    <K extends keyof OpPlant>(k: K) =>
    (v: OpPlant[K]) =>
      setPlant((x) => ({ ...x, [k]: v }));
  // the RC tank's numbers (operation.ts TankRc); switched on from a start that fits the network's supply
  const setRc =
    <K extends keyof TankRc>(k: K) =>
    (v: TankRc[K]) =>
      setPlant((x) => (x.rc ? { ...x, rc: { ...x.rc, [k]: v } } : x));
  const supplyAt = useMemo(() => (typeof p.supply === "number" ? p.times.map(() => p.supply as number) : p.supply), [p.supply, p.times]);
  const [eta, setEta] = useKept("op-eta", 0.5);
  const [copModel, setCopModel] = useState(p.cop ? "matching" : ""); // "": the Carnot formula; "matching": Heat Matching's; else a plant model's id
  const hasCop = !!p.cop;
  useEffect(() => setCopModel(hasCop ? "matching" : ""), [hasCop]);
  const [spread, setSpread] = useKept("op-spread", 1);
  const [fees, setFees] = useKept("op-fees", 0.14);
  // the market's price and CO₂ (SMARD, GET /api/market/hourly) for the page's hours, when someone dropped its files in
  const [priceFrom, setPriceFrom] = useKept<"market" | "synthetic">("op-price-from", "market");
  const [market, setMarket] = useState<{ hours: MarketHours | null; error: string | null }>({ hours: null, error: null });
  useEffect(() => {
    if (!p.times.length) return;
    let live = true;
    fetchMarket(p.times[0], p.times[p.times.length - 1] + p.stepHours * 3600)
      .then((hours) => live && setMarket({ hours, error: null }))
      .catch((e) => live && setMarket({ hours: null, error: errorMessage(e) }));
    return () => void (live = false);
  }, [p.times, p.stepHours]);
  const series = useMemo(() => (market.hours ? marketSeries(p.times, market.hours) : null), [market.hours, p.times]);
  const useMarket = priceFrom === "market" && !!series && series.spot.some((v) => v != null);
  const missing = series ? { price: series.spot.filter((v) => v == null).length, co2: series.co2.filter((v) => v == null).length } : null;
  // the data center's avoided cooling (operation.ts coolingPerKwh, the standalone model's cooling concepts): kWh of its
  // electricity per kWh of heat the heat pump takes, per step, from the outdoor temperature and humidity; counted only
  // when a cooling concept is picked ("": not counted)
  const [rejection, setRejection] = useKept<Rejection | "">("op-cooling", "");
  const hasWeather = !!p.tOut && p.tOut.length >= p.times.length;
  // a heat recovery concept: the heat pump takes the heat before the cooling does, in the hot aisle (the standalone
  // model's hp_airside: chilled water 6.67/12 °C) or from the liquid cooling's loop (warm water: its own temperatures,
  // the return as measured at the point, the supply LOOP_SPREAD below, so it free-cools far more). At the condenser
  // the chiller runs as before: nothing to credit.
  const recovery = p.at === HOT_AISLE || p.at === LIQUID;
  const coolSeries = useMemo(() => {
    const t = p.tOut;
    if (!rejection || !recovery || !t || t.length < p.times.length) return null;
    const h = p.hum && p.hum.length >= p.times.length ? p.hum : null;
    const pct = h && Math.max(...h.filter(Number.isFinite)) <= 1.5 ? 100 : 1; // a fraction (0–1) or %
    const c = { ...COOLING, rejection };
    const loop = (i: number) => (p.at === LIQUID && p.tSrc[i] != null ? { ...c, tRet: p.tSrc[i], tEvap: p.tSrc[i] - LOOP_SPREAD } : c);
    return p.times.map((_, i) => coolingPerKwh(t[i], h ? h[i] * pct : null, loop(i)));
  }, [rejection, recovery, p.at, p.tSrc, p.tOut, p.hum, p.times]);
  const countCooling = !!coolSeries;
  const [objective, setObjective] = useKept<Objective>("op-objective", "cost");
  const [horizon, setHorizon] = useKept("op-horizon", 24);
  const [week, setWeek] = useKept("op-week", 16); // mid-April: the season where looking ahead pays
  const [span, setSpan] = useKept<"week" | "month">("op-span", "week");
  const [month, setMonth] = useKept("op-month", 4);
  const [metric, setMetric] = useKept<Metric>("op-metric", "saved");
  const [scenarios, setScenarios] = useKept<Scenario[]>(`op-scenarios|${p.hpKw}`, () => STARTERS(p.hpKw));
  const [picked, setPicked] = useKept("op-picked", 1);
  const edit = (id: number, o: Partial<Scenario>) => setScenarios((xs) => xs.map((x) => (x.id === id ? { ...x, ...o } : x)));
  const add = () =>
    setScenarios((xs) => {
      const id = Math.max(0, ...xs.map((x) => x.id)) + 1;
      return [...xs, { ...(xs[xs.length - 1] ?? STARTERS(plant.hpKw)[0]), id, name: `Scenario ${id}` }];
    });

  // the COP per step: the formula, or the plant model run over the source and supply temperatures
  const comps = useComponentList();
  const hpModels = useMemo(() => usableFor("hp", comps.list), [comps.list]);
  const [modelCop, setModelCop] = useState<number[] | null>(null);
  useEffect(() => {
    setModelCop(null);
    const c = hpModels.find((x) => x.id === copModel);
    if (!c || !p.tSrc.length) return;
    let live = true;
    simulateComponent(c, { T_source: p.tSrc, T_supply: p.supply }, undefined, ["COP"])
      .then((r) => live && setModelCop(r.COP))
      .catch(() => live && setModelCop(null));
    return () => {
      live = false;
    };
  }, [copModel, hpModels, p.tSrc, p.supply]);
  const cop = useMemo(
    () =>
      (copModel === "matching" ? p.cop : null) ??
      modelCop ??
      p.tSrc.map((t, i) => carnotCop(t, typeof p.supply === "number" ? p.supply : p.supply[i], eta)),
    [copModel, p.cop, modelCop, p.tSrc, p.supply, eta],
  );

  // every scenario's runs, in the worker; the latest request wins
  const { out, busy } = useOperationRuns({
    times: p.times,
    q: p.q,
    cop,
    demand: p.demand,
    supply: supplyAt,
    tSrc: p.tSrc,
    stepHours: p.stepHours,
    horizonH: horizon,
    objective,
    fees,
    market: useMarket ? series : null,
    cool: countCooling ? coolSeries : null,
    direct: p.direct ?? null,
    plant,
    spread,
    scenarios,
  });

  // the strategies differ only where the heat pump could make more than the demand: that surplus is what a tank stores
  const spare = useMemo(() => {
    const n = Math.min(p.q.length, p.demand.length);
    let k = 0;
    for (let i = 0; i < n; i++) if (hpMax({ src: p.q, cop, direct: p.direct }, plant, i) > p.demand[i] + 1e-6) k++;
    return n ? k / n : 0;
  }, [p.q, p.demand, cop, plant, p.direct]);

  // the key figures for the page (operation.ts summaryOf): the cheapest (or cleanest) run against heat-led in its scenario
  const { onSummary } = p;
  useEffect(() => onSummary?.(out ? summaryOf(out, scenarios, objective, countCooling) : null), [out, onSummary, objective, scenarios, countCooling]);

  const sel = out?.find((r) => r.id === picked) ?? out?.[0];
  const selScenario = scenarios.find((s) => s.id === sel?.id);
  const what = objective === "cost" ? "cost" : "CO₂";
  const val = (t: { costEur: number; co2T: number }) => (objective === "cost" ? t.costEur : t.co2T);

  // a bar: what a strategy saves against heat-led, or how much more of the data center's heat it uses (the backup
  // heat it avoids: every strategy meets the same demand)
  const unit = objective === "cost" ? "€" : "t";
  const bar = (st: Strategy, base: { costEur: number; co2T: number; backupMwh: number }, x: { costEur: number; co2T: number; backupMwh: number }) => {
    const v = metric === "saved" ? val(base) - val(x) : base.backupMwh - x.backupMwh;
    const pctText = metric === "saved" && val(base) ? ` · ${fmt((100 * v) / val(base), 1)} %` : "";
    const text = metric === "saved" ? `${fmt(v, objective === "cost" ? 0 : 1)} ${unit}${pctText}` : `${fmt(v, 0)} MWh`;
    return { label: STRATEGIES.find((s) => s.id === st)!.label, value: v, color: BAR[st], text };
  };
  const ran = scenarios.flatMap((sc) => {
    const r = out?.find((x) => x.id === sc.id);
    return r ? [{ sc, r }] : [];
  });
  const scenarioBars = ran.map(({ sc, r }) => ({ label: sc.name, bars: SHIFTERS.map((st) => bar(st.id, r.runs.heat.totals, r.runs[st.id].totals)) }));
  const monthBars = sel ? MONTHS.map((m, k) => ({ label: m, bars: SHIFTERS.map((st) => bar(st.id, sel.runs.heat.months[k], sel.runs[st.id].months[k])) })) : [];

  // one week or one calendar month of the picked scenario
  const per = Math.max(1, Math.round((7 * 24) / p.stepHours));
  const weeks = Math.max(1, Math.floor(p.times.length / per));
  const w = Math.min(week, weeks) - 1;
  const monthOf = useMemo(() => p.times.map((t) => new Date(t * 1000).getUTCMonth()), [p.times]);
  const [a, b] =
    span === "week" ? [w * per, Math.min(p.times.length, (w + 1) * per)] : [Math.max(0, monthOf.indexOf(month - 1)), monthOf.lastIndexOf(month - 1) + 1];
  const xs = p.times.slice(a, b);
  const cut = (v: number[]) => v.slice(a, b);

  // the plant's settings: at the top of the page beside its key figures (`settingsSlot`), else here
  const controls = (
    <div className="plan-op-controls">
      <NumberField label="Heat pump (thermal)" unit="kW" step={50} value={plant.hpKw} onChange={setP("hpKw")} />
      <NumberField label="Time constant τ" unit="h" step={0.1} min={0} value={plant.tauH} onChange={setP("tauH")} />
      <NumberField label="Storage" unit="kWh" step={250} min={0} value={plant.tankKwh} onChange={setP("tankKwh")} />
      <Segmented<"bucket" | "rc">
        label="Storage model"
        value={plant.rc ? "rc" : "bucket"}
        onChange={(m) => setPlant((x) => ({ ...x, rc: m === "rc" ? defaultRc(x.tankKwh, p.supply) : null }))}
        options={[
          { id: "bucket", label: "Energy" },
          { id: "rc", label: "With temperature" },
        ]}
      />
      {plant.rc ? (
        <>
          <NumberField label="Empty at" unit="°C" step={1} value={plant.rc.tMin} onChange={setRc("tMin")} />
          <NumberField label="Full at" unit="°C" step={1} min={plant.rc.tMin + 1} value={plant.rc.tMax} onChange={setRc("tMax")} />
          <NumberField label="Around the tank" unit="°C" step={1} min={-30} value={plant.rc.tAmb} onChange={setRc("tAmb")} />
          <NumberField label="Storage time constant" unit="h" step={6} min={0.1} value={plant.rc.tauH} onChange={setRc("tauH")} />
          <NumberField label="Max. charge" unit="kW" step={50} min={0} value={plant.rc.chargeKw} onChange={setRc("chargeKw")} />
          <NumberField label="Max. discharge" unit="kW" step={50} min={0} value={plant.rc.dischargeKw} onChange={setRc("dischargeKw")} />
        </>
      ) : (
        <NumberField label="Standing loss" unit="%/h" step={0.1} min={0} value={plant.lossPctH} onChange={setP("lossPctH")} />
      )}
      <Field label="COP from">
        <select className="field field--sm" value={copModel} onChange={(e) => setCopModel(e.target.value)} aria-label="COP model">
          {p.cop && <option value="matching">As on Heat Matching</option>}
          <option value="">Carnot formula</option>
          {hpModels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      {!copModel && <NumberField label="Carnot efficiency η_C" step={0.05} min={0.1} max={1} value={eta} onChange={setEta} />}
      <Field label="Price and CO₂ from">
        <select
          className="field field--sm"
          value={useMarket ? "market" : "synthetic"}
          onChange={(e) => setPriceFrom(e.target.value as "market" | "synthetic")}
          aria-label="Price and CO₂ from"
          title={market.hours?.hint ?? undefined}
        >
          <option value="market" disabled={!series?.spot.some((v) => v != null)}>
            SMARD: day-ahead DE/LU, CO₂ of the mix
          </option>
          <option value="synthetic">Synthetic year</option>
        </select>
      </Field>
      {!useMarket && priceFrom === "market" && market.error && <p className="plan-note">{market.error}</p>}
      {market.hours && !market.hours.hint && !series?.spot.some((v) => v != null) && (
        // files there, but none of this year's hours (e.g. SMARD 2023–2024, a Heat Matching year outside it)
        <p className="plan-note">{`SMARD's files cover ${spanText(market.hours.span.price ?? market.hours.span.co2)}; this year is outside them, so price and CO₂ are the synthetic year's.`}</p>
      )}
      <NumberField label="Price spread" unit="×" step={0.25} min={0} value={spread} onChange={setSpread} />
      <NumberField label="Fees and levies" unit="€/kWh" step={0.01} min={0} value={fees} onChange={setFees} />
      <NumberField label="Backup heat price" unit="€/kWh" step={0.01} min={0} value={plant.backupPrice} onChange={setP("backupPrice")} />
      <NumberField label="Look-ahead" unit="h" step={6} min={1} max={72} value={horizon} onChange={setHorizon} />
      <Segmented<Objective>
        label="Optimise for"
        value={objective}
        onChange={setObjective}
        options={[
          { id: "cost", label: "Cost" },
          { id: "co2", label: "CO₂" },
        ]}
      />
      {!recovery ? (
        <p className="plan-note">
          The data center&apos;s avoided cooling counts only when the heat pump takes its heat before the cooling, from the hot aisle (Hall HEX) or the liquid cooling (Liquid cooling HEX); here it takes it at the{" "}
          {pointLabel(p.at ?? "").title}, where the cooling runs as before.
        </p>
      ) : hasWeather ? (
        <Field label="Data center cooling avoided">
          <select className="field field--sm" value={rejection} onChange={(e) => setRejection(e.target.value as Rejection | "")}>
            <option value="">Not counted</option>
            {REJECTIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <p className="plan-note">No outdoor temperature for these hours: run Heat Matching again to count the data center&apos;s avoided cooling.</p>
      )}
    </div>
  );

  return (
    <Card title="Heat pump operation" className="plan-ops">
      <details className="plan-how">
        <summary>How the three strategies work</summary>
        <p className="plan-note">
          When the heat pump runs and the storage charges, always over whole years: three strategies on the same plant, the same data center heat and district
          demand. <b>Heat-led</b> follows the demand; the <b>price rule</b> charges the tank in the day&apos;s cheap hours; <b>MPC</b> plans the next {horizon} h
          for the least {what}, applies the first hour, plans again. The plant runs every plan (its capacity, the source, its time constant τ, the tank and its
          loss; with temperature, it cools towards its surroundings, serves the network only above its supply temperature, and the heat pump charges it above
          its temperature, at a lower COP); what neither covers comes from the backup. {useMarket
            ? `Electricity prices are SMARD's day-ahead prices of the DE/LU zone plus the fees and levies, the grid's CO₂ that of the generation mix (direct emissions per source, as the group's pyest package: lignite 1,097, hard coal 838, gas 369 g/kWh; imports left out)${missing && (missing.price || missing.co2) ? `; ${fmt(Math.max(missing.price, missing.co2))} of ${fmt(p.times.length)} steps without market data take the synthetic year's` : ""}.`
            : "Electricity prices and the grid's CO₂ are a synthetic day-ahead year shaped like the German market (a solar dip at noon, deepest in spring, evening peaks in winter)."}{" "}
          {countCooling
            ? "The data center's avoided cooling is counted: every kWh of heat the heat pump takes from it (its heat less its electricity, taken ahead of the cooling: in the hot aisle, or from the liquid cooling's loop, then with the loop's own temperatures, 10 K between its return and supply) the data center need not cool, which saves the electricity of its cooling at that hour's outdoor temperature and humidity (the cooling concept picked above, as in the standalone data center model: its rejector free-cools what it can, a chiller at 0.45 of Carnot lifts the rest; nothing in the cold, about 0.15 kWh per kWh on warm days with a wet tower, more with a dry cooler), at the same price and CO₂; cost and CO₂ are net of it, and the MPC plans with it."
            : ""}{" "}
          Sized as {p.sizedAs} at first.
        </p>
      </details>
      {p.settingsSlot ? createPortal(controls, p.settingsSlot) : controls}

      {spare < 0.02 && (
        <p className="plan-note plan-warn" role="note">
          The data center&apos;s heat is below the district&apos;s demand {spare ? `in all but ${fmt(spare * 100)} % of the hours` : "in every hour"} (at most{" "}
          {fmt(Math.max(0, ...p.q))} kW of source against {fmt(p.demand.reduce((x, y) => x + y, 0) / Math.max(1, p.demand.length))} kW of demand on average):
          the heat pump uses all of it as it comes, nothing is left over to store, so the strategies cannot differ. A bigger data center, a smaller district or
          the other heat point (Heat Matching) gives them room.
        </p>
      )}
      <h3 className="plan-h3">Scenarios · a year each{busy ? <span className="plan-note"> · working…</span> : null}</h3>
      <div className="plan-scroll">
        <table className="plan-table plan-scenarios" aria-label="Scenarios">
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">Heat pump (kW)</th>
              <th scope="col">Storage (kWh)</th>
              <th scope="col">Price spread (×)</th>
              <th scope="col" title="What if: the district's demand times this">
                Demand (×)
              </th>
              <th scope="col" title="What if: the data center's heat times this">
                DC heat (×)
              </th>
              <th scope="col">Heat-led ({objective === "cost" ? "€" : "t"})</th>
              <th scope="col">Price rule</th>
              <th scope="col">MPC</th>
              <th scope="col" aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {scenarios.map((sc) => {
              const r = out?.find((x) => x.id === sc.id);
              const heat = r?.runs.heat;
              const on = sc.id === sel?.id;
              return (
                <tr key={sc.id} className={on ? "plan-table__best" : undefined} onClick={() => setPicked(sc.id)}>
                  <th scope="row">
                    <input className="field field--sm" aria-label="Scenario name" value={sc.name} onChange={(e) => edit(sc.id, { name: e.target.value })} />
                  </th>
                  <td>
                    <input
                      className="field field--sm plan-num"
                      type="number"
                      step={50}
                      aria-label={`${sc.name}: heat pump, kW`}
                      placeholder={fmt(plant.hpKw)}
                      value={sc.hpKw ?? ""}
                      onChange={(e) => edit(sc.id, { hpKw: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      className="field field--sm plan-num"
                      type="number"
                      step={250}
                      aria-label={`${sc.name}: storage, kWh`}
                      placeholder={fmt(plant.tankKwh)}
                      value={sc.tankKwh ?? ""}
                      onChange={(e) => edit(sc.id, { tankKwh: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      className="field field--sm plan-num"
                      type="number"
                      step={0.25}
                      aria-label={`${sc.name}: price spread`}
                      placeholder={fmt(spread, 2)}
                      value={sc.spread ?? ""}
                      onChange={(e) => edit(sc.id, { spread: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </td>
                  {(["demandX", "supplyX"] as const).map((k) => (
                    <td key={k}>
                      <input
                        className="field field--sm plan-num"
                        type="number"
                        step={0.25}
                        min={0}
                        aria-label={`${sc.name}: ${k === "demandX" ? "demand" : "data center heat"} times`}
                        placeholder={fmt(1, 2)}
                        value={sc[k] ?? ""}
                        onChange={(e) => edit(sc.id, { [k]: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </td>
                  ))}
                  <td>{heat ? fmt(val(heat.totals), objective === "cost" ? 0 : 1) : "…"}</td>
                  <td>{heat && r ? saving(val(heat.totals), val(r.runs.price.totals)) : "…"}</td>
                  <td className="plan-mpc">{heat && r ? saving(val(heat.totals), val(r.runs.mpc.totals)) : "…"}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--xs btn--ghost"
                      onClick={() => setScenarios((xs) => xs.filter((x) => x.id !== sc.id))}
                      disabled={scenarios.length < 2}
                      aria-label={`Remove ${sc.name}`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn--sm" onClick={add}>
        Add scenario
      </button>
      <p className="plan-note">
        Empty fields take the value set above. Click a scenario (row or bars) for its months, years and hours below. −: cheaper (or less CO₂) than heat-led. The
        price rule is a simple rule: it charges in every cheap hour whatever the tank will need, so it often costs a little more than heat-led.
      </p>
      {out?.some((r) => r.runs.mpc.totals.heatLed) && (
        <p className="plan-note" role="note">
          {`MPC ran heat-led in ${out
            .filter((r) => r.runs.mpc.totals.heatLed)
            .map((r) => scenarios.find((x) => x.id === r.id)?.name ?? "")
            .join(", ")}: its plan does not know the heat pump's time constant τ and cost more there (a slow heat pump, or a short look-ahead).`}
        </p>
      )}

      {scenarioBars.length > 0 && (
        <>
          <div className="plan-bars-head">
            <h3 className="plan-h3">{metric === "saved" ? `What each strategy saves against heat-led (${unit})` : "Data center heat used more than heat-led (MWh)"}</h3>
            <Segmented<Metric>
              label="Bars show"
              value={metric}
              onChange={setMetric}
              options={[
                { id: "saved", label: objective === "cost" ? "Saving" : "CO₂ saved" },
                { id: "heat", label: "Waste heat used" },
              ]}
            />
          </div>
          <BarChart
            label="Scenarios against heat-led"
            groups={scenarioBars}
            picked={ran.findIndex((x) => x.sc.id === sel?.id)}
            onPick={(i) => setPicked(ran[i].sc.id)}
          />
          <p className="plan-note">
            {metric === "saved"
              ? `Heat-led's ${what} minus the strategy's, over the period (the same demand, the same plant). Below zero: it costs more.`
              : "Every strategy meets the same demand; what the heat pump does not give comes from the backup. Above zero: less backup, more of the data center's heat used. Below zero: it saves by letting the backup do more."}
          </p>
        </>
      )}

      {sel && (
        <>
          <h3 className="plan-h3">
            {selScenario?.name ?? "Scenario"} · by month · {metric === "saved" ? `saving (${unit})` : "waste heat used (MWh)"}
          </h3>
          <BarChart
            label="By month"
            groups={monthBars}
            values={false}
            height={140}
            picked={span === "month" ? month - 1 : undefined}
            onPick={(k) => {
              setSpan("month");
              setMonth(k + 1);
            }}
          />
          <p className="plan-note">Every month against heat-led in the same month (hover a bar for its value). Click a month for its hours below.</p>

          <h3 className="plan-h3">{selScenario?.name ?? "Scenario"} · per year</h3>
          <div className="plan-scroll">
            <table className="plan-table" aria-label="Per year">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Strategy</th>
                  <th scope="col">Cost (€)</th>
                  <th scope="col">vs heat-led</th>
                  <th scope="col">CO₂ (t)</th>
                  <th scope="col">HP electricity (MWh)</th>
                  <th scope="col">Backup heat (MWh)</th>
                  {countCooling && <th scope="col">DC cooling avoided (MWh el.)</th>}
                </tr>
              </thead>
              <tbody>
                {sel.runs.heat.years.flatMap(([year, base]) =>
                  STRATEGIES.map((st, k) => {
                    const y = sel.runs[st.id].years.find(([yy]) => yy === year)?.[1] ?? base;
                    return (
                      <tr key={`${year}-${st.id}`}>
                        {k === 0 && (
                          <th scope="rowgroup" rowSpan={STRATEGIES.length}>
                            {year}
                            {base.hours < 8000 ? <span className="plan-note"> ({fmt(base.hours / 24, 0)} days)</span> : null}
                          </th>
                        )}
                        <th scope="row" title={st.about}>
                          {st.label}
                        </th>
                        <td>{fmt(y.costEur, 0)}</td>
                        <td>{st.id === "heat" ? "–" : saving(val(base), val(y))}</td>
                        <td>{fmt(y.co2T, 1)}</td>
                        <td>{fmt(y.elecMwh, 1)}</td>
                        <td>{fmt(y.backupMwh, 1)}</td>
                        {countCooling && <td>{fmt(y.coolMwh, 1)}</td>}
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
          <p className="plan-note">
            Over the whole period:{" "}
            {STRATEGIES.map((st) => `${st.label} ${fmt(sel.runs[st.id].totals.runHours, 0)} h running, ${fmt(sel.runs[st.id].totals.starts, 0)} starts`).join(
              " · ",
            )}
            .
          </p>

          <div className="plan-op-week">
            <Segmented<"week" | "month">
              label="Show"
              value={span}
              onChange={setSpan}
              options={[
                { id: "week", label: "Week" },
                { id: "month", label: "Month" },
              ]}
            />
            {span === "week" ? (
              <NumberField label="Week" step={1} min={1} max={weeks} value={Math.min(week, weeks)} onChange={(v) => setWeek(Math.max(1, Math.round(v)))} />
            ) : (
              <Field label="Month">
                <select className="field field--sm" value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">
                  {MONTHS.map((m, k) => (
                    <option key={m} value={k + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <span className="plan-note">What each strategy does that {span}: the heat pump&apos;s heat, the tank&apos;s level, and the price it runs on.</span>
          </div>
          <LineChart
            xs={xs}
            height={190}
            lines={[
              { label: "Demand", values: cut(p.demand).map((x) => x * (selScenario?.demandX ?? 1)), color: "#3b82f6", fill: true },
              ...STRATEGIES.map((s) => ({ label: `HP · ${s.label}`, values: cut(sel.runs[s.id].hp), color: COLOR[s.id] })),
            ]}
          />
          {plant.rc ? (
            // the RC tank: its temperature, against the supply it must reach to serve the network
            <LineChart
              xs={xs}
              height={140}
              unit="°C"
              lines={[
                ...STRATEGIES.map((s) => {
                  const rc = plant.rc as TankRc;
                  const kwh = selScenario?.tankKwh ?? plant.tankKwh;
                  return { label: `Tank · ${s.label}`, values: cut(sel.runs[s.id].level).map((l) => tankTemp(rc, kwh, l)), color: COLOR[s.id] };
                }),
                { label: "Network supply", values: cut(supplyAt), color: "#ef4444" },
              ]}
            />
          ) : (
            <LineChart
              xs={xs}
              height={140}
              unit="kWh"
              lines={STRATEGIES.map((s) => ({ label: `Tank · ${s.label}`, values: cut(sel.runs[s.id].level), color: COLOR[s.id] }))}
            />
          )}
          <LineChart xs={xs} height={120} unit="€/kWh" lines={[{ label: "Electricity price", values: cut(sel.price), color: "#ef4444" }]} />
        </>
      )}
    </Card>
  );
}

/** What the market files cover, as dates: "2023-01-01 to 2025-01-01" (end excluded). */
const spanText = (s: [string, string] | null) => (s ? `${s[0].slice(0, 10)} to ${s[1].slice(0, 10)}` : "no hours");
