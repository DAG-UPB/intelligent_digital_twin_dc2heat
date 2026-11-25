/**
 * Operation (Intelligent Digital Twin): design options of the heat distribution side by side over the same evaluated
 * period, each with its key figures, and for one chosen option how it runs. The data is loaded as on Heat
 * distribution (useHeatSources: the data center's measured heat at the default extraction point, the district
 * demand); every option is one matchHeat run with its parts and sizes. The logic is in planning.ts. Under it, the heat
 * pump's operation: control strategies on the chosen option's plant (HeatPumpOperation, operation.ts). By default
 * all of it runs on what Heat Matching last ran (matchingSetup.ts: its data center heat, demand, supply, COP, and its
 * heat pump and storage for the strategies); "Define here" turns that off. The plant is drawn small at the top left.
 */
import { useEffect, useMemo, useState } from "react";
import { useKept } from "../../lib/kept";
import { listModels } from "../../api";
import { DATASET } from "../../dataset";
import { STRUCTURES } from "../../lib/modelCatalog";
import { fmt, fmtDateTime } from "../../lib/format";
import { matchHeat } from "../../lib/matching";
import { durationLabel } from "../../lib/period";
import { Card } from "../../ui/Card";
import { ErrorBanner } from "../../ui/ErrorBanner";
import { Field } from "../../ui/Field";
import { Segmented } from "../../ui/Segmented";
import { Kpi, KpiRow } from "../../ui/Kpi";
import { NumberField } from "../../ui/NumberField";
import { Switch } from "../../ui/Switch";
import { HeatFlowDiagram } from "../heat/HeatFlowDiagram";
import { useHeatSources } from "../heat/useHeatSources";
import { HeatPumpOperation, type OpSummary } from "./HeatPumpOperation";
import { readSetup } from "./matchingSetup";
import { PlantSketch } from "./PlantSketch";
import { bestOf, DEFAULT_VARIANTS, kpiOf, operationOf, optionsOf, usableOf, type Variant } from "./planning";
import "./planning.css";

// the extraction point Heat distribution opens with
const DEFAULT_AT = "condenser";
const hrs = (h: number | null) => (h === null ? "–" : fmt(h, h < 100 ? 1 : 0));

export default function PlanningPage() {
  const [variants, setVariants] = useKept<Variant[]>("plan-variants", DEFAULT_VARIANTS);
  const [picked, setPicked] = useKept("plan-picked", DEFAULT_VARIANTS[0].id);
  const edit = (id: number, o: Partial<Variant>) => setVariants((vs) => vs.map((v) => (v.id === id ? { ...v, ...o } : v)));
  const add = () =>
    setVariants((vs) => {
      const id = Math.max(0, ...vs.map((v) => v.id)) + 1;
      return [...vs, { ...(vs[vs.length - 1] ?? DEFAULT_VARIANTS[0]), id, name: `Option ${id}` }];
    });
  const remove = (id: number) => setVariants((vs) => vs.filter((v) => v.id !== id));

  // the data center's heat: measured, or one of its trained models' free run (switch to compare)
  const [dcFrom, setDcFrom] = useKept("plan-dcFrom", "");
  const [dcModels, setDcModels] = useState<string[]>([]);
  useEffect(() => void listModels(DATASET).then(setDcModels, () => setDcModels([])), []);
  const data = useHeatSources(dcFrom ? "model" : "actual", dcFrom ? { model: dcFrom } : {});
  const { period, district, sources } = data;
  const keys = Object.keys(data.dataMaps);
  // the heat point with the most heat, the condenser's on a tie (a free-cooled plant's condenser is idle much of the year)
  const sum = (k: string) => (sources[k]?.q ?? []).reduce((a, b) => a + b, 0);
  const ownAt = [...keys].sort((x, y) => sum(y) - sum(x) || (x === DEFAULT_AT ? -1 : y === DEFAULT_AT ? 1 : 0))[0];
  // what Heat Matching last ran for this data center, the default; "Define here": the data loaded here, the options' sizes
  const setup = useMemo(() => readSetup(DATASET), []);
  const [fromHm, setFromHm] = useKept("plan-fromHm", !!setup);
  const hm = fromHm ? setup : null;
  const at = hm ? hm.at : ownAt;
  const src = useMemo(() => (hm ? { q: hm.q, t: hm.t } : ownAt ? sources[ownAt] : undefined), [hm, ownAt, sources]); // one object while they stay
  const demand = hm ? hm.demand : district?.kw;
  const supply = hm ? hm.supply : district?.settings.supplyTemp;
  const stepHours = hm ? hm.stepHours : (district?.stepHours ?? period?.stepHours ?? 1);
  const times = hm ? hm.times : district?.times;
  // the weather for the data center's avoided cooling: as Heat Matching ran it (a setup saved before it had none), else the district's
  const tOut = hm ? hm.tOut : district?.outTemp;
  const hum = hm ? hm.hum : undefined;

  // the share of q the extraction HEX passes, one rule for the design options and the strategies
  const usable = usableOf(hm?.usable, !!data.configured);
  const runs = useMemo(
    // on Heat Matching: its options and its COP per step (its heat pump's model or formula), each option's sizes
    () =>
      src && demand && supply !== undefined
        ? variants.map((v) => matchHeat(src.q, src.t, demand, supply, optionsOf(v, usable, hm?.opts), stepHours, undefined, hm ? { hpCop: hm.cop } : {}))
        : null,
    [src, demand, supply, variants, stepHours, usable, hm],
  );
  const rows = useMemo(() => (runs && src ? runs.map((r) => kpiOf(r, src.q, stepHours)) : null), [runs, src, stepHours]);
  const best = rows ? bestOf(rows) : -1;
  const pi = Math.max(
    0,
    variants.findIndex((v) => v.id === picked),
  );
  const pv = variants[pi];
  const op = runs?.[pi] && pv ? operationOf(runs[pi], pv, stepHours) : null;
  const n = runs?.[0]?.unmet.length ?? 0;
  // the heat pump's operation runs on the chosen option's plant, or the first option with a heat pump
  const hpv = pv?.hp ? pv : variants.find((v) => v.hp);
  const [summary, setSummary] = useState<OpSummary | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null); // the heat pump's settings, beside the key figures
  // a key figure's change against the standard (heat-led as set above), "−4,108 € (−2.7 %)"
  const change = (x: number, base: number, unit: string, d = 0) =>
    `${x - base >= 0 ? "+" : "−"}${fmt(Math.abs(x - base), d)} ${unit} (${x - base >= 0 ? "+" : "−"}${fmt(base ? Math.abs((100 * (x - base)) / base) : 0, 1)} %)`;
  // the strategies' plant: Heat Matching's heat pump and storage, or the chosen option's
  const hmHp = hm && hm.parts.hp && hm.hpKw > 0 ? hm : null;
  // the steps the source feeds in directly, as matchHeat ran the plant: Heat Matching's, or the strategies' design option's
  const nOp = src && demand ? Math.min(src.q.length, demand.length) : 0;
  const direct = useMemo(() => {
    const run = hpv ? runs?.[variants.indexOf(hpv)] : undefined;
    const d = hmHp ? hmHp.direct : hpv?.hex && run ? run.viaHp.map((v) => !v) : undefined;
    return d?.slice(0, nOp);
  }, [hmHp, hpv, runs, variants, nOp]);
  // Operation's series, cut to one length once: new arrays on every render restarted its year-long job each time its
  // answer re-rendered this page (onSummary), a job every few seconds for as long as the page was open
  const opSeries = useMemo(() => {
    if (!src || !demand || !times) return null;
    const m = Math.min(src.q.length, demand.length);
    return { times: times.slice(0, m), q: src.q.slice(0, m).map((x) => x * usable), tSrc: src.t.slice(0, m), demand: demand.slice(0, m) };
  }, [src, demand, times, usable]);
  const sketch = hmHp
    ? { parts: hmHp.parts, hpKw: hmHp.hpKw, tankKwh: hmHp.tankKwh }
    : { parts: { hex: hpv?.hex ?? true, hp: !!hpv, tank: (hpv?.tankKwh ?? 0) > 0 }, hpKw: (hpv?.hpMw ?? 0) * 1000, tankKwh: hpv?.tankKwh ?? 0 };

  return (
    <div className="page">
      <div className="plan-top">
        <aside className="card plan-plant" aria-label="Plant">
          <span className="caps">Plant · {hmHp ? "as on Heat Matching" : (hpv?.name ?? "–")}</span>
          {hm?.diagram ? (
            <div className="plan-plant__diagram" title="Heat Matching's diagram, as it last drew it: change the plant there">
              <HeatFlowDiagram {...hm.diagram} onPick={() => {}} />
            </div>
          ) : (
            <PlantSketch at={at ?? ""} {...sketch} />
          )}
          {setup ? (
            <Segmented<"hm" | "own">
              label="Runs on"
              value={fromHm ? "hm" : "own"}
              onChange={(v) => setFromHm(v === "hm")}
              options={[
                { id: "hm", label: "Heat Matching" },
                { id: "own", label: "Define here" },
              ]}
            />
          ) : null}
          <p className="plan-plant__from">
            {hm ? (
              <>
                Heat: {hm.dcFrom}, at the {hm.at}. Demand: {hm.demandFrom}. As Heat Matching last ran it ({fmtDateTime(hm.saved)}); change it there.
                {!hmHp && " Its heat pump is off: the strategies run on the chosen design option's."}
              </>
            ) : setup ? (
              "Defined here: the data center's heat below, the district's demand, the sizes of the design options."
            ) : (
              "Open Heat Matching once to run on its setup (its models, demand and sizes); until then defined here."
            )}
          </p>
        </aside>
        <div>
          <h1 className="page__title">Operation</h1>
          <p className="page__lead">
            How the heat pump and its storage run over the year{n ? ` (${durationLabel(n * stepHours * 3600)}, every ${durationLabel(stepHours * 3600)})` : ""}: heat-led, a
            price rule or MPC.
          </p>
          {summary && (
            <>
              <KpiRow className="plan-kpis">
                <Kpi
                  label={summary.objective === "cost" ? "Cost · best case" : "Cost · cleanest case"}
                  value={fmt(summary.best.costEur)}
                  unit="€"
                  tone="var(--accent)"
                  sub={`${change(summary.best.costEur, summary.base.costEur, "€")} vs heat-led`}
                />
                <Kpi
                  label="CO₂ saved vs heat-led"
                  value={fmt(summary.base.co2T - summary.best.co2T, 1)}
                  unit="t"
                  tone="var(--ok)"
                  sub={`${fmt(summary.best.co2T)} t emitted (heat pump and backup)`} // not Heat Matching's saving against gas
                />
                <Kpi
                  label="Heat delivered by the plant"
                  hint="The district's demand less the backup heat: the heat pump's (its electricity included, not only the data center's heat), the tank's and the direct heat exchanger's"
                  value={fmt(summary.best.plantMwh)}
                  unit="MWh"
                  tone="var(--heat-strong)"
                  sub={`${change(summary.best.plantMwh, summary.base.plantMwh, "MWh")} vs heat-led`}
                />
                <Kpi label="Backup heat" value={fmt(summary.best.backupMwh)} unit="MWh" tone="var(--danger)" sub={`${change(summary.best.backupMwh, summary.base.backupMwh, "MWh")} vs heat-led`} />
                {summary.cooling && (
                  <Kpi
                    label="DC cooling avoided"
                    value={fmt(summary.best.coolMwh)}
                    unit="MWh el."
                    tone="var(--ok)"
                    sub={`${change(summary.best.coolMwh, summary.base.coolMwh, "MWh")} vs heat-led`}
                  />
                )}
              </KpiRow>
              <p className="plan-note">
                Best case: <b>{summary.best.strategy}</b> in the scenario <b>{summary.best.scenario}</b> (the {summary.objective === "cost" ? "cheapest" : "least CO₂"} of the scenarios
                below at the prices set above), against heat-led in the same scenario.
              </p>
            </>
          )}
          <div ref={setSlot} className="plan-settings" aria-label="Heat pump and prices" />
        </div>
      </div>
      <ErrorBanner error={hm ? null : data.error || null} />
      {!hm && dcModels.length > 0 && (
        <Field label="Data center heat from">
          <select className="field field--sm plan-pick" value={dcFrom} onChange={(e) => setDcFrom(e.target.value)}>
            <option value="">Measured</option>
            {dcModels.map((m) => (
              <option key={m} value={m}>
                Trained model · {STRUCTURES.find((d) => d.name === m)?.label ?? m}
              </option>
            ))}
          </select>
        </Field>
      )}

      {opSeries && supply !== undefined && (hmHp || hpv) && (
        <HeatPumpOperation
          times={opSeries.times}
          q={opSeries.q}
          tSrc={opSeries.tSrc}
          demand={opSeries.demand}
          supply={supply}
          at={at}
          tOut={tOut}
          hum={hum}
          cop={hmHp?.cop}
          direct={direct}
          onSummary={setSummary}
          settingsSlot={slot}
          stepHours={stepHours}
          hpKw={sketch.hpKw}
          tankKwh={sketch.tankKwh}
          lossPctH={hmHp?.opts?.tankLossPct}
          tauH={hmHp?.opts?.hpTauH}
          sizedAs={hmHp ? "on Heat Matching" : hpv!.name}
        />
      )}

      {/* the design options: folded away while the plant is Heat Matching's (Define here opens them) */}
      <details key={hm ? "hm" : "own"} className="plan-designs" open={!hm}>
        <summary>Design options · compare the heat exchanger, heat pump and storage sizes</summary>
        <Card title="Design options" className="plan-options">
          <div className="plan-variants">
            {variants.map((v) => (
              <div key={v.id} className="card plan-variant">
                <Field label="Name">
                  <input className="field field--sm" value={v.name} onChange={(e) => edit(v.id, { name: e.target.value })} />
                </Field>
                <Switch label="Heat exchanger" checked={v.hex} onChange={(hex) => edit(v.id, { hex })} />
                <Switch label="Heat pump" checked={v.hp} onChange={(hp) => edit(v.id, { hp })} />
                <NumberField label="Heat pump" unit="MW" step={0.5} value={v.hpMw} onChange={(hpMw) => edit(v.id, { hpMw })} />
                <NumberField label="Storage" unit="kWh" step={100} value={v.tankKwh} onChange={(tankKwh) => edit(v.id, { tankKwh })} />
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => remove(v.id)} disabled={variants.length < 2}>
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn--sm" onClick={add}>
            Add option
          </button>
        </Card>

        <Card title="Comparison" className="plan-compare">
          {rows ? (
            <div className="plan-scroll">
              <table className="plan-table">
                <thead>
                  <tr>
                    <th scope="col">Option</th>
                    <th scope="col">Delivered (MWh)</th>
                    <th scope="col">Demand covered (%)</th>
                    <th scope="col">HP electricity (MWh)</th>
                    <th scope="col">Mean COP (SPF)</th>
                    <th scope="col">Unused DC heat (MWh)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((k, i) => (
                    <tr key={variants[i].id} className={i === best ? "plan-table__best" : undefined}>
                      <th scope="row">
                        {variants[i].name}
                        {i === best && <span className="plan-badge">best</span>}
                      </th>
                      <td>{fmt(k.deliveredMwh, 1)}</td>
                      <td>{fmt(k.coveragePct, 1)}</td>
                      <td>{fmt(k.hpElecMwh, 1)}</td>
                      <td>{k.spf ? fmt(k.spf, 2) : "–"}</td>
                      <td>{fmt(k.unusedMwh, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="plan-note">Best: the highest share of demand covered; on a tie, the one with less heat pump electricity.</p>
            </div>
          ) : (
            <p className="plan-note">
              {data.loading ? "Loading profiles…" : !keys.length ? "No heat source: this dataset has no columns to take the heat from." : "No data."}
            </p>
          )}
        </Card>

        <Card title="Operation">
          <Field label="Option">
            <select className="field field--sm plan-pick" value={pv?.id} onChange={(e) => setPicked(Number(e.target.value))}>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <KpiRow className="plan-kpis">
            <Kpi label="Heat pump runs" value={op ? hrs(op.hpHours) : "–"} unit="h" tone="var(--accent)" sub={op ? `of ${hrs(op.hours)} h` : undefined} />
            <Kpi
              label="HP mean load"
              value={op?.hpLoadPct != null ? fmt(op.hpLoadPct, 0) : "–"}
              unit="%"
              tone="var(--accent)"
              bar={op?.hpLoadPct ?? undefined}
              sub="while running"
            />
            <Kpi label="Direct HEX" value={op ? hrs(op.directHours) : "–"} unit="h" tone="var(--heat-strong)" />
            <Kpi
              label="Storage full"
              value={op ? hrs(op.tankFullHours) : "–"}
              unit="h"
              tone="var(--ok)"
              sub={op && op.tankEmptyHours !== null ? `empty ${hrs(op.tankEmptyHours)} h` : "no storage"}
            />
            <Kpi label="Peak not covered" value={op ? fmt(op.peakUnmetKw) : "–"} unit="kW" tone="var(--danger)" />
          </KpiRow>
        </Card>
      </details>
    </div>
  );
}
